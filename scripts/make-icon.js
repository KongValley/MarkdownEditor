'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const BG_TOP = [47, 111, 237];
const BG_BOTTOM = [29, 78, 216];
const FG = [255, 255, 255];

const M_POINTS = [
  [0.20, 0.82], [0.20, 0.18], [0.33, 0.18], [0.50, 0.44],
  [0.67, 0.18], [0.80, 0.18], [0.80, 0.82], [0.67, 0.82],
  [0.67, 0.42], [0.50, 0.66], [0.33, 0.42], [0.33, 0.82]
];

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderIcon(size) {
  const samples = 4;
  const output = Buffer.alloc(size * size * 4);
  const left = 0.035;
  const top = 0.035;
  const right = 0.965;
  const bottom = 0.965;
  const radius = 0.195;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / size;
          const py = (y + (sy + 0.5) / samples) / size;
          if (!insideRoundedRect(px, py, left, top, right, bottom, radius)) continue;
          const mix = py;
          let cr = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * mix;
          let cg = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * mix;
          let cb = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * mix;
          if (insidePolygon(px, py, M_POINTS)) {
            cr = FG[0];
            cg = FG[1];
            cb = FG[2];
          }
          r += cr;
          g += cg;
          b += cb;
          a += 1;
        }
      }
      const index = (y * size + x) * 4;
      const total = samples * samples;
      if (a > 0) {
        output[index] = Math.round(r / a);
        output[index + 1] = Math.round(g / a);
        output[index + 2] = Math.round(b / a);
        output[index + 3] = Math.round((a / total) * 255);
      }
    }
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  body.copy(output, 4);
  output.writeUInt32BE(crc32(body), 8 + data.length);
  return output;
}

function encodePng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeDib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const maskRow = Math.ceil(size / 32) * 4;
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const targetY = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      const target = (targetY * size + x) * 4;
      pixels[target] = rgba[source + 2];
      pixels[target + 1] = rgba[source + 1];
      pixels[target + 2] = rgba[source];
      pixels[target + 3] = rgba[source + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

function buildIcon(outputPath) {
  const entries = [];
  let offset = 6 + SIZES.length * 16;
  for (const size of SIZES) {
    const rgba = renderIcon(size);
    const data = size === 256 ? encodePng(rgba, size) : encodeDib(rgba, size);
    entries.push({ size, data, offset });
    offset += data.length;
  }
  const directory = Buffer.alloc(6);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(SIZES.length, 4);
  const headers = Buffer.alloc(SIZES.length * 16);
  entries.forEach((entry, index) => {
    const base = index * 16;
    headers[base] = entry.size === 256 ? 0 : entry.size;
    headers[base + 1] = entry.size === 256 ? 0 : entry.size;
    headers[base + 2] = 0;
    headers[base + 3] = 0;
    headers.writeUInt16LE(1, base + 4);
    headers.writeUInt16LE(32, base + 6);
    headers.writeUInt32LE(entry.data.length, base + 8);
    headers.writeUInt32LE(entry.offset, base + 12);
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([directory, headers, ...entries.map((entry) => entry.data)]));
  const previewPath = outputPath.replace(/\.ico$/i, '-256.png');
  fs.writeFileSync(previewPath, encodePng(renderIcon(256), 256));
  return { outputPath, previewPath };
}

if (require.main === module) {
  const target = path.join(__dirname, '..', 'build', 'icon.ico');
  const result = buildIcon(target);
  console.log(`图标：${result.outputPath}（预览 ${result.previewPath}）`);
}

module.exports = { buildIcon };
