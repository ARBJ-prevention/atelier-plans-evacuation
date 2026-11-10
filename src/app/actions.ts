import { COUNTRIES } from '../model/countries';
import { makeElement, newProject, uid } from '../model/defaults';
import { cloneProjectWithNewIds, parseProject, ProjectFormatError, serializeProject } from '../model/serialize';
import type { Background, PageSetup } from '../model/types';
import { api, bytesToDataUrl, MIME } from '../services/api';
import { buildPrintHtml, renderPagePng, safeFileName, type ExportJob } from '../services/exporter';
import { imageFromFile, pdfPageCount, renderPdfPage } from '../services/imports';
import { currentBuilding, currentFloor, currentVariantId, useStore } from '../store/store';
import { alertDialog, ask, confirmDialog, promptDialog } from '../ui/dialogs';

const S = () => useStore.getState();

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Si le projet a des modifications, propose d'enregistrer. Retourne false si l'utilisateur annule. */
export async function confirmDiscardChanges(): Promise<boolean> {
  if (!S().project || !S().dirty) return true;
  const r = await ask({
    title: 'Modifications non enregistrées',
    message: 'Le projet en cours contient des modifications non enregistrées.',
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Ne pas enregistrer', value: 'discard', danger: true }, { label: 'Enregistrer', value: 'save', primary: true }],
  });
  if (r.button === 'cancel') return false;
  if (r.button === 'save') return saveProject(false);
  await api().autosaveClear(S().project!.id);
  return true;
}

export async function newProjectAction(): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  const r = await ask({
    title: 'Nouveau projet',
    fields: [
      { key: 'name', label: 'Nom du projet', type: 'text', value: 'Nouveau projet', required: true },
      { key: 'building', label: 'Premier bâtiment', type: 'text', value: 'Bâtiment principal', required: true },
      { key: 'country', label: 'Pays (modèles et consignes par défaut)', type: 'select', value: 'BE', options: COUNTRIES.map((c) => ({ value: c.code, label: c.name })) },
      { key: 'author', label: 'Auteur (cartouche)', type: 'text', value: '' },
    ],
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Créer', value: 'ok', primary: true }],
  });
  if (r.button !== 'ok') return;
  const p = newProject(r.values.name, r.values.country);
  p.buildings[0].name = r.values.building;
  p.buildings[0].floors.forEach((f) => { f.titleBlock.author = r.values.author; });
  S().loadProject(p, null);
  S().toast('Projet créé. Commencez par importer un plan de fond ou dessiner les murs.', 'success');
}

export async function openProjectAction(path?: string): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  try {
    const res = path ? await api().openProjectPath(path) : await api().openProjectDialog();
    if (!res) return;
    const p = parseProject(res.content);
    S().loadProject(p, res.path);
    S().toast(`Projet « ${p.name} » ouvert.`, 'success');
  } catch (e) {
    await alertDialog('Impossible d’ouvrir le projet', e instanceof ProjectFormatError ? e.message : `Erreur de lecture : ${errMsg(e)}`);
  }
}

export async function saveProject(saveAs: boolean): Promise<boolean> {
  const s = S();
  if (!s.project) return false;
  try {
    const content = serializeProject(s.project);
    const path = await api().saveProject({ path: s.filePath, content, suggestedName: safeFileName(s.project.name), saveAs });
    if (!path) return false;
    S().markSaved(path);
    await api().autosaveClear(s.project.id);
    S().toast('Projet enregistré.', 'success');
    return true;
  } catch (e) {
    await alertDialog('Échec de l’enregistrement', `Le projet n’a pas pu être enregistré : ${errMsg(e)}\nVos données restent ouvertes ; réessayez à un autre emplacement.`);
    return false;
  }
}

export async function duplicateProjectAction(): Promise<void> {
  const s = S();
  if (!s.project) return;
  const name = await promptDialog('Dupliquer le projet', 'Nom de la copie', `Copie de ${s.project.name}`);
  if (!name) return;
  const copy = cloneProjectWithNewIds(s.project, name);
  const content = serializeProject(copy);
  const path = await api().saveProject({ path: null, content, suggestedName: safeFileName(name), saveAs: true });
  if (!path) return;
  if (await confirmDialog('Projet dupliqué', `La copie a été enregistrée :\n${path}\n\nVoulez-vous l’ouvrir maintenant ?`, 'Ouvrir la copie')) {
    if (await confirmDiscardChanges()) { S().loadProject(copy, path); }
  }
}

