import { baseHeight, WALL700, type P2 } from './geo';
import { AUREA_CENTER } from './aurea-perimeter';

// Places in Benevento, AD 700, registered to real ground (metres, x east,
// z south; see geo.ts). Porta Aurea uses the plan-relative perimeter repair
// documented in AUREA-ALIGNMENT.md. Other positions come from OSM features of the
// surviving monuments and excavations; see docs/benevento/HISTORY.md for the
// sources and what is attested, inferred or legendary.

/** A landmark's frame: module code authored at (lx, lz) in its own coordinates lands at (x, z), turned by rot. */
export interface Frame2 { x: number; z: number; rot: number; lx?: number; lz?: number }
export interface Plateau { x: number; z: number; r0: number; r1: number; h: number; ex?: number; ez?: number; ca: number; sa: number;
  /** Only lower the ground to h (a cut), never raise it. */
  cut?: boolean }

/** The Roman grid of the eastern town (decumanus along the later Via Magistrale, ~21.5° south of east). */
export const GRID_ROT = -0.375;

const pl: Plateau[] = [];
/** Level a terrace: circular (r0 flat, r1 blended) or rectangular (half-extents ex, ez, turned by rot). */
function plateau(x: number, z: number, r0: number, r1: number, dh = 0, rect?: { ex: number; ez: number; rot: number }) {
  const p: Plateau = { x, z, r0, r1, h: baseHeight(x, z) + dh, ca: 1, sa: 0 };
  if (rect) { p.ex = rect.ex; p.ez = rect.ez; p.ca = Math.cos(rect.rot); p.sa = Math.sin(rect.rot); p.r0 = 1; p.r1 = r1 / Math.max(rect.ex, rect.ez) + 1; }
  pl.push(p);
  return p;
}

export interface SiteDef extends Frame2 {
  id: string;
  name: string;
  /** Terrace radius (flat) and blend radius; 0 = follow the land. */
  flat?: [number, number];
  /** Clear radius in the town raster (no houses / alleys). */
  clear?: number;
  /** Polygon in the site's local frame to keep free of houses (default: clear radius). */
  reserve?: P2[];
  /** The cleared ground is an open square (paved, trodden) rather than a precinct. */
  square?: boolean;
  /** Polygons in the site's local frame where the module lays its own floor: the town's ground is not drawn there. */
  floors?: P2[][];
}

