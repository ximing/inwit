#!/usr/bin/env node
// 生成 GitHub Social Preview 分享卡片（1280×640）
// 视觉与品牌管线一致：宣纸底、暖墨字、朱批红（见 docs/design/brand-icons.md）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const VERMILION = '#B3402A';
const INK = '#221D16';
const PAPER = '#F7F3EC';

const W = 1280;
const H = 640;

const brandDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const inner = readFileSync(join(brandDir, 'src/logo.svg'), 'utf8')
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .replaceAll('currentColor', VERMILION)
  .trim();

function squirclePath(size, inset, radiusPct = 0.24) {
  const r = (size - inset * 2) * radiusPct;
  const x0 = inset;
  const y0 = inset;
  const x1 = size - inset;
  const y1 = size - inset;
  return `M ${x0 + r} ${y0} H ${x1 - r} C ${x1 - r * 0.35} ${y0} ${x1} ${y0 + r * 0.35} ${x1} ${y0 + r} V ${y1 - r} C ${x1} ${y1 - r * 0.35} ${x1 - r * 0.35} ${y1} ${x1 - r} ${y1} H ${x0 + r} C ${x0 + r * 0.35} ${y1} ${x0} ${y1 - r * 0.35} ${x0} ${y1 - r} V ${y0 + r} C ${x0} ${y0 + r * 0.35} ${x0 + r * 0.35} ${y0} ${x0 + r} ${y0} Z`;
}

// 印章式 logo：纸砖 + 朱红字形，与应用图标同比例
const TILE = 260;
const TILE_X = 130;
const TILE_Y = (H - TILE) / 2;
const markInner = TILE * (1 - 0.06 * 2);
const markOffset = (TILE - markInner) / 2;

const TEXT_X = TILE_X + TILE + 90;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="rgba(34,29,22,0.10)" stroke-width="2"/>
  <g transform="translate(${TILE_X} ${TILE_Y})">
    <path d="${squirclePath(TILE, TILE * 0.06)}" fill="#FFFFFF" stroke="rgba(34,29,22,0.08)" stroke-width="2"/>
    <g fill="none" transform="translate(${markOffset} ${markOffset}) scale(${markInner / 32})">${inner}</g>
  </g>
  <text x="${TEXT_X}" y="255" font-family="Georgia, 'Times New Roman', serif" font-size="104" font-weight="700" fill="${INK}">Inwit</text>
  <rect x="${TEXT_X + 4}" y="290" width="150" height="6" fill="${VERMILION}"/>
  <text x="${TEXT_X}" y="385" font-family="'PingFang SC', 'Hiragino Sans GB', sans-serif" font-size="40" fill="${INK}">只管往里扔。它替你消化，并催你复习。</text>
  <text x="${TEXT_X}" y="450" font-family="'Helvetica Neue', Arial, sans-serif" font-size="27" fill="rgba(34,29,22,0.55)">AI-first learning companion · spaced repetition · LLM agent</text>
</svg>`;

const out = join(brandDir, 'design/social-preview.png');
mkdirSync(dirname(out), { recursive: true });
const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: PAPER }).render().asPng();
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
