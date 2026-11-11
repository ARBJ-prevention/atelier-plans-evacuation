/* Processus principal Electron — Atelier Plans d'Évacuation */
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { buildMenu } = require('./menu.cjs');
const { ODA_DOWNLOAD_URL, convertDwgToDxf, findOdaConverter, isOdaConverter } = require('./dwg.cjs');

const APP_NAME = "Atelier Plans d'Évacuation";
const PROJECT_EXT = 'planevac';
const DIST = path.join(__dirname, '..', 'dist');
const isSelfTest = process.argv.includes('--selftest');
const selfTestOut = (process.argv.find((a) => a.startsWith('--selftest-out=')) || '').split('=')[1]
  || path.join(os.tmpdir(), 'atelier-evac-selftest');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** @type {BrowserWindow | null} */
let win = null;
let dirty = false;
let forceClosing = false;
let pendingOpenFile = findProjectArg(process.argv);

function findProjectArg(argv) {
  return argv.slice(1).find((a) => a.toLowerCase().endsWith('.' + PROJECT_EXT) && fs.existsSync(a)) || null;
}

// ——— Instance unique (ouverture par double-clic sur un .planevac) ———
if (!isSelfTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = findProjectArg(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-file', f);
    }
  });
}

// ——— Dossiers de données ———
const userDir = () => app.getPath('userData');
const autosaveDir = () => { const d = path.join(userDir(), 'autosave'); fs.mkdirSync(d, { recursive: true }); return d; };
const recentFile = () => path.join(userDir(), 'recent.json');
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

function readRecent() {
  try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')).filter((p) => fs.existsSync(p)); } catch { return []; }
}
function addRecent(p) {
  const list = [p, ...readRecent().filter((x) => x.toLowerCase() !== p.toLowerCase())].slice(0, 10);
  try { fs.writeFileSync(recentFile(), JSON.stringify(list)); } catch { /* ignore */ }
  refreshMenu();
  if (process.platform === 'win32') app.addRecentDocument(p);
}

/** Écriture atomique : fichier temporaire + renommage, avec copie .bak de la version précédente. */
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd);
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, `${file}.bak`); } catch { /* ignore */ } }
  fs.renameSync(tmp, file);
}

function refreshMenu() {
  Menu.setApplicationMenu(buildMenu({
    send: (action, arg) => win && win.webContents.send('menu', action, arg),
    recent: readRecent(),
  }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: APP_NAME,
    show: !isSelfTest,
    backgroundColor: '#eef1f4',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (!isSelfTest) win.maximize();
  win.loadURL('app://bundle/index.html');

  // Aucune navigation externe ni ouverture de fenêtre depuis le contenu.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Capture d'écran de l'interface (documentation) : --capture-ui=fichier.png
  const capture = (process.argv.find((a) => a.startsWith('--capture-ui=')) || '').slice('--capture-ui='.length);
  if (capture) {
    win.setSize(1600, 1000);
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const js = (code) => win.webContents.executeJavaScript(code);
      await wait(800);
      if (process.argv.includes('--capture-welcome')) { await wait(1500); const im = await win.webContents.capturePage(); fs.writeFileSync(capture, im.toPNG()); app.exit(0); return; }
      await js("document.querySelector('.sample-card')?.click()");
      await wait(1200);
      await js(`(() => { const el = [...document.querySelectorAll('[data-id]')].find(g => g.querySelector('path[stroke="#00843d"]')); if (!el) return; const r = el.getBoundingClientRect(); const o = { bubbles: true, clientX: r.x + 4, clientY: r.y + r.height / 2, pointerId: 1, button: 0 }; el.querySelector('path[stroke="#00843d"]').dispatchEvent(new PointerEvent('pointerdown', o)); document.querySelector('svg.canvas').dispatchEvent(new PointerEvent('pointerup', o)); })()`);
      await wait(600);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(capture, img.toPNG());
      app.exit(0);
    });
  }

  if (isSelfTest) {
    // Journal de la page et délai maximal pour l'autotest.
    fs.mkdirSync(selfTestOut, { recursive: true });
    const logFile = path.join(selfTestOut, 'journal-autotest.log');
    fs.writeFileSync(logFile, '');
    win.webContents.on('console-message', (ev) => {
      fs.appendFileSync(logFile, `[${ev.level}] ${ev.message} (${ev.sourceId}:${ev.lineNumber})\n`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => fs.appendFileSync(logFile, `did-fail-load ${code} ${desc} ${url}\n`));
    win.webContents.on('render-process-gone', (_e, d) => fs.appendFileSync(logFile, `render-process-gone ${JSON.stringify(d)}\n`));
    setTimeout(() => {
      fs.appendFileSync(logFile, 'DÉLAI DÉPASSÉ (180 s)\n');
      app.exit(2);
    }, 180000);
  }

  win.on('close', async (e) => {
    if (forceClosing || !dirty || isSelfTest) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Enregistrer', 'Ne pas enregistrer', 'Annuler'],
      defaultId: 0,
      cancelId: 2,
      title: APP_NAME,
      message: 'Le projet contient des modifications non enregistrées.',
      detail: 'Voulez-vous les enregistrer avant de quitter ?',
    });
    if (response === 0) win.webContents.send('menu', 'save-and-close');
    else if (response === 1) win.webContents.send('menu', 'discard-and-close');
  });
  win.on('closed', () => { win = null; });
}

