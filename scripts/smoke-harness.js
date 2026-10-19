'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function prepare() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'markdown-notes-smoke-'));
  const note = [
    '# 标题',
    '',
    '## 子标题',
    '',
    '第一段 **粗体** 和 [外部链接](https://example.com)。',
    '',
    '![远程图片](https://example.com/pixel.png)',
    '',
    '<script>window.__xss = true</script>',
    '',
    '[危险链接](javascript:alert(1))',
    '',
    '- 项目一',
    '- 项目二',
    '',
    '```js',
    'const x = 1;',
    '```',
    ''
  ].join('\n');
  await fsp.mkdir(path.join(root, '子目录'));
  await fsp.mkdir(path.join(root, '忽略目录'));
  await fsp.writeFile(path.join(root, '笔记.md'), note, 'utf8');
  await fsp.writeFile(path.join(root, '其他.md'), '# 其他\n\n无关内容。\n', 'utf8');
  await fsp.writeFile(path.join(root, '子目录', '任务.md'), '# 任务\n\n这里是苹果搜索关键字。\n', 'utf8');
  await fsp.writeFile(path.join(root, '忽略目录', '隐藏.md'), '# 隐藏\n\n不应出现在目录树。\n', 'utf8');
  await fsp.writeFile(path.join(root, '消失.md'), '# 消失\n\n稍后从磁盘删除。\n', 'utf8');
  return root;
}