export async function importBackgroundAction(): Promise<void> {
  const s = S();
  const floor = currentFloor(s);
  if (!floor) return;
  if (floor.background && !(await confirmDialog('Remplacer le plan de fond', 'Cet étage possède déjà un plan de fond. Le remplacer ?', 'Remplacer'))) return;
  const file = await api().pickFile('plan');
  if (!file) return;
  try {
    let img;
    if (file.ext === 'pdf') {
      const n = await pdfPageCount(file.data);
      let page = 1;
      if (n > 1) {
        const v = await promptDialog('Importer un PDF', `Numéro de page à importer (1 à ${n})`, '1');
        if (!v) return;
        page = Math.min(n, Math.max(1, parseInt(v, 10) || 1));
      }
      S().toast('Conversion du PDF en cours…', 'info');
      img = await renderPdfPage(file.data, page);
    } else {
      img = await imageFromFile(file);
    }
    applyBackground(img.src, img.width, img.height, file.name);
    S().toast('Plan de fond importé. Étalonnez l’échelle (outil « Étalonner ») pour obtenir des mesures réelles.', 'success');
  } catch (e) {
    await alertDialog('Import impossible', `Le fichier n’a pas pu être importé : ${errMsg(e)}`);
  }
}

export function applyBackground(src: string, width: number, height: number, name: string) {
  const scale = 2000 / Math.max(width, height);
  const bg: Background = { src, sourceName: name, naturalWidth: width, naturalHeight: height, x: 0, y: 0, scale, opacity: 0.45, locked: true, grayscale: true };
  S().mutateFloor((f) => { f.background = bg; });
  S().requestFit();
}

export async function importSymbolAction(): Promise<void> {
  const file = await api().pickFile('symbol');
  if (!file) return;
  const r = await ask({
    title: 'Importer un pictogramme',
    message: 'Assurez-vous de disposer des droits d’utilisation de ce pictogramme (licence, source officielle).',
    fields: [
      { key: 'name', label: 'Nom (affiché dans la légende)', type: 'text', value: file.name.replace(/\.[^.]+$/, ''), required: true },
      { key: 'category', label: 'Catégorie', type: 'text', value: 'Mes pictogrammes', required: true },
    ],
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Importer', value: 'ok', primary: true }],
  });
  if (r.button !== 'ok') return;
  const src = bytesToDataUrl(file.data, MIME[file.ext] ?? 'image/png');
  S().mutate((d) => { d.customSymbols.push({ id: uid('sym'), name: r.values.name, category: r.values.category, src }); });
  S().toast('Pictogramme ajouté à la bibliothèque du projet.', 'success');
}

export async function insertImageAction(): Promise<void> {
  const file = await api().pickFile('image');
  if (!file) return;
  try {
    const img = await imageFromFile(file);
    const s = S();
    const v = s.view;
    const el = document.querySelector('.canvas-wrap');
    const cw = el?.clientWidth ?? 800, ch = el?.clientHeight ?? 600;
    const w = 200, h = (200 * img.height) / Math.max(1, img.width);
    s.addElements([makeElement('image', { x: (cw / 2 - v.x) / v.zoom, y: (ch / 2 - v.y) / v.zoom, w, h, src: img.src })]);
    s.setTool('select');
  } catch (e) {
    await alertDialog('Import impossible', errMsg(e));
  }
}

export async function pickLogoAction(): Promise<void> {
  const file = await api().pickFile('image');
  if (!file) return;
  const img = await imageFromFile(file);
  S().mutateFloor((f) => { f.titleBlock.logo = img.src; });
}

export async function calibrateAction(unitsDistance: number): Promise<void> {
  if (unitsDistance < 1) { S().toast('Les deux points sont trop proches.', 'warning'); return; }
  const v = await promptDialog('Étalonnage de l’échelle', 'Distance réelle entre les deux points (en mètres)', '',
    'Indiquez la distance réelle mesurée entre les deux points cliqués (par exemple une cote du plan importé).');
  if (!v) return;
  const meters = parseFloat(v.replace(',', '.'));
  if (!(meters > 0)) { await alertDialog('Valeur invalide', 'Saisissez une distance positive, par exemple 12,5.'); return; }
  S().mutateFloor((f) => { f.unitsPerMeter = unitsDistance / meters; });
  S().setTool('select');
  S().toast(`Échelle étalonnée : ${(unitsDistance / meters).toFixed(2)} unités par mètre.`, 'success');
}

