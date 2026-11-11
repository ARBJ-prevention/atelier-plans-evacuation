import { COUNTRIES } from '../model/countries';
import { makeElement, newProject, newVariant, uid } from '../model/defaults';
import { isVisibleInVariant } from '../model/geometry';
import { applyOrganizationTemplate, organizationTemplates, templateFromFloor, writeOrganizationTemplates } from './organizationTemplates';
import { cloneProjectWithNewIds, parseProject, ProjectFormatError, serializeProject } from '../model/serialize';
import type { Draft } from 'immer';
import type { Background, Element, PageSetup } from '../model/types';
import { api, bytesToDataUrl, MIME } from '../services/api';
import { buildBatchPrintHtml, buildPrintHtml, renderPagePng, safeFileName, type ExportJob } from '../services/exporter';
import { imageFromFile, pdfPageCount, renderPdfPage } from '../services/imports';
import { decodeDxfBytes, DxfError, flattenDxf, parseDxf } from '../services/dxf';
import { askDxfImport, type DxfImportChoice } from '../dialogs/DxfImport';
import { askRecognition } from '../dialogs/Recognize';
import { currentBuilding, currentFloor, currentVariantId, useStore } from '../store/store';
import { alertDialog, ask, confirmDialog, promptDialog } from '../ui/dialogs';

const S = () => useStore.getState();

function errMsg(e: unknown): string {
  // Les erreurs du processus principal arrivent préfixées par « Error invoking remote method '…': Error: ».
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
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
  const templates = organizationTemplates();
  const r = await ask({
    title: 'Nouveau projet',
    fields: [
      { key: 'name', label: 'Nom du projet', type: 'text', value: 'Nouveau projet', required: true },
      { key: 'building', label: 'Premier bâtiment', type: 'text', value: 'Bâtiment principal', required: true },
      { key: 'country', label: 'Pays (modèles et consignes par défaut)', type: 'select', value: 'BE', options: COUNTRIES.map((c) => ({ value: c.code, label: c.name })) },
      { key: 'author', label: 'Auteur (cartouche)', type: 'text', value: '' },
      ...(templates.length ? [{
        key: 'template', label: 'Modèle d’organisation', type: 'select' as const, value: '',
        options: [{ value: '', label: 'Réglages par défaut' }, ...templates.map((t) => ({ value: t.name, label: t.name }))],
      }] : []),
    ],
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Créer', value: 'ok', primary: true }],
  });
  if (r.button !== 'ok') return;
  const p = newProject(r.values.name, r.values.country);
  p.buildings[0].name = r.values.building;
  const template = templates.find((t) => t.name === r.values.template);
  for (const floor of p.buildings[0].floors) {
    if (template) applyOrganizationTemplate(floor, template);
    if (r.values.author.trim()) floor.titleBlock.author = r.values.author.trim();
  }
  S().loadProject(p, null);
  S().toast('Projet créé. Commencez par importer un plan de fond ou dessiner les murs.', 'success');
}

export async function createDisplayLocation(): Promise<void> {
  const s = S();
  const floor = currentFloor(s);
  if (!floor || !s.project) return;
  const sourceId = currentVariantId(s);
  const reusable = floor.variants.length === 1 && floor.variants[0].name === 'Version 1'
    && !floor.elements.some((e) => e.variantId === sourceId || (e.type === 'symbol' && e.symbolId === 'you-are-here'));
  const routes = floor.elements.filter((e) => e.type === 'route' && isVisibleInVariant(e, sourceId));
  const r = await ask({
    title: 'Créer un emplacement d’affichage',
    message: 'Nommez l’affiche, puis cliquez sur le plan pour placer le repère « Vous êtes ici ».',
    fields: [
      { key: 'name', label: 'Emplacement (ex. Hall d’entrée)', type: 'text', value: '', required: true },
      ...(routes.length && !reusable ? [{
        key: 'routes', label: 'Itinéraires de la version active', type: 'select' as const, value: 'reuse',
        options: [{ value: 'reuse', label: 'Reprendre les itinéraires' }, { value: 'adapt', label: 'Créer des copies modifiables pour cette affiche' }],
      }] : []),
    ],
    invalid: (values) => floor.variants.some((v) => (!reusable || v.id !== sourceId)
      && v.name.toLocaleLowerCase() === String(values.name).trim().toLocaleLowerCase()) ? 'Ce nom est déjà utilisé pour cet étage.' : null,
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Placer le repère', value: 'ok', primary: true }],
  });
  if (r.button !== 'ok' || S().project !== s.project || S().floorId !== floor.id) return;
  const variant = reusable ? { id: sourceId, name: r.values.name.trim() } : newVariant(r.values.name.trim());
  const adapt = r.values.routes === 'adapt';
  S().mutateFloor((f) => {
    if (reusable) f.variants[0].name = variant.name;
    else {
      f.variants.push(variant);
      for (const element of f.elements) {
        if (!element.variantId && element.excludedVariantIds?.includes(sourceId)) element.excludedVariantIds.push(variant.id);
      }
      for (const route of routes) {
        if (!route.variantId && !adapt) continue;
        if (!route.variantId) {
          const shared = f.elements.find((e) => e.id === route.id)!;
          shared.excludedVariantIds = [...(shared.excludedVariantIds ?? []), variant.id];
        }
        f.elements.push({ ...structuredClone(route), id: uid('el'), groupId: undefined, excludedVariantIds: undefined, variantId: variant.id });
      }
    }
  });
  S().setVariant(variant.id);
  S().setTool('symbol', 'you-are-here');
  if (adapt) S().toast('Placez le repère, puis sélectionnez un itinéraire pour l’adapter à cette affiche.', 'info');
}