// ——— Rendu HTML -> PDF / impression ———
async function withHtmlWindow(html, fn) {
  const dir = path.join(os.tmpdir(), 'atelier-evac');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rendu-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadFile(file);
    await new Promise((r) => setTimeout(r, 300));
    return await fn(w);
  } finally {
    w.destroy();
    fs.rm(file, { force: true }, () => {});
  }
}

ipcMain.handle('render:pdf', async (_e, { html, paper, landscape, suggestedName, path: target }) => {
  let file = target;
  if (!file) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Exporter en PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  const data = await withHtmlWindow(html, (w) => w.webContents.printToPDF({
    pageSize: paper,
    landscape,
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  }));
  atomicWrite(file, data);
  return file;
});

/** État du service Windows « Spouleur d'impression » : 'running' | 'stopped' | 'unknown'. */
function spoolerState() {
  if (process.platform !== 'win32') return Promise.resolve('unknown');
  return new Promise((resolve) => {
    // Les libellés (STATE / ÉTAT) dépendent de la langue, mais pas les codes « 4 RUNNING » / « 1 STOPPED ».
    require('node:child_process').execFile('sc', ['query', 'Spooler'], { windowsHide: true, timeout: 4000 }, (_err, out) => {
      const s = String(out || '');
      if (/\b4\s+RUNNING\b/.test(s)) resolve('running');
      else if (/\b[1-3]\s+(STOPPED|START_PENDING|STOP_PENDING)\b/.test(s)) resolve('stopped');
      else resolve('unknown');
    });
  });
}

/**
 * Impression : Chromium échoue avec « Failed to enumerate printers » quand le
 * spouleur Windows est arrêté ou qu'aucune imprimante n'est installée. On vérifie
 * donc d'abord la liste des imprimantes et on renvoie un code exploitable par
 * l'interface (no-printer) au lieu du message technique.
 */
ipcMain.handle('render:print', async (_e, { html, paper, landscape }) => {
  let printers = [];
  try { printers = await (win || BrowserWindow.getAllWindows()[0]).webContents.getPrintersAsync(); } catch { printers = []; }
  if (!printers.length) {
    return { success: false, reason: 'no-printer', spooler: await spoolerState() };
  }
  const device = printers.find((p) => p.isDefault) || printers[0];
  return withHtmlWindow(html, (w) => new Promise((resolve) => {
    w.webContents.print({
      silent: false,
      deviceName: device.name,
      printBackground: true,
      landscape,
      pageSize: paper,
      margins: { marginType: 'none' },
    }, async (success, reason) => {
      if (!success && /enumerate printers|no printer|invalid printer/i.test(reason || '')) {
        resolve({ success: false, reason: 'no-printer', spooler: await spoolerState() });
      } else resolve({ success, reason: reason || '' });
    });
  }));
});