export async function validateAction(): Promise<void> {
  const f = currentFloor(S());
  if (!f) return;
  const r = await ask({
    title: 'Valider le plan',
    message: 'La validation est une décision explicite de votre part. Elle sera indiquée dans le cartouche avec votre nom et la date. Elle ne constitue pas une certification de conformité. Toute modification ultérieure du plan repassera automatiquement le statut à « À valider ».',
    fields: [
      { key: 'by', label: 'Validé par (nom et fonction)', type: 'text', value: f.titleBlock.validatedBy || f.titleBlock.author, required: true },
      { key: 'checked', label: 'Je confirme avoir vérifié le contenu de ce plan (itinéraires, équipements, consignes).', type: 'checkbox', value: false },
    ],
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Valider le plan', value: 'ok', primary: true }],
  });
  if (r.button !== 'ok') return;
  if (!r.values.checked) { await alertDialog('Validation non effectuée', 'Vous devez cocher la confirmation de vérification pour valider le plan.'); return; }
  S().mutateFloor((fd) => {
    fd.titleBlock.status = 'validated';
    fd.titleBlock.validatedBy = String(r.values.by).trim();
    fd.titleBlock.validatedAt = new Date().toISOString();
  }, { keepValidation: true });
  S().toast('Plan validé.', 'success');
}

// ——— Exports ———
export function currentExportJob(variantScope: 'current' | 'all', page?: PageSetup): ExportJob | null {
  const s = S();
  const floor = currentFloor(s), building = currentBuilding(s);
  if (!floor || !building || !s.project) return null;
  return {
    building, floor, customSymbols: s.project.customSymbols, page: page ?? floor.page,
    variantIds: variantScope === 'all' ? floor.variants.map((v) => v.id) : [currentVariantId(s)],
  };
}

function exportBaseName(job: ExportJob, variantId?: string): string {
  const v = job.floor.variants.find((x) => x.id === variantId);
  return safeFileName([job.floor.titleBlock.title, job.building.name, job.floor.name, job.floor.variants.length > 1 && v ? v.name : ''].filter(Boolean).join(' - '));
}

export async function exportPdfAction(job: ExportJob | null = currentExportJob('current'), path?: string): Promise<string | null> {
  if (!job) return null;
  try {
    const html = buildPrintHtml(job);
    const out = await api().exportPdf({
      html, paper: job.page.paper, landscape: job.page.orientation === 'landscape',
      suggestedName: `${exportBaseName(job, job.variantIds.length === 1 ? job.variantIds[0] : undefined)}.pdf`, path,
    });
    if (out && !path) {
      S().toast(`PDF exporté (${job.variantIds.length} page${job.variantIds.length > 1 ? 's' : ''}).`, 'success');
      api().showInFolder(out);
    }
    return out;
  } catch (e) {
    await alertDialog('Échec de l’export PDF', errMsg(e));
    return null;
  }
}

export async function exportPngAction(job: ExportJob | null = currentExportJob('current'), dpi = 300, dir?: string): Promise<string[]> {
  if (!job) return [];
  const out: string[] = [];
  try {
    for (const vid of job.variantIds) {
      const png = await renderPagePng(job, vid, dpi);
      const name = `${exportBaseName(job, vid)}.png`;
      const p = await api().saveBinary({ data: png.data, suggestedName: name, filterName: 'Image PNG', ext: 'png', path: dir ? `${dir}\\${name}` : undefined });
      if (!p) break;
      out.push(p);
    }
    if (out.length && !dir) { S().toast(`${out.length} image(s) PNG exportée(s) à ${dpi} ppp.`, 'success'); api().showInFolder(out[0]); }
  } catch (e) {
    await alertDialog('Échec de l’export PNG', errMsg(e));
  }
  return out;
}

export async function printAction(job: ExportJob | null = currentExportJob('current')): Promise<void> {
  if (!job) return;
  const r = await api().print({ html: buildPrintHtml(job), paper: job.page.paper, landscape: job.page.orientation === 'landscape' });
  if (!r.success && r.reason && r.reason !== 'cancelled') S().toast(`Impression non effectuée : ${r.reason}`, 'warning');
}