// ---------------------------------------------------------------- the sites
// Module-authored sites carry their old local origin (lx, lz).
export const SITES: Record<string, SiteDef> = {
  // Old Triggio San Modesto parcel, not the modern Rione Libertà church.
  sanctusModestus: { id: 'sanctusModestus', name: 'Sanctus Modestus', x: -22.98, z: 6.81, rot: 0,
    floors: [[[-4.62,-2.81],[-5.37,.74],[4.42,2.81],[5.17,-.74]]] },
  // Street-side access beneath a traced house front in Triggio (tools/benevento/anchor_burials.ts:
  // the nearest front, 34 m from the former site, whose lane takes the stair); no clearing or
  // terrace change. Inspired by Triggio burial evidence; exact access/plan are reconstruction.
  triggioBurials: { id: 'triggioBurials', name: 'Sepulcra Langobardorum', x: 83.618, z: 12.461, rot: -1.865224 },
  // The dukes' residence in the old praetorium: planum curiae, today Piazza Piano di Corte.
  curtis: { id: 'curtis', name: 'Curtis Ducis', x: 506, z: -140, rot: GRID_ROT, lx: 40, lz: -23, flat: [24, 40], clear: 22 },
  // The cathedral of S. Maria (consecrated 15 Dec 600) with its atrium; the bishop's house and books.
  episcopium: { id: 'episcopium', name: 'Episcopium', x: -14, z: -98, rot: -0.618, lx: -14, lz: -48, flat: [26, 44], clear: 24,
    reserve: [[-24, -70], [-3, -70], [-3, -27], [-24, -27]],
    // S. Maria (nave, aisle, apse) and the bishop's library beside it have their own slab floors.
    floors: [[[-22.2, -68], [-5.3, -68], [-5.3, -40.4], [-22.2, -40.4]]] },
  // Roman cryptoporticus outside the walls: surviving covered public passages.
  // Exact AD 700 elevations and passage arrangement remain reconstruction hypotheses.
  quadraginta: { id: 'quadraginta', name: 'Porticus Romanae', x: -548, z: -392, rot: 0.32, lx: -37, lz: -70, flat: [44, 70] },
  // Baths between the later Porta S. Lorenzo and Port'Arsa, outside the circuit of 700.
  thermae: { id: 'thermae', name: 'Thermae', x: -419, z: -140, rot: 0.38, lx: -33, lz: 24, flat: [24, 42] },
  // Nunnery of St Peter outside the walls, founded by Theuderada (wife of Romuald I) beyond the Sabato on the Appia.
  sanctusPetrus: { id: 'sanctusPetrus', name: 'Sanctus Petrus extra muros', x: -858, z: -6, rot: -0.9, lx: -16, lz: -50, flat: [30, 50],
    floors: [[[-22.2, -68], [-9.4, -68], [-9.4, -40.4], [-22.2, -40.4]]] },
  theatrum: { id: 'theatrum', name: 'Theatrum', x: -229, z: -8, rot: 0, flat: [52, 74] },
  amphitheatrum: { id: 'amphitheatrum', name: 'Amphitheatrum', x: -593, z: -214, rot: 0.5, flat: [56, 80] },
  arcusTraiani: { id: 'arcusTraiani', name: 'Porta Aurea', x: AUREA_CENTER[0], z: AUREA_CENTER[1], rot: -Math.atan2(24, 18), flat: [9, 22] },
  arcusSacramenti: { id: 'arcusSacramenti', name: 'Arcus Sacramenti', x: -76, z: -61, rot: 0, flat: [7, 16] },
  pontesLeprosus: { id: 'pontesLeprosus', name: 'Pons Leprosus', x: -764, z: -99, rot: 0 },
  pontesOnuphrii: { id: 'pontesOnuphrii', name: 'Pons Sancti Onuphrii', x: -86, z: -372, rot: 0 },
  turrisCatenae: { id: 'turrisCatenae', name: 'Turris Catenae', x: -517, z: -27, rot: 0, flat: [14, 26] },
  sanctusHilarius: { id: 'sanctusHilarius', name: 'Sanctus Hilarius ad Portam Auream', x: 429, z: -285, rot: 0, flat: [14, 26] },
  // Domitian's temple of Isis: its remains in the square before the bishop's church (authored in the
  // Episcopium's frame; HISTORY.md §5 for the evidence).
  iseum: { id: 'iseum', name: 'Iseum', x: -32.8, z: -73.3, rot: -0.618, lx: -15, lz: -17,
    reserve: [[-28, -28.6], [-2.5, -28.6], [-2.5, -6.5], [-28, -6.5]] },
  necropolis: { id: 'necropolis', name: 'Coemeterium Langobardorum', x: 238, z: 286, rot: 0 },
  nux: { id: 'nux', name: 'Nux Sacra', x: -330, z: 478, rot: 0, flat: [12, 24] },
  molendinum: { id: 'molendinum', name: 'Molendinum', x: -692, z: 2, rot: 0 },
  forum: { id: 'forum', name: 'Forum', x: -40, z: -168, rot: GRID_ROT, flat: [16, 30], clear: 18 },
  // The Roman castellum aquae on the height outside Porta Summa, where the Rocca dei Rettori will stand
  // (OSM: the Rocca at 41.1290 N, 14.7820 E); the aqueduct comes in from the east-south-east.
  castellumAquae: { id: 'castellumAquae', name: 'Castellum Aquae', x: 622, z: 160, rot: 2.64, flat: [14, 30] },
  hortusSophiae: { id: 'hortusSophiae', name: 'Hortus Curtis', x: 566, z: -16, rot: GRID_ROT, clear: 20 },
  // The little square before the curtis gate named after a Roman equestrian statue (Piazza Piano di
  // Corte: two fragments of an equestrian monument found there in 1920), with the church of
  // S. Petrus ad Caballum on its east side (HISTORY.md §5 "Ad Caballum"). Kept open as a square.
  caballus: { id: 'caballus', name: 'Ad Caballum', x: 499, z: -108, rot: 0, flat: [10, 19], clear: 13, square: true,
    reserve: [[-12, -10], [16.5, -10], [16.5, 10], [-12, 10]] },
};

