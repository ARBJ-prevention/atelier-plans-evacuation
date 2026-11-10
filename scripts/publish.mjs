/**
 * Publie la version construite :
 *  - copie l'installateur à la racine du dossier de distribution
 *    (par défaut le dossier parent du projet : « Atelier Plans Evacuation ») ;
 *  - supprime les installateurs plus anciens qui s'y trouvent ;
 *  - écrit « mise-a-jour.json » (version, empreinte SHA-256, notes),
 *    lu par le logiciel à chaque démarrage pour proposer la mise à jour.
 *
 * Usage :  npm run release            (construit puis publie)
 *          node scripts/publish.mjs [dossier-de-distribution] [--github]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const name = `Atelier-Plans-Evacuation-Setup-${version}.exe`;
const built = path.join(root, 'release', name);
const dest = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, '..'));

if (!fs.existsSync(built)) {
  console.error(`Installateur introuvable : ${built}\nLancez d'abord « npm run dist ».`);
  process.exit(1);
}

// Notes : section de la version dans CHANGELOG.md
let notes = '';
try {
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const m = log.match(new RegExp(`## ${version.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  if (m) notes = m[1].trim();
} catch { /* pas de journal */ }

fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(dest)) {
  if (/^Atelier-Plans-Evacuation-Setup-.*\.exe$/i.test(f) && f !== name) {
    fs.rmSync(path.join(dest, f));
    console.log(`Ancien installateur retiré : ${f}`);
  }
}
const target = path.join(dest, name);
fs.copyFileSync(built, target);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
const manifest = { version, installer: name, date: new Date().toISOString(), sha256, notes };
fs.writeFileSync(path.join(dest, 'mise-a-jour.json'), JSON.stringify(manifest, null, 2));
console.log(`Publié : ${target}\nVersion ${version} · SHA-256 ${sha256.slice(0, 16)}…`);

// Publication GitHub (option --github) : crée la release vX.Y.Z avec l'installateur,
// que le logiciel installé détecte au démarrage lorsqu'Internet est disponible.
if (process.argv.includes('--github')) {
  const { execFileSync } = await import('node:child_process');
  const notesFile = path.join(root, 'release', `notes-${version}.md`);
  fs.writeFileSync(notesFile, notes || `Version ${version}`);
  execFileSync('gh', ['release', 'create', `v${version}`, built, '--title', `Version ${version}`, '--notes-file', notesFile], { cwd: root, stdio: 'inherit' });
  console.log(`Publication GitHub v${version} créée.`);
}