export async function manageOrganizationTemplates(): Promise<void> {
  const floor = currentFloor(S());
  const building = currentBuilding(S());
  const projectId = S().project?.id;
  if (!floor || !building) return;
  const templates = organizationTemplates();
  const r = await ask({
    title: 'Modèles d’organisation',
    fields: [
      { key: 'name', label: 'Nom pour enregistrer les réglages de cet étage', type: 'text', value: floor.titleBlock.organization },
      ...(templates.length ? [
        { key: 'template', label: 'Modèle enregistré', type: 'select' as const, value: templates[0].name,
          options: templates.map((t) => ({ value: t.name, label: t.name })) },
        { key: 'all', label: 'Appliquer à tous les étages de ce bâtiment', type: 'checkbox' as const, value: false },
      ] : []),
    ],
    buttons: [
      { label: 'Fermer', value: 'cancel' },
      ...(templates.length ? [{ label: 'Supprimer le modèle', value: 'delete' }, { label: 'Appliquer le modèle', value: 'apply' }] : []),
      { label: 'Enregistrer les réglages', value: 'save', primary: true },
    ],
  });
  try {
    const selected = templates.find((t) => t.name === r.values.template);
    if (r.button === 'save') {
      const name = String(r.values.name).trim();
      if (!name) { await alertDialog('Nom du modèle', 'Indiquez un nom pour enregistrer les réglages.'); return; }
      if (templates.some((t) => t.name === name)
        && !(await confirmDialog('Remplacer le modèle', `Remplacer « ${name} » par les réglages de cet étage ?`, 'Remplacer'))) return;
      writeOrganizationTemplates([...templates.filter((t) => t.name !== name), templateFromFloor(name, floor)]);
      S().toast(`Modèle « ${name} » enregistré sur ce poste.`, 'success');
    }
    if (r.button === 'delete' && selected
      && await confirmDialog('Supprimer le modèle', `Supprimer « ${selected.name} » de ce poste ?`, 'Supprimer', true)) {
      writeOrganizationTemplates(templates.filter((t) => t !== selected));
    }
    if (r.button === 'apply' && selected && S().project?.id === projectId) {
      const floors = r.values.all ? building.floors : [floor];
      if (!(await confirmDialog('Appliquer le modèle', `Remplacer les réglages de présentation, le logo, les consignes et les numéros d’urgence sur ${floors.length} étage(s) ?`, 'Appliquer'))
        || S().project?.id !== projectId) return;
      let reset = false;
      S().mutate((p) => {
        for (const target of p.buildings.find((b) => b.id === building.id)?.floors ?? []) {
          if (floors.some((f) => f.id === target.id) && applyOrganizationTemplate(target, selected)) reset = true;
        }
      });
      S().toast(reset ? 'Modèle appliqué. Les étages dont les consignes ou numéros ont changé sont à valider.' : 'Modèle appliqué.', reset ? 'warning' : 'success');
    }
  } catch (e) {
    await alertDialog('Modèle indisponible', errMsg(e));
  }
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
  if (file.ext === 'dwg') { await importDwgBackground(file.name, file.data); return; }
  if (file.ext === 'dxf') { await importDxfBackground(file.name, file.data); return; }
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

/**
 * Import d'un plan DWG : conversion en DXF par ODA File Converter (outil gratuit installé à part),
 * puis même traitement qu'un DXF. Si le convertisseur est absent, explique comment l'installer.
 */
export async function importDwgBackground(name: string, data: Uint8Array): Promise<void> {
  try {
    let status = await api().dwgStatus();
    while (!status.found) {
      const r = await ask({
        title: 'Lire un fichier DWG',
        message: 'Le format DWG est le format propriétaire d’AutoCAD. Pour le lire, le logiciel utilise « ODA File Converter », un outil gratuit de l’Open Design Alliance, à installer une seule fois sur ce poste.\n\n1. Cliquez sur « Page de téléchargement » et téléchargez la version Windows 64 bits.\n2. Installez-la (les conditions d’utilisation sont celles de l’ODA).\n3. Revenez ici et cliquez sur « C’est installé ».\n\nAutre solution : dans AutoCAD (ou BricsCAD, DraftSight…), « Enregistrer sous » › type DXF, puis importez le fichier DXF.',
        buttons: [
          { label: 'Annuler', value: 'cancel' },
          { label: 'Indiquer son emplacement…', value: 'choose' },
          { label: 'Page de téléchargement', value: 'download' },
          { label: 'C’est installé', value: 'retry', primary: true },
        ],
      });
      if (r.button === 'cancel') return;
      if (r.button === 'download') { await api().dwgDownloadPage(); continue; }
      if (r.button === 'choose') {
        try {
          if (!(await api().dwgChooseConverter())) continue;
        } catch (e) { await alertDialog('Convertisseur non reconnu', errMsg(e)); continue; }
      }
      status = await api().dwgStatus();
      if (!status.found && r.button === 'retry') {
        await alertDialog('ODA File Converter introuvable', 'Il n’a pas été trouvé dans « Program Files\\ODA ». S’il est installé ailleurs, utilisez « Indiquer son emplacement… » et choisissez le fichier ODAFileConverter.exe.');
      }
    }
    S().toast('Conversion du fichier DWG en cours…', 'info');
    const { dxf, version } = await api().dwgConvert({ data });
    await importDxfBackground(name, new Uint8Array(dxf), version);
  } catch (e) {
    await alertDialog('Import DWG impossible', errMsg(e));
  }
}

/** Import d'un plan DXF : plan vectoriel net, échelle réelle reprise du fichier. */
export async function importDxfBackground(name: string, data: Uint8Array, dwgVersion?: string): Promise<void> {
  const kind = dwgVersion ? 'DWG' : 'DXF';
  try {
    if (!dwgVersion) S().toast('Lecture du fichier DXF…', 'info');
    await new Promise((r) => setTimeout(r, 30)); // laisse le message s'afficher
    const flat = flattenDxf(parseDxf(decodeDxfBytes(data)));
    if (!flat.prims.length) throw new DxfError('Le fichier ne contient aucun objet dessinable dans l’espace objet.');
    const floor = currentFloor(S());
    if (!floor) return;
    // Échelle de l'étage : on garde celle déjà étalonnée si des éléments existent, sinon 50 unités par mètre.
    const upm = floor.unitsPerMeter > 0 && floor.elements.length > 0 ? floor.unitsPerMeter : 50;
    const choice = await askDxfImport(flat, name, upm, dwgVersion);
    if (!choice) return;
    const { result } = choice;
    const dims = `${result.widthM.toFixed(2).replace('.', ',')} m × ${result.heightM.toFixed(2).replace('.', ',')} m`;
    if (choice.recognize) {
      const bg = dxfBackground(name, choice);
      const rec = await askRecognition(flat, choice.visibleLayers, result.origin, floor, bg, upm);
      if (!rec) return;
      applyDxfBackground(name, choice, upm, rec.elements);
      if (rec.elements.length) {
        const c = rec.counts;
        S().toast(`Plan redessiné à l’échelle réelle (${dims}) : ${c.rooms} pièce(s), ${c.walls} mur(s), ${c.doors} porte(s), ${c.windows} fenêtre(s), ${c.stairs} escalier(s). Vérifiez-le, puis ajoutez les pictogrammes.`, 'success');
        return;
      }
    } else {
      applyDxfBackground(name, choice, upm);
    }
    S().toast(`Plan ${kind} importé à l’échelle réelle : ${dims}. Aucun étalonnage nécessaire.`, 'success');
  } catch (e) {
    await alertDialog(`Import ${kind} impossible`, e instanceof DxfError ? e.message : `Le fichier n’a pas pu être lu : ${errMsg(e)}`);
  }
}

function dxfBackground(name: string, choice: DxfImportChoice): Background {
  const { result } = choice;
  return {
    src: bytesToDataUrl(new TextEncoder().encode(result.svg), 'image/svg+xml'), sourceName: name,
    naturalWidth: result.width, naturalHeight: result.height, x: 0, y: 0, scale: 1, opacity: 0.6, locked: true, grayscale: false,
    vector: { format: /\.dwg$/i.test(name) ? 'dwg' : 'dxf', unit: choice.unit, unitDeclared: choice.unitDeclared, widthM: result.widthM, heightM: result.heightM, layers: choice.visibleLayers },
  };
}

/**
 * Applique un plan DXF converti comme fond de l'étage courant, étalonne l'étage et ajoute
 * les éléments reconnus (le tout en une seule étape d'annulation).
 */
export function applyDxfBackground(name: string, choice: DxfImportChoice, upm: number, elements: Element[] = []): void {
  const bg = dxfBackground(name, choice);
  if (elements.length) { bg.opacity = 0.3; bg.grayscale = true; } // le plan redessiné passe au premier plan
  S().mutateFloor((f) => {
    f.background = bg;
    f.unitsPerMeter = upm;
    if (elements.length) f.elements.push(...(elements as Draft<Element>[]));
  });
  S().requestFit();
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

export async function pickAerialAction(): Promise<void> {
  const file = await api().pickFile('image');
  if (!file) return;
  const img = await imageFromFile(file);
  S().mutateFloor((f) => {
    f.titleBlock.aerialImage = img.src;
    f.page.showAerial = true;
  }, { keepValidation: true });
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
    message: 'Vérifiez toutes les affiches de cet étage. Votre nom et la date seront inscrits dans le cartouche. Une modification du plan, des consignes ou des numéros d’urgence remettra le statut à « À valider ». La validation correspond à votre vérification du contenu.',
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
    delete fd.titleBlock.validationReason;
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

function exportBaseName(job: ExportJob, variantId?: string, includeVariant = job.floor.variants.length > 1): string {
  const v = job.floor.variants.find((x) => x.id === variantId);
  return safeFileName([job.floor.titleBlock.title, job.building.name, job.floor.name, includeVariant && v ? v.name : ''].filter(Boolean).join(' - '));
}

export async function exportBuildingPdf(jobs: ExportJob[], separate: boolean): Promise<void> {
  const first = jobs[0];
  if (!first) return;
  const title = `Plans d’évacuation - ${first.building.name}`;
  const count = jobs.reduce((total, job) => total + job.variantIds.length, 0);
  try {
    if (!separate) {
      const out = await api().exportPdf({ html: buildBatchPrintHtml(jobs, title), paper: first.page.paper,
        landscape: first.page.orientation === 'landscape', suggestedName: `${safeFileName(title)}.pdf` });
      if (out) {
        S().toast(`PDF du bâtiment exporté · ${count} page(s).`, 'success');
      }
      return;
    }
    const dir = await api().createExportFolder(title);
    if (!dir) return;
    let completed = 0;
    for (const job of jobs) {
      for (const variantId of job.variantIds) {
        const prefix = String(completed + 1).padStart(String(count).length, '0');
        const path = `${dir}\\${prefix} - ${exportBaseName(job, variantId, true)}.pdf`;
        const out = await exportPdfAction({ ...job, variantIds: [variantId] }, path);
        if (!out) {
          S().toast(`Export interrompu · ${completed} fichier(s) sur ${count}.`, 'warning');
          return;
        }
        completed++;
      }
    }
    S().toast(`${completed} fichier(s) PDF exporté(s).`, 'success');
  } catch (e) {
    await alertDialog('Échec de l’export du bâtiment', errMsg(e));
  }
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
    if (out.length && !dir) S().toast(`${out.length} image(s) PNG exportée(s) à ${dpi} ppp.`, 'success');
  } catch (e) {
    await alertDialog('Échec de l’export PNG', errMsg(e));
  }
  return out;
}

export async function printAction(job: ExportJob | null = currentExportJob('current')): Promise<void> {
  if (!job) return;
  let r: Awaited<ReturnType<ReturnType<typeof api>['print']>>;
  try {
    r = await api().print({ html: buildPrintHtml(job), paper: job.page.paper, landscape: job.page.orientation === 'landscape' });
  } catch (e) {
    await alertDialog('Impression impossible', errMsg(e));
    return;
  }
  if (r.success || !r.reason || r.reason === 'cancelled' || r.reason === 'Print job canceled') return;
  if (r.reason === 'no-printer') {
    const cause = r.spooler === 'stopped'
      ? 'Le service Windows « Spouleur d’impression » est arrêté : aucune imprimante n’est accessible. Pour le redémarrer : touche Windows → « Services » → « Spouleur d’impression » → Démarrer (type de démarrage : Automatique).'
      : 'Aucune imprimante n’est installée ou accessible sur cet ordinateur.';
    const ok = await confirmDialog('Aucune imprimante disponible',
      `${cause} En attendant, vous pouvez exporter le plan en PDF et l’imprimer depuis un autre poste.`, 'Exporter en PDF');
    if (ok) await exportPdfAction(job);
    return;
  }
  S().toast(`Impression non effectuée : ${r.reason}`, 'warning');
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
