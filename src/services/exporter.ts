import type { Building, CustomSymbol, Floor, PageSetup } from '../model/types';
import { pageSizeMm } from '../render/layout';
import { renderPageSvg } from '../render/PrintPage';

export interface ExportJob {
  building: Building;
  floor: Floor;
  variantIds: string[];
  customSymbols: CustomSymbol[];
  page: PageSetup;
}

/** Document HTML (une page par version) prêt pour printToPDF / impression. */
export function buildPrintHtml(job: ExportJob): string {
  return buildBatchPrintHtml([job], job.floor.titleBlock.title);
}

/** Une règle de papier par format, avec les dimensions et le dessin propres à chaque étage. */
export function buildBatchPrintHtml(jobs: ExportJob[], title: string): string {
  const sizes = new Map<string, string>();
  let index = 0;
  const pages = jobs.flatMap((job) => {
    const { w, h } = pageSizeMm(job.page);
    const name = `sheet-${job.page.paper}-${job.page.orientation}`;
    sizes.set(name, `@page ${name} { size: ${w}mm ${h}mm; margin: 0; }
.${name} { page: ${name}; width: ${w}mm; height: ${h}mm; }
.${name} > svg { width: ${w}mm; height: ${h}mm; }`);
    return job.variantIds.map((vid) => `<div class="page ${name}">${renderPageSvg({
      building: job.building, floor: job.floor, variantId: vid, customSymbols: job.customSymbols, page: job.page, uniqueKey: `p${index++}`,
    })}</div>`);
  });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
html, body { margin: 0; padding: 0; background: #fff; }
.page { overflow: hidden; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.page > svg { display: block; }
${[...sizes.values()].join('\n')}
</style></head><body>${pages.join('\n')}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Rendu PNG d'une page à la résolution demandée (ppp). */
export async function renderPagePng(job: ExportJob, variantId: string, dpi: number): Promise<{ data: Uint8Array; width: number; height: number }> {
  const svg = renderPageSvg({ building: job.building, floor: job.floor, variantId, customSymbols: job.customSymbols, page: job.page, uniqueKey: 'png' });
  const { w, h } = pageSizeMm(job.page);
  const width = Math.round((w / 25.4) * dpi);
  const height = Math.round((h / 25.4) * dpi);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Échec du rendu de la page.'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    const out = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Échec de l’encodage PNG.'))), 'image/png'));
    return { data: new Uint8Array(await out.arrayBuffer()), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'plan';
}