// Terraces for the sites that need level footing.
for (const s of Object.values(SITES)) if (s.flat) plateau(s.x, s.z, s.flat[0], s.flat[1]);
// The Sabato's gravel bed under the Ponte Leproso in 700. The modern ground (the DEM) has the
// river pushed against the left bank and the three northern arches silted to above their
// springing: that is the work of the mills Dacomarius was allowed to build in 1077 (Meomartini
// 1889, p. 277). Before them the river spread its bed under the whole bridge: the ground under
// and beside it is cut down to a gravel bed a hand above the water (12.5 here), the channel
// itself left as it is. Axis of the bridge (OSM way 59431406, as in pons.ts): from (-736.8,
// -143.4) to (-788.5, -61.4); the five arches between 20 and 83.5 m from the town end.
{
  const A = [-736.8, -143.4], B = [-788.5, -61.4], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const D = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], sm = (20 + 83.5) / 2;
  const p = plateau(A[0] + D[0] * sm, A[1] + D[1] * sm, 1, 8, 0, { ex: 33, ez: 20, rot: Math.atan2(D[1], D[0]) });
  p.h = 12.75; p.cut = true;
}

// Spatial hash so the terrain does not scan every terrace per vertex.
const HC = 64;
const hash = new Map<number, Plateau[]>();
for (const p of pl) {
  const r = p.ex ? Math.max(p.ex, p.ez!) * p.r1 / p.r0 : p.r1;
  for (let i = Math.floor((p.x - r) / HC); i <= Math.floor((p.x + r) / HC); i++)
    for (let j = Math.floor((p.z - r) / HC); j <= Math.floor((p.z + r) / HC); j++) {
      const k = i * 4096 + j;
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k)!.push(p);
    }
}
const none: Plateau[] = [];
export function plateausNear(x: number, z: number): Plateau[] {
  return hash.get(Math.floor(x / HC) * 4096 + Math.floor(z / HC)) ?? none;
}

/** Local site point to world. */
export function siteToWorld(s: Frame2, lx: number, lz: number): P2 {
  const dx = lx - (s.lx ?? 0), dz = lz - (s.lz ?? 0), c = Math.cos(s.rot), sn = Math.sin(s.rot);
  return [s.x + dx * c + dz * sn, s.z - dx * sn + dz * c];
}

