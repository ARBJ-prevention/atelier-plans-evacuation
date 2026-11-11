/*
 * Conversion DWG → DXF par ODA File Converter (Open Design Alliance).
 *
 * Le format DWG est propriétaire : il est converti en DXF par l'outil gratuit
 * « ODA File Converter », installé séparément par l'utilisateur (licence ODA).
 * Le logiciel le trouve automatiquement dans « Program Files\ODA », ou à
 * l'emplacement indiqué dans les paramètres.
 *
 * Ligne de commande ODA : ODAFileConverter <dossier entrée> <dossier sortie>
 *   <version sortie> <type sortie> <récursif 0|1> <audit 0|1> [filtre]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const ODA_DOWNLOAD_URL = 'https://www.opendesign.com/guestfiles/oda_file_converter';

/** Versions DWG (6 premiers octets du fichier). */
const DWG_VERSIONS = {
  AC1009: 'AutoCAD R11/R12', AC1012: 'AutoCAD R13', AC1014: 'AutoCAD R14', AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018',
};

/** Vérifie la signature d'un fichier DWG ; renvoie la version lisible ou lève une erreur. */
function dwgVersion(data) {
  const sig = Buffer.from(data.subarray(0, 6)).toString('latin1');
  if (!/^AC\d{4}$/.test(sig)) throw new Error('Ce fichier n’est pas un fichier DWG valide.');
  return DWG_VERSIONS[sig] || `DWG ${sig}`;
}

function versionKey(dir) {
  return (dir.match(/\d+/g) || []).map((n) => n.padStart(6, '0')).join('.');
}

/** Cherche ODAFileConverter.exe dans les dossiers d'installation habituels. */
function findOdaConverter(extraRoots = []) {
  const roots = [
    ...extraRoots,
    process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
  ].filter(Boolean);
  const found = [];
  for (const root of [...new Set(roots)]) {
    const odaDir = path.join(root, 'ODA');
    let subdirs = [];
    try { subdirs = fs.readdirSync(odaDir); } catch { continue; }
    for (const d of subdirs) {
      const exe = path.join(odaDir, d, 'ODAFileConverter.exe');
      if (/^ODAFileConverter/i.test(d) && fs.existsSync(exe)) found.push({ exe, key: versionKey(d) });
    }
  }
  found.sort((a, b) => (a.key < b.key ? 1 : -1));
  return found[0] ? found[0].exe : null;
}

/** Le chemin indiqué est-il un convertisseur ODA utilisable ? */
function isOdaConverter(p) {
  return !!p && fs.existsSync(p) && /odafileconverter/i.test(path.basename(p));
}

function run(exe, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const isScript = /\.(cmd|bat)$/i.test(exe); // utilisé par les tests (convertisseur simulé)
    const file = isScript ? (process.env.ComSpec || 'cmd.exe') : exe;
    const argv = isScript ? ['/d', '/s', '/c', `"${[exe, ...args].map((a) => `"${a}"`).join(' ')}"`] : args;
    execFile(file, argv, { windowsHide: true, timeout: timeoutMs, windowsVerbatimArguments: isScript }, (err, stdout, stderr) => {
      if (err && err.killed) reject(new Error('La conversion a pris trop de temps et a été interrompue.'));
      else resolve({ code: err ? err.code : 0, out: `${stdout || ''}${stderr || ''}` });
    });
  });
}

/**
 * Convertit un DWG (octets) en DXF (octets) avec le convertisseur indiqué.
 * Travaille dans un dossier temporaire unique, supprimé ensuite.
 */
async function convertDwgToDxf(converter, data, { timeoutMs = 180000 } = {}) {
  if (!isOdaConverter(converter)) throw new Error('ODA File Converter est introuvable.');
  const version = dwgVersion(data);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'evac-dwg-'));
  const inDir = path.join(work, 'entree');
  const outDir = path.join(work, 'sortie');
  fs.mkdirSync(inDir);
  fs.mkdirSync(outDir);
  try {
    fs.writeFileSync(path.join(inDir, 'plan.dwg'), data);
    const res = await run(converter, [inDir, outDir, 'ACAD2018', 'DXF', '0', '1', '*.DWG'], timeoutMs);
    const dxf = fs.readdirSync(outDir).find((f) => /\.dxf$/i.test(f));
    if (!dxf) {
      const detail = res.out.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 300);
      throw new Error(`ODA File Converter n’a produit aucun fichier DXF (code ${res.code})${detail ? ` : ${detail}` : ''}. Le fichier DWG est peut-être endommagé ou protégé.`);
    }
    return { dxf: fs.readFileSync(path.join(outDir, dxf)), version };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { ODA_DOWNLOAD_URL, dwgVersion, findOdaConverter, isOdaConverter, convertDwgToDxf };
