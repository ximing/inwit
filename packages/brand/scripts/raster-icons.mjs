#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const VERMILION = '#B3402A';
const WHITE = '#FFFFFF';
const MARK_RATIO = 0.58;

const brandDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(brandDir, '..', '..');

const canonical = readFileSync(join(brandDir, 'src/logo.svg'), 'utf8');
const inner = canonical
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .replaceAll('currentColor', VERMILION)
  .trim();

/** Continuous-curvature rounded rect (squircle-ish). */
function squirclePath(size, inset, radiusPct = 0.24) {
  const r = (size - inset * 2) * radiusPct;
  const x0 = inset;
  const y0 = inset;
  const x1 = size - inset;
  const y1 = size - inset;
  return `M ${x0 + r} ${y0} H ${x1 - r} C ${x1 - r * 0.35} ${y0} ${x1} ${y0 + r * 0.35} ${x1} ${y0 + r} V ${y1 - r} C ${x1} ${y1 - r * 0.35} ${x1 - r * 0.35} ${y1} ${x1 - r} ${y1} H ${x0 + r} C ${x0 + r * 0.35} ${y1} ${x0} ${y1 - r * 0.35} ${x0} ${y1 - r} V ${y0 + r} C ${x0} ${y0 + r * 0.35} ${x0 + r * 0.35} ${y0} ${x0 + r} ${y0} Z`;
}

function markGroup(size, ratio, markInner = inner) {
  const innerPx = size * ratio;
  const offset = (size - innerPx) / 2;
  return `<g fill="none" transform="translate(${offset} ${offset}) scale(${innerPx / 32})">${markInner}</g>`;
}

function fullBleedSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${WHITE}"/>
  ${markGroup(size, MARK_RATIO)}
</svg>`;
}

function roundedSvg(size, insetPct = 0.06) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F7F3EC"/>
    </linearGradient>
  </defs>
  <path d="${squirclePath(size, size * insetPct)}" fill="url(#tile)" stroke="rgba(34,29,22,0.08)" stroke-width="${size * 0.006}"/>
  ${markGroup(size, MARK_RATIO)}
</svg>`;
}

function traySvg(size) {
  const mark = inner.replaceAll(VERMILION, '#000000');
  const innerPx = size * 0.82;
  const offset = (size - innerPx) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g fill="none" transform="translate(${offset} ${offset}) scale(${innerPx / 32})">${mark}</g>
</svg>`;
}

function render(svg, size, background) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    ...(background ? { background } : {}),
  });
  return resvg.render().asPng();
}

function writePng(path, size, svg, background) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, render(svg, size, background));
}

async function writeIco(path, sizes, insetPct) {
  const dir = mkdtempSync(join(tmpdir(), 'inwit-ico-'));
  try {
    const pngs = sizes.map((size) => {
      const file = join(dir, `${size}.png`);
      writeFileSync(file, render(roundedSvg(size, insetPct), size));
      return file;
    });
    writeFileSync(path, await pngToIco(pngs));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeIcns(path) {
  const dir = mkdtempSync(join(tmpdir(), 'inwit-iconset-'));
  const iconset = `${dir}.iconset`;
  mkdirSync(iconset, { recursive: true });
  const entries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of entries) {
    writeFileSync(join(iconset, name), render(roundedSvg(size, 0.1), size));
  }
  execFileSync('iconutil', ['-c', 'icns', '-o', path, iconset]);
  rmSync(iconset, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}

const webPublic = join(repoRoot, 'apps/web/public');
const desktopIcons = join(repoRoot, 'apps/desktop/src-tauri/icons');

mkdirSync(webPublic, { recursive: true });
writeFileSync(join(webPublic, 'favicon.svg'), `${roundedSvg(32)}\n`);
writePng(join(webPublic, 'apple-touch-icon.png'), 180, fullBleedSvg(180), WHITE);

writePng(join(desktopIcons, '16x16.png'), 16, roundedSvg(16));
writePng(join(desktopIcons, '32x32.png'), 32, roundedSvg(32));
writePng(join(desktopIcons, '128x128.png'), 128, roundedSvg(128));
writePng(join(desktopIcons, '128x128@2x.png'), 256, roundedSvg(256));
writePng(join(desktopIcons, '256x256.png'), 256, roundedSvg(256));
writePng(join(desktopIcons, 'icon.png'), 256, roundedSvg(256));
writeFileSync(join(desktopIcons, 'tray.png'), render(traySvg(64), 64));

await writeIco(join(webPublic, 'favicon.ico'), [16, 32, 48], 0.06);
await writeIco(join(desktopIcons, 'icon.ico'), [16, 32, 48, 256], 0.06);
writeIcns(join(desktopIcons, 'icon.icns'));

const preview = join(brandDir, 'design');
mkdirSync(preview, { recursive: true });
cpSync(join(desktopIcons, 'icon.png'), join(preview, 'app-icon.png'));
cpSync(join(desktopIcons, 'tray.png'), join(preview, 'tray.png'));

console.log('rasterized Inwit mark into web/desktop assets');