// ——— Projets ———
ipcMain.handle('project:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Ouvrir un projet',
    properties: ['openFile'],
    filters: [{ name: "Projet de plan d'évacuation", extensions: [PROJECT_EXT] }, { name: 'Tous les fichiers', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const content = fs.readFileSync(p, 'utf8');
  addRecent(p);
  return { path: p, content };
});

ipcMain.handle('project:open-path', async (_e, p) => {
  const content = fs.readFileSync(p, 'utf8');
  if (!isSelfTest) addRecent(p);
  return { path: p, content };
});

ipcMain.handle('project:save', async (_e, { path: target, content, suggestedName, saveAs }) => {
  let file = target;
  if (!file || saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: saveAs ? 'Enregistrer sous' : 'Enregistrer le projet',
      defaultPath: file || `${suggestedName}.${PROJECT_EXT}`,
      filters: [{ name: "Projet de plan d'évacuation", extensions: [PROJECT_EXT] }],
    });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  atomicWrite(file, content);
  // Relecture de contrôle : le fichier écrit doit être identique.
  if (fs.readFileSync(file, 'utf8') !== content) throw new Error('Vérification après écriture échouée.');
  if (!isSelfTest) addRecent(file);
  return file;
});

ipcMain.handle('file:pick', async (_e, kind) => {
  const filters = {
    plan: [
      { name: 'Plans (DXF, DWG, PDF, images)', extensions: ['dxf', 'dwg', 'pdf', 'png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] },
      { name: 'Plans AutoCAD (DXF, DWG)', extensions: ['dxf', 'dwg'] },
      { name: 'Documents PDF', extensions: ['pdf'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] },
    ],
    image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'bmp'] }],
    symbol: [{ name: 'Pictogrammes (SVG, PNG, JPEG)', extensions: ['svg', 'png', 'jpg', 'jpeg'] }],
  }[kind] || [];
  const r = await dialog.showOpenDialog(win, { title: 'Choisir un fichier', properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), data: fs.readFileSync(p) };
});

ipcMain.handle('file:save-binary', async (_e, { data, suggestedName, filterName, ext, path: target }) => {
  let file = target;
  if (!file) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Exporter',
      defaultPath: suggestedName,
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  atomicWrite(file, Buffer.from(data));
  return file;
});

ipcMain.handle('file:read-binary', async (_e, p) => fs.readFileSync(p));
ipcMain.handle('file:show', async (_e, p) => shell.showItemInFolder(p));