// ---------------------------------------------------------------- the circuit
/** Nearest point on the wall polygon to (x, z): segment index and parameter. */
export function onWall(x: number, z: number) {
  let best = { k: 0, u: 0, d: Infinity, p: [0, 0] as P2 };
  const n = WALL700.length;
  for (let k = 0; k < n; k++) {
    const a = WALL700[k], b = WALL700[(k + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const p: P2 = [a[0] + dx * u, a[1] + dz * u];
    const d = Math.hypot(x - p[0], z - p[1]);
    if (d < best.d) best = { k, u, d, p };
  }
  return best;
}

export interface Gate { id: string; name: string; at: P2; main: boolean; kind: 'arch' | 'gate' | 'postern' }
/**
 * Gates of the circuit of c. 600 (Rotili 2004; Bertelli 1992): the Arch of
 * Trajan as Porta Aurea, the Arch "del Sacramento" reused as a gate, Porta
 * Rufina (the older, displaced one), Porta S. Lorenzo, the Porta Gloriosa at
 * the S. Onofrio bridge, Porta Rettore, a postern; Porta Summa at the east end
 * of the decumanus, 150 m short of its 10th-century successor.
 */
const GATE_SPEC: { id: string; name: string; near: P2; main: boolean; kind: Gate['kind'] }[] = [
  { id: 'aurea', name: 'Porta Aurea', near: AUREA_CENTER, main: true, kind: 'arch' },
  { id: 'summa', name: 'Porta Summa', near: [590, 80], main: true, kind: 'gate' },
  { id: 'rufina', name: 'Porta Rufina', near: [168, 96], main: false, kind: 'gate' },
  { id: 'sacramenti', name: 'Arcus Sacramenti', near: [-76, -61], main: false, kind: 'arch' },
  { id: 'laurentii', name: 'Porta Sancti Laurentii', near: [-392, -332], main: true, kind: 'gate' },
  { id: 'gloriosa', name: 'Porta Gloriosa', near: [-82, -312], main: false, kind: 'gate' },
  { id: 'rectoris', name: 'Porta Rectoris', near: [196, -292], main: false, kind: 'gate' },
  { id: 'posterula', name: 'Posterula', near: [283, -287], main: false, kind: 'postern' },
];
export const GATES: Gate[] = GATE_SPEC.map((g) => ({ id: g.id, name: g.name, main: g.main, kind: g.kind, at: g.kind === 'arch' ? g.near : onWall(g.near[0], g.near[1]).p }));

// ---------------------------------------------------------------- roads outside the walls
export interface Road { name: string; pts: P2[]; w: number }
const g = (id: string) => GATES.find((x) => x.id === id)!.at;
export const ROADS: Road[] = [
  // The Appia: Ponte Leproso, north past the amphitheatre and the Santi Quaranta, to Porta S. Lorenzo.
  // Over the bridge it runs from ramp foot to ramp foot (pons.ts: the bridge's axis is OSM's).
  { name: 'Via Appia', w: 3.4, pts: [[-1120, 40], [-990, 18], [-900, -10], [-845, -30], [-808.0, -30.5], [-714.4, -178.9], [-700, -184], [-664, -246], [-630, -294], [-590, -326], [-520, -347], [-460, -345], g('laurentii')] },
  // From the Arcus Sacramenti down past the theatre and Torre della Catena to the Sabato, along its
  // bank upstream of the bridge, and up to the bridge's town-side ramp.
  { name: 'Via ad Pontem Leprosum', w: 2.8, pts: [[-82, -52], [-120, -38], [-168, -30], [-205, -52], [-262, -70], [-330, -60], [-400, -48], [-470, -40], [-517, -14], [-570, -30], [-640, -70], [-690, -98], [-736.9, -115.1], [-714.4, -178.9]] },
  // The Traiana: through the Arch of Trajan, past S. Ilario, down to the Calore and on to Apulia.
  { name: 'Via Traiana', w: 3.2, pts: [[AUREA_CENTER[0] + 3.2, AUREA_CENTER[1] - 2.4], [AUREA_CENTER[0] + 19.2, AUREA_CENTER[1] - 14.4], [452, -268], [500, -300], [560, -342], [622, -390], [690, -444], [770, -500], [900, -530]] },
  // Porta Gloriosa down to the bridge of S. Onofrio and the road north (the old Latina).
  { name: 'Via Latina', w: 3.0, pts: [g('gloriosa'), [-80, -330], [-84, -350], [-90, -398], [-98, -428], [-118, -480], [-150, -560], [-200, -680], [-240, -800]] },
  // South from Porta Rufina past the Lombard cemetery to the Sabato ford.
  { name: 'Via Rufina', w: 2.6, pts: [g('rufina'), [172, 140], [184, 200], [214, 252], [236, 320], [222, 420], [200, 520], [178, 610]] },
  // East from Porta Summa.
  { name: 'Via Summa', w: 2.8, pts: [g('summa'), [618, 108], [646, 140], [700, 172], [790, 200], [900, 236]] },
  // Down the riverside from Torre della Catena along the Sabato to the old walnut.
  { name: 'Semita Nucis', w: 1.8, pts: [[-517, -14], [-492, 40], [-470, 110], [-450, 200], [-418, 300], [-380, 400], [-345, 462]] },
  // The mill lane off the Leproso road.
  { name: 'Semita Molendini', w: 1.8, pts: [[-600, -48], [-640, -20], [-676, 0]] },
  // A track from Porta Rectoris down the bluff to the Calore meadows.
  { name: 'Semita Caloris', w: 1.6, pts: [g('rectoris'), [192, -320], [170, -380], [150, -440], [140, -520]] },
];

// ---------------------------------------------------------------- quarters (for placing people)
/**
 * Named quarters of the town and its surroundings c. 700, with who would be
 * found there. Attested: the dukes' curtis in the old praetorium with the
 * Lombard nobles (adalingi) and freemen (arimanni) round it; the bishop's
 * church on the forum; the theatre lived in; the nunnery across the Sabato.
 * Inferred: Latin (Roman-descended) households in the old insulae along the
 * decumanus; market on the forum; mills on the Sabato. Hypothetical: an
 * eastern (Greek) household or two by Porta Aurea, on the road to Apulia
 * (churches "de Grecis" are attested only later).
 */
export interface District { id: string; name: string; kind: string; people: string[]; center: P2; poly: P2[]; certainty: 'attested' | 'inferred' | 'hypothesis' }
const circle = (x: number, z: number, r: number, n = 14): P2[] => Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * r, z + Math.sin((i / n) * Math.PI * 2) * r * 0.85] as P2);
export const DISTRICTS: District[] = [
  { id: 'curtis', name: 'Curtis Ducis', kind: 'lombard', certainty: 'attested', people: ['duke', 'gastald', 'Lombard nobles (adalingi)', 'arimanni (armed freemen)', 'servants', 'guards'], center: [506, -128], poly: circle(500, -120, 95) },
  { id: 'vicusLangobardorum', name: 'Vicus Langobardorum', kind: 'lombard', certainty: 'inferred', people: ['arimanni and their households', 'smiths', 'horsemen'], center: [420, -60], poly: circle(420, -40, 70) },
  { id: 'episcopium', name: 'Episcopium', kind: 'ecclesiastical', certainty: 'attested', people: ['bishop', 'priests', 'deacons', 'clerics', 'scribes', 'beggars', 'pilgrims'], center: [-14, -98], poly: circle(-20, -100, 48) },
  { id: 'forum', name: 'Forum (mercatum)', kind: 'market', certainty: 'inferred', people: ['traders', 'peasants selling produce', 'Latin townsfolk', 'Jewish or eastern merchants (rare)'], center: [-40, -168], poly: circle(-40, -168, 30) },
  { id: 'platea', name: 'Platea Publica Maior', kind: 'latin', certainty: 'attested', people: ['Latin townsfolk', 'craftsmen', 'goldsmiths', 'carters'], center: [200, -70], poly: [[-120, -230], [80, -160], [360, -60], [560, 40], [580, 100], [350, 10], [70, -100], [-140, -180]] },
  { id: 'insulaeOccidentales', name: 'Insulae Occidentales', kind: 'latin', certainty: 'inferred', people: ['Latin households', 'potters', 'weavers', 'the poor'], center: [-250, -220], poly: [[-430, -260], [-330, -350], [-150, -320], [-120, -190], [-200, -170], [-330, -200]] },
  { id: 'graeci', name: 'Domus Graecorum', kind: 'eastern', certainty: 'hypothesis', people: ['a Greek merchant family', 'eastern monks passing', 'travellers on the Traiana'], center: [335, -228], poly: circle(335, -225, 40) },
  { id: 'hortiSeptentrionales', name: 'Horti Septentrionales', kind: 'gardens', certainty: 'inferred', people: ['gardeners', 'goatherds', 'children'], center: [60, -290], poly: [[-120, -330], [380, -280], [380, -250], [-120, -300]] },
  { id: 'theatrum', name: 'Theatrum habitatum', kind: 'latin', certainty: 'attested', people: ['poor Latin families living in the arches', 'lime burners'], center: [-222, -23], poly: circle(-222, -23, 55) },
  { id: 'ripaSabbati', name: 'Ripa Sabbati (molendina)', kind: 'river', certainty: 'inferred', people: ['millers', 'fishermen', 'washerwomen', 'carters on the Appia'], center: [-700, -40], poly: circle(-700, -40, 90) },
  { id: 'calcariae', name: 'Calcariae', kind: 'industry', certainty: 'inferred', people: ['lime burners', 'stone robbers', 'carters'], center: [-593, -214], poly: circle(-593, -214, 60) },
  { id: 'sanctusPetrus', name: 'Sanctus Petrus extra muros', kind: 'ecclesiastical', certainty: 'attested', people: ['abbess', 'nuns', 'lay servants', 'pilgrims'], center: [-858, -6], poly: circle(-858, -6, 45) },
  { id: 'coemeterium', name: 'Coemeterium Langobardorum', kind: 'burial', certainty: 'attested', people: ['mourners', 'gravediggers'], center: [238, 286], poly: circle(238, 286, 40) },
  { id: 'viaTraiana', name: 'Via Traiana', kind: 'road', certainty: 'attested', people: ['travellers', 'pilgrims to Monte Gargano', 'drovers'], center: [470, -290], poly: circle(470, -290, 50) },
  { id: 'nux', name: 'Nux Sacra', kind: 'legend', certainty: 'hypothesis', people: ['nobody by day'], center: [-330, 478], poly: circle(-330, 478, 24) },
];

