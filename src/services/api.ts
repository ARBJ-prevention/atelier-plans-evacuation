/** Typage du pont exposé par electron/preload.cjs (window.evac). */
export interface PickedFile { name: string; ext: string; data: Uint8Array }
export interface AutosaveEntry { id: string; name: string; filePath: string | null; savedAt: string; content: string }

export interface UpdateInfo {
  current: string; dir: string; available: boolean; version: string; installer: string;
  notes: string; date: string; error: string; skipped?: boolean; source?: string;
}

export interface EvacBridge {
  info(): Promise<{ selftest: boolean; selftestOut: string; version: string; pendingOpenFile: string | null }>;
  openProjectDialog(): Promise<{ path: string; content: string } | null>;
  openProjectPath(p: string): Promise<{ path: string; content: string }>;
  saveProject(a: { path: string | null; content: string; suggestedName: string; saveAs?: boolean }): Promise<string | null>;
  pickFile(kind: 'plan' | 'image' | 'symbol'): Promise<PickedFile | null>;
  saveBinary(a: { data: Uint8Array; suggestedName: string; filterName: string; ext: string; path?: string }): Promise<string | null>;
  readBinary(p: string): Promise<Uint8Array>;
  showInFolder(p: string): Promise<void>;
  /** Convertisseur DWG (ODA File Converter) trouvé ? */
  dwgStatus(): Promise<{ found: boolean; path: string }>;
  dwgChooseConverter(): Promise<string | null>;
  dwgDownloadPage(): Promise<void>;
  /** Convertit un DWG en DXF ; `converter` force un exécutable (tests). */
  dwgConvert(a: { data: Uint8Array; converter?: string }): Promise<{ dxf: Uint8Array; version: string }>;
  exportPdf(a: { html: string; paper: string; landscape: boolean; suggestedName: string; path?: string }): Promise<string | null>;
  print(a: { html: string; paper: string; landscape: boolean }): Promise<{ success: boolean; reason: string; spooler?: 'running' | 'stopped' | 'unknown' }>;
  autosaveWrite(a: { id: string; name: string; filePath: string | null; content: string }): Promise<boolean>;
  autosaveClear(id: string): Promise<boolean>;
  autosaveList(): Promise<AutosaveEntry[]>;
  recentList(): Promise<string[]>;
  setTitle(t: string): void;
  setDirty(d: boolean): void;
  forceClose(): void;
  selftestDone(report: unknown): Promise<boolean>;
  updateCheck(dir?: string): Promise<UpdateInfo>;
  updateSkip(version: string): Promise<boolean>;
  updateGetDir(): Promise<{ dir: string; isDefault: boolean }>;
  updateChooseDir(): Promise<string | null>;
  updateInstall(): Promise<boolean>;
  updateGetOnline(): Promise<boolean>;
  updateSetOnline(v: boolean): Promise<boolean>;
  onMenu(cb: (action: string, arg?: string) => void): () => void;
  onOpenFile(cb: (p: string) => void): () => void;
}

declare global {
  interface Window { evac: EvacBridge }
}

export const api = (): EvacBridge => window.evac;

export function bytesToDataUrl(data: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) bin += String.fromCharCode(...data.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

export const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf',
};
