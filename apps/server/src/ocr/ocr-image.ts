import { createCanvas, loadImage } from '@napi-rs/canvas';
import { scaleToPixelBudget } from '../documents/screenshot-logic.js';
import { OCR_MAX_PIXELS } from './ocr-logic.js';

export async function rasterImageFileToPng(
  filePath: string,
  maxPixels = OCR_MAX_PIXELS,
): Promise<Buffer> {
  const img = await loadImage(filePath);
  const { width, height } = scaleToPixelBudget(img.width, img.height, maxPixels);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}
