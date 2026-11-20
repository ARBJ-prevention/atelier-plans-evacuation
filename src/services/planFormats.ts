/**
 * Reconnaissance du type d'un plan importé d'après son contenu (et non seulement son extension),
 * décompression des SVGZ et messages clairs pour les formats qui ne peuvent pas être lus directement.
 */
import type { PickedFile } from './api';

const ALIASES: Record<string, string> = { jfif: 'jpg', jpe: 'jpg', jpeg: 'jpg', dib: 'bmp', svgz: 'svg', tif: 'tiff' };

/** Formats d'autres logiciels : indication pour obtenir un format lisible. */
const OTHER_FORMATS: Record<string, string> = {
  eddx: 'EdrawMax', edrx: 'EdrawMax', eddt: 'EdrawMax',
  vsdx: 'Microsoft Visio', vsd: 'Microsoft Visio', vsdm: 'Microsoft Visio', vdx: 'Microsoft Visio',
  rvt: 'Revit', pln: 'ArchiCAD', skp: 'SketchUp', dgn: 'MicroStation', dwf: 'Autodesk DWF', dwfx: 'Autodesk DWF',
  ifc: 'IFC (BIM)', emf: 'image EMF', wmf: 'image WMF', tiff: 'image TIFF', heic: 'image HEIC', ai: 'Adobe Illustrator', cdr: 'CorelDRAW',
  doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint', odg: 'LibreOffice Draw',
};

/** Type réel du fichier d'après ses premiers octets, ou null si inconnu. */
export function sniffPlanType(data: Uint8Array): string | null {
  const b = data;
  const ascii = new TextDecoder('latin1').decode(b.subarray(0, 512));
  if (/^AC10\d\d/.test(ascii) || /^AC1\.\d/.test(ascii) || /^AC2\.\d/.test(ascii)) return 'dwg';
  if (ascii.startsWith('AutoCAD Binary DXF')) return 'dxf';
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (b[0] === 0x89 && ascii.startsWith('PNG', 1)) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('BM')) return 'bmp';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.slice(4, 12) === 'ftypavif' || ascii.slice(4, 12) === 'ftypavis') return 'avif';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'tiff';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gz';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';
  const text = ascii.replace(/^﻿/, '').trimStart();
  if (/<svg[\s>]/i.test(ascii) && (text.startsWith('<') )) return 'svg';
  if (/^0\s*\r?\n\s*SECTION/.test(text) || /^999\s*\r?\n/.test(text)) return 'dxf';
  return null;
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Corrige l'extension selon le contenu, décompresse les SVGZ et refuse avec une explication
 * les formats qui doivent d'abord être exportés depuis leur logiciel d'origine.
 */
export async function normalizePlanFile(file: PickedFile): Promise<PickedFile> {
  let { data } = file;
  let ext = ALIASES[file.ext] ?? file.ext;
  let sniffed = sniffPlanType(data);
  if (sniffed === 'gz') {
    data = await gunzip(data);
    sniffed = sniffPlanType(data);
  }
  if (sniffed && sniffed !== 'zip') ext = sniffed;
  if (!data.length) throw new Error('Le fichier est vide.');
  const supported = ['dwg', 'dxf', 'svg', 'pdf', 'png', 'jpg', 'gif', 'bmp', 'webp', 'avif', 'ico'];
  if (!supported.includes(ext)) {
    const app = OTHER_FORMATS[ext] ?? OTHER_FORMATS[file.ext];
    const hint = app
      ? `Ce fichier vient de ${app}. Ouvrez-le dans ce logiciel et utilisez « Exporter » ou « Enregistrer sous » au format DWG, DXF, SVG ou PDF (de préférence DXF ou SVG pour garder les murs en vectoriel), puis importez ce fichier.`
      : `Le format « .${file.ext || '?'} » n’est pas reconnu. Formats acceptés : DWG, DXF, SVG, PDF, PNG, JPEG, BMP, WebP, GIF, AVIF, ICO.`;
    throw new Error(hint);
  }
  return { name: file.name, ext, data };
}