// ---------------------------------------------------------------- explorable houses
/**
 * Town houses you can enter, each with something to find. The layout gives
 * each the frontage plot nearest its target; see lore.ts for what is inside.
 */
export type ExploreKind = 'domus' | 'fabrica' | 'hospitium' | 'horreum' | 'officina' | 'figulina' | 'textrinum' | 'cella' | 'medicus' | 'pistrinum' | 'oratorium' | 'scola' | 'synagoga' | 'ecclesia';
export interface ExploreTarget { id: string; kind: ExploreKind; near: P2 }
export const EXPLORE_TARGETS: ExploreTarget[] = [
  { id: 'domusAudoini', kind: 'domus', near: [452, -70] },        // an old Lombard's house by the curtis (the viper)
  { id: 'fabricaAurea', kind: 'fabrica', near: [352, -198] },     // smithy by Porta Aurea
  { id: 'hospitiumSummae', kind: 'hospitium', near: [520, 30] },  // travellers' inn at the east end of the decumanus
  { id: 'domusNotarii', kind: 'scola', near: [70, -150] },        // a notary's house near the forum
  { id: 'horreumCurtis', kind: 'horreum', near: [430, -175] },    // the duke's granary
  { id: 'aurifices', kind: 'officina', near: [222, -86] },        // goldsmiths on the decumanus
  { id: 'figulina', kind: 'figulina', near: [150, 50] },          // potter by Porta Rufina
  { id: 'textrinum', kind: 'textrinum', near: [292, -10] },       // weavers
  { id: 'domusGraeca', kind: 'domus', near: [330, -236] },        // a Greek merchant's house
  { id: 'cellaVinaria', kind: 'cella', near: [104, -206] },       // a wine cellar with a way down
  { id: 'medicus', kind: 'medicus', near: [-4, -30] },            // physician-herbalist
  { id: 'pistrinum', kind: 'pistrinum', near: [182, -142] },      // bakery
  { id: 'oratoriumDomus', kind: 'oratorium', near: [-150, -205] },// a house-chapel with relics
  { id: 'domusSculdahis', kind: 'domus', near: [-262, -276] },    // the sculdahis (local judge)
  { id: 'domusVidua', kind: 'domus', near: [262, -150] },         // a widow's house
  { id: 'domusFabri', kind: 'fabrica', near: [-60, -230] },       // a joiner
  { id: 'synagoga', kind: 'synagoga', near: [530, -80] },        // prayer room within an existing lot
];

/** Worship rooms placed in the drawn footprint nearest a chosen point (after the
 * houses above): San Pietro ad Forum by the former delle Monache site in Piazza
 * Cardinal Pacca (docs/benevento/MISSING-CHURCHES.md, PIAZZA-PACCA.md). */
export const FIXED_EXPLORE_LOTS: { near: P2; id: string; kind: ExploreKind }[] = [
  { near: [-134.9, -149.5], id: 'sanctusPetrusForum', kind: 'ecclesia' },
];
