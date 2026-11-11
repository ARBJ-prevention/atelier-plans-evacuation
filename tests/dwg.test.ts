/// <reference types="node" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildSampleDxf } from '../src/app/sampleDxf';
import { decodeDxfBytes, flattenDxf, parseDxf } from '../src/services/dxf';

const require = createRequire(import.meta.url);
const dwg = require('../electron/dwg.cjs') as {
  dwgVersion(d: Uint8Array): string;
  findOdaConverter(roots: string[]): string | null;
  isOdaConverter(p: string): boolean;
  convertDwgToDxf(exe: string, d: Uint8Array, o?: { timeoutMs?: number }): Promise<{ dxf: Uint8Array; version: string }>;
};

const work = mkdtempSync(join(tmpdir(), 'evac-dwg-test-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Faux DWG : signature AutoCAD 2018 suivie d'octets quelconques. */
const fakeDwg = new Uint8Array([...new TextEncoder().encode('AC1032'), 0, 0, 0, 1, 2, 3]);

describe('conversion DWG (ODA File Converter)', () => {
  it('reconnaît la signature et la version d’un DWG', () => {
    expect(dwg.dwgVersion(fakeDwg)).toBe('AutoCAD 2018');
    expect(() => dwg.dwgVersion(new TextEncoder().encode('PK\u0003\u0004zip'))).toThrow(/pas un fichier DWG/);
  });

  it('trouve la version la plus récente installée dans « ODA »', () => {
    const root = join(work, 'ProgramFiles');
    for (const v of ['ODAFileConverter 24.12.0', 'ODAFileConverter 25.4.0', 'Autre']) {
      mkdirSync(join(root, 'ODA', v), { recursive: true });
      writeFileSync(join(root, 'ODA', v, 'ODAFileConverter.exe'), '');
    }
    let found: string | null;
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA']) vi.stubEnv(key, undefined);
    try { found = dwg.findOdaConverter([root]); } finally { vi.unstubAllEnvs(); }
    expect(found).toContain('25.4.0');
    expect(dwg.isOdaConverter(found!)).toBe(true);
    expect(dwg.isOdaConverter(join(root, 'ODA', 'Autre', 'ODAFileConverter.exe'))).toBe(true);
    expect(dwg.isOdaConverter(join(work, 'absent.exe'))).toBe(false);
  });

  it.runIf(process.platform === 'win32')('convertit avec la ligne de commande ODA et nettoie le dossier temporaire', async () => {
    // Convertisseur simulé : même arguments que ODA (entrée, sortie, version, type…), copie un DXF dans la sortie.
    const dir = join(work, 'oda sim');
    mkdirSync(dir, { recursive: true });
    const dxfPath = join(dir, 'modele.dxf');
    writeFileSync(dxfPath, buildSampleDxf());
    const exe = join(dir, 'ODAFileConverter.cmd');
    writeFileSync(exe, [
      '@echo off',
      'if not exist "%~1\\plan.dwg" exit /b 2',
      'if /i not "%~4"=="DXF" exit /b 3',
      `copy /y "${dxfPath}" "%~2\\plan.dxf" >nul`,
      'exit /b 0',
    ].join('\r\n'));
    const { dxf, version } = await dwg.convertDwgToDxf(exe, fakeDwg);
    expect(version).toBe('AutoCAD 2018');
    const flat = flattenDxf(parseDxf(decodeDxfBytes(new Uint8Array(dxf))));
    expect(flat.layers.map((l) => l.name)).toContain('MURS');

    // Convertisseur qui ne produit rien : message explicite
    const bad = join(dir, 'odafileconverter-vide.cmd');
    writeFileSync(bad, '@echo off\r\necho Fichier illisible\r\nexit /b 1');
    await expect(dwg.convertDwgToDxf(bad, fakeDwg)).rejects.toThrow(/aucun fichier DXF.*Fichier illisible/);
  });
});
