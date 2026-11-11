/**
 * Autotest de bout en bout, exécuté DANS l'application réelle
 * (`npm run selftest` ou « Atelier Plans d'Évacuation.exe --selftest »).
 * Il parcourt le chemin complet : création, import PDF, pictogrammes,
 * itinéraires, enregistrement, réouverture, sauvegarde automatique,
 * exports PDF (A4/A3) et PNG haute résolution, annulation, validation.
 * Les fichiers produits sont conservés dans le dossier de sortie.
 */
import * as pdfjs from 'pdfjs-dist';
import * as A from './app/actions';
import { buildSampleProject, SAMPLES } from './app/sample';
import { BUILTIN_SYMBOLS } from './symbols/library';
import { makeElement, uid } from './model/defaults';
import { canonicalJson, parseProject, serializeProject } from './model/serialize';
import { api } from './services/api';
import { renderPdfPage } from './services/imports';
import { renderPagePng } from './services/exporter';
import { currentFloor, useStore } from './store/store';

interface Check { name: string; ok: boolean; detail: string }

export async function runSelfTest(outDir: string): Promise<void> {
  const checks: Check[] = [];
  const started = Date.now();
  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      checks.push({ name, ok: true, detail });
    } catch (e) {
      checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
  const S = () => useStore.getState();
  const sep = outDir.includes('\\') ? '\\' : '/';
  const out = (f: string) => `${outDir}${sep}${f}`;

  // 1. Création du projet + pictogramme importé + image
  await check('Création d’un projet (bâtiment, étage, 2 versions)', async () => {
    const p = buildSampleProject();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#1f5fbf"/><circle cx="5" cy="5" r="3" fill="#fff"/></svg>';
    p.customSymbols.push({ id: 'sym_test', name: 'Pictogramme importé (test)', category: 'Mes pictogrammes', src: `data:image/svg+xml;base64,${btoa(svg)}` });
    p.buildings[0].floors[0].elements.push(makeElement('symbol', { x: 300, y: 120, symbolId: 'sym_test' }));
    S().loadProject(p, null);
    const f = currentFloor(S())!;
    assert(f.variants.length === 2, 'deux versions attendues');
    return `${f.elements.length} éléments, ${f.variants.length} versions`;
  });

  // 2. Export PDF de toutes les versions
  let pdfPath = '';
  await check('Export PDF A4 paysage (une page par version)', async () => {
    const job = A.currentExportJob('all')!;
    pdfPath = (await A.exportPdfAction(job, out('plan-A4-toutes-versions.pdf')))!;
    assert(pdfPath, 'aucun fichier produit');
    const bytes = new Uint8Array(await api().readBinary(pdfPath));
    assert(new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-', 'signature PDF absente');
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    assert(doc.numPages === 2, `2 pages attendues, ${doc.numPages} obtenues`);
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    assert(Math.abs(vp.width - 841.9) < 3 && Math.abs(vp.height - 595.3) < 3, `format inattendu ${vp.width.toFixed(1)}×${vp.height.toFixed(1)} pt`);
    const text = (await page.getTextContent()).items.map((i: any) => i.str).join(' ');
    assert(text.includes('évacuation'), 'le titre n’est pas présent sous forme de texte vectoriel');
    assert(text.includes('Légende') && text.includes('Consignes'), 'légende ou consignes absentes');
    assert(text.includes('Brouillon'), 'statut absent du cartouche');
    const p2 = (await (await doc.getPage(2)).getTextContent()).items.map((i: any) => i.str).join(' ');
    assert(p2.includes('Couloir est'), 'page 2 : nom de version absent');
    // Les pictogrammes SVG doivent rester vectoriels (aucune image matricielle sans plan de fond).
    const ops = await page.getOperatorList();
    const rasters = ops.fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
    assert(rasters === 0, `${rasters} image(s) matricielle(s) trouvée(s) : les pictogrammes ont été rastérisés`);
    await doc.loadingTask.destroy();
    return `${(bytes.length / 1024).toFixed(0)} Ko, 2 pages A4 (842×595 pt), texte et pictogrammes vectoriels vérifiés`;
  });

  // 2 bis. Bibliothèque ISO 7010 complète et lisible
  const ISO_EXPECTED = 97;
  await check(`Bibliothèque ISO 7010 (${ISO_EXPECTED} signaux officiels)`, async () => {
    const iso = BUILTIN_SYMBOLS.filter((s) => s.kind === 'iso');
    assert(iso.length === ISO_EXPECTED, `${iso.length} signaux ISO chargés au lieu de ${ISO_EXPECTED}`);
    const bad: string[] = [];
    for (const s of iso) {
      const ok = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = s.svg;
      });
      if (!ok) bad.push(s.id);
      assert(/^(Public domain|CC0)/.test(s.license), `${s.id} : licence ${s.license}`);
    }
    assert(!bad.length, `illisibles : ${bad.join(', ')}`);
    return `${iso.length} signaux décodés, licences domaine public / CC0`;
  });

  // 2 ter. Les quatre thèmes et plans d'exemple s'exportent
  await check('Plans d’exemple : export des 4 thèmes', async () => {
    const done: string[] = [];
    for (const sm of SAMPLES) {
      const p = sm.build();
      const b = p.buildings[0], f = b.floors[0];
      const job = { building: b, floor: f, variantIds: f.variants.map((v) => v.id), customSymbols: p.customSymbols, page: f.page };
      const file = await A.exportPdfAction(job, out(`exemple-${sm.id}.pdf`));
      const bytes = new Uint8Array(await api().readBinary(file!));
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      assert(doc.numPages === f.variants.length, `${sm.id} : ${doc.numPages} page(s)`);
      const text = (await (await doc.getPage(1)).getTextContent()).items.map((i: any) => i.str).join(' ');
      await doc.loadingTask.destroy();
      assert(/vacuation/i.test(text) && /gende/i.test(text), `${sm.id} : titre ou légende absents`);
      const unknown = f.elements.filter((e) => e.type === 'symbol' && !BUILTIN_SYMBOLS.some((s) => s.id === e.symbolId)).map((e: any) => e.symbolId);
      assert(!unknown.length, `${sm.id} : pictogrammes inconnus ${unknown.join(', ')}`);
      const png = await renderPagePng(job, f.variants[0].id, 150);
      await api().saveBinary({ data: png.data, suggestedName: `exemple-${sm.id}.png`, filterName: 'PNG', ext: 'png', path: out(`exemple-${sm.id}.png`) });
      done.push(`${sm.theme} (${doc.numPages} p.)`);
    }
    return done.join(', ');
  });

  // 2 quinquies. Détection d'une mise à jour dans le dossier de distribution
  await check('Détection des mises à jour (dossier local)', async () => {
    const dir = `${outDir}${sep}maj-test`;
    const enc = (s: string) => new TextEncoder().encode(s);
    const write = (f: string, data: Uint8Array) => api().saveBinary({ data, suggestedName: f, filterName: 'test', ext: 'x', path: `${dir}${sep}${f}` });
    await write('Atelier-Plans-Evacuation-Setup-99.0.0.exe', enc('factice'));
    await write('mise-a-jour.json', enc(JSON.stringify({ version: '99.0.0', installer: 'Atelier-Plans-Evacuation-Setup-99.0.0.exe', notes: 'Test' })));
    const up = await api().updateCheck(dir);
    assert(up.available && up.version === '99.0.0', `nouvelle version non détectée (${JSON.stringify(up)})`);
    await write('mise-a-jour.json', enc(JSON.stringify({ version: '0.0.1', installer: 'Atelier-Plans-Evacuation-Setup-99.0.0.exe' })));
    const old = await api().updateCheck(dir);
    assert(!old.available, 'une version plus ancienne ne doit pas être proposée');
    return `version installée ${up.current} : 99.0.0 proposée, 0.0.1 ignorée`;
  });

  // 2 quater. Migration d'un projet de la version 1
  await check('Ouverture d’un projet de la version 1 (migration)', async () => {
    const v1 = JSON.stringify({
      format: 'atelier-evac', formatVersion: 1, id: 'prj_old', name: 'Ancien', country: 'BE',
      buildings: [{ id: 'b', name: 'B', floors: [{ id: 'f', name: 'RDC', elements: [
        { id: 'a', type: 'symbol', layer: 'symbols', rotation: 0, x: 0, y: 0, size: 40, symbolId: 'extinguisher', label: '' },
        { id: 'r', type: 'route', layer: 'routes', rotation: 0, points: [[0, 0], [10, 0]], color: '#00843d', width: 8, dashed: true, arrowEnd: true, arrowStart: false, kind: 'secondaire' },
        { id: 'd', type: 'door', layer: 'building', rotation: 0, x: 0, y: 0, width: 90, swing: 'left', double: true, color: '#222' },
      ] }] }],
    });
    const p = parseProject(v1);
    const els = p.buildings[0].floors[0].elements as any[];
    assert(p.formatVersion === 2, 'version non migrée');
    assert(els[0].symbolId === 'iso-F001', `pictogramme non converti (${els[0].symbolId})`);
    assert(els[1].dash === 'dashed' && els[1].arrowStyle, 'itinéraire non converti');
    assert(els[2].doorType === 'double', 'porte non convertie');
    return 'pictogrammes → ISO 7010, styles et portes convertis';
  });

  // 3. Import du PDF comme plan de fond
  await check('Import d’un PDF comme plan de fond', async () => {
    const bytes = new Uint8Array(await api().readBinary(pdfPath));
    const img = await renderPdfPage(bytes, 1);
    assert(img.width >= 3000 && img.height >= 2000, `résolution trop faible ${img.width}×${img.height}`);
    A.applyBackground(img.src, img.width, img.height, 'plan-A4-toutes-versions.pdf');
    S().mutateFloor((f) => { f.background!.x = -200; f.background!.y = -150; f.background!.opacity = 0.25; });
    const bg = currentFloor(S())!.background!;
    assert(bg.naturalWidth === img.width, 'fond non appliqué');
    return `rastérisé en ${img.width}×${img.height} px`;
  });

  // 4. Undo / redo
  await check('Annuler / rétablir', async () => {
    const n = currentFloor(S())!.elements.length;
    S().addElements([makeElement('route', { points: [[0, 0], [100, 0], [100, 100]] })]);
    assert(currentFloor(S())!.elements.length === n + 1, 'ajout non effectué');
    S().undo();
    assert(currentFloor(S())!.elements.length === n, 'annulation non effectuée');
    S().redo();
    assert(currentFloor(S())!.elements.length === n + 1, 'rétablissement non effectué');
    S().undo();
    return 'ajout → annulation → rétablissement OK';
  });

  // 5. Copier-coller, grouper, aligner
  await check('Copier-coller, grouper et aligner', async () => {
    const f = currentFloor(S())!;
    const syms = f.elements.filter((e) => e.type === 'symbol' && !e.variantId).slice(0, 3).map((e) => e.id);
    S().select(syms);
    S().copySelection(); S().paste();
    const pasted = S().selection;
    assert(pasted.length === 3 && pasted.every((id) => !syms.includes(id)), 'collage incorrect');
    S().groupSelection();
    const g = currentFloor(S())!.elements.filter((e) => pasted.includes(e.id)).map((e) => e.groupId);
    assert(g[0] && g.every((x) => x === g[0]), 'groupe non créé');
    S().alignSelection('top');
    S().deleteSelection();
    assert(currentFloor(S())!.elements.length === f.elements.length, 'suppression incorrecte');
    return 'collage de 3 éléments, groupe, alignement, suppression';
  });

  // 6. Enregistrement puis réouverture
  const projectPath = out('projet-test.planevac');
  await check('Enregistrement du projet sur disque', async () => {
    const content = serializeProject(S().project!);
    const p = await api().saveProject({ path: projectPath, content, suggestedName: 'projet-test' });
    assert(p === projectPath, 'chemin inattendu');
    S().markSaved(p!);
    return `${(content.length / 1024).toFixed(0)} Ko écrits (écriture atomique + relecture de contrôle)`;
  });
  await check('Réouverture : projet identique et éléments modifiables', async () => {
    const original = canonicalJson(S().project!);
    const res = await api().openProjectPath(projectPath);
    const p = parseProject(res.content);
    assert(canonicalJson(p) === original, 'le projet relu diffère du projet enregistré');
    S().loadProject(p, res.path);
    const f = currentFloor(S())!;
    const route = f.elements.find((e) => e.type === 'route')!;
    S().select([route.id]);
    S().nudgeSelection(10, 0);
    assert((currentFloor(S())!.elements.find((e) => e.id === route.id) as any).points[0][0] === (route as any).points[0][0] + 10, 'élément non modifiable');
    S().undo();
    return `${f.elements.length} éléments relus, fond et pictogramme importé conservés`;
  });

  // 7. Sauvegarde automatique / récupération
  await check('Sauvegarde automatique et récupération', async () => {
    S().mutateFloor((f) => { f.name = 'Rez-de-chaussée (modifié)'; });
    await A.autosaveNow();
    const list = await api().autosaveList();
    const entry = list.find((e) => e.id === S().project!.id);
    assert(entry, 'sauvegarde automatique introuvable');
    const restored = parseProject(entry!.content);
    assert(restored.buildings[0].floors[0].name === 'Rez-de-chaussée (modifié)', 'contenu récupéré incorrect');
    await api().autosaveClear(S().project!.id);
    assert(!(await api().autosaveList()).some((e) => e.id === S().project!.id), 'sauvegarde non supprimée');
    S().undo();
    return 'écriture, relecture et nettoyage OK';
  });

  // 8. Export PNG 300 ppp
  await check('Export PNG haute résolution (300 ppp, A4)', async () => {
    const job = A.currentExportJob('current')!;
    const files = await A.exportPngAction(job, 300, outDir);
    assert(files.length === 1, 'aucun PNG');
    const b = new Uint8Array(await api().readBinary(files[0]));
    assert(b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, 'signature PNG absente');
    const dv = new DataView(b.buffer, b.byteOffset);
    const w = dv.getUint32(16), h = dv.getUint32(20);
    assert(w === 3508 && h === 2480, `dimensions ${w}×${h} au lieu de 3508×2480`);
    const bmp = await createImageBitmap(new Blob([b], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = 350; c.height = 248;
    const ctx = c.getContext('2d')!; ctx.drawImage(bmp, 0, 0, 350, 248);
    const px = ctx.getImageData(0, 0, 350, 248).data;
    let green = 0, dark = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 1] > 100 && px[i] < 60 && px[i + 2] < 110) green++;
      if (px[i] < 80 && px[i + 1] < 80 && px[i + 2] < 80) dark++;
    }
    assert(green > 200 && dark > 500, `contenu insuffisant (vert ${green}, sombre ${dark})`);
    return `${w}×${h} px, ${(b.length / 1024).toFixed(0)} Ko, contenu vérifié (pictogrammes verts, traits)`;
  });

  // 9. Export A3 portrait à l'échelle fixe
  await check('Export PDF A3 portrait à l’échelle 1:200', async () => {
    S().mutateFloor((f) => { Object.assign(f.page, { paper: 'A3', orientation: 'portrait', scaleMode: 'fixed', scale: 200 }); }, { keepValidation: true });
    const p = await A.exportPdfAction(A.currentExportJob('current'), out('plan-A3-portrait-1-200.pdf'));
    const bytes = new Uint8Array(await api().readBinary(p!));
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i: any) => i.str).join(' ');
    await doc.loadingTask.destroy();
    assert(Math.abs(vp.width - 841.9) < 3 && Math.abs(vp.height - 1190.6) < 3, `format ${vp.width.toFixed(0)}×${vp.height.toFixed(0)} pt`);
    assert(text.includes('1:200'), 'échelle 1:200 absente');
    S().mutateFloor((f) => { Object.assign(f.page, { paper: 'A4', orientation: 'landscape', scaleMode: 'fit' }); }, { keepValidation: true });
    return 'A3 portrait (842×1191 pt), mention 1:200 présente';
  });

  // 10. Validation explicite et retour automatique à « À valider »
  await check('Statut de validation explicite', async () => {
    assert(currentFloor(S())!.titleBlock.status === 'draft', 'le statut initial doit être Brouillon');
    S().mutateFloor((f) => { f.titleBlock.status = 'validated'; f.titleBlock.validatedBy = 'Testeur'; f.titleBlock.validatedAt = new Date().toISOString(); }, { keepValidation: true });
    const p = await A.exportPdfAction(A.currentExportJob('current'), out('plan-valide.pdf'));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await api().readBinary(p!)).slice() }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i: any) => i.str).join(' ');
    await doc.loadingTask.destroy();
    assert(text.includes('Validé par Testeur'), 'mention de validation absente du PDF');
    assert(!text.includes('BROUILLON'), 'filigrane présent sur un plan validé');
    S().addElements([makeElement('text', { x: 0, y: 0, text: 'modif' })]);
    assert(currentFloor(S())!.titleBlock.status === 'to_validate', 'une modification doit invalider la validation');
    return 'validé → PDF mentionne le validateur → modification → « À valider »';
  });

  // 11. Robustesse : fichier corrompu refusé proprement
  await check('Rejet propre d’un fichier invalide', async () => {
    let msg = '';
    try { parseProject('{"format":"autre"}'); } catch (e) { msg = (e as Error).message; }
    assert(msg.includes('n’est pas un projet'), 'message attendu absent');
    try { parseProject('{tronqué'); } catch (e) { msg = (e as Error).message; }
    assert(msg.includes('JSON'), 'JSON invalide non détecté');
    return 'messages d’erreur explicites';
  });

  const report = {
    ok: checks.every((c) => c.ok),
    date: new Date().toISOString(),
    durationMs: Date.now() - started,
    outDir,
    checks,
    id: uid('run'),
  };
  await api().selftestDone(report);
}
