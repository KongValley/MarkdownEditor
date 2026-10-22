'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function prepare() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'markdown-notes-smoke-'));
  const secondRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'markdown-notes-smoke-lib2-'));
  const thirdRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'markdown-notes-smoke-third-'));
  const note = [
    '---',
    'title: 标题',
    'tags: [知识库, 测试]',
    '---',
    '# 标题',
    '',
    '## 子标题',
    '',
    '第一段 **粗体** 和 [外部链接](https://example.com)。',
    '',
    '双链：[[任务]] 与 [[任务|别名]]',
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
  await fsp.writeFile(path.join(root, '子目录', '任务.md'), '# 任务\n\n这里是苹果搜索关键字。\n\n引用：[[笔记]]\n', 'utf8');
  await fsp.writeFile(path.join(root, '忽略目录', '隐藏.md'), '# 隐藏\n\n不应出现在目录树。\n', 'utf8');
  await fsp.writeFile(path.join(root, '消失.md'), '# 消失\n\n稍后从磁盘删除。\n', 'utf8');
  await fsp.writeFile(path.join(secondRoot, '外部.md'), '---\ntags: [第二库]\n---\n# 外部\n\n苹果也出现在另一个知识库。\n', 'utf8');
  await fsp.writeFile(path.join(root, '编辑体验.md'), '# 一级\n\n## 二级\n\n### 三级\n\n段落 abc 123，第二段 456，第三段 789。\n', 'utf8');
  await fsp.writeFile(path.join(root, 'crlf.md'), Buffer.from('# CRLF\r\n\r\n第一行\r\n第二行\r\n', 'utf8'));
  await fsp.writeFile(path.join(root, 'utf16.md'), Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('# UTF16\n\n中文内容\n', 'utf16le')
  ]));
  await fsp.writeFile(path.join(root, 'gbk.md'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
  const fixtures = {
    '保存实验.md': '# 保存实验\n\n初始内容。\n',
    '另存为源.md': '# 另存为\n\n源内容。\n',
    '消失2.md': '# 消失2\n\n稍后删除。\n',
    '历史.md': '# 历史\n\n版本零。\n',
    '冲突2.md': '# 冲突2\n\n本地内容。\n',
    '重名测试.md': '# 重名\n\n用于重名检查。\n',
    '关闭测试.md': '# 关闭\n\n用于关闭检查。\n',
    '恢复保存.md': '# 恢复保存\n\n磁盘旧内容。\n',
    '恢复丢弃.md': '# 恢复丢弃\n\n磁盘旧内容。\n'
  };
  for (const [name, content] of Object.entries(fixtures)) {
    await fsp.writeFile(path.join(root, name), content, 'utf8');
  }
  return { root, secondRoot, thirdRoot };
}

async function run(context) {
  const { win, app, testRoot, secondRoot, thirdRoot, testControls, log } = context;
  const results = [];
  const pageErrors = [];
  const startedAt = Date.now();
  const tmpDir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  let currentSuite = '基础';

  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 2 && pageErrors.length < 50) pageErrors.push({ level, message });
  });

  const js = (code) => win.webContents.executeJavaScript(code, true);
  const quote = (value) => JSON.stringify(value);

  function suite(name) {
    currentSuite = name;
  }

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

  async function waitForFile(filePath, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (fs.existsSync(filePath)) return true;
      await sleep(100);
    }
    throw new Error(`文件未生成：${filePath}`);
  }

  async function waitForText(selector, needle, label, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const text = await js(`(document.querySelector(${quote(selector)}) || {}).textContent || ''`);
        if (String(text).includes(needle)) return text;
      } catch {
        // 元素可能尚未创建。
      }
      await sleep(100);
    }
    throw new Error(`等待超时：${label}`);
  }

  async function step(name, fn) {
    const started = Date.now();
    try {
      await fn();
      results.push({ suite: currentSuite, name, ok: true, ms: Date.now() - started, error: null });
      console.log(`[PASS] ${currentSuite} · ${name} (${Date.now() - started}ms)`);
    } catch (error) {
      results.push({ suite: currentSuite, name, ok: false, ms: Date.now() - started, error: error.message || String(error) });
      console.error(`[FAIL] ${currentSuite} · ${name} (${Date.now() - started}ms)\n       ${error.message || error}`);
    } finally {
      if (testControls) {
        testControls.confirmResponse = 1;
        testControls.addLibraryPath = null;
        testControls.saveAsPath = null;
        testControls.printPath = null;
      }
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(`${message}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
  }

  const menu = (action) => win.webContents.send('menu:action', action);
  const setConfirm = (response) => {
    testControls.confirmResponse = response;
  };
  const toastTexts = () => js(`[...document.querySelectorAll('#toasts .toast')].map((node) => node.textContent)`);

  async function waitToast(text, timeout = 6000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const toasts = await toastTexts();
        if (toasts.some((item) => item.includes(text))) return true;
      } catch {
        // 页面可能正在重载。
      }
      await sleep(80);
    }
    throw new Error(`等待 toast 超时：${text}`);
  }

  async function saveNow() {
    menu('save');
    await waitFor('document.getElementById("statusSave").textContent === "已保存"', '手动保存完成', 15000);
  }

  async function capture(name, assertMin = 10000) {
    win.showInactive();
    await sleep(250);
    const image = await win.webContents.capturePage();
    const outFile = path.join(tmpDir, `e2e-${name}.png`);
    fs.writeFileSync(outFile, image.toPNG());
    const size = fs.statSync(outFile).size;
    assert(size > assertMin, `截图 ${name} 文件过小：${size}`);
    return outFile;
  }

  function writeReport(failed) {
    const report = {
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      passed: results.length - failed.length,
      failed: failed.length,
      platform: process.platform,
      electron: process.versions.electron,
      consoleMessages: pageErrors,
      steps: results.map((item) => ({ ...item }))
    };
    fs.writeFileSync(path.join(tmpDir, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf8');
    const lines = [
      '# E2E 报告',
      '',
      `- 结果：${report.passed}/${results.length} 通过`,
      `- 耗时：${report.durationMs}ms`,
      `- 平台：${report.platform} / Electron ${report.electron}`,
      `- 控制台警告/错误：${pageErrors.length}`,
      '',
      '| 套件 | 步骤 | 结果 | 毫秒 |',
      '| --- | --- | --- | --- |'
    ];
    for (const item of results) {
      lines.push(`| ${item.suite} | ${item.name.replace(/\|/g, '\\|')} | ${item.ok ? 'PASS' : 'FAIL'} | ${item.ms} |`);
    }
    if (failed.length > 0) {
      lines.push('', '## 失败', '');
      for (const item of failed) lines.push(`- **${item.suite} · ${item.name}**：${item.error}`);
    }
    const slowest = results.slice().sort((a, b) => b.ms - a.ms).slice(0, 5);
    lines.push('', '## 最慢 5 步', '');
    for (const item of slowest) lines.push(`- ${item.suite} · ${item.name}：${item.ms}ms`);
    if (pageErrors.length > 0) {
      lines.push('', '## 控制台消息', '');
      for (const item of pageErrors) lines.push(`- level ${item.level}: ${item.message}`);
    }
    fs.writeFileSync(path.join(tmpDir, 'e2e-report.md'), `${lines.join('\n')}\n`, 'utf8');
    return report;
  }

  const getState = () => js('window.__mdTest.getState()');
  const getText = () => js('window.__mdTest.getText()');
  const setText = (text) => js(`window.__mdTest.setText(${quote(text)})`);
  const appendText = async (text) => {
    await js(`(() => { window.__mdTest.setText(window.__mdTest.getText() + ${quote(text)}); return true; })()`);
  };

  const clickTree = (rel) => js(`(() => {
    const row = document.querySelector('.tree-row[data-rel="' + ${quote(rel)} + '"]');
    if (!row) throw new Error('目录项不存在：' + ${quote(rel)});
    row.click();
    return true;
  })()`);

  async function openTreeMenu(rel) {
    await js(`(() => {
      const row = document.querySelector('.tree-row[data-rel="' + ${quote(rel)} + '"]');
      if (!row) throw new Error('目录项不存在：' + ${quote(rel)});
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }));
      return true;
    })()`);
    await waitFor('document.getElementById("contextMenu").hidden === false', '目录右键菜单');
  }

  const chooseMenu = (label) => js(`(() => {
    const button = Array.from(document.querySelectorAll('#contextMenu button')).find((item) => item.textContent === ${quote(label)});
    if (!button) throw new Error('菜单项不存在：' + ${quote(label)});
    button.click();
    return true;
  })()`);

  const submitModal = (value) => js(`(() => {
    document.getElementById('modalInput').value = ${quote(value)};
    document.getElementById('modalForm').requestSubmit();
    return true;
  })()`);

  const clickLibrary = (name) => js(`(() => {
    const row = Array.from(document.querySelectorAll('#libraryList .library-row')).find((item) => item.textContent.includes(${quote(name)}));
    if (!row) throw new Error('知识库行不存在：' + ${quote(name)});
    row.click();
    return true;
  })()`);

  const openLibraryRowMenu = async (name) => {
    await js(`(() => {
      const row = Array.from(document.querySelectorAll('#libraryList .library-row')).find((item) => item.textContent.includes(${quote(name)}));
      if (!row) throw new Error('知识库行不存在：' + ${quote(name)});
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }));
      return true;
    })()`);
    await waitFor('document.getElementById("contextMenu").hidden === false', '知识库右键菜单');
  };

  const openCardMenu = async (libraryPath) => {
    await js(`(() => {
      const card = Array.from(document.querySelectorAll('#libraryCards .lib-card')).find((item) => item.dataset.path === ${quote(libraryPath)});
      if (!card) throw new Error('知识库卡片不存在');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }));
      return true;
    })()`);
    await waitFor('document.getElementById("contextMenu").hidden === false', '知识库卡片右键菜单');
  };

  let editOriginal = '';

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
      await js('window.__mdTest.scrollEditorTo(100000)');
      await waitFor('document.getElementById("previewPane").scrollTop > 100', '预览同步滚动');
      await js('window.__mdTest.scrollPreviewTo(document.getElementById("previewPane").scrollHeight)');
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
      await js('(() => { const text = window.__mdTest.getText(); window.__mdTest.setSelection(text.length, text.length); return true; })()');
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

    await step('最近打开删除与清空', async () => {
      await waitFor('window.__mdTest.getState().recent.length >= 1', '最近记录生成');
      assert(await js('Boolean(document.querySelector(".recent-item .recent-remove"))'), '最近记录缺少删除按钮');
      const before = (await getState()).recent.length;
      await js('document.querySelector(".recent-item .recent-remove").click()');
      await waitFor(`window.__mdTest.getState().recent.length === ${before - 1}`, '单条删除');
      await js('document.getElementById("btnClearRecent").click()');
      await waitFor('window.__mdTest.getState().recent.length === 0', '清空最近记录');
      assert(await js('document.getElementById("recentWrap").hidden === true'), '清空后最近区域未隐藏');
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
      await js('document.querySelector("#viewSwitch [data-mode=\\"reading\\"]").click()');
      await waitFor('document.getElementById("editorWrap").classList.contains("mode-reading")', '阅读模式');
      assert(await js('document.querySelector(".editor-pane").offsetParent === null'), '阅读模式仍显示编辑区');
      await js('document.querySelector("#viewSwitch [data-mode=\\"split\\"]").click()');
      await waitFor('!document.getElementById("editorWrap").classList.contains("mode-reading")', '分栏恢复');
      await js('document.getElementById("btnToggleSidebar").click()');
      assert(await js('document.getElementById("app").classList.contains("sidebar-hidden")'), '侧边栏未隐藏');
      await js('document.getElementById("btnToggleSidebar").click()');
      assert(await js('!document.getElementById("app").classList.contains("sidebar-hidden")'), '侧边栏未恢复');
    });

    await step('关闭恢复草稿', async () => {
      await js('document.querySelector(".tab.recovered .tab-close").click()');
      await waitFor('!window.__mdTest.getState().tabs.some((tab) => tab.recovered)', '恢复草稿标签关闭');
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

    await step('工作台与知识库卡片', async () => {
      await js('document.getElementById("btnHome").click()');
      await waitFor('window.__mdTest.getState().view === "home"', '工作台视图');
      await waitFor('document.querySelectorAll("#libraryCards .lib-card").length === 3', '工作台卡片');
      const libCount = await js('window.__mdTest.getState().libraries.length');
      assert(libCount === 2, `知识库数量异常：${libCount}`);
      const rowCount = await js('document.querySelectorAll("#libraryList .library-row").length');
      assert(rowCount === 2, `侧栏知识库数量异常：${rowCount}`);
      await js('Array.from(document.querySelectorAll("#libraryCards .lib-card")).find((card) => card.textContent.includes("第二库")).click()');
      await waitFor('window.__mdTest.getState().view === "library"', '切换知识库视图');
      await waitFor('document.getElementById("libTitle").textContent === "第二库"', '第二库标题');
      await waitFor('document.getElementById("docList").textContent.includes("外部")', '第二库文档列表', 8000);
    });

    await step('文档目录与标签', async () => {
      await js('Array.from(document.querySelectorAll("#libraryList .library-row")).find((row) => row.textContent.includes("测试库")).click()');
      await waitFor(`window.__mdTest.getState().activeLibrary === ${quote(testRoot)}`, '切回测试库');
      await waitFor('window.__mdTest.getState().catalogCount >= 3', '文档索引', 10000);
      await waitFor('document.getElementById("docList").textContent.includes("标题")', '文档列表标题');
      const hasTag = await js('Array.from(document.querySelectorAll("#tagFilter .tag-chip")).some((chip) => chip.textContent.includes("知识库"))');
      assert(hasTag, '标签筛选缺少「知识库」');
      await js('Array.from(document.querySelectorAll("#tagFilter .tag-chip")).find((chip) => chip.textContent.includes("知识库")).click()');
      await waitFor('document.querySelectorAll("#docList .doc-row").length === 1', '标签筛选结果');
      assert(await js('document.getElementById("docList").textContent.includes("标题")'), '标签筛选结果不含标题文档');
      await js('Array.from(document.querySelectorAll("#tagFilter .tag-chip")).find((chip) => chip.textContent.trim() === "全部").click()');
      await waitFor('document.querySelectorAll("#docList .doc-row").length >= 3', '清除标签筛选');
    });

    await step('收藏', async () => {
      await js('window.__mdTest.openRel("笔记.md")');
      await waitFor('window.__mdTest.getText().includes("# 标题")', '打开待收藏文档');
      await js('document.getElementById("btnStar").click()');
      await waitFor('document.getElementById("btnStar").textContent === "★"', '收藏状态');
      await js('document.getElementById("btnHome").click()');
      await waitFor('document.getElementById("starredList").textContent.includes("笔记")', '收藏列表');
      await js('document.querySelector("#starredList .star-toggle").click()');
      await waitFor('document.getElementById("starredWrap").hidden === true', '取消收藏');
    });

    await step('双链与反向链接', async () => {
      await js('Array.from(document.querySelectorAll("#libraryCards .lib-card")).find((card) => card.textContent.includes("测试库")).click()');
      await waitFor('window.__mdTest.getState().view === "library"', '回到测试库');
      await js('window.__mdTest.openRel("笔记.md")');
      await waitFor('document.querySelector(\'a.wiki-link[data-wiki-target="任务"]\')', '双链渲染');
      await js('document.querySelector(\'a.wiki-link[data-wiki-target="任务"]\').click()');
      await waitFor('window.__mdTest.getState().tabs.find((tab) => tab.relPath === "子目录/任务.md" && tab.id === window.__mdTest.getState().activeId)', '打开双链目标');
      assert(await js(`window.__mdTest.getState().tabs.find((tab) => tab.relPath === "子目录/任务.md").libraryRoot === ${quote(testRoot)}`), '双链目标库异常');
      await waitFor('document.getElementById("backlinkList").textContent.includes("笔记")', '反向链接列表');
    });

    await step('跨库搜索', async () => {
      await js(`(() => {
        const input = document.getElementById('searchInput');
        input.value = '苹果';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`);
      await waitFor('document.querySelectorAll(".search-group").length === 2', '跨库搜索结果', 10000);
      const text = await js('document.getElementById("searchResults").textContent');
      assert(text.includes('测试库') && text.includes('第二库'), '搜索结果缺少知识库分组');
      await js(`(() => {
        const group = Array.from(document.querySelectorAll('.search-group')).find((item) => item.textContent.includes('第二库'));
        group.querySelector('.search-result').click();
        return true;
      })()`);
      await waitFor(`window.__mdTest.getState().tabs.find((tab) => tab.id === window.__mdTest.getState().activeId && tab.libraryRoot && tab.libraryRoot.toLowerCase() === ${quote(secondRoot.toLowerCase())})`, '打开第二库命中');
      await waitFor('window.__mdTest.getText().includes("苹果")', '第二库命中内容');
      await js('Array.from(document.querySelectorAll("#libraryList .library-row")).find((row) => row.textContent.includes("测试库")).click()');
      await waitFor(`window.__mdTest.getState().activeLibrary === ${quote(testRoot)}`, '搜索后切回测试库');
    });

    await step('移除知识库', async () => {
      await js(`(() => {
        const row = Array.from(document.querySelectorAll('#libraryList .library-row')).find((item) => item.textContent.includes('第二库'));
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }));
        return true;
      })()`);
      await waitFor('document.getElementById("contextMenu").hidden === false', '知识库右键菜单');
      await js(`(() => {
        const item = Array.from(document.querySelectorAll('#contextMenu button')).find((button) => button.textContent === '从列表移除…');
        item.click();
        return true;
      })()`);
      await waitFor('window.__mdTest.getState().libraries.length === 1', '移除知识库', 10000);
      await waitFor('!document.getElementById("libraryCards").textContent.includes("第二库")', '首页卡片移除');
      assert(fs.existsSync(secondRoot), '移除知识库时删除了磁盘文件');
      await waitFor(`window.__mdTest.getState().activeLibrary === ${quote(testRoot)}`, '移除后回到测试库');
      await waitFor(`window.__mdTest.getState().recent.every((item) => !item.path.toLowerCase().startsWith(${quote(secondRoot.toLowerCase())}))`, '移除库清理最近记录');
      const recentText = await js('document.getElementById("recentList").textContent');
      assert(!recentText.includes('外部'), '移除知识库后最近列表仍显示该库文档');
    });

    suite('体验契约');

    await step('设置弹框焦点', async () => {
      await js(`(() => {
        const button = document.getElementById('btnSettings');
        button.focus();
        button.click();
        return true;
      })()`);
      await waitFor('document.getElementById("settingsModal").hidden === false', '设置弹框');
      await waitFor('document.activeElement && document.activeElement.id === "setTheme"', '设置弹框初始焦点');
      await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await waitFor('document.getElementById("settingsModal").hidden === true', '关闭设置弹框');
      assertEqual(await js('document.activeElement && document.activeElement.id'), 'btnSettings', '设置关闭后焦点未回到触发按钮');
    });

    await step('菜单快捷键契约', async () => {
      const { Menu } = require('electron');
      const appMenu = Menu.getApplicationMenu();
      const accelerators = [];
      const walk = (items) => {
        for (const item of items || []) {
          if (!item.role && item.accelerator) accelerators.push(item.accelerator);
          if (item.submenu) walk(item.submenu.items);
        }
      };
      walk(appMenu && appMenu.items);
      const expected = ['Ctrl+N', 'Ctrl+Shift+O', 'Ctrl+O', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+P', 'Ctrl+W', 'Ctrl+,', 'Ctrl+F', 'Ctrl+Shift+F', 'Ctrl+Shift+B', 'Ctrl+E'];
      assertEqual(new Set(accelerators).size, accelerators.length, '菜单快捷键重复');
      assertEqual(accelerators.slice().sort().join('|'), expected.slice().sort().join('|'), '菜单快捷键集合不一致');
    });

    await step('历史弹框焦点', async () => {
      await js('window.__mdTest.openRel("其他.md")');
      await waitFor('window.__mdTest.getText().includes("# 其他")', '打开历史测试文档');
      await js(`(() => {
        const button = document.getElementById('btnHistory');
        button.focus();
        button.click();
        return true;
      })()`);
      await waitFor('document.getElementById("historyModal").hidden === false', '历史弹框');
      await waitFor('document.activeElement && document.activeElement.id === "historyClose"', '历史弹框初始焦点');
      await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await waitFor('document.getElementById("historyModal").hidden === true', '关闭历史弹框');
      assertEqual(await js('document.activeElement && document.activeElement.id'), 'btnHistory', '历史关闭后焦点未回到触发按钮');
    });

    await step('命名弹框焦点', async () => {
      const before = (await getState()).tabs.length;
      await js(`(() => {
        const button = document.getElementById('btnNewNote');
        button.focus();
        button.click();
        return true;
      })()`);
      await waitFor('document.getElementById("modal").hidden === false', '新建笔记弹框');
      await waitFor('document.activeElement && document.activeElement.id === "modalInput"', '命名弹框初始焦点');
      await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await waitFor('document.getElementById("modal").hidden === true', '关闭命名弹框');
      assertEqual(await js('document.activeElement && document.activeElement.id'), 'btnNewNote', '命名关闭后焦点未回到触发按钮');
      assertEqual((await getState()).tabs.length, before, '取消命名弹框后仍新建了标签');
    });

    await step('标签页键盘与语义', async () => {
      await js('window.__mdTest.openRel("其他.md")');
      await js('window.__mdTest.openRel("笔记.md")');
      await waitFor('window.__mdTest.getState().tabs.length >= 2', '打开两个标签');
      const first = await getState();
      const active = first.tabs.find((tab) => tab.id === first.activeId);
      assert(active, '缺少活动标签');
      assertEqual(await js(`document.querySelector('.tab[data-id="${active.id}"]').getAttribute('aria-selected')`), 'true', '活动标签 aria-selected 错误');
      assertEqual(await js(`document.querySelector('.tab[data-id="${active.id}"]').tabIndex`), 0, '活动标签不可键盘聚焦');
      await js(`document.querySelector('.tab[data-id="${active.id}"]').focus()`);
      await js(`(() => {
        const tab = document.querySelector('.tab[data-id="${active.id}"]');
        tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        return true;
      })()`);
      await waitFor(`window.__mdTest.getState().activeId !== ${active.id}`, '右箭头切换标签');
      const next = await getState();
      assertEqual(await js('document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id'), String(next.activeId), '右箭头后焦点未移动到新标签');
      await js(`(() => {
        const tab = document.querySelector('.tab.active');
        tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        return true;
      })()`);
      await waitFor(`window.__mdTest.getState().activeId === ${active.id}`, '左箭头切回标签');
      const count = (await getState()).tabs.length;
      menu('close-tab');
      await waitFor(`window.__mdTest.getState().tabs.length === ${count - 1}`, '菜单关闭标签');
    });

    await step('搜索无结果可清除', async () => {
      await js(`(() => {
        const input = document.getElementById('searchInput');
        input.value = '绝无此词';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`);
      await waitFor('document.querySelector(".search-empty")', '搜索空结果');
      const buttonText = await js('Array.from(document.querySelectorAll(".search-empty button")).map((button) => button.textContent).join("|")');
      assert(buttonText.includes('清除搜索'), '搜索空结果缺少清除按钮');
      await js('Array.from(document.querySelectorAll(".search-empty button")).find((button) => button.textContent === "清除搜索").click()');
      await waitFor('document.getElementById("searchView").hidden === true', '清除搜索返回文档');
      assertEqual(await js('document.getElementById("searchInput").value'), '', '清除后搜索框未清空');
      await waitFor('document.getElementById("searchResults").hidden === true', '清除搜索结果');
    });

    suite('编辑体验');

    await step('编辑检查准备', async () => {
      await js('window.__mdTest.updateSettings({ autosave: false })');
      await waitFor('window.__mdTest.getState().settings.autosave === false', '关闭自动保存');
      await js('window.__mdTest.openRel("编辑体验.md")');
      await waitFor('window.__mdTest.getText().includes("段落 abc")', '打开编辑体验文档');
      editOriginal = await getText();
    });

    await step('大纲跳转', async () => {
      await waitFor('document.querySelectorAll(".outline-item").length >= 3', '大纲条目');
      await js('Array.from(document.querySelectorAll(".outline-item")).find((item) => item.textContent === "三级").click()');
      await waitFor('window.__mdTest.getCursor().line === 4', '大纲跳转行');
      assert(await js('document.getElementById("statusCursor").textContent.startsWith("行 5")'), '状态栏行号未更新');
    });

    await step('列表续行', async () => {
      await setText('- 项目');
      await js('window.__mdTest.setSelection(4, 4)');
      await js(`(() => {
        const cm = document.querySelector('.CodeMirror').CodeMirror;
        cm.focus();
        cm.triggerOnKeyDown({ type: 'keydown', keyCode: 13, which: 13, preventDefault() {} });
        return true;
      })()`);
      await waitFor('window.__mdTest.getText() === "- 项目\\n- "', '列表续行');
      const cursor = await js('window.__mdTest.getCursor()');
      assertEqual(cursor.line, 1, '续行后光标行错误');
      assertEqual(cursor.ch, 2, '续行后光标列错误');
      await setText(editOriginal);
    });

    await step('表格 Tab 跳格', async () => {
      const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
      await setText(table);
      const start = table.indexOf('A');
      await js(`window.__mdTest.setSelection(${start}, ${start + 1})`);
      await js(`(() => {
        const cm = document.querySelector('.CodeMirror').CodeMirror;
        cm.focus();
        cm.triggerOnKeyDown({ type: 'keydown', keyCode: 9, which: 9, preventDefault() {} });
        return true;
      })()`);
      await waitFor('document.querySelector(".CodeMirror").CodeMirror.getSelection() === "B"', 'Tab 跳到下一格');
      await js(`(() => {
        const cm = document.querySelector('.CodeMirror').CodeMirror;
        cm.triggerOnKeyDown({ type: 'keydown', keyCode: 9, which: 9, shiftKey: true, preventDefault() {} });
        return true;
      })()`);
      await waitFor('document.querySelector(".CodeMirror").CodeMirror.getSelection() === "A"', 'Shift+Tab 回到上一格');
      await setText(editOriginal);
    });

    await step('查找正则/大小写/错误', async () => {
      await js('document.getElementById("btnFind").click()');
      await waitFor('document.getElementById("findbar").hidden === false', '查找栏');
      if (await js('document.getElementById("findRegex").classList.contains("active")')) {
        await js('document.getElementById("findRegex").click()');
      }
      if (await js('document.getElementById("findCase").classList.contains("active")')) {
        await js('document.getElementById("findCase").click()');
      }
      await js(`(() => {
        const input = document.getElementById('findInput');
        input.value = ${quote('\\d+')};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await js('document.getElementById("findRegex").click()');
      await waitFor('document.getElementById("findRegex").classList.contains("active")', '正则开关');
      await waitFor('document.getElementById("findCount").textContent.endsWith("/3")', '正则命中 3 处');
      await js(`(() => {
        const input = document.getElementById('findInput');
        input.value = ${quote('(')};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await waitFor('document.getElementById("findCount").textContent === "正则错误"', '非法正则提示');
      await js('document.getElementById("findRegex").click()');
      await waitFor('!document.getElementById("findRegex").classList.contains("active")', '关闭正则');
      await js('document.getElementById("findCase").click()');
      await waitFor('document.getElementById("findCase").classList.contains("active")', '开启大小写');
      await js(`(() => {
        const input = document.getElementById('findInput');
        input.value = 'ABC';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await waitFor('document.getElementById("findCount").textContent === "0/0"', '大小写无命中');
      await js('document.getElementById("findClose").click()');
    });

    await step('字数目标', async () => {
      await js('window.__mdTest.updateSettings({ wordGoal: 20 })');
      await waitFor('window.__mdTest.getState().settings.wordGoal === 20', '字数目标设置');
      await setText('字'.repeat(30));
      await waitFor('document.getElementById("statusWords").textContent.includes("/20 字")', '字数目标显示');
      assert(await js('document.getElementById("statusWords").classList.contains("goal-met")'), '达标状态未变色');
      await js('window.__mdTest.updateSettings({ wordGoal: 0 })');
      await waitFor('window.__mdTest.getState().settings.wordGoal === 0', '恢复字数目标');
      await setText(editOriginal);
    });

    await step('大文档暂停预览', async () => {
      await js('window.__mdTest.setText("# 大文档\\n\\n" + "a".repeat(300001))');
      await waitFor('document.querySelector("#preview .preview-limit")', '大文档预览暂停', 15000);
      const notice = await js('document.querySelector("#preview .preview-limit").textContent');
      assert(notice.includes('已暂停实时预览'), '大文档提示缺失');
      await setText(editOriginal);
      await waitFor('document.querySelector("#preview h1")', '预览恢复');
    });

    await step('视图切换', async () => {
      await js('document.querySelector(\'#viewSwitch [data-mode="reading"]\').click()');
      await waitFor('document.getElementById("editorWrap").classList.contains("mode-reading")', '阅读模式');
      assert(await js('document.querySelector(".editor-pane").offsetParent === null'), '阅读模式仍显示编辑区');
      await js('document.querySelector(\'#viewSwitch [data-mode="split"]\').click()');
      await waitFor('!document.getElementById("editorWrap").classList.contains("mode-reading")', '分栏恢复');
      menu('toggle-reading');
      await waitFor('window.__mdTest.getState().settings.viewMode === "reading"', '菜单切换阅读');
      menu('toggle-reading');
      await waitFor('window.__mdTest.getState().settings.viewMode === "split"', '菜单切回分栏');
    });

    await step('清理临时编辑', async () => {
      await setText(editOriginal);
      await waitFor('!window.__mdTest.getState().tabs.find((tab) => tab.relPath === "编辑体验.md").dirty', '临时编辑已还原');
      await js('window.api.clearAllRecovery()');
      await js('window.__mdTest.updateSettings({ autosave: true, autosaveDelay: 900 })');
      await waitFor('window.__mdTest.getState().settings.autosave === true', '恢复自动保存');
    });

    suite('数据安全');

    await step('关闭自动保存', async () => {
      await js('window.__mdTest.updateSettings({ autosave: false })');
      await waitFor('window.__mdTest.getState().settings.autosave === false', '关闭自动保存');
      await sleep(1200);
      await js('window.__mdTest.openRel("保存实验.md")');
      await waitFor('window.__mdTest.getText().includes("初始内容")', '打开保存实验');
      const filePath = path.join(testRoot, '保存实验.md');
      const before = await fsp.readFile(filePath, 'utf8');
      await appendText('\n追加保存。');
      await sleep(1500);
      assertEqual(await fsp.readFile(filePath, 'utf8'), before, '自动保存关闭后仍写盘');
      assertEqual(await js('document.getElementById("statusSave").textContent'), '未保存', '状态栏未显示未保存');
      await saveNow();
      await waitForDisk(filePath, '追加保存。');
    });

    await step('CRLF 往返', async () => {
      await js('window.__mdTest.openRel("crlf.md")');
      await waitFor('window.__mdTest.getText().includes("第一行")', '打开 CRLF 文档');
      await appendText('\n追加行');
      await saveNow();
      const filePath = path.join(testRoot, 'crlf.md');
      await waitForDisk(filePath, '追加行');
      const raw = fs.readFileSync(filePath);
      assert(!(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf), 'CRLF 文件出现 BOM');
      for (let index = 0; index < raw.length; index += 1) {
        if (raw[index] === 0x0a) assert(index > 0 && raw[index - 1] === 0x0d, 'CRLF 文件出现孤立 LF');
      }
    });

    await step('UTF-16LE 往返', async () => {
      await js('window.__mdTest.openRel("utf16.md")');
      await waitFor('window.__mdTest.getText().includes("中文内容")', '打开 UTF-16 文档');
      await appendText('\n追加');
      await saveNow();
      const raw = fs.readFileSync(path.join(testRoot, 'utf16.md'));
      assert(raw[0] === 0xff && raw[1] === 0xfe, 'UTF-16LE BOM 丢失');
      assert(raw.subarray(2).toString('utf16le').includes('追加'), 'UTF-16LE 内容未保存');
      assert(!(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf), 'UTF-16 文件写入 UTF-8 BOM');
    });

    await step('GBK 拒绝', async () => {
      const before = (await getState()).tabs.length;
      await clickTree('gbk.md');
      await waitToast('不是 UTF-8 或 UTF-16LE');
      const after = await getState();
      assertEqual(after.tabs.length, before, 'GBK 文件被打开');
      assert(!after.tabs.some((tab) => tab.relPath === 'gbk.md'), 'GBK 文件标签存在');
    });

    await step('另存为', async () => {
      await js('window.__mdTest.openRel("另存为源.md")');
      await waitFor('window.__mdTest.getText().includes("源内容")', '打开另存为源');
      const target = path.join(testRoot, '另存为结果.md');
      testControls.saveAsPath = target;
      await js('document.getElementById("btnSaveAs").click()');
      await waitForFile(target, 10000);
      await waitFor('window.__mdTest.getState().tabs.find((tab) => tab.id === window.__mdTest.getState().activeId && tab.relPath === "另存为结果.md")', '另存为标签路径');
      await waitToast('已另存为');
      assert((await fsp.readFile(target, 'utf8')).includes('源内容'), '另存为文件内容错误');
    });

    await step('缺失文件另存为', async () => {
      await js('window.__mdTest.openRel("消失2.md")');
      await waitFor('window.__mdTest.getText().includes("稍后删除")', '打开消失2');
      const missingPath = path.join(testRoot, '消失2.md');
      await fsp.rm(missingPath, { force: true });
      await appendText('\n删除后编辑。');
      menu('save');
      await waitFor('document.getElementById("missing").hidden === false', '缺失文件提示');
      const target = path.join(testRoot, '找回.md');
      testControls.saveAsPath = target;
      await js('document.getElementById("btnMissingSaveAs").click()');
      await waitForFile(target, 10000);
      await waitFor('window.__mdTest.getState().tabs.find((tab) => tab.id === window.__mdTest.getState().activeId && tab.relPath === "找回.md")', '缺失文件另存标签');
      await waitFor('document.getElementById("missing").hidden === true', '缺失提示隐藏');
      assert((await fsp.readFile(target, 'utf8')).includes('删除后编辑。'), '另存为内容缺失');
    });

    await step('历史载入', async () => {
      const filePath = path.join(testRoot, '历史.md');
      await js('window.__mdTest.openRel("历史.md")');
      await waitFor('window.__mdTest.getText().includes("版本零")', '打开历史文档');
      await setText('# 历史\n\n版本一。\n');
      await saveNow();
      await waitForDisk(filePath, '版本一。');
      await js('document.getElementById("btnHistory").click()');
      await waitFor('document.getElementById("historyModal").hidden === false', '历史弹框');
      await js('document.getElementById("historyCreate").click()');
      await waitFor('document.querySelector("#historyList .history-item button")', '历史快照条目');
      await setText('# 历史\n\n版本二。\n');
      await sleep(100);
      const beforeMtime = fs.statSync(filePath).mtimeMs;
      await js('document.querySelector("#historyList .history-item button").click()');
      await waitFor('window.__mdTest.getText().includes("版本一")', '载入快照内容');
      assertEqual(fs.statSync(filePath).mtimeMs, beforeMtime, '载入快照写入了磁盘');
      assert((await fsp.readFile(filePath, 'utf8')).includes('版本一'), '历史磁盘内容异常');
      await saveNow();
    });

    await step('冲突重新加载', async () => {
      const filePath = path.join(testRoot, '冲突2.md');
      await js('window.__mdTest.openRel("冲突2.md")');
      await waitFor('window.__mdTest.getText().includes("本地内容")', '打开冲突文档');
      await appendText('\n本地编辑。');
      await fsp.appendFile(filePath, '\n外部修改内容。\n', 'utf8');
      await sleep(120);
      menu('save');
      await waitFor('document.getElementById("conflict").hidden === false', '冲突提示');
      const flush = await js('window.__flushSave()');
      assert(flush && flush.ok === false && flush.blocked === true, 'flushSave 未报告阻塞');
      setConfirm(1);
      await js('document.getElementById("btnReload").click()');
      await waitFor('document.getElementById("conflict").hidden === true', '冲突提示关闭');
      await waitFor('window.__mdTest.getText().includes("外部修改内容")', '重新加载外部内容');
      const active = await getState();
      const tab = active.tabs.find((item) => item.id === active.activeId);
      assert(tab && tab.dirty === false, '重新加载后标签仍为脏');
    });

    await step('恢复草稿保存', async () => {
      const filePath = path.join(testRoot, '恢复保存.md');
      const stat = fs.statSync(filePath);
      const payload = {
        key: filePath.toLowerCase(),
        path: filePath,
        library: testRoot,
        name: '恢复保存.md',
        relPath: '恢复保存.md',
        content: '# 恢复保存\n\n恢复内容。',
        eol: 'lf',
        encoding: 'utf8',
        mtimeMs: stat.mtimeMs,
        timestamp: Date.now()
      };
      await js(`window.api.saveRecovery(${quote(payload)})`);
      win.reload();
      await waitFor('document.body.dataset.ready === "1"', '重载后就绪', 20000);
      await waitFor('document.getElementById("recoveryModal").hidden === false', '恢复弹框');
      await js('document.getElementById("recoveryRestore").click()');
      await waitFor('window.__mdTest.getState().tabs.some((tab) => tab.recovered && tab.relPath === "恢复保存.md")', '恢复标签');
      await waitFor('window.__mdTest.getText().includes("恢复内容")', '恢复内容载入');
      await js('document.getElementById("btnRecoveredSave").click()');
      await waitForDisk(filePath, '恢复内容');
      await waitFor('window.__mdTest.getState().tabs.every((tab) => !tab.recovered || tab.relPath !== "恢复保存.md")', '恢复标签保存完成');
      await waitFor('document.getElementById("recoveredBanner").hidden === true', '恢复横幅隐藏');
    });

    await step('恢复草稿丢弃', async () => {
      const filePath = path.join(testRoot, '恢复丢弃.md');
      const stat = fs.statSync(filePath);
      const payload = {
        key: filePath.toLowerCase(),
        path: filePath,
        library: testRoot,
        name: '恢复丢弃.md',
        relPath: '恢复丢弃.md',
        content: '# 恢复丢弃\n\n待丢弃内容。',
        eol: 'lf',
        encoding: 'utf8',
        mtimeMs: stat.mtimeMs,
        timestamp: Date.now()
      };
      await js(`window.api.saveRecovery(${quote(payload)})`);
      win.reload();
      await waitFor('document.body.dataset.ready === "1"', '重载后就绪', 20000);
      await waitFor('document.getElementById("recoveryModal").hidden === false', '恢复弹框');
      await js('document.getElementById("recoveryDiscard").click()');
      await waitFor('document.getElementById("recoveryModal").hidden === true', '丢弃恢复弹框');
      await sleep(400);
      win.reload();
      await waitFor('document.body.dataset.ready === "1"', '再次重载后就绪', 20000);
      assert(await js('document.getElementById("recoveryModal").hidden === true'), '丢弃后恢复弹框仍出现');
    });

    await step('关闭未保存标签', async () => {
      const filePath = path.join(testRoot, '关闭测试.md');
      await js('window.__mdTest.openRel("关闭测试.md")');
      await waitFor('window.__mdTest.getText().includes("用于关闭检查")', '打开关闭测试');
      await appendText('\n未保存内容。');
      const active = await getState();
      const id = active.activeId;
      setConfirm(0);
      await js(`document.querySelector('.tab[data-id="${id}"] .tab-close').click()`);
      await sleep(300);
      const still = await getState();
      assert(still.tabs.some((tab) => tab.id === id && tab.dirty), '取消关闭后标签丢失或未保持脏');
      setConfirm(2);
      await js(`document.querySelector('.tab[data-id="${id}"] .tab-close').click()`);
      await waitFor(`!window.__mdTest.getState().tabs.some((tab) => tab.id === ${id})`, '保存并关闭标签');
      await waitForDisk(filePath, '未保存内容。');
    });

    await step('打印 PDF', async () => {
      await js('window.__mdTest.openRel("其他.md")');
      await waitFor('window.__mdTest.getText().includes("# 其他")', '打印前打开文档');
      const printPath = path.join(tmpDir, 'e2e-print.pdf');
      await fsp.rm(printPath, { force: true });
      win.showInactive();
      await sleep(250);
      testControls.printPath = printPath;
      menu('print');
      await waitForFile(printPath, 20000);
      const buffer = fs.readFileSync(printPath);
      assertEqual(buffer.subarray(0, 4).toString('ascii'), '%PDF', '打印输出不是 PDF');
      assert(buffer.length > 10000, `打印 PDF 过小：${buffer.length}`);
    });

    await step('恢复自动保存', async () => {
      await js('window.__mdTest.updateSettings({ autosave: true, autosaveDelay: 900 })');
      await waitFor('window.__mdTest.getState().settings.autosave === true', '恢复自动保存');
    });

    suite('文件与知识库');

    await step('新建文件夹与嵌套笔记', async () => {
      await js('window.__mdTest.openRel("其他.md")');
      await waitFor('window.__mdTest.getText().includes("# 其他")', '定位根目录');
      await js('document.getElementById("btnNewFolder").click()');
      await waitFor('document.getElementById("modal").hidden === false', '新建文件夹弹框');
      await submitModal('测试目录');
      await waitFor('document.querySelector(\'.tree-row.dir[data-rel="测试目录"]\')', '目录创建');
      await clickTree('测试目录');
      await sleep(100);
      await js('document.getElementById("btnNewNote").click()');
      await waitFor('document.getElementById("modal").hidden === false', '新建笔记弹框');
      await submitModal('目录笔记.md');
      await waitFor('window.__mdTest.getState().tabs.some((tab) => tab.relPath === "测试目录/目录笔记.md")', '嵌套笔记标签');
      assert(fs.existsSync(path.join(testRoot, '测试目录', '目录笔记.md')), '嵌套笔记未写盘');
    });

    await step('重名/非法名提示', async () => {
      const filePath = path.join(testRoot, '重名测试.md');
      await openTreeMenu('重名测试.md');
      await chooseMenu('重命名');
      await waitFor('document.getElementById("modal").hidden === false', '重命名弹框');
      await submitModal('其他.md');
      await waitToast('已存在同名文件或文件夹');
      assert(fs.existsSync(filePath), '重名失败后原文件丢失');
      await openTreeMenu('重名测试.md');
      await chooseMenu('重命名');
      await waitFor('document.getElementById("modal").hidden === false', '非法名弹框');
      await submitModal('a/b');
      await waitToast('名称不能包含');
      assert(fs.existsSync(filePath), '非法名失败后原文件丢失');
    });

    await step('删除取消与确认', async () => {
      const filePath = path.join(testRoot, '测试目录', '目录笔记.md');
      await openTreeMenu('测试目录/目录笔记.md');
      setConfirm(0);
      await chooseMenu('删除文件');
      await sleep(400);
      assert(fs.existsSync(filePath), '取消删除后文件丢失');
      assert(await js('Boolean(document.querySelector(\'.tree-row.file[data-rel="测试目录/目录笔记.md"]\'))'), '取消删除后目录项丢失');
      assert((await getState()).tabs.some((tab) => tab.relPath === '测试目录/目录笔记.md'), '取消删除后标签丢失');
      setConfirm(1);
      await openTreeMenu('测试目录/目录笔记.md');
      await chooseMenu('删除文件');
      await waitFor('!document.querySelector(\'.tree-row.file[data-rel="测试目录/目录笔记.md"]\')', '删除后目录项移除');
      await waitFor('!window.__mdTest.getState().tabs.some((tab) => tab.relPath === "测试目录/目录笔记.md")', '删除后标签移除');
      assert(!fs.existsSync(filePath), '删除后文件仍存在');
      const after = await getState();
      assert(after.tabs.length > 0, '删除活动标签后其余标签丢失');
      assert(after.tabs.some((tab) => tab.id === after.activeId), '删除活动标签后未激活下一个标签');
      assert(await js('!document.querySelector(\'#viewSwitch [data-mode="reading"]\').disabled'), '删除活动标签后视图按钮仍禁用');
    });

    await step('最近清空取消', async () => {
      await js('document.getElementById("btnHome").click()');
      await waitFor('window.__mdTest.getState().view === "home"', '回到工作台');
      const before = (await getState()).recent.length;
      assert(before > 0, '最近记录为空，无法测试清空取消');
      setConfirm(0);
      await js('document.getElementById("btnClearRecent").click()');
      await sleep(400);
      assertEqual((await getState()).recent.length, before, '取消清空仍改变了最近记录');
      setConfirm(1);
      await js('document.getElementById("btnClearRecent").click()');
      await waitFor('window.__mdTest.getState().recent.length === 0', '清空最近记录');
      assert(await js('document.getElementById("recentWrap").hidden === true'), '清空后最近区域未隐藏');
    });

    await step('添加空知识库', async () => {
      testControls.addLibraryPath = thirdRoot;
      await js('document.getElementById("btnAddLibrary").click()');
      await waitFor('window.__mdTest.getState().libraries.length === 2', '添加第三库');
      await waitFor(`window.__mdTest.getState().activeLibrary === ${quote(thirdRoot)}`, '切换到第三库');
      await waitFor('window.__mdTest.getState().view === "library"', '第三库首页');
      await waitFor('document.getElementById("libEmpty").hidden === false', '空库提示', 10000);
      const emptyText = await js('document.getElementById("libEmpty").textContent');
      assert(emptyText.includes('还没有文档'), '空库提示缺失');
      await js('document.getElementById("btnHome").click()');
      await waitFor('window.__mdTest.getState().view === "home"', '回到工作台');
      await waitFor('document.querySelectorAll("#libraryCards .lib-card").length === 3', '知识库卡片数量');
      const meta = await js(`(() => {
        const card = Array.from(document.querySelectorAll('#libraryCards .lib-card')).find((item) => item.dataset.path === ${quote(thirdRoot)});
        return card ? card.querySelector('.lib-card-meta').textContent : '';
      })()`);
      assert(meta.includes('0 篇文档'), `空库卡片计数异常：${meta}`);
      await clickLibrary('测试库');
      await waitFor(`window.__mdTest.getState().activeLibrary === ${quote(testRoot)}`, '切回测试库');
    });

    await step('失效知识库', async () => {
      await fsp.rm(thirdRoot, { recursive: true, force: true });
      await js('document.getElementById("btnHome").click()');
      await waitFor('window.__mdTest.getState().view === "home"', '回到工作台');
      await waitFor(`(() => {
        const card = Array.from(document.querySelectorAll('#libraryCards .lib-card')).find((item) => item.dataset.path === ${quote(thirdRoot)});
        return Boolean(card && card.classList.contains('missing'));
      })()`, '失效知识库卡片');
      const beforeTabs = (await getState()).tabs.length;
      await js(`(() => {
        const card = Array.from(document.querySelectorAll('#libraryCards .lib-card')).find((item) => item.dataset.path === ${quote(thirdRoot)});
        card.click();
        return true;
      })()`);
      await waitToast('路径不可用');
      const state = await getState();
      assertEqual(state.activeLibrary, testRoot, '失效库点击后切换了活动库');
      assertEqual(state.tabs.length, beforeTabs, '失效库点击后新建了标签');
      assertEqual(state.view, 'home', '失效库点击后离开工作台');
    });

    await step('移除第三库', async () => {
      setConfirm(1);
      await openCardMenu(thirdRoot);
      await chooseMenu('从列表移除…');
      await waitFor('window.__mdTest.getState().libraries.length === 1', '移除第三库');
      await waitFor('document.querySelectorAll("#libraryCards .lib-card").length === 2', '移除第三库卡片');
      await waitFor(`window.__mdTest.getState().activeLibrary === ${quote(testRoot)}`, '移除第三库后回到测试库');
    });

    await step('设置持久化', async () => {
      await js('window.__mdTest.openRel("关闭测试.md")');
      await waitFor('window.__mdTest.getText().includes("用于关闭检查")', '设置前打开文档');
      await js(`(() => {
        const button = document.getElementById('btnSettings');
        button.focus();
        button.click();
        return true;
      })()`);
      await waitFor('document.getElementById("settingsModal").hidden === false', '设置弹框');
      await js(`(() => {
        document.getElementById('setTheme').value = 'dark';
        document.getElementById('setFontSize').value = '18';
        document.getElementById('setSidebar').checked = false;
        document.getElementById('setOutline').checked = false;
        document.getElementById('setWordGoal').value = '100';
        document.getElementById('settingsForm').requestSubmit();
        return true;
      })()`);
      await waitFor('document.getElementById("settingsModal").hidden === true', '设置保存');
      assertEqual(await js('document.activeElement && document.activeElement.id'), 'btnSettings', '设置保存后焦点未回归');
      await waitFor('document.documentElement.dataset.theme === "dark"', '深色主题');
      await js('document.querySelector(\'#viewSwitch [data-mode="reading"]\').click()');
      await waitFor('window.__mdTest.getState().settings.viewMode === "reading"', '阅读视图持久化前');
      win.reload();
      await waitFor('document.body.dataset.ready === "1"', '设置重载后就绪', 20000);
      await waitFor('window.__mdTest.getState().settings.theme === "dark"', '主题持久化');
      const settings = (await getState()).settings;
      assertEqual(settings.fontSize, 18, '字号未持久化');
      assertEqual(settings.sidebar, false, '侧边栏设置未持久化');
      assertEqual(settings.outline, false, '信息栏设置未持久化');
      assertEqual(settings.wordGoal, 100, '字数目标未持久化');
      assertEqual(settings.viewMode, 'reading', '视图模式未持久化');
      assert(await js('document.documentElement.dataset.theme === "dark"'), '主题未应用');
      assertEqual(await js('getComputedStyle(document.documentElement).getPropertyValue("--editor-font-size").trim()'), '18px', '字号 CSS 未应用');
      assert(await js('document.getElementById("app").classList.contains("sidebar-hidden")'), '侧边栏未隐藏');
      assert(await js('document.getElementById("editorWrap").classList.contains("rail-hidden")'), '信息栏未隐藏');
      assert(await js('document.getElementById("editorWrap").classList.contains("mode-reading")'), '阅读视图未应用');
      assert((await getState()).tabs.length > 0, '重载后未恢复活动标签');
      await js('window.__mdTest.updateSettings({ theme: "light", fontSize: 15, sidebar: true, outline: true, wordGoal: 0, viewMode: "split", autosave: true, autosaveDelay: 900 })');
      await waitFor('window.__mdTest.getState().settings.theme === "light"', '恢复默认主题');
      await waitFor('window.__mdTest.getState().settings.viewMode === "split"', '恢复分栏');
      assert(await js('!document.getElementById("app").classList.contains("sidebar-hidden")'), '侧边栏未恢复');
      assert(await js('!document.getElementById("editorWrap").classList.contains("rail-hidden")'), '信息栏未恢复');
    });

    await step('收藏持久化', async () => {
      await js('window.__mdTest.openRel("笔记.md")');
      await waitFor('window.__mdTest.getText().includes("# 标题")', '打开收藏文档');
      await js('document.getElementById("btnStar").click()');
      await waitFor('document.getElementById("btnStar").textContent === "★"', '收藏状态');
      win.reload();
      await waitFor('document.body.dataset.ready === "1"', '收藏重载后就绪', 20000);
      await waitFor('window.__mdTest.getState().starred.some((item) => item.relPath === "笔记.md")', '收藏持久化');
      await js('document.getElementById("btnHome").click()');
      await waitFor('window.__mdTest.getState().view === "home"', '收藏首页');
      await waitFor('document.getElementById("starredList").textContent.includes("笔记")', '收藏列表');
      await js('document.querySelector("#starredList .star-toggle").click()');
      await waitFor('window.__mdTest.getState().starred.length === 0', '取消收藏');
      await waitFor('document.getElementById("starredWrap").hidden === true', '收藏区域隐藏');
    });

    await step('最终空状态', async () => {
      await clickLibrary('测试库');
      await waitFor('window.__mdTest.getState().view === "library"', '测试库首页');
      const flush = await js('window.__flushSave()');
      assert(flush && flush.ok === true, '收尾前仍有未保存内容');
      const ids = (await getState()).tabs.map((tab) => tab.id);
      for (const id of ids) {
        await js(`document.querySelector('.tab[data-id="${id}"] .tab-close').click()`);
      }
      await waitFor('window.__mdTest.getState().tabs.length === 0', '关闭全部标签');
      assertEqual((await getState()).view, 'library', '关闭全部标签后未停留在库首页');
      setConfirm(1);
      await openLibraryRowMenu('测试库');
      await chooseMenu('从列表移除…');
      await waitFor('window.__mdTest.getState().libraries.length === 0', '移除最后一个知识库');
      await waitFor('window.__mdTest.getState().view === "home"', '回到工作台', 10000);
      await waitFor('window.__mdTest.getState().recent.length === 0', '最近记录清空');
      assertEqual(await js('document.getElementById("welcomeTitle").textContent'), '开始建立你的知识库', '欢迎标题异常');
      assertEqual(await js('document.getElementById("sidebarEmptyText").textContent'), '还没有知识库', '侧栏空态异常');
      assert(await js('document.getElementById("searchInput").disabled === true'), '搜索框未禁用');
      assertEqual(await js('document.querySelectorAll("#libraryCards .lib-card").length'), 1, '首页卡片未清空');
    });

    await step('重新添加知识库', async () => {
      testControls.addLibraryPath = secondRoot;
      await js('document.getElementById("btnAddLibrary").click()');
      await waitFor('window.__mdTest.getState().libraries.length === 1', '重新添加知识库');
      await waitFor(`window.__mdTest.getState().activeLibrary === ${quote(secondRoot)}`, '重新添加后活动库');
      await waitFor('window.__mdTest.getState().view === "library"', '重新添加后库首页');
      assertEqual(await js('document.getElementById("libTitle").textContent'), path.basename(secondRoot), '知识库标题异常');
    });

    suite('截图');

    await step('截图留证', async () => {
      await js('document.getElementById("toasts").replaceChildren()');
      await js('document.getElementById("btnHome").click()');
      await waitFor('window.__mdTest.getState().view === "home"', '截图工作台');
      const homeShot = await capture('home');
      await clickLibrary(path.basename(secondRoot));
      await waitFor('window.__mdTest.getState().view === "library"', '截图库首页');
      const libraryShot = await capture('library');
      await js('window.__mdTest.openRel("外部.md")');
      await waitFor('window.__mdTest.getText().includes("# 外部")', '截图编辑器');
      const editorShot = await capture('editor');
      await js('document.querySelector(\'#viewSwitch [data-mode="reading"]\').click()');
      await waitFor('document.getElementById("editorWrap").classList.contains("mode-reading")', '截图阅读视图');
      const readingShot = await capture('reading');
      await js('document.querySelector(\'#viewSwitch [data-mode="split"]\').click()');
      await waitFor('!document.getElementById("editorWrap").classList.contains("mode-reading")', '截图分栏恢复');
      await js(`(() => {
        const input = document.getElementById('searchInput');
        input.value = '苹果';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`);
      await waitFor('document.querySelector(".search-group")', '截图搜索结果', 10000);
      const searchShot = await capture('search');
      await js('document.getElementById("btnSearchClose").click()');
      await waitFor('document.getElementById("searchView").hidden === true', '关闭搜索结果');
      await js('document.getElementById("btnSettings").click()');
      await waitFor('document.getElementById("settingsModal").hidden === false', '截图设置');
      const settingsShot = await capture('settings');
      await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await waitFor('document.getElementById("settingsModal").hidden === true', '关闭设置截图');
      console.log(`       截图：${[homeShot, libraryShot, editorShot, readingShot, searchShot, settingsShot].join(', ')}`);
      win.hide();
    });
  } catch (error) {
    results.push({ suite: currentSuite, name: '测试执行', ok: false, ms: 0, error: error.message || String(error) });
    console.error(`[FATAL] ${error.stack || error}`);
  }

  const failed = results.filter((result) => !result.ok);
  const report = writeReport(failed);
  console.log(`\n冒烟测试：${report.passed}/${results.length} 通过`);
  console.log(`报告：${path.join(tmpDir, 'e2e-report.json')} / ${path.join(tmpDir, 'e2e-report.md')}`);
  const slowest = results.slice().sort((a, b) => b.ms - a.ms).slice(0, 3).map((item) => `${item.name} ${item.ms}ms`).join(' | ');
  console.log(`最慢：${slowest}`);
  if (pageErrors.length > 0) console.log(`页面控制台消息：${pageErrors.length} 条（见报告）`);
  await fsp.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(secondRoot, { recursive: true, force: true }).catch(() => {});
  if (thirdRoot) await fsp.rm(thirdRoot, { recursive: true, force: true }).catch(() => {});
  log('info', 'smoke', `${report.passed}/${results.length} passed`);
  app.exit(failed.length === 0 ? 0 : 1);
}

module.exports = { prepare, run };