async function run(context) {
  const { win, app, testRoot, log } = context;
  const results = [];
  let pageError = null;

  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) pageError = message;
  });

  const js = (code) => win.webContents.executeJavaScript(code, true);
  const quote = (value) => JSON.stringify(value);

  async function waitFor(code, label, timeout = 10000) {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await js(`Boolean(${code})`)) return true;
      } catch (error) {
        lastError = error;
      }
      await sleep(80);
    }
    throw new Error(`等待超时：${label}${lastError ? ` (${lastError.message})` : ''}`);
  }

  async function waitForDisk(filePath, needle, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const text = await fsp.readFile(filePath, 'utf8');
        if (text.includes(needle)) return text;
      } catch {
        // 文件可能尚未创建。
      }
      await sleep(120);
    }
    throw new Error(`磁盘内容未出现：${needle}`);
  }

  async function step(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`[PASS] ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.error(`[FAIL] ${name}\n       ${error.message}`);
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  const getState = () => js('window.__mdTest.getState()');
  const getText = () => js('window.__mdTest.getText()');
  const setText = (text) => js(`window.__mdTest.setText(${quote(text)})`);
  const appendText = async (text) => {
    await js(`(() => { window.__mdTest.setText(window.__mdTest.getText() + ${quote(text)}); return true; })()`);
  };

  try {
    await waitFor('document.body.dataset.ready === "1"', '渲染进程就绪', 20000);

    await step('启动并加载目录树', async () => {
      assert(await js('Boolean(window.api && window.__mdTest)'), 'API 或测试钩子缺失');
      assert(await js('Boolean(window.CodeMirror && document.querySelector(".CodeMirror"))'), 'CodeMirror 未加载');
      const count = await js('document.querySelectorAll(".tree-row.file").length');
      assert(count >= 3, `目录树根层文件数量异常：${count}`);
      assert(await js('Boolean(document.querySelector(".tree-row.file[data-rel=\\"笔记.md\\"]"))'), '目录树缺少 笔记.md');
      assert(await js('Boolean(document.querySelector(".tree-row.dir[data-rel=\\"忽略目录\\"]"))'), '忽略目录初始应显示');
      await js('document.querySelector(".tree-row.dir[data-rel=\\"子目录\\"]").click()');
      await waitFor('document.querySelector(".tree-row.file[data-rel=\\"子目录/任务.md\\"]")', '展开子目录');
    });

    await step('打开文档、预览、安全与高亮', async () => {
      await js('document.querySelector(".tree-row.file[data-rel=\\"笔记.md\\"]").click()');
      await waitFor('window.__mdTest.getText().includes("# 标题")', '编辑器载入内容');
      await waitFor('document.querySelector("#preview h1")', '预览标题');
      await waitFor('document.querySelectorAll(".CodeMirror-linenumber").length > 0', '行号渲染');
      const original = await getText();
      const longDoc = ['# A', '', ...Array(40).fill('段落内容。\n'), '## B', '', ...Array(40).fill('段落内容。\n'), '## C', '', ...Array(40).fill('段落内容。\n')].join('\n');
      await setText(longDoc);
      await waitFor('document.querySelectorAll("#preview h2").length >= 2', '长文档预览');
      await js('document.querySelector(".CodeMirror").CodeMirror.scrollTo(null, 100000)');
      await waitFor('document.getElementById("previewPane").scrollTop > 100', '预览同步滚动');
      await js('(() => { const pane = document.getElementById("previewPane"); pane.scrollTop = pane.scrollHeight; return true; })()');
      await waitFor('document.querySelector(".CodeMirror").CodeMirror.getScrollInfo().top > 100', '预览反向同步滚动');
      await setText(original);
      await waitFor('window.__mdTest.getText().includes("# 标题")', '恢复原始文档');
      await waitFor('document.querySelector("#preview strong")', '预览恢复');
      const info = await js(`(() => {
        const preview = document.getElementById('preview');
        return {
          strong: preview.innerHTML.includes('<strong>粗体</strong>'),
          scriptTags: preview.querySelectorAll('script').length,
          jsLinks: preview.querySelectorAll('a[href^="javascript:"]').length,
          external: preview.querySelector('a[href="https://example.com"]') !== null,
          xss: Boolean(window.__xss),
          remoteImages: preview.querySelectorAll('img[src^="https://"]').length,
          highlighted: preview.querySelectorAll('.hljs-keyword, .hljs-string, .hljs-number').length,
          outline: document.querySelectorAll('.outline-item').length,
          lineNumbers: document.querySelectorAll('.CodeMirror-linenumber').length,
          tabs: window.__mdTest.getState().tabs.length
        };
      })()`);
      assert(info.strong, '粗体未渲染');
      assert(info.scriptTags === 0, '原始 HTML 脚本进入了 DOM');
      assert(info.jsLinks === 0, 'javascript: 链接未被移除');
      assert(info.external, '外部链接未保留');
      assert(!info.xss, '原始 HTML 脚本被执行');
      assert(info.remoteImages === 0, '默认不应加载远程图片');
      assert(info.highlighted > 0, '代码块语法高亮未生效');
      assert(info.outline >= 2, `大纲数量异常：${info.outline}`);
      assert(info.lineNumbers > 0, '行号未渲染');
      assert(info.tabs >= 1, '标签页未创建');
    });

    await step('工具栏格式化并自动保存', async () => {
      await js(`(() => {
        const text = window.__mdTest.getText();
        const start = text.indexOf('第一段');
        window.__mdTest.setSelection(start, start + 3);
        document.querySelector('.tool-btn[data-format="bold"]').click();
        return true;
      })()`);
      await waitFor('window.__mdTest.getText().includes("**第一段**")', '工具栏粗体');
      await waitForDisk(path.join(testRoot, '笔记.md'), '**第一段**');
      await waitFor('document.getElementById("statusSave").textContent === "已保存"', '自动保存状态');
    });

    await step('查找与全部替换', async () => {
      await js('document.getElementById("btnFind").click()');
      await waitFor('document.getElementById("findbar").hidden === false', '查找栏');
      await js(`(() => {
        const input = document.getElementById('findInput');
        input.value = '粗体';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await waitFor('document.getElementById("findCount").textContent !== "0/0"', '查找命中');
      await js('document.getElementById("replaceInput").value = "加粗"');
      await js('document.getElementById("replaceAll").click()');
      await waitFor('window.__mdTest.getText().includes("**加粗**")', '全部替换');
      await js('document.getElementById("findClose").click()');
    });

    await step('多标签页切换', async () => {
      await js('document.querySelector(".tree-row.file[data-rel=\\"其他.md\\"]").click()');
      await waitFor('window.__mdTest.getState().tabs.length >= 2', '打开第二个标签');
      await waitFor('window.__mdTest.getText().includes("# 其他")', '第二个标签内容');
      const firstId = await js('String(window.__mdTest.getState().tabs[0].id)');
      await js(`document.querySelector('.tab[data-id="${firstId}"]').click()`);
      await waitFor('window.__mdTest.getText().includes("# 标题")', '切回第一个标签');
      assert((await getState()).tabs.length >= 2, '标签数量异常');
    });

    await step('插入表格', async () => {
      await js('document.querySelector(".tool-btn[data-format=\\"table\\"]").click()');
      await waitFor('window.__mdTest.getText().includes("| ---- | ---- | ---- |")', '插入表格');
      await waitForDisk(path.join(testRoot, '笔记.md'), '| ---- | ---- | ---- |');
    });

    await step('编辑器右键菜单', async () => {
      await js(`(() => {
        const wrapper = document.querySelector('.CodeMirror');
        wrapper.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 220, clientY: 220 }));
        return true;
      })()`);
      await waitFor('document.getElementById("contextMenu").hidden === false', '编辑器右键菜单');
      const menu = await js('document.getElementById("contextMenu").textContent');
      assert(menu.includes('插入日期时间'), '右键菜单缺少插入日期时间');
      await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await waitFor('document.getElementById("contextMenu").hidden === true', '关闭右键菜单');
    });

    await step('外部修改冲突处理', async () => {
      const filePath = path.join(testRoot, '笔记.md');
      await fsp.appendFile(filePath, '\n\n外部修改内容。\n', 'utf8');
      await sleep(120);
      await appendText('\n\n布局冲突测试。');
      await waitFor('document.getElementById("conflict").hidden === false', '冲突提示', 6000);
      await js('document.getElementById("btnOverwrite").click()');
      await waitFor('document.getElementById("conflict").hidden === true', '覆盖后隐藏冲突提示', 6000);
      const text = await waitForDisk(filePath, '布局冲突测试。');
      assert(!text.includes('外部修改内容。'), '覆盖保存没有以编辑器内容为准');
    });

    await step('全文搜索并跳转到命中行', async () => {
      await js(`(() => {
        const input = document.getElementById('searchInput');
        input.value = '苹果';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`);
      await waitFor('document.querySelector(".search-result")', '搜索结果', 8000);
      const resultText = await js('document.querySelector(".search-results").textContent');
      assert(resultText.includes('任务.md'), '搜索结果缺少 任务.md');
      await js('document.querySelector(".search-result").click()');
      await waitFor('window.__mdTest.getState().tabs.some((tab) => tab.relPath === "子目录/任务.md")', '打开搜索结果标签');
      await waitFor('window.__mdTest.getText().includes("苹果")', '跳转到搜索结果内容');
      const cursor = await js('document.getElementById("statusCursor").textContent');
      assert(cursor.startsWith('行 3'), `搜索跳转行号异常：${cursor}`);
    });

    await step('新建笔记并写入内容', async () => {
      await js('document.getElementById("btnNewNote").click()');
      await waitFor('document.getElementById("modal").hidden === false', '新建笔记弹框');
      await js(`(() => {
        document.getElementById('modalInput').value = '冒烟笔记.md';
        document.getElementById('modalForm').requestSubmit();
        return true;
      })()`);
      await waitFor('window.__mdTest.getState().tabs.some((tab) => tab.relPath === "子目录/冒烟笔记.md")', '新建文件标签');
      const newPath = path.join(testRoot, '子目录', '冒烟笔记.md');
      await waitForDisk(newPath, '');
      await setText('# 冒烟\n\n新建内容。');
      await waitForDisk(newPath, '新建内容。');
    });

    await step('重命名当前笔记', async () => {
      await js(`(() => {
        const row = document.querySelector('.tree-row.file[data-rel="子目录/冒烟笔记.md"]');
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }));
        return true;
      })()`);
      await waitFor('document.getElementById("contextMenu").hidden === false', '打开右键菜单');
      await js(`(() => {
        Array.from(document.querySelectorAll('#contextMenu button')).find((button) => button.textContent === '重命名').click();
        return true;
      })()`);
      await waitFor('document.getElementById("modal").hidden === false', '重命名弹框');
      await js(`(() => {
        document.getElementById('modalInput').value = '重命名笔记.md';
        document.getElementById('modalForm').requestSubmit();
        return true;
      })()`);
      await waitFor('document.querySelector(".tree-row.file[data-rel=\\"子目录/重命名笔记.md\\"]")', '重命名后目录项');
      await waitFor('window.__mdTest.getState().tabs.some((tab) => tab.relPath === "子目录/重命名笔记.md")', '重命名后标签路径');
      assert(fs.existsSync(path.join(testRoot, '子目录', '重命名笔记.md')), '重命名后的文件不存在');
      assert(!fs.existsSync(path.join(testRoot, '子目录', '冒烟笔记.md')), '旧文件仍然存在');
    });

    await step('设置界面与远程图片开关', async () => {
      await js('window.__mdTest.openRel("笔记.md")');
      await waitFor('window.__mdTest.getText().includes("# 标题")', '设置前打开笔记');
      await js('document.getElementById("btnSettings").click()');
      await waitFor('document.getElementById("settingsModal").hidden === false', '设置弹框');
      await js(`(() => {
        document.getElementById('setRemoteImages').checked = true;
        document.getElementById('setIgnoreDirs').value = '忽略目录';
        document.getElementById('settingsForm').requestSubmit();
        return true;
      })()`);
      await waitFor('window.__mdTest.getState().settings.remoteImages === true', '远程图片设置生效');
      await waitFor('window.__mdTest.getState().settings.ignoreDirs.includes("忽略目录")', '忽略目录设置生效');
      await waitFor('!document.querySelector(".tree-row.dir[data-rel=\\"忽略目录\\"]")', '忽略目录从目录树移除');
      await waitFor('document.querySelector(".tab.active") && window.__mdTest.getState().tabs.length > 0', '设置后标签仍在');
      await waitFor('document.querySelector("#preview img[src^=\\"https://\\"]")', '远程图片 DOM', 6000);
    });

    await step('历史快照创建与列出', async () => {
      await js('document.getElementById("btnHistory").click()');
      await waitFor('document.getElementById("historyModal").hidden === false', '历史弹框');
      await js('document.getElementById("historyCreate").click()');
      await waitFor('document.querySelector("#historyList .history-item")', '快照列表', 8000);
      await js('document.getElementById("historyClose").click()');
    });

    await step('缺失文件保存引导', async () => {
      await js('document.querySelector(".tree-row.file[data-rel=\\"消失.md\\"]").click()');
      await waitFor('window.__mdTest.getState().tabs.some((tab) => tab.relPath === "消失.md")', '打开消失.md');
      await fsp.rm(path.join(testRoot, '消失.md'), { force: true });
      await appendText('\n\n删除后的编辑。');
      await waitFor('document.getElementById("missing").hidden === false', '缺失文件提示', 6000);
      await js('document.getElementById("btnMissingDiscard").click()');
      await waitFor('!window.__mdTest.getState().tabs.some((tab) => tab.relPath === "消失.md")', '放弃后关闭标签', 6000);
    });

    await step('图片落盘与唯一命名', async () => {
      const stateInfo = await getState();
      const tab = stateInfo.tabs.find((item) => item.relPath === '笔记.md');
      assert(tab && tab.path, '当前标签路径缺失');
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZkAAAAASUVORK5CYII=';
      const saved = await js(`(async () => {
        const bytes = Uint8Array.from(atob(${quote(png)}), (c) => c.charCodeAt(0));
        const one = await window.api.saveImageBuffer({ path: ${quote(tab.path)}, name: 'dot.png', mime: 'image/png', data: bytes });
        const two = await window.api.saveImageBuffer({ path: ${quote(tab.path)}, name: 'dot.png', mime: 'image/png', data: bytes });
        return { one, two };
      })()`);
      assert(saved.one && saved.two, '图片保存失败');
      assert(saved.one.name !== saved.two.name, '重名图片未加后缀');
      assert(fs.existsSync(path.join(testRoot, 'assets', saved.one.name)), '图片文件未落盘');
    });

    await step('草稿恢复', async () => {
      const stateInfo = await getState();
      const tab = stateInfo.tabs.find((item) => item.relPath === '笔记.md');
      assert(tab && tab.path, '缺少用于恢复的文件');
      await js(`window.api.saveRecovery({
        key: ${quote(tab.path.toLowerCase())},
        path: ${quote(tab.path)},
        name: '笔记.md',
        relPath: '笔记.md',
        content: '# 恢复内容\\n\\n来自上次异常退出。',
        eol: 'lf',
        encoding: 'utf8',
        mtimeMs: Date.now() - 60000,
        timestamp: Date.now()
      })`);
      win.reload();
      await waitFor('document.body.dataset.ready === "1"', '重载后渲染进程就绪', 20000);
      await waitFor('document.getElementById("recoveryModal").hidden === false', '恢复草稿弹框', 10000);
      await js('document.getElementById("recoveryRestore").click()');
      await waitFor('window.__mdTest.getState().tabs.some((tab) => tab.recovered)', '恢复标签');
      await waitFor('window.__mdTest.getText().includes("恢复内容")', '恢复内容载入');
      await js(`window.api.clearAllRecovery()`);
    });

    await step('主题与布局切换', async () => {
      await js('document.getElementById("btnTheme").click()');
      await waitFor('document.documentElement.dataset.theme === "dark"', '深色主题');
      await js('document.getElementById("btnTheme").click()');
      await waitFor('document.documentElement.dataset.theme === "light"', '浅色主题');
      await js('document.getElementById("btnTogglePreview").click()');
      assert(await js('document.getElementById("editorWrap").classList.contains("preview-hidden")'), '预览未隐藏');
      await js('document.getElementById("btnTogglePreview").click()');
      assert(await js('!document.getElementById("editorWrap").classList.contains("preview-hidden")'), '预览未恢复');
      await js('document.getElementById("btnToggleSidebar").click()');
      assert(await js('document.getElementById("app").classList.contains("sidebar-hidden")'), '侧边栏未隐藏');
      await js('document.getElementById("btnToggleSidebar").click()');
      assert(await js('!document.getElementById("app").classList.contains("sidebar-hidden")'), '侧边栏未恢复');
    });

    await step('删除文件并清空标签', async () => {
      await js('(() => { const folder = document.querySelector(".tree-row.dir[data-rel=\\"子目录\\"]"); if (folder && !folder.classList.contains("open")) folder.click(); return true; })()');
      await waitFor('document.querySelector(".tree-row.file[data-rel=\\"子目录/重命名笔记.md\\"]")', '展开子目录后定位文件');
      await js(`(() => {
        const row = document.querySelector('.tree-row.file[data-rel="子目录/重命名笔记.md"]');
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }));
        return true;
      })()`);
      await waitFor('document.getElementById("contextMenu").hidden === false', '打开删除菜单');
      await js(`(() => {
        Array.from(document.querySelectorAll('#contextMenu button')).find((button) => button.textContent === '删除文件').click();
        return true;
      })()`);
      await waitFor('!document.querySelector(".tree-row.file[data-rel=\\"子目录/重命名笔记.md\\"]")', '目录项移除');
      await waitFor('!window.__mdTest.getState().tabs.some((tab) => tab.relPath === "子目录/重命名笔记.md")', '标签移除');
      assert(!fs.existsSync(path.join(testRoot, '子目录', '重命名笔记.md')), '删除后文件仍然存在');
    });

    await step('截图留证', async () => {
      await js(`(() => {
        const input = document.getElementById('searchInput');
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        window.__mdTest.openRel('其他.md');
        return true;
      })()`);
      await waitFor('window.__mdTest.getText().includes("# 其他")', '截图前载入笔记');
      await js('document.getElementById("toasts").replaceChildren()');
      await sleep(300);
      win.showInactive();
      await sleep(250);
      const image = await win.webContents.capturePage();
      const outDir = path.join(__dirname, '..', 'tmp');
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, 'smoke-editor.png');
      fs.writeFileSync(outFile, image.toPNG());
      const size = fs.statSync(outFile).size;
      assert(size > 10000, `截图文件过小：${size}`);
      console.log(`       截图：${outFile} (${size} bytes)`);
      win.hide();
    });
  } catch (error) {
    results.push({ name: '测试执行', ok: false, error });
    console.error(`[FATAL] ${error.stack || error}`);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n冒烟测试：${results.length - failed.length}/${results.length} 通过`);
  if (pageError) console.log(`页面最近错误：${pageError}`);
  await fsp.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  log('info', 'smoke', `${results.length - failed.length}/${results.length} passed`);
  app.exit(failed.length === 0 ? 0 : 1);
}

module.exports = { prepare, run };