// ——— Récupération ———
export async function checkRecovery(): Promise<void> {
  const list = await api().autosaveList();
  for (const entry of list) {
    const date = new Date(entry.savedAt).toLocaleString('fr-BE');
    const r = await ask({
      title: 'Récupération après fermeture inattendue',
      message: `Le projet « ${entry.name} » n’a pas été fermé correctement.\nUne sauvegarde automatique du ${date} est disponible${entry.filePath ? `\n(fichier d’origine : ${entry.filePath})` : ''}.`,
      buttons: [
        { label: 'Supprimer la sauvegarde', value: 'delete', danger: true },
        { label: 'Plus tard', value: 'later' },
        { label: 'Restaurer', value: 'restore', primary: true },
      ],
    });
    if (r.button === 'delete') await api().autosaveClear(entry.id);
    if (r.button === 'restore') {
      try {
        const p = parseProject(entry.content);
        S().loadProject(p, entry.filePath);
        useStore.setState({ dirty: true });
        S().toast('Projet restauré. Enregistrez-le pour conserver les modifications récupérées.', 'success');
        return;
      } catch (e) {
        await alertDialog('Restauration impossible', errMsg(e));
      }
    }
  }
}

export async function autosaveNow(): Promise<void> {
  const s = S();
  if (!s.project || !s.dirty) return;
  await api().autosaveWrite({ id: s.project.id, name: s.project.name, filePath: s.filePath, content: serializeProject(s.project) });
  S().markAutosaved();
}

// ——— Mises à jour ———
/**
 * Recherche une version plus récente dans le dossier des mises à jour.
 * Au démarrage (manual = false), ne dit rien s'il n'y a rien de nouveau ou si
 * l'utilisateur a choisi d'ignorer cette version.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  let info;
  try { info = await api().updateCheck(); } catch { if (manual) await alertDialog('Mises à jour', 'La recherche de mise à jour a échoué.'); return; }
  if (!info.available) {
    if (manual) {
      await alertDialog('Mises à jour', info.error
        ? `${info.error}\n\nDossier consulté : ${info.dir}\nVous pouvez en choisir un autre (Aide › Dossier des mises à jour).`
        : `Vous utilisez la dernière version (${info.current}).\n\nDossier consulté : ${info.dir}`);
    }
    return;
  }
  if (info.skipped && !manual) return;
  const date = info.date ? ` du ${new Date(info.date).toLocaleDateString('fr-BE')}` : '';
  const r = await ask({
    title: 'Mise à jour disponible',
    message: `La version ${info.version}${date} est disponible (version installée : ${info.current})${info.source === 'github' ? ', publiée sur GitHub. Elle sera téléchargée puis installée' : ''}.${info.notes ? `\n\nNouveautés :\n${info.notes}` : ''}\n\nL’installation ferme le logiciel puis lance l’installateur ; vos projets ne sont pas modifiés.`,
    buttons: [
      { label: 'Ignorer cette version', value: 'skip' },
      { label: 'Plus tard', value: 'later' },
      { label: 'Installer maintenant', value: 'install', primary: true },
    ],
  });
  if (r.button === 'skip') { await api().updateSkip(info.version); return; }
  if (r.button !== 'install') return;
  if (!(await confirmDiscardChanges())) return;
  try {
    await api().updateInstall();
  } catch (e) {
    await alertDialog('Mise à jour impossible', errMsg(e));
  }
}

export async function chooseUpdateDirAction(): Promise<void> {
  const cur = await api().updateGetDir();
  const online = await api().updateGetOnline();
  const r = await ask({
    title: 'Mises à jour',
    message: `À chaque démarrage, le logiciel recherche les nouvelles versions dans ce dossier :\n${cur.dir}${cur.isDefault ? '\n(dossier par défaut)' : ''}\n\nIl peut s’agir d’un dossier partagé sur le réseau de votre organisation.`,
    fields: [{ key: 'online', label: 'Rechercher aussi sur GitHub lorsqu’Internet est disponible', type: 'checkbox', value: online }],
    buttons: [{ label: 'Fermer', value: 'close' }, { label: 'Choisir un autre dossier…', value: 'choose', primary: true }],
  });
  if (!!r.values.online !== online) await api().updateSetOnline(!!r.values.online);
  if (r.button !== 'choose') return;
  const dir = await api().updateChooseDir();
  if (dir) { S().toast(`Dossier des mises à jour : ${dir}`, 'success'); await checkForUpdates(true); }
}
