/**
 * Génère un plan DXF d'exemple (rez-de-chaussée de 24 m × 14 m, en millimètres)
 * semblable à un relevé de géomètre : murs en double trait hachurés, cloisons,
 * portes en blocs, noms de pièces, cotes et points topographiques éloignés.
 * Sert à l'autotest et à essayer l'import DXF.
 */
export function buildSampleDxf(): string {
  const out: (string | number)[] = [];
  const p = (...v: (string | number)[]) => out.push(...v);
  const layers: [string, number, number][] = [
    ['MURS', 7, 0], ['CLOISONS', 8, 0], ['PORTES', 3, 0], ['FENETRES', 4, 0], ['TEXTES', 5, 0],
    ['COTES', 1, 0], ['MOBILIER', 30, 0], ['TOPO', 2, 0], ['CARTOUCHE', 7, 1],
  ];
  p(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1027', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
  p(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, layers.length);
  for (const [n, c, frozen] of layers) p(0, 'LAYER', 2, n, 70, frozen, 62, c, 6, 'CONTINUOUS');
  p(0, 'ENDTAB', 0, 'ENDSEC');
  // Blocs : porte 90 cm (battant + arc), table
  p(0, 'SECTION', 2, 'BLOCKS');
  p(0, 'BLOCK', 8, '0', 2, 'PORTE_90', 70, 0, 10, 0, 20, 0);
  p(0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 0, 21, 900);
  p(0, 'ARC', 8, '0', 10, 0, 20, 0, 40, 900, 50, 0, 51, 90);
  p(0, 'ENDBLK', 8, '0');
  p(0, 'BLOCK', 8, '0', 2, 'TABLE', 70, 0, 10, 0, 20, 0);
  p(0, 'LWPOLYLINE', 8, '0', 90, 4, 70, 1, 10, -800, 20, -400, 10, 800, 20, -400, 10, 800, 20, 400, 10, -800, 20, 400);
  p(0, 'CIRCLE', 8, '0', 10, -1100, 20, 0, 40, 220);
  p(0, 'CIRCLE', 8, '0', 10, 1100, 20, 0, 40, 220);
  p(0, 'ENDBLK', 8, '0');
  p(0, 'ENDSEC');

  p(0, 'SECTION', 2, 'ENTITIES');
  const W = 24000, H = 14000, T = 300;
  const rect = (layer: string, x0: number, y0: number, x1: number, y1: number) =>
    p(0, 'LWPOLYLINE', 8, layer, 90, 4, 70, 1, 10, x0, 20, y0, 10, x1, 20, y0, 10, x1, 20, y1, 10, x0, 20, y1);
  // Murs extérieurs (double trait) + hachure pleine entre les deux contours
  rect('MURS', 0, 0, W, H);
  rect('MURS', T, T, W - T, H - T);
  p(0, 'HATCH', 8, 'MURS', 62, 8, 2, 'SOLID', 70, 1, 71, 0, 91, 2,
    92, 3, 72, 0, 73, 1, 93, 4, 10, 0, 20, 0, 10, W, 20, 0, 10, W, 20, H, 10, 0, 20, H, 97, 0,
    92, 3, 72, 0, 73, 1, 93, 4, 10, T, 20, T, 10, W - T, 20, T, 10, W - T, 20, H - T, 10, T, 20, H - T, 97, 0,
    75, 0, 76, 1, 98, 0);
  // Cloisons
  const wall = (x0: number, y0: number, x1: number, y1: number) => p(0, 'LINE', 8, 'CLOISONS', 370, 35, 10, x0, 20, y0, 11, x1, 21, y1);
  // (cloisons doubles de 10 cm interrompues aux portes de 90 cm)
  wall(9000, T, 9000, 5800); wall(9100, T, 9100, 5800);
  wall(9000, 6700, 9000, H - T); wall(9100, 6700, 9100, H - T);
  wall(T, 8000, 8100, 8000); wall(T, 8100, 8100, 8100);
  wall(16000, T, 16000, 3900); wall(16100, T, 16100, 3900);
  wall(16000, 4800, 16000, 5800); wall(16100, 4800, 16100, 5800);
  wall(16100, 5800, 19000, 5800); wall(16100, 5900, 19000, 5900);
  wall(19900, 5800, W - T, 5800); wall(19900, 5900, W - T, 5900);
  p(0, 'LINE', 8, 'CLOISONS', 10, 9100, 20, 5800, 11, 16000, 21, 5800); // cloison en simple trait
  // Portes (blocs), dont une porte d'entrée double (bloc inséré en miroir)
  p(0, 'INSERT', 8, 'PORTES', 2, 'PORTE_90', 10, 9050, 20, 5800, 50, 90);
  p(0, 'INSERT', 8, 'PORTES', 2, 'PORTE_90', 10, 8100, 20, 8050, 50, 0);
  p(0, 'INSERT', 8, 'PORTES', 2, 'PORTE_90', 10, 16050, 20, 3900, 50, 90);
  p(0, 'INSERT', 8, 'PORTES', 2, 'PORTE_90', 10, 19000, 20, 5850, 50, 0);
  p(0, 'INSERT', 8, 'PORTES', 2, 'PORTE_90', 10, 11000, 20, 150, 50, 0);
  p(0, 'INSERT', 8, 'PORTES', 2, 'PORTE_90', 10, 12800, 20, 150, 41, -1, 42, 1, 50, 0);
  // Fenêtres (traits dans l'épaisseur du mur)
  for (const x of [2000, 5000, 18500, 21500]) {
    p(0, 'LINE', 8, 'FENETRES', 10, x, 20, 100, 11, x + 1500, 21, 100);
    p(0, 'LINE', 8, 'FENETRES', 10, x, 20, 200, 11, x + 1500, 21, 200);
  }
  // Escalier : polyligne avec arc (renflement) + marches
  p(0, 'LWPOLYLINE', 8, 'MURS', 90, 3, 70, 0, 10, 19000, 20, 9000, 42, 0.4142136, 10, 21000, 20, 11000, 10, 21000, 20, 13700);
  for (let i = 0; i < 10; i++) p(0, 'LINE', 8, 'MURS', 10, 21000, 20, 11000 + i * 270, 11, 23700, 21, 11000 + i * 270);
  // Noms de pièces
  const label = (x: number, y: number, t: string) => p(0, 'MTEXT', 8, 'TEXTES', 10, x, 20, y, 40, 350, 71, 5, 1, t);
  label(4500, 4000, 'Accueil\\P{\\fArial|b1;42,3 m²}');
  label(4000, 11000, 'Bureau 1');
  label(12500, 3000, 'Salle de réunion');
  label(16500, 10000, 'Atelier');
  label(20000, 3000, 'Stockage');
  p(0, 'TEXT', 8, 'TEXTES', 10, 22350, 20, 12500, 40, 250, 50, 90, 72, 1, 11, 22350, 21, 12500, 1, 'Escalier %%c 1,20');
  // Mobilier
  p(0, 'INSERT', 8, 'MOBILIER', 2, 'TABLE', 10, 12500, 20, 2000, 70, 2, 71, 1, 44, 2500);
  // Cotes
  p(0, 'LINE', 8, 'COTES', 10, 0, 20, -1200, 11, W, 21, -1200);
  p(0, 'TEXT', 8, 'COTES', 10, W / 2, 20, -1000, 40, 300, 72, 1, 11, W / 2, 21, -1000, 1, '24,00');
  // Points topographiques (dont un très éloigné, comme dans les relevés en coordonnées Lambert)
  for (let i = 0; i < 6; i++) p(0, 'TEXT', 8, 'TOPO', 10, -2000 + i * 5000, 20, H + 2000, 40, 200, 1, `+${(52.1 + i * 0.03).toFixed(2)}`);
  p(0, 'TEXT', 8, 'TOPO', 10, 9_000_000, 20, 4_000_000, 40, 200, 1, 'BORNE 12');
  // Cartouche gelé
  rect('CARTOUCHE', W + 2000, 0, W + 9000, 4000);
  p(0, 'ENDSEC', 0, 'EOF');
  return out.map(String).join('\n') + '\n';
}