// ——— Plans DWG : conversion par ODA File Converter ———
function dwgConverterPath() {
  const saved = readSettings().dwgConverter;
  if (isOdaConverter(saved)) return saved;
  return findOdaConverter();
}
ipcMain.handle('dwg:status', async () => {
  const p = dwgConverterPath();
  return { found: !!p, path: p || '' };
});
ipcMain.handle('dwg:choose-converter', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Emplacement de ODA File Converter',
    defaultPath: process.env.ProgramFiles || undefined,
    properties: ['openFile'],
    filters: [{ name: 'ODA File Converter', extensions: ['exe'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  if (!isOdaConverter(p)) throw new Error('Le fichier choisi n’est pas ODAFileConverter.exe.');
  writeSettings({ dwgConverter: p });
  return p;
});
ipcMain.handle('dwg:download-page', async () => shell.openExternal(ODA_DOWNLOAD_URL));
ipcMain.handle('dwg:convert', async (_e, { data, converter }) => {
  // Un convertisseur imposé par l'interface n'est accepté qu'en autotest (convertisseur simulé).
  const exe = (isSelfTest && converter) || dwgConverterPath();
  if (!exe) throw new Error('ODA File Converter est introuvable.');
  const { dxf, version } = await convertDwgToDxf(exe, Buffer.from(data));
  return { dxf: new Uint8Array(dxf), version };
});

// ——— Sauvegarde automatique / récupération ———
ipcMain.handle('autosave:write', async (_e, { id, name, filePath, content }) => {
  const file = path.join(autosaveDir(), `${safeId(id)}.json`);
  atomicWrite(file, JSON.stringify({ id, name, filePath, savedAt: new Date().toISOString(), content }));
  return true;
});
ipcMain.handle('autosave:clear', async (_e, id) => {
  fs.rmSync(path.join(autosaveDir(), `${safeId(id)}.json`), { force: true });
  return true;
});
ipcMain.handle('autosave:list', async () => {
  const out = [];
  for (const f of fs.readdirSync(autosaveDir())) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(autosaveDir(), f), 'utf8'))); } catch { /* fichier illisible ignoré */ }
  }
  return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
});

// ——— Mises à jour (hors ligne, depuis un dossier local ou partagé) ———
// Le dossier de mise à jour contient l'installateur le plus récent et un
// fichier « mise-a-jour.json » : { version, installer, date, sha256, notes }.
// Sans ce fichier, le nom de l'installateur (…-Setup-X.Y.Z.exe) suffit.
const UPDATE_MANIFEST = 'mise-a-jour.json';
const INSTALLER_RE = /^Atelier-Plans-Evacuation-Setup-(\d+\.\d+\.\d+)\.exe$/i;
const settingsFile = () => path.join(userDir(), 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  const s = { ...readSettings(), ...patch };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch { /* ignore */ }
  return s;
}
const defaultUpdateDir = () => path.join(app.getPath('documents'), 'Atelier Plans Evacuation');
const updateDir = () => readSettings().updateDir || defaultUpdateDir();

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

function findUpdate(dir) {
  const current = app.getVersion();
  const result = { current, dir, available: false, version: '', installer: '', notes: '', date: '', error: '' };
  if (!dir || !fs.existsSync(dir)) { result.error = 'Dossier de mise à jour introuvable.'; return result; }
  let best = null;
  const mf = path.join(dir, UPDATE_MANIFEST);
  if (fs.existsSync(mf)) {
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      if (m.version && m.installer) best = { version: String(m.version), installer: path.join(dir, path.basename(String(m.installer))), notes: String(m.notes || ''), date: String(m.date || ''), sha256: m.sha256 };
    } catch { result.error = 'Fichier mise-a-jour.json illisible.'; }
  }
  if (!best) {
    for (const f of fs.readdirSync(dir)) {
      const mm = f.match(INSTALLER_RE);
      if (mm && (!best || cmpVersion(mm[1], best.version) > 0)) best = { version: mm[1], installer: path.join(dir, f), notes: '', date: '' };
    }
  }
  if (best && fs.existsSync(best.installer) && cmpVersion(best.version, current) > 0) {
    Object.assign(result, { available: true, version: best.version, installer: best.installer, notes: best.notes, date: best.date, sha256: best.sha256 || '' });
  }
  return result;
}

// Publications GitHub (facultatif : seulement si Internet est disponible).
const GITHUB_REPO = 'ARBJ-prevention/atelier-plans-evacuation';
async function findOnlineUpdate() {
  if (readSettings().onlineUpdates === false) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AtelierPlansEvacuation' }, signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const rel = await r.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const asset = (rel.assets || []).find((a) => INSTALLER_RE.test(a.name));
    if (!asset || !/^\d+\.\d+\.\d+$/.test(version) || cmpVersion(version, app.getVersion()) <= 0) return null;
    return { version, url: asset.browser_download_url, name: asset.name, size: asset.size, notes: String(rel.body || '').slice(0, 1500), date: rel.published_at || '' };
  } catch { return null; }
}
let onlineCandidate = null;

