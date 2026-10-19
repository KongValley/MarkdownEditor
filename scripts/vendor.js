'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'src', 'vendor');

function copy(relativeSource, targetName) {
  const source = path.join(root, 'node_modules', relativeSource);
  if (!fs.existsSync(source)) {
    console.error(`缺少依赖文件：node_modules/${relativeSource}。请先运行 npm install。`);
    process.exit(1);
  }
  fs.copyFileSync(source, path.join(outDir, targetName));
  return fs.statSync(source).size;
}

function versionOf(packageName) {
  return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', packageName, 'package.json'), 'utf8')).version;
}

fs.mkdirSync(outDir, { recursive: true });

const markedVersion = versionOf('marked');
copy('marked/marked.min.js', 'marked.min.js');
copy('marked/LICENSE.md', 'marked.LICENSE.md');

const codemirrorVersion = versionOf('codemirror');
copy('codemirror/lib/codemirror.js', 'codemirror.js');
copy('codemirror/lib/codemirror.css', 'codemirror.css');
copy('codemirror/mode/markdown/markdown.js', 'mode-markdown.js');
copy('codemirror/mode/gfm/gfm.js', 'mode-gfm.js');
copy('codemirror/mode/xml/xml.js', 'mode-xml.js');
copy('codemirror/mode/javascript/javascript.js', 'mode-javascript.js');
copy('codemirror/addon/selection/active-line.js', 'addon-active-line.js');
copy('codemirror/addon/mode/overlay.js', 'addon-overlay.js');
copy('codemirror/LICENSE', 'codemirror.LICENSE');

const highlightVersion = versionOf('@highlightjs/cdn-assets');
copy('@highlightjs/cdn-assets/highlight.min.js', 'highlight.min.js');
copy('@highlightjs/cdn-assets/LICENSE', 'highlight.LICENSE');

console.log(`marked ${markedVersion}、CodeMirror ${codemirrorVersion}、highlight.js ${highlightVersion} -> src/vendor`);
