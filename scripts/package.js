'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const outDir = path.join(root, 'dist');
const appName = 'MarkdownNotes';
const electronVersion = '22.3.27';
const SKIP_SMOKE = process.env.SKIP_PACK_SMOKE === '1';

function verifyPe32(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64);
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (buffer.toString('ascii', 0, 2) !== 'MZ') throw new Error('不是有效 PE 文件');
    const peOffset = buffer.readUInt32LE(0x3c);
    const header = Buffer.alloc(6);
    fs.readSync(fd, header, 0, header.length, peOffset);
    if (header.toString('ascii', 0, 4) !== 'PE\0\0') throw new Error('PE 头无效');
    const machine = header.readUInt16LE(4);
    if (machine !== 0x014c) throw new Error(`期望 IA-32 (0x014c)，实际 0x${machine.toString(16)}`);
    return machine;
  } finally {
    fs.closeSync(fd);
  }
}

function verifyBoot(exePath) {
  const userData = path.join(os.tmpdir(), `markdown-notes-boot-${process.pid}`);
  fs.mkdirSync(userData, { recursive: true });
  try {
    const result = spawnSync(exePath, ['--smoke-boot', `--user-data-dir=${userData.replace(/\\/g, '/')}`], {
      stdio: 'inherit',
      timeout: 90000
    });
    if (result.status !== 0) {
      throw new Error(`打包态启动自检失败，退出码 ${result.status}`);
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

function verifyPortable(exePath, appDir) {
  const dataDir = path.join(appDir, 'data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  const result = spawnSync(exePath, ['--portable', '--smoke-boot'], { stdio: 'inherit', timeout: 90000 });
  if (result.status !== 0) throw new Error(`便携模式启动自检失败，退出码 ${result.status}`);
  const settings = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(settings)) throw new Error('便携模式未在 data 目录写入设置');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function zipFolder(folder, zipPath) {
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const command = `Compress-Archive -LiteralPath ${quote(folder)} -DestinationPath ${quote(zipPath)} -Force`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    stdio: 'inherit'
  });
}

(async () => {
  fs.rmSync(outDir, { recursive: true, force: true });

  const appPaths = await packager({
    dir: root,
    out: outDir,
    name: appName,
    platform: 'win32',
    arch: 'ia32',
    electronVersion,
    asar: true,
    overwrite: true,
    prune: true,
    appVersion: pkg.version,
    appCopyright: `Copyright © ${new Date().getFullYear()} Markdown Notes`,
    win32metadata: {
      CompanyName: 'Markdown Notes',
      FileDescription: 'Markdown 笔记',
      ProductName: 'Markdown 笔记',
      OriginalFilename: `${appName}.exe`
    },
    ignore: [
      /^\/dist($|\/)/,
      /^\/node_modules($|\/)/,
      /^\/scripts($|\/)/,
      /^\/tmp($|\/)/,
      /^\/data($|\/)/,
      /^\/test-workspace($|\/)/,
      /^\/todo\.md$/,
      /^\/README\.md$/,
      /^\/\.gitignore$/,
      /^\/package-lock\.json$/
    ]
  });

  const appDir = appPaths[0];
  const exePath = path.join(appDir, `${appName}.exe`);
  verifyPe32(exePath);
  if (!fs.existsSync(path.join(appDir, 'resources', 'app.asar'))) {
    throw new Error('缺少 resources/app.asar');
  }
  if (SKIP_SMOKE) {
    console.log('SKIP_PACK_SMOKE=1，跳过打包态启动与便携自检（CI 无桌面会话）');
  } else {
    verifyBoot(exePath);
    verifyPortable(exePath, appDir);
  }

  const zipPath = path.join(outDir, `${appName}-${pkg.version}-win32-ia32.zip`);
  zipFolder(appDir, zipPath);

  const exeSize = fs.statSync(exePath).size;
  const zipSize = fs.statSync(zipPath).size;
  console.log(`\n构建完成：${appDir}`);
  console.log(`PE 架构：IA-32 (x86)`);
  console.log(`主程序：${(exeSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`压缩包：${zipPath} (${(zipSize / 1024 / 1024).toFixed(1)} MB)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
