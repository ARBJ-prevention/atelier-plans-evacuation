/**
 * Récupère les pictogrammes ISO 7010 depuis Wikimedia Commons.
 *
 * - Ne retient QUE les fichiers en domaine public ou CC0 (licence vérifiée
 *   via l'API Commons, champ LicenseShortName) ;
 * - nettoie chaque SVG (scripts, gestionnaires d'événements, liens externes,
 *   métadonnées d'éditeur) ;
 * - écrit src/symbols/iso7010/<code>.svg et src/symbols/iso7010/manifest.json
 *   (nom français, catégorie, licence, auteur, URL source).
 *
 * Usage :  node scripts/fetch-iso7010.mjs
 * Nécessite Internet UNIQUEMENT pour cette étape de développement ;
 * le logiciel livré embarque les fichiers et fonctionne hors ligne.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'symbols', 'iso7010');
// Identification conforme à la politique User-Agent de Wikimedia (nom, version, contact).
const UA = 'AtelierPlansEvacuation/2.0 (https://github.com/ARBJ-prevention/atelier-plans-evacuation; build script)';
const ALLOWED = ['Public domain', 'CC0'];

// [fichier Commons, identifiant, nom français, catégorie]
const LIST = [
  ['ISO 7010 E001.svg', 'iso-E001', 'Sortie de secours (à gauche)', 'Évacuation'],
  ['ISO 7010 E002.svg', 'iso-E002', 'Sortie de secours (à droite)', 'Évacuation'],
  ['ISO 7010 Safe condition arrow 1.svg', 'iso-arrow', 'Flèche de direction', 'Évacuation'],
  ['ISO 7010 Safe condition arrow 2.svg', 'iso-arrow-45', 'Flèche de direction (45°)', 'Évacuation'],
  ['ISO 7010 E016.svg', 'iso-E016', 'Échelle d’évacuation', 'Évacuation'],
  ['ISO 7010 E017.svg', 'iso-E017', 'Fenêtre de sauvetage', 'Évacuation'],
  ['ISO 7010 E026.svg', 'iso-E026', 'Sortie de secours PMR (à gauche)', 'Évacuation'],
  ['ISO 7010 E030.svg', 'iso-E030', 'Sortie de secours PMR (à droite)', 'Évacuation'],
  ['ISO 7010 E024.svg', 'iso-E024', 'Espace d’attente sécurisé', 'Évacuation'],
  ['ISO 7010 E007.svg', 'iso-E007', 'Point de rassemblement', 'Évacuation'],
  ['ISO 7010 E021.svg', 'iso-E021', 'Abri de protection', 'Évacuation'],
  ['ISO 7010 E022.svg', 'iso-E022', 'Porte : pousser à gauche', 'Évacuation'],
  ['ISO 7010 E023.svg', 'iso-E023', 'Porte : pousser à droite', 'Évacuation'],
  ['ISO 7010 E018.svg', 'iso-E018', 'Ouverture par rotation à gauche', 'Évacuation'],
  ['ISO 7010 E019.svg', 'iso-E019', 'Ouverture par rotation à droite', 'Évacuation'],
  ['ISO 7010 E008.svg', 'iso-E008', 'Briser pour accéder', 'Évacuation'],
  ['ISO 7010 E025.svg', 'iso-E025', 'Marteau brise-vitre', 'Évacuation'],

  ['ISO 7010 F001.svg', 'iso-F001', 'Extincteur', 'Lutte contre l’incendie'],
  ['ISO 7010 F009.svg', 'iso-F009', 'Extincteur sur roues', 'Lutte contre l’incendie'],
  ['ISO 7010 F002.svg', 'iso-F002', 'Robinet d’incendie armé (RIA)', 'Lutte contre l’incendie'],
  ['ISO 7010 F005.svg', 'iso-F005', 'Déclencheur manuel d’alarme', 'Lutte contre l’incendie'],
  ['ISO 7010 F006.svg', 'iso-F006', 'Téléphone d’urgence incendie', 'Lutte contre l’incendie'],
  ['ISO 7010 F004.svg', 'iso-F004', 'Matériel de lutte contre l’incendie', 'Lutte contre l’incendie'],
  ['ISO 7010 F003.svg', 'iso-F003', 'Échelle d’incendie', 'Lutte contre l’incendie'],
  ['ISO 7010 F007.svg', 'iso-F007', 'Porte coupe-feu', 'Lutte contre l’incendie'],
  ['ISO 7010 F008.svg', 'iso-F008', 'Batterie fixe d’extinction', 'Lutte contre l’incendie'],
  ['ISO 7010 F012.svg', 'iso-F012', 'Installation fixe d’extinction', 'Lutte contre l’incendie'],

  ['ISO 7010 E003.svg', 'iso-E003', 'Premiers secours', 'Premiers secours'],
  ['ISO 7010 E010.svg', 'iso-E010', 'Défibrillateur (DEA)', 'Premiers secours'],
  ['ISO 7010 E004.svg', 'iso-E004', 'Téléphone d’urgence', 'Premiers secours'],
  ['ISO 7010 E009.svg', 'iso-E009', 'Médecin', 'Premiers secours'],
  ['ISO 7010 E011.svg', 'iso-E011', 'Lave-œil', 'Premiers secours'],
  ['ISO 7010 E012.svg', 'iso-E012', 'Douche de sécurité', 'Premiers secours'],
  ['ISO 7010 E013.svg', 'iso-E013', 'Civière', 'Premiers secours'],
  ['ISO 7010 E020.svg', 'iso-E020', 'Bouton d’arrêt d’urgence', 'Premiers secours'],

  ['ISO 7010 P020.svg', 'iso-P020', 'Ascenseur interdit en cas d’incendie', 'Interdictions et dangers'],
  ['ISO 7010 P002.svg', 'iso-P002', 'Interdiction de fumer', 'Interdictions et dangers'],
  ['ISO 7010 P003.svg', 'iso-P003', 'Flamme nue interdite', 'Interdictions et dangers'],
  ['ISO 7010 P004.svg', 'iso-P004', 'Passage interdit aux piétons', 'Interdictions et dangers'],
  ['ISO 7010 W012.svg', 'iso-W012', 'Danger électrique', 'Interdictions et dangers'],
  ['ISO 7010 W021.svg', 'iso-W021', 'Matières inflammables', 'Interdictions et dangers'],
  ['ISO 7010 W001.svg', 'iso-W001', 'Danger général', 'Interdictions et dangers'],
];

const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function sanitize(svg) {
  let s = svg;
  s = s.replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  s = s.replace(/<(sodipodi|inkscape):[^>]*\/>/gi, '').replace(/<(sodipodi|inkscape):[\s\S]*?<\/(sodipodi|inkscape):[^>]*>/gi, '');
  s = s.replace(/\s(sodipodi|inkscape):[a-z-]+="[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  s = s.replace(/\s(xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, '');
  if (!/viewBox=/.test(s)) {
    const w = parseFloat((s.match(/<svg[^>]*\swidth="([\d.]+)/) || [])[1]);
    const h = parseFloat((s.match(/<svg[^>]*\sheight="([\d.]+)/) || [])[1]);
    if (w && h) s = s.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`);
  }
  // Taille intrinsèque normalisée (le rendu se fait par viewBox)
  s = s.replace(/(<svg[^>]*?)\swidth="[^"]*"/, '$1').replace(/(<svg[^>]*?)\sheight="[^"]*"/, '$1');
  s = s.replace('<svg', '<svg width="100" height="100" preserveAspectRatio="xMidYMid meet"');
  return s.trim() + '\n';
}

/** Télécharge un SVG ; nouvelle tentative si limitation de débit. Retourne null si le contenu n'est pas un SVG. */
async function download(url) {
  for (let attempt = 0; attempt < 10; attempt++) {
    // curl est moins souvent limité que le client HTTP de Node par les serveurs de Wikimedia.
    let res = { ok: false, status: 0 };
    let text = '';
    try {
      const outp = execFileSync('curl', ['-s', '-A', UA, '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
      const cut = outp.lastIndexOf('\n');
      res = { status: Number(outp.slice(cut + 1)), ok: false };
      res.ok = res.status === 200;
      text = outp.slice(0, cut);
    } catch {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      res = { ok: r.ok, status: r.status };
      text = await r.text();
    }
    const body = text.replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '').trim();
    if (res.ok && body.startsWith('<svg')) return text;
    const wait = res.status === 429 ? 60000 + attempt * 30000 : 5000;
    console.warn(`  nouvel essai dans ${wait / 1000} s (HTTP ${res.status})`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const delay = Number(process.env.START_DELAY || 0);
  if (delay) { console.log(`Attente initiale ${delay / 1000} s`); await new Promise((r) => setTimeout(r, delay)); }
  const manifest = [];
  for (let i = 0; i < LIST.length; i += 40) {
    const chunk = LIST.slice(i, i + 40);
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata',
      iiextmetadatafilter: 'LicenseShortName|Artist|ImageDescription',
      titles: chunk.map((c) => `File:${c[0]}`).join('|'),
    }).toString();
    const data = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
    const byTitle = new Map(Object.values(data.query.pages).map((p) => [p.title.replace(/^File:/, ''), p]));
    for (const [file, id, name, category] of chunk) {
      const p = byTitle.get(file.replace(/_/g, ' '));
      const info = p?.imageinfo?.[0];
      if (!info) { console.warn(`ABSENT   ${file}`); continue; }
      const license = info.extmetadata.LicenseShortName?.value ?? '?';
      if (!ALLOWED.some((a) => license.startsWith(a))) { console.warn(`REFUSÉ   ${file} (${license})`); continue; }
      const target = path.join(OUT, `${id}.svg`);
      const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      const svg = existing.startsWith('<svg') ? null : await download(info.url);
      if (existing.startsWith('<svg')) {
        manifest.push({ id, name, category, code: id.replace('iso-', ''), license, author: strip(info.extmetadata.Artist?.value) || 'inconnu', source: info.descriptionurl });
        console.log(`DÉJÀ     ${id}`);
        continue;
      }
      if (!svg) { console.warn(`INVALIDE ${file}`); continue; }
      fs.writeFileSync(path.join(OUT, `${id}.svg`), sanitize(svg));
      manifest.push({
        id, name, category, code: id.replace('iso-', ''), license,
        author: strip(info.extmetadata.Artist?.value) || 'inconnu',
        source: info.descriptionurl,
      });
      console.log(`OK       ${id.padEnd(14)} ${license.padEnd(14)} ${name}`);
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length} pictogrammes écrits dans ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
