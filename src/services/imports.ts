import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { bytesToDataUrl, MIME, type PickedFile } from './api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RasterImage { src: string; width: number; height: number }

const MAX_SIDE = 5000;

export async function pdfPageCount(data: Uint8Array): Promise<number> {
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
  const n = doc.numPages;
  await doc.loadingTask.destroy();
  return n;
}

/** Rastérise une page de PDF (haute définition, ~4000 px sur le grand côté). */
export async function renderPdfPage(data: Uint8Array, pageNumber = 1, targetLongSide = 4000): Promise<RasterImage> {
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(targetLongSide, MAX_SIDE) / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
    return { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    await doc.loadingTask.destroy();
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible ou format non pris en charge.'));
    img.src = src;
  });
}

/** Charge une image ; la réduit si elle dépasse MAX_SIDE pixels. */
export async function imageFromFile(file: PickedFile): Promise<RasterImage> {
  const mime = MIME[file.ext] ?? 'image/png';
  const src = bytesToDataUrl(file.data, mime);
  const img = await loadImage(src);
  let w = img.naturalWidth || 800, h = img.naturalHeight || 600;
  if (mime === 'image/svg+xml' || Math.max(w, h) <= MAX_SIDE) return { src, width: w, height: h };
  const k = MAX_SIDE / Math.max(w, h);
  w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return { src: c.toDataURL(mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92), width: w, height: h };
}