ipcMain.handle('update:check', async (_e, dirOverride) => {
  const res = findUpdate(dirOverride || updateDir());
  if (!dirOverride) {
    const online = await findOnlineUpdate();
    if (online && (!res.available || cmpVersion(online.version, res.version) > 0)) {
      onlineCandidate = online;
      Object.assign(res, { available: true, version: online.version, installer: '', notes: online.notes, date: online.date, source: 'github', error: '' });
    } else onlineCandidate = null;
  }
  res.skipped = readSettings().skippedVersion === res.version;
  return res;
});
ipcMain.handle('update:get-online', async () => readSettings().onlineUpdates !== false);
ipcMain.handle('update:set-online', async (_e, v) => { writeSettings({ onlineUpdates: !!v }); return !!v; });
ipcMain.handle('update:skip', async (_e, version) => { writeSettings({ skippedVersion: version }); return true; });
ipcMain.handle('update:get-dir', async () => ({ dir: updateDir(), isDefault: !readSettings().updateDir }));
ipcMain.handle('update:choose-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossier des mises à jour', defaultPath: updateDir(), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  writeSettings({ updateDir: r.filePaths[0] });
  return r.filePaths[0];
});
ipcMain.handle('update:install', async () => {
  let res = findUpdate(updateDir());
  if (onlineCandidate && (!res.available || cmpVersion(onlineCandidate.version, res.version) > 0)) {
    // Téléchargement de l'installateur publié sur GitHub
    const r = await net.fetch(onlineCandidate.url, { headers: { 'User-Agent': 'AtelierPlansEvacuation' } });
    if (!r.ok) throw new Error(`Téléchargement impossible (HTTP ${r.status}).`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (onlineCandidate.size && buf.length !== onlineCandidate.size) throw new Error('Téléchargement incomplet. Réessayez plus tard.');
    const dir = path.join(os.tmpdir(), 'atelier-evac-maj');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, onlineCandidate.name);
    fs.writeFileSync(file, buf);
    res = { ...res, available: true, version: onlineCandidate.version, installer: file, sha256: '' };
  }
  if (!res.available) throw new Error('Aucune mise à jour disponible.');
  if (res.sha256) {
    const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(res.installer)).digest('hex');
    if (hash.toLowerCase() !== String(res.sha256).toLowerCase()) throw new Error('L’installateur ne correspond pas à l’empreinte attendue (fichier incomplet ou modifié). Mise à jour annulée.');
  }
  const { spawn } = require('node:child_process');
  // Mise à jour rapide : sans assistant (le contrôle UAC reste demandé si besoin), puis relance du programme.
  spawn(res.installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  forceClosing = true;
  setTimeout(() => app.quit(), 300);
  return true;
});

// ——— Divers ———
ipcMain.handle('app:info', async () => ({
  selftest: isSelfTest,
  selftestOut: selfTestOut,
  version: app.getVersion(),
  pendingOpenFile: (() => { const f = pendingOpenFile; pendingOpenFile = null; return f; })(),
}));
ipcMain.handle('recent:list', async () => readRecent());
ipcMain.on('app:set-title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.on('app:set-dirty', (_e, d) => { dirty = !!d; if (win) win.setDocumentEdited(dirty); });
ipcMain.on('app:force-close', () => { forceClosing = true; if (win) win.close(); });
ipcMain.handle('selftest:done', async (_e, report) => {
  fs.mkdirSync(selfTestOut, { recursive: true });
  fs.writeFileSync(path.join(selfTestOut, 'rapport-autotest.json'), JSON.stringify(report, null, 2));
  setTimeout(() => app.exit(report.ok ? 0 : 1), 100);
  return true;
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Interdit', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  refreshMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
