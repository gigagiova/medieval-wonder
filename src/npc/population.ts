import * as THREE from 'three';
import { makePerson, registerOutfit, outfitBodies, outfitTailored, type Gear, type Look, type EquipHooks, type TownApi, type TownDirector, type Role, type Person } from '../npc';
import * as Props from './props';
import { makeApron, makeBuckle, makeFibula, makeScrip, makeWorkProp, type WorkProp } from './population-props';
import type { BeltStyle } from '../npc2/kit';
import { PEOPLE_LINES, type GroupId } from './lines-people';
import type { ClipName } from './rig';
import type { getMapData } from '../world';

// The people of Beneventum in AD 700, by group, by quarter and by place.
// Who they are, what they wore and how sure we are: docs/benevento/PEOPLE.md.
//
// The town is large (2.8 km of wall), so people live only about the player:
// - *Stations* are fixed places with fixed people (the guards at a gate, the
//   smith at his forge, the washerwomen at the Sabato, nuns at St Peter's):
//   their people are made when the player comes within ~100 m and put away
//   beyond ~125 m. The same station always has the same people (seeded).
// - *Walkers* fill the streets in between: made on a street 40-95 m away
//   (out of sight where possible), from the groups of the quarter they are
//   in, kept to that quarter's streets, and put away beyond ~120 m.
// At most CAP people at once (fewer on phones), one made per frame or so;
// bodies and their clothes are the few tailored pairings of src/npc.ts,
// varied by dye, skin, size, hair, gear and what they carry.

type MapData = ReturnType<typeof getMapData>;
type Colors = NonNullable<Look['colors']>;

// ------------------------------------------------------------------ outfits

/** Two more cuts, tailored on first use like the others: the long tunic of clergy, merchants and strangers, and the same under a mantle (paenula, pallium). */
export function registerPopulationOutfits() {
  registerOutfit('robe', { sex: 'man', bodies: ['nathan', 'manuel'], beard: true, wraps: false, spec: { hem: 'ankle', flare: 0.16, folds: 0.03, sleeve: 'fitted', hood: null, belt: 'sash', stride: 0.85 } });
  registerOutfit('robeCloak', { sex: 'man', bodies: ['eric'], beard: true, wraps: false, spec: { hem: 'ankle', flare: 0.16, folds: 0.03, sleeve: 'fitted', hood: null, cape: 'cloak', belt: 'sash', stride: 0.85 } });
}

// ------------------------------------------------------------------ dyes

// Natural dyes on wool and linen: undyed fleece browns and greys, madder reds,
// woad blues, weld yellows; the better-off wear them stronger and cleaner.
// Orchil (lichen) purple-browns for the Greek household; black-brown for
// religious women; flour and lime dust whiten the miller and lime-burner.
const P = {
  undyed: [0x6e6250, 0x5a5042, 0x4a4036, 0x7a6e5a, 0x3e352c],
  madder: [0x6a3428, 0x7a4232, 0x5e2a22, 0x8a5444],
  redBright: [0x8a2e20, 0x9a3a26, 0x7e2a1e],
  woad: [0x3a4656, 0x46505c, 0x34404e],
  woadDeep: [0x2a3e5e, 0x30466a, 0x283a52],
  weld: [0x7a6c3a, 0x5e5a36, 0x6e6a44],
  weldBright: [0x9a8444, 0x8a7438],
  linen: [0xb8ae98, 0xa89c84, 0xc2b8a2],
  white: [0xd2cab6, 0xc8c0ac, 0xcec6b2],
  habit: [0x1f1813, 0x241c16, 0x2a2219, 0x1c1a17],
  brown: [0x4a3626, 0x3e2e20, 0x55402c],
  orchil: [0x4e3a4e, 0x5a4248, 0x48384a],
  dust: [0x9a9488, 0x8e887c, 0xa8a294],
  lime: [0xb0aa9c, 0xa49e90],
  rag: [0x3e352c, 0x4a4036, 0x2e2822],
};
const pick = <T>(r: () => number, a: T[]) => a[Math.floor(r() * a.length) % a.length];
const mix = (...as: number[][]) => as.flat();
const span = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r();

// ------------------------------------------------------------------ names

const N = {
  lombardM: ['Audoin', 'Aio', 'Arechis', 'Ratchis', 'Rodoald', 'Agipert', 'Teuderad', 'Grimoald', 'Radoald', 'Ansprand', 'Walpert', 'Rotchis', 'Gaido', 'Alahis', 'Hildeprand', 'Zotto', 'Audoald', 'Ago', 'Sindual', 'Faroald', 'Paldo', 'Tato', 'Taso', 'Rotari', 'Godescalc'],
  lombardF: ['Wigilinda', 'Winiperga', 'Gumperga', 'Ranigunda', 'Gaila', 'Ansa', 'Rotruda', 'Ratperga', 'Adalberga', 'Gundiperga', 'Teudelinda', 'Aurona', 'Scauniperga', 'Ermelinda', 'Theodrada'],
  latinM: ['Ursus', 'Iohannes', 'Petrus', 'Leo', 'Maurus', 'Martinus', 'Stephanus', 'Bonus', 'Sabinus', 'Constantius', 'Benedictus', 'Paulus', 'Andreas', 'Lupulus', 'Felix', 'Vitalis', 'Deusdedit', 'Ianuarius', 'Barbatus', 'Romanus'],
  latinF: ['Maria', 'Theodora', 'Iohanna', 'Agatha', 'Lucia', 'Anna', 'Sergia', 'Romana', 'Benedicta', 'Bona', 'Dulcia', 'Iusta', 'Sabina', 'Constantia', 'Petronia'],
  greekM: ['Theophylaktos', 'Eustathios', 'Nikephoros', 'Gregorios', 'Kosmas', 'Theodoros', 'Leontios', 'Anastasios'],
  greekF: ['Eirene', 'Anastasia', 'Sophia', 'Theodote', 'Kale', 'Zoe'],
  // From the Jewish epitaphs of Venosa (Latin and Greek, 5th-6th c.; Hebrew, 9th c.) and the Chronicle of Ahimaaz.
  jewishM: ['Shabbetai', 'Natan', 'Iosef', 'Hananel', 'Amittai', 'Faustinus', 'Sabbatius', 'Benjamin'],
  bulgar: ['Kuber', 'Kurt', 'Batbayan'],
  african: ['Quodvultdeus', 'Fortunatus', 'Saturninus', 'Victor', 'Adeodatus'],
  pilgrim: ['Ermenfrid', 'Waldebert', 'Wynfrith', 'Eadberht', 'Chrodegar', 'Iohannes', 'Aldo', 'Petrus'],
};

// ------------------------------------------------------------------ groups

type Skin = [number, number, number, number]; // tan from-to, olive from-to (see Person's skin tone)
// Fair to olive to light tan, never darker: Lombards fairer, Latins Mediterranean olive,
// Greeks, Jews, Africans of Carthage olive to light tan; outdoor work weathers.
const SKIN: Record<string, Skin> = {
  lombard: [0, 0.35, 0, 0.18], latin: [0.25, 0.7, 0.15, 0.45], outdoor: [0.45, 0.85, 0.2, 0.45],
  eastern: [0.5, 0.95, 0.3, 0.6], bulgar: [0.2, 0.55, 0.1, 0.3], pale: [0.05, 0.4, 0.05, 0.3],
};

type Extra = 'apronLeather' | 'apronBrown' | 'apronClay' | 'apronLinen' | 'apronDye' | 'fibula' | 'fibulaThroat' | 'scrip' | 'beltSet' | 'buckleBronze' | 'buckleIron';
interface GroupDef {
  outfits: [string, Role][];
  title: string;
  names: string[];
  prefix?: string;
  skin: Skin;
  dress: (r: () => number) => Colors;
  gear?: (r: () => number, outfit: string) => Gear | undefined;
  extras?: (r: () => number, outfit: string) => Extra[];
  beard?: [number, number]; grey?: [number, number]; hair?: number[];
  scale?: number; headScale?: number; speed?: number;
  /**
   * How they are girded (tools/npc3/wardrobe.json, docs/npc/WARDROBE.md):
   * a leather strap (with a bronze buckle for Lombard men, iron for
   * townsmen), a cord (a monk's rope, a priest's linen cingulum, a poor
   * man's hemp), or a woven sash (women's girdle). Default: the outfit's.
   */
  belt?: BeltStyle; buckle?: 'bronze' | 'iron';
}

const tunicKinds = (k: Colors['kinds']) => k;
const G: Record<GroupId, GroupDef> = {
  gasindus: {
    belt: 'leather', buckle: 'bronze',
    outfits: [['soldierCloak', 'soldier'], ['soldier', 'soldier']], title: 'gasindius ducis', names: N.lombardM, skin: SKIN.lombard,
    dress: (r) => ({ tunic: pick(r, mix(P.redBright, P.woadDeep, P.weldBright)), over: pick(r, mix(P.woadDeep, P.madder, P.undyed)), head: pick(r, P.white), belt: 0x24170e, kinds: tunicKinds(['twill', 'felt', 'linen']) }),
    gear: (r) => ({ arms: true, cap: r() < 0.3 }), extras: (_r, o) => (o === 'soldierCloak' ? ['fibula'] : []),
    beard: [0.9, 1.3], hair: [0x3a2a1e, 0x4a3524, 0x5a4430, 0x2a1d15], speed: 1.25,
  },
  gastaldius: {
    belt: 'leather', buckle: 'bronze',
    outfits: [['soldierCloak', 'soldier']], title: 'gastaldius', names: N.lombardM, skin: SKIN.lombard,
    dress: (r) => ({ tunic: pick(r, mix(P.redBright, P.weldBright)), over: pick(r, mix(P.woadDeep, P.brown)), head: pick(r, P.white), belt: 0x24170e, kinds: ['twill', 'felt', 'linen'] }),
    gear: () => ({ staff: true, cap: true }), extras: () => ['fibula', 'beltSet'], beard: [1, 1.3], grey: [0.25, 0.6], speed: 1.0,
  },
  sculdahis: {
    belt: 'leather', buckle: 'bronze',
    outfits: [['soldierCloak', 'soldier']], title: 'sculdahis', names: N.lombardM, skin: SKIN.lombard,
    dress: (r) => ({ tunic: pick(r, mix(P.madder, P.woad)), over: pick(r, mix(P.brown, P.undyed)), head: pick(r, P.linen), belt: 0x2e1e12, kinds: ['twill', 'felt', 'linen'] }),
    gear: () => ({ staff: true, cap: true }), extras: () => ['fibula', 'beltSet'], beard: [1, 1.3], grey: [0.3, 0.7], speed: 1.0,
  },
  arimannus: {
    belt: 'leather', buckle: 'bronze',
    outfits: [['soldier', 'soldier'], ['soldierCloak', 'soldier']], title: 'arimannus', names: N.lombardM, skin: SKIN.lombard,
    dress: (r) => ({ tunic: pick(r, mix(P.madder, P.woad, P.undyed)), over: pick(r, mix(P.undyed, P.woad)), head: pick(r, P.undyed), belt: 0x2e1e12, kinds: ['twill', 'felt', 'tabby'] }),
    gear: (r, o) => { const x = r(); return { arms: true, spear: true, helmet: x < 0.4 ? 'spangen' : x < 0.65 ? 'lamellar' : false, cap: x >= 0.65, shield: o === 'soldierCloak' ? 'arm' : 'back' }; },
    beard: [0.8, 1.3], speed: 1.3,
  },
  langobarda: {
    belt: 'sash',
    outfits: [['woman', 'woman'], ['womanShawl', 'woman']], title: 'femina Langobarda', names: N.lombardF, skin: SKIN.lombard,
    dress: (r) => ({ tunic: pick(r, mix(P.redBright, P.weldBright, P.woadDeep)), over: pick(r, mix(P.woadDeep, P.madder, P.undyed)), head: pick(r, P.white), belt: pick(r, P.weldBright), beltKind: 'tabby', kinds: ['twill', 'twill', 'linen'] }),
    gear: (r) => ({ basket: r() < 0.3 }), extras: () => ['fibulaThroat'],
  },
  senexLangobardus: {
    belt: 'leather', buckle: 'bronze',
    outfits: [['soldierCloak', 'soldier']], title: 'senex Langobardus', names: N.lombardM, skin: SKIN.lombard,
    dress: (r) => ({ tunic: pick(r, mix(P.madder, P.linen)), over: pick(r, mix(P.brown, P.undyed)), head: pick(r, P.linen), belt: 0x24170e, kinds: ['linen', 'felt', 'linen'] }),
    gear: (r) => ({ staff: true, cap: r() < 0.5 }), extras: () => ['fibula', 'beltSet'], beard: [1.1, 1.4], grey: [0.7, 0.9], speed: 0.8,
  },
  bulgarus: {
    belt: 'leather', buckle: 'bronze',
    outfits: [['soldier', 'soldier']], title: 'Vulgar de Sepino', names: N.bulgar, skin: SKIN.bulgar,
    dress: (r) => ({ tunic: pick(r, mix(P.weld, P.madder)), over: pick(r, P.undyed), head: pick(r, P.undyed), belt: 0x24170e, kinds: ['twill', 'felt', 'tabby'] }),
    gear: () => ({ arms: true, cap: true }), beard: [0.6, 1.0], hair: [0x1c1510, 0x2a1d15], speed: 1.2,
  },
  aldius: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantHood', 'peasant'], ['peasantCloak', 'peasant']], title: 'aldius', names: [...N.lombardM, ...N.latinM], skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, mix(P.undyed, P.undyed, P.madder, P.weld, P.woad)), over: pick(r, P.undyed), head: pick(r, mix(P.undyed, P.weld)), belt: 0x3a2618, kinds: ['tabby', 'felt', 'tabby'] }),
    gear: (r, o) => { const x = r(); return { cap: o === 'peasantCloak', sticks: o === 'peasantHood' && x < 0.35, bucket: x >= 0.4 && x < 0.6, basket: x >= 0.6 && x < 0.75 }; },
  },
  rustica: {
    belt: 'sash',
    outfits: [['woman', 'woman'], ['womanShawl', 'woman']], title: 'rustica', names: [...N.latinF, ...N.lombardF], skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, mix(P.undyed, P.madder, P.weld)), over: pick(r, P.undyed), head: pick(r, P.linen), belt: pick(r, P.undyed), beltKind: 'tabby', kinds: ['tabby', 'tabby', 'linen'] }),
    gear: (r) => { const x = r(); return { jar: x < 0.4, basket: x >= 0.4 }; },
  },
  servus: {
    belt: 'cord',
    outfits: [['peasantHood', 'peasant']], title: 'servus', names: N.latinM, skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, P.rag), over: pick(r, P.rag), head: pick(r, P.rag), belt: 0x3a2618, kinds: ['tabby', 'tabby', 'tabby'] }),
    gear: (r) => { const x = r(); return { sticks: x < 0.45, bucket: x >= 0.45 && x < 0.8 }; }, beard: [0, 0.9],
  },
  mulier: {
    belt: 'sash',
    outfits: [['woman', 'woman'], ['womanShawl', 'woman']], title: 'mulier Beneventana', names: N.latinF, skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, mix(P.madder, P.woad, P.undyed, P.weld)), over: pick(r, mix(P.undyed, P.woad)), head: pick(r, P.linen), belt: pick(r, mix(P.madder, P.weld, P.undyed)), beltKind: 'tabby', kinds: ['twill', 'twill', 'linen'] }),
    gear: (r) => { const x = r(); return { jar: x < 0.3, basket: x >= 0.3 && x < 0.65 }; },
  },
  anus: {
    belt: 'sash',
    outfits: [['womanShawl', 'woman']], title: 'anus', names: [...N.latinF, ...N.lombardF], skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, mix(P.brown, P.undyed)), over: pick(r, P.rag), head: pick(r, mix(P.undyed, P.linen)), belt: pick(r, P.undyed), beltKind: 'tabby', kinds: ['tabby', 'felt', 'linen'] }),
    gear: (r) => ({ staff: r() < 0.6 }), grey: [0.8, 0.95], speed: 0.75,
  },
  puer: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantHood', 'peasant'], ['peasantCloak', 'peasant']], title: 'puer', names: [...N.latinM, ...N.lombardM], skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, mix(P.undyed, P.madder, P.weld)), over: pick(r, P.undyed), head: pick(r, P.undyed), belt: 0x3a2618, kinds: ['tabby', 'felt', 'tabby'] }),
    gear: () => ({}), beard: [0, 0], grey: [0, 0], scale: 0.62, headScale: 1.13, speed: 1.0,
  },
  puella: {
    belt: 'sash',
    outfits: [['woman', 'woman']], title: 'puella', names: [...N.latinF, ...N.lombardF], skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, mix(P.madder, P.weld, P.undyed)), over: pick(r, P.undyed), head: pick(r, P.linen), belt: pick(r, P.madder), beltKind: 'tabby', kinds: ['tabby', 'tabby', 'linen'] }),
    gear: () => ({}), grey: [0, 0], scale: 0.6, headScale: 1.13, speed: 0.95,
  },
  mendicus: {
    belt: 'cord',
    outfits: [['peasantHood', 'peasant']], title: 'mendicus', names: N.latinM, skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, P.rag), over: pick(r, P.rag), head: pick(r, P.rag), belt: 0x2a1a10, kinds: ['tabby', 'tabby', 'tabby'] }),
    gear: () => ({ staff: true }), beard: [1, 1.4], grey: [0.4, 0.8], speed: 0.7,
  },
  faber: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantCloak', 'peasant'], ['peasantHood', 'peasant']], title: 'faber ferrarius', names: [...N.latinM, ...N.lombardM], skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, P.undyed), over: pick(r, P.undyed), head: pick(r, P.undyed), belt: 0x2a1a10, kinds: ['tabby', 'felt', 'tabby'] }),
    gear: (_r, o) => ({ cap: o === 'peasantCloak' }), extras: () => ['apronLeather'], beard: [0.9, 1.3],
  },
  aurifex: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantCloak', 'peasant']], title: 'aurifex', names: N.latinM, skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, mix(P.madder, P.woad)), over: pick(r, P.undyed), head: pick(r, P.undyed), belt: 0x2a1a10, kinds: ['twill', 'felt', 'tabby'] }),
    gear: () => ({ cap: true }), extras: () => ['apronBrown'],
  },
  figulus: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantHood', 'peasant']], title: 'figulus', names: N.latinM, skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, P.undyed), over: pick(r, P.undyed), head: pick(r, P.undyed), belt: 0x3a2618, kinds: ['tabby', 'felt', 'tabby'] }),
    extras: () => ['apronClay'], gear: () => ({}),
  },
  pistor: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantCloak', 'peasant']], title: 'pistor', names: N.latinM, skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, P.linen), over: pick(r, P.undyed), head: pick(r, P.linen), belt: 0x3a2618, kinds: ['tabby', 'felt', 'linen'] }),
    gear: () => ({ cap: true }), extras: () => ['apronLinen'],
  },
  molendinarius: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantHood', 'peasant'], ['peasantCloak', 'peasant']], title: 'molinarius', names: [...N.latinM, ...N.lombardM], skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, P.dust), over: pick(r, P.dust), head: pick(r, P.dust), belt: 0x5a4a38, kinds: ['tabby', 'felt', 'tabby'] }),
    gear: (_r, o) => ({ cap: o === 'peasantCloak' }), extras: () => ['apronLinen'],
  },
  calcarius: {
    belt: 'leather', buckle: 'iron',
    outfits: [['peasantHood', 'peasant']], title: 'calcarius', names: N.latinM, skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, P.lime), over: pick(r, P.lime), head: pick(r, P.lime), belt: 0x5a4a38, kinds: ['tabby', 'felt', 'tabby'] }),
    gear: (r) => ({ sticks: r() < 0.4 }),
  },
  lavandaria: {
    belt: 'sash',
    outfits: [['woman', 'woman']], title: 'lavandaria', names: [...N.latinF, ...N.lombardF], skin: SKIN.outdoor,
    dress: (r) => ({ tunic: pick(r, mix(P.undyed, P.madder)), over: pick(r, P.undyed), head: pick(r, P.linen), belt: pick(r, P.undyed), beltKind: 'tabby', kinds: ['tabby', 'tabby', 'linen'] }),
    gear: () => ({}),
  },
  textrix: {
    belt: 'sash',
    outfits: [['woman', 'woman'], ['womanShawl', 'woman']], title: 'textrix', names: [...N.latinF, ...N.lombardF], skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, mix(P.weld, P.woad, P.madder)), over: pick(r, mix(P.woad, P.undyed)), head: pick(r, P.linen), belt: pick(r, P.redBright), beltKind: 'tabby', kinds: ['twill', 'twill', 'linen'] }),
    gear: () => ({}),
  },
  negotiator: {
    belt: 'leather', buckle: 'iron',
    outfits: [['robe', 'monk'], ['robeCloak', 'monk']], title: 'negotiator', names: N.latinM, skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, mix(P.madder, P.woad, P.weld)), over: pick(r, mix(P.undyed, P.woadDeep)), head: pick(r, P.linen), belt: pick(r, P.madder), beltKind: 'tabby', kinds: ['twill', 'felt', 'linen'] }),
    gear: (r) => ({ cap: r() < 0.4 }), extras: (r) => (r() < 0.6 ? ['scrip'] : []), beard: [0.7, 1.2], speed: 1.05,
  },
  notarius: {
    belt: 'sash',
    outfits: [['robe', 'monk']], title: 'notarius', names: N.latinM, skin: SKIN.pale,
    dress: (r) => ({ tunic: pick(r, mix(P.linen, P.undyed)), over: pick(r, P.undyed), head: pick(r, P.linen), belt: pick(r, P.undyed), beltKind: 'tabby', kinds: ['linen', 'felt', 'linen'] }),
    gear: () => ({}), beard: [0, 0.8], speed: 1.0,
  },
  medicus: {
    belt: 'leather', buckle: 'iron',
    outfits: [['robe', 'monk'], ['robeCloak', 'monk']], title: 'medicus', names: [...N.latinM, ...N.greekM], skin: SKIN.latin,
    dress: (r) => ({ tunic: pick(r, mix(P.woad, P.linen)), over: pick(r, P.undyed), head: pick(r, P.linen), belt: pick(r, P.undyed), beltKind: 'tabby', kinds: ['twill', 'felt', 'linen'] }),
    gear: () => ({}), extras: () => ['scrip'], beard: [0.8, 1.2], grey: [0.2, 0.6],
  },
  presbyter: {
    belt: 'cord',
    outfits: [['robeCloak', 'monk'], ['robe', 'monk']], title: 'presbyter', prefix: 'Presbyter', names: N.latinM, skin: SKIN.pale,
    dress: (r) => ({ tunic: pick(r, P.white), over: pick(r, mix(P.brown, P.habit, P.madder)), head: pick(r, P.white), belt: pick(r, P.white), beltKind: 'linen', kinds: ['linen', 'felt', 'linen'] }),
    gear: () => ({}), beard: [0, 0], speed: 0.95,
  },
  diaconus: {
    belt: 'cord',
    outfits: [['robe', 'monk']], title: 'diaconus', prefix: 'Diaconus', names: N.latinM, skin: SKIN.pale,
    dress: (r) => ({ tunic: pick(r, P.white), over: pick(r, P.white), head: pick(r, P.white), belt: pick(r, P.white), beltKind: 'linen', kinds: ['linen', 'linen', 'linen'] }),
    gear: () => ({}), beard: [0, 0], grey: [0, 0.2], speed: 1.0,
  },
  monachus: {
    belt: 'cord',
    outfits: [['monk', 'monk'], ['monkBare', 'monk']], title: 'monachus', prefix: 'Frater', names: [...N.latinM, ...N.greekM.slice(0, 3)], skin: SKIN.pale,
    dress: (r) => ({ tunic: pick(r, P.habit), over: pick(r, P.habit), head: pick(r, P.habit), kinds: ['tabby', 'tabby', 'tabby'] }),
    gear: (r) => ({ lantern: r() < 0.3 }), beard: [0, 0], speed: 0.95,
  },
  sanctimonialis: {
    belt: 'sash',
    outfits: [['woman', 'woman'], ['womanShawl', 'woman']], title: 'ancilla Dei', prefix: 'Soror', names: [...N.lombardF, ...N.latinF], skin: SKIN.pale,
    dress: (r) => ({ tunic: pick(r, mix(P.habit, P.brown)), over: pick(r, P.habit), head: pick(r, [0x1e1a18, 0x24201c, 0x2a2420]), belt: pick(r, P.habit), beltKind: 'tabby', kinds: ['tabby', 'felt', 'tabby'] }),
    gear: () => ({}), speed: 0.9,
  },
  peregrinus: {
    belt: 'leather', buckle: 'iron',
    outfits: [['robeCloak', 'monk'], ['peasantHood', 'peasant']], title: 'peregrinus', names: N.pilgrim, skin: SKIN.pale,
    dress: (r) => ({ tunic: pick(r, P.undyed), over: pick(r, mix(P.brown, P.undyed)), head: pick(r, P.undyed), belt: 0x3a2618, kinds: ['tabby', 'felt', 'tabby'] }),
    gear: () => ({ staff: true }), extras: () => ['scrip'], beard: [0.7, 1.3], speed: 1.0,
  },
  graecus: {
    belt: 'sash',
    outfits: [['robeCloak', 'monk'], ['robe', 'monk']], title: 'Graecus de Tarento', names: N.greekM, skin: SKIN.eastern,
    dress: (r) => ({ tunic: pick(r, mix(P.orchil, P.woad, P.weldBright)), over: pick(r, mix(P.madder, P.undyed, P.orchil)), head: pick(r, P.white), belt: pick(r, P.weldBright), beltKind: 'tabby', kinds: ['twill', 'twill', 'linen'] }),
    gear: () => ({}), extras: (r) => (r() < 0.5 ? ['scrip'] : []), beard: [1.0, 1.35], hair: [0x1c1510, 0x2a1d15, 0x22180f],
  },
  graeca: {
    belt: 'sash',
    outfits: [['woman', 'woman'], ['womanShawl', 'woman']], title: 'Graeca', names: N.greekF, skin: SKIN.eastern,
    dress: (r) => ({ tunic: pick(r, mix(P.orchil, P.redBright)), over: pick(r, mix(P.orchil, P.woadDeep)), head: pick(r, P.white), belt: pick(r, P.weldBright), beltKind: 'tabby', kinds: ['twill', 'twill', 'linen'] }),
    gear: (r) => ({ basket: r() < 0.3 }),
  },
  iudaeus: {
    belt: 'leather', buckle: 'iron',
    outfits: [['robe', 'monk'], ['robeCloak', 'monk']], title: 'Iudaeus', names: N.jewishM, skin: SKIN.eastern,
    dress: (r) => ({ tunic: pick(r, mix(P.woad, P.undyed, P.weld)), over: pick(r, mix(P.undyed, P.woadDeep)), head: pick(r, P.white), belt: pick(r, P.woad), beltKind: 'tabby', kinds: ['twill', 'felt', 'linen'] }),
    gear: () => ({}), extras: (r) => (r() < 0.5 ? ['apronDye'] : ['scrip']), beard: [1.0, 1.35], hair: [0x1c1510, 0x2a1d15, 0x3a2a1e],
  },
  afer: {
    belt: 'sash',
    outfits: [['robe', 'monk']], title: 'Afer de Carthagine', names: N.african, skin: SKIN.eastern,
    dress: (r) => ({ tunic: pick(r, mix(P.linen, P.undyed)), over: pick(r, P.undyed), head: pick(r, P.linen), belt: pick(r, P.undyed), beltKind: 'tabby', kinds: ['linen', 'felt', 'linen'] }),
    gear: (r) => ({ staff: r() < 0.5 }), beard: [0.6, 1.1], hair: [0x1c1510, 0x22180f],
  },
};
export const GROUPS = G;

function equipExtras(list: Extra[], h: EquipHooks) {
  for (const e of list) {
    if (e.startsWith('apron')) {
      const c = { apronLeather: [0x3a2618, true], apronBrown: [0x4a3020, true], apronClay: [0x7a5e48, false], apronLinen: [0xbab2a0, false], apronDye: [0x34405a, false] }[e as 'apronLeather']!;
      h.on('Hips', makeApron(h.belt, c[0] as number, c[1] as boolean, c[1] ? 0.42 : 0.38), new THREE.Matrix4());
    } else if (e === 'fibula' || e === 'fibulaThroat') {
      const f = makeFibula(h.m, e === 'fibula' ? 'right' : 'throat');
      h.on('Spine2', f.obj, f.place);
    } else if (e === 'scrip') h.on('Hips', makeScrip(h.belt), new THREE.Matrix4());
    else if (e === 'beltSet') h.on('Hips', Props.makeBeltFittings(h.belt, h.rnd() * 10), new THREE.Matrix4());
    else if (e === 'buckleBronze' || e === 'buckleIron') h.on('Hips', makeBuckle(h.belt, e === 'buckleBronze' ? 'bronze' : 'iron'), new THREE.Matrix4());
  }
}

/** Make one person of a group (seeded: the same seed, the same person). */
export function makeOfGroup(scene: THREE.Scene, id: GroupId, seed: number, o: { name?: string; lines?: typeof PEOPLE_LINES[GroupId]; outfit?: number } = {}) {
  const g = G[id];
  const r = mulberry(seed);
  // Tailoring a new outfit/body pairing takes a few tenths of a second (on first use, src/npc.ts):
  // mostly reuse pairings already made, so a walk through town stalls only a handful of times.
  let pickI = (o.outfit ?? Math.floor(r() * g.outfits.length)) % g.outfits.length, body: number | undefined;
  const ready = g.outfits.flatMap(([id], i) => outfitBodies(id).map((b, bi) => ({ i, bi, ok: outfitTailored(`${id}:${b}`) }))).filter((q) => q.ok);
  if (o.outfit === undefined && ready.length && r() < 0.85) { const q = ready[Math.floor(r() * ready.length)]; pickI = q.i; body = q.bi; }
  const [outfitId, role] = g.outfits[pickI];
  const name = o.name ?? pick(r, g.names);
  const extras = g.extras?.(r, outfitId) ?? [];
  if (g.belt === 'leather' && g.buckle) extras.push(g.buckle === 'bronze' ? 'buckleBronze' : 'buckleIron');
  const look: Look = {
    name: g.prefix ? `${g.prefix} ${name}` : name, title: g.title, lines: o.lines ?? PEOPLE_LINES[id],
    skin: { tan: span(r, [g.skin[0], g.skin[1]]), olive: span(r, [g.skin[2], g.skin[3]]) },
    colors: g.dress(r),
    hair: g.hair ? pick(r, g.hair) : undefined,
    grey: g.grey ? span(r, g.grey) : undefined,
    beard: g.beard ? (g.beard[1] > 0 && r() < 0.85 ? span(r, g.beard) : g.beard[0]) : undefined,
    scale: g.scale ? g.scale * (0.92 + r() * 0.16) : undefined,
    headScale: g.headScale,
    belt: g.belt,
    equip: extras.length ? (h) => equipExtras(extras, h) : undefined,
  };
  const gear = g.gear?.(r, outfitId);
  // Children never get the older scanned face; the old may.
  const face = g.scale ? false : g.grey && g.grey[0] >= 0.4 ? true : undefined;
  const p = makePerson(scene, role, { outfitId, body, seed: Math.floor(r() * 1e9), gear, look, face });
  return { person: p, speed: g.speed ?? (role === 'soldier' ? 1.3 : 1.15) };
}
const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ------------------------------------------------------------------ who walks where

/** Groups walking each quarter (getMapData().districts), by weight. */
const WALKERS: Record<string, [GroupId, number][]> = {
  curtis: [['arimannus', 3], ['gasindus', 2], ['servus', 2], ['langobarda', 2], ['aldius', 1], ['puer', 1], ['gastaldius', 0.5]],
  vicusLangobardorum: [['arimannus', 2], ['langobarda', 2.5], ['faber', 0.6], ['puer', 1], ['puella', 0.8], ['senexLangobardus', 0.8], ['servus', 1], ['bulgarus', 0.3]],
  episcopium: [['presbyter', 1.5], ['diaconus', 1], ['monachus', 1.5], ['peregrinus', 1.5], ['mendicus', 1], ['mulier', 1.5], ['anus', 1]],
  forum: [['negotiator', 2], ['rustica', 2], ['aldius', 2], ['mulier', 2], ['iudaeus', 0.7], ['graecus', 0.7], ['bulgarus', 0.3], ['afer', 0.3], ['puer', 1], ['servus', 1]],
  platea: [['mulier', 2], ['aldius', 1.5], ['negotiator', 1], ['servus', 1], ['puer', 1], ['puella', 1], ['presbyter', 0.4], ['arimannus', 0.7], ['langobarda', 0.8], ['anus', 0.6], ['iudaeus', 0.3], ['monachus', 0.3]],
  insulaeOccidentales: [['mulier', 2], ['aldius', 2], ['puella', 1], ['puer', 1], ['anus', 1], ['servus', 1], ['figulus', 0.4]],
  graeci: [['graecus', 2], ['graeca', 1.5], ['peregrinus', 1], ['monachus', 0.4], ['mulier', 1]],
  hortiSeptentrionales: [['aldius', 2], ['servus', 2], ['puer', 1.5], ['rustica', 1]],
  theatrum: [['mulier', 2], ['puer', 2], ['puella', 1.5], ['anus', 1], ['aldius', 1], ['calcarius', 0.6]],
  ripaSabbati: [['aldius', 1], ['rustica', 1], ['molendinarius', 0.5], ['peregrinus', 1]],
  calcariae: [['calcarius', 2], ['servus', 1]],
  sanctusPetrus: [['sanctimonialis', 2], ['peregrinus', 1], ['rustica', 1]],
  coemeterium: [['langobarda', 1], ['senexLangobardus', 1]],
  viaTraiana: [['peregrinus', 3], ['aldius', 1], ['graecus', 0.8], ['negotiator', 1], ['afer', 0.3], ['bulgarus', 0.3]],
  nux: [],
  '': [['aldius', 2], ['mulier', 2], ['servus', 1], ['puer', 1], ['rustica', 1], ['peregrinus', 0.5]],
};

// ------------------------------------------------------------------ stations

/**
 * A fixed place and its people. `at`: 'x:<explorable id>' (a house door),
 * 'l:<landmark name>', 't:<teleport name>' (a spot known to be walkable), 'g:<gate id>', 'p:x,z', or 'r:<river>@x,z' (the bank
 * nearest a point). `off` shifts it (metres, x east, z south).
 *  - group: standing in a circle on the street, talking in turns;
 *  - guard: two on either side of the street through a gate, facing out;
 *  - work: at the door, facing the street, with their work beside them;
 *  - kneel: kneeling where they are (prayer, washing), facing `face`.
 */
interface Station {
  id: string; at: string; off?: [number, number];
  kind: 'group' | 'guard' | 'work' | 'kneel' | 'post';
  who: GroupId[];
  prop?: WorkProp;
  /** Kneel/post: face this point (same notation as `at`); default the street. */
  face?: string;
  /** Named characters (by index into who). */
  names?: Record<number, string>;
  /** Snap to the nearest street (default true for group, guard and work). */
  street?: boolean;
}
const STATIONS: Station[] = [
  // Porta Aurea and the Via Traiana: guards, pilgrims bound for Monte Gargano, the smith inside the gate, the Greek household.
  { id: 'aureaGuard', at: 'g:aurea', kind: 'guard', who: ['arimannus', 'arimannus'] },
  { id: 'aureaPilgrims', at: 'g:aurea', off: [-14, 5], kind: 'group', who: ['peregrinus', 'peregrinus', 'negotiator'] },
  { id: 'hilarius', at: 't:Sanctus Hilarius', off: [4, 1], kind: 'kneel', who: ['peregrinus'], face: 'l:Sanctus Hilarius ad Portam Auream', street: false },
  { id: 'hilariusGreeks', at: 't:Sanctus Hilarius', off: [-1, -5], kind: 'group', who: ['graeca', 'graecus'], street: false },
  { id: 'fabrica', at: 'x:fabricaAurea', kind: 'work', who: ['faber', 'puer'], prop: 'anvil' },
  { id: 'domusGraeca', at: 'x:domusGraeca', kind: 'group', who: ['graecus', 'graeca', 'afer'] },
  // The curtis: palace guards, the duke's men, his gastald at the granary, the Lombard quarter.
  { id: 'palatium', at: 'l:Palatium', kind: 'guard', who: ['arimannus', 'arimannus'] },
  { id: 'curtisNobles', at: 'l:Curtis Ducis', off: [-30, 18], kind: 'group', who: ['gasindus', 'gasindus', 'langobarda'] },
  { id: 'horreum', at: 'x:horreumCurtis', kind: 'work', who: ['gastaldius', 'servus', 'servus'], prop: 'sacks' },
  { id: 'audoin', at: 'x:domusAudoini', off: [6, 4], kind: 'group', who: ['senexLangobardus', 'puer'], names: { 0: 'Aio' } },
  { id: 'vicus', at: 'p:400,-30', kind: 'group', who: ['langobarda', 'langobarda', 'puella'] },
  { id: 'hortus', at: 'l:Hortus Curtis', off: [8, -6], kind: 'post', who: ['servus'], street: false },
  // The bishop's church and the forum.
  { id: 'atrium', at: 'l:Atrium', kind: 'group', who: ['presbyter', 'diaconus', 'mendicus'], street: false },
  { id: 'atriumPilgrim', at: 'l:Atrium', off: [3, 4], kind: 'kneel', who: ['peregrinus'], face: 'l:Basilica', street: false },
  { id: 'episcopiumMonks', at: 'l:Episcopium', off: [18, 10], kind: 'group', who: ['monachus', 'monachus', 'anus'] },
  { id: 'forumStall', at: 'l:Templum', off: [6, 4], kind: 'work', who: ['negotiator'], prop: 'stall', street: false },
  { id: 'forumStall2', at: 'l:Templum', off: [-7, 8], kind: 'work', who: ['rustica'], prop: 'stall', street: false },
  { id: 'forumTalk', at: 'l:Templum', off: [0, -6], kind: 'group', who: ['iudaeus', 'medicus', 'bulgarus'], street: false },
  { id: 'notarius', at: 'x:domusNotarii', kind: 'group', who: ['notarius', 'aldius'] },
  { id: 'medicus', at: 'x:medicus', kind: 'group', who: ['medicus', 'mulier', 'puella'] },
  { id: 'aurifices', at: 'x:aurifices', kind: 'work', who: ['aurifex'] },
  { id: 'pistrinum', at: 'x:pistrinum', kind: 'work', who: ['pistor', 'mulier'] },
  { id: 'textrinum', at: 'x:textrinum', kind: 'work', who: ['textrix', 'textrix'], prop: 'loom' },
  { id: 'figulina', at: 'x:figulina', kind: 'work', who: ['figulus', 'puer'], prop: 'pots' },
  { id: 'vidua', at: 'x:domusVidua', kind: 'group', who: ['anus', 'mulier'] },
  { id: 'oratorium', at: 'x:oratoriumDomus', kind: 'group', who: ['anus', 'diaconus'] },
  { id: 'synagoga', at: 'x:synagoga', off: [2, 0], kind: 'post', who: ['iudaeus'] },
  { id: 'sculdahis', at: 'x:domusSculdahis', kind: 'group', who: ['sculdahis', 'aldius', 'rustica'] },
  { id: 'hospitium', at: 'x:hospitiumSummae', kind: 'group', who: ['mulier', 'peregrinus', 'bulgarus'] },
  // Gates.
  { id: 'summaGuard', at: 'g:summa', kind: 'guard', who: ['arimannus', 'arimannus'] },
  { id: 'rufinaGuard', at: 'g:rufina', kind: 'guard', who: ['arimannus'] },
  { id: 'laurentiiGuard', at: 'g:laurentii', kind: 'guard', who: ['arimannus', 'arimannus'] },
  { id: 'gloriosaGuard', at: 'g:gloriosa', kind: 'guard', who: ['arimannus'] },
  { id: 'sacramentiGuard', at: 'g:sacramenti', kind: 'guard', who: ['arimannus'] },
  // The west: the theatre's poor, the lime-burners, the chain tower, the mill and the river.
  { id: 'theatrum', at: 'l:Theatrum', off: [10, 0], kind: 'group', who: ['mulier', 'puer', 'puella', 'anus'] },
  { id: 'calcaria', at: 'l:Amphitheatrum', off: [0, -48], kind: 'work', who: ['calcarius', 'calcarius'], prop: 'kiln' },
  { id: 'catena', at: 'l:Turris Catenae', off: [-8, 4], kind: 'post', who: ['arimannus'], street: false },
  { id: 'molendinum', at: 'l:Molendinum', off: [2, -8], kind: 'work', who: ['molendinarius', 'servus'], prop: 'sacks', street: false },
  { id: 'lavandariae', at: 'r:Sabbatus@-700,-20', kind: 'kneel', who: ['lavandaria', 'lavandaria', 'lavandaria'], prop: 'laundry' },
  { id: 'quadraginta', at: 't:Porticus Romanae', off: [2, 4], kind: 'group', who: ['monachus', 'mendicus'], street: false },
  // Outside the walls: the nuns, the Lombard graves, the walnut stump, the Iseum.
  { id: 'sanctusPetrus', at: 't:Sanctus Petrus', off: [2.5, 2.5], kind: 'group', who: ['sanctimonialis', 'sanctimonialis', 'rustica'], street: false },
  { id: 'coemeterium', at: 'l:Coemeterium Langobardorum', off: [3, 12], kind: 'kneel', who: ['langobarda'], face: 'l:Coemeterium Langobardorum', street: false },
  { id: 'coemeterium2', at: 'l:Coemeterium Langobardorum', off: [-4, 16], kind: 'post', who: ['senexLangobardus'], face: 'l:Coemeterium Langobardorum', street: false },
  { id: 'nux', at: 'l:Nux Sacra', off: [5, 7], kind: 'post', who: ['anus'], face: 'l:Nux Sacra', street: false },
  { id: 'iseum', at: 'l:Iseum', off: [6, 14], kind: 'post', who: ['puer'], face: 'l:Iseum', street: false },
];

// ------------------------------------------------------------------ the director

const ON = 100, OFF = 125; // stations: made within ON metres, put away beyond OFF
const W_MIN = 40, W_MAX = 95, W_OFF = 120; // walkers
export const popDebug = { cap: 0, stations: 0, walkers: 0, made: 0, makeMs: 0, maxMakeMs: 0, firstAt: 0, live: [] as string[], player: [0, 0], samples: 0, updMs: 0, updFrames: 0 };

interface Placed { x: number; z: number; yaw: number; kind: 'walk' | 'post' | 'group'; pose?: ClipName; gi?: number }
interface Live { st: Station; people: Person[]; props: THREE.Object3D[] }

export function populationDirector(scene: THREE.Scene, data: MapData, o: { cap?: number } = {}): TownDirector {
  const phone = typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 500);
  const CAP = o.cap ?? (phone ? 18 : 24);
  popDebug.cap = CAP;
  let T: TownApi;
  const live = new Map<string, Live>();
  const walkers: { p: Person; d: string }[] = [];
  /** Districts' street sets (for keeping walkers in their quarter). */
  const zones = new Map<string, Set<number> | null>();
  let samples: { x: number; z: number; st: number; s: number }[] = [];
  let cool = 0, t = 0, walkSeed = 1;
  let centres: { st: Station; c: ReturnType<typeof where> }[] = [];
  const queue: (() => void)[] = [];

  const inPoly = (x: number, z: number, poly: [number, number][]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const districtAt = (x: number, z: number) => data.districts.find((d) => inPoly(x, z, d.poly as [number, number][]))?.id ?? '';

  /** Resolve a station reference to a point. */
  const where = (ref: string, off: [number, number] = [0, 0]): { x: number; z: number; ok: boolean; face?: number } => {
    const [k, v] = [ref.slice(0, 1), ref.slice(2)];
    let x = NaN, z = NaN, face: number | undefined;
    if (k === 'x') { const e = data.explorables.find((q) => q.id === v); if (e) { x = e.x; z = e.z; } }
    else if (k === 'l') { const l = data.landmarks.find((q) => q.name === v); if (l) { x = l.x; z = l.z; } }
    else if (k === 'g') { const g = data.gates.find((q) => q.id === v); if (g) { x = g.at[0]; z = g.at[1]; } }
    else if (k === 't') { const t = data.teleports.find((q) => q.name === v); if (t) { x = t.x; z = t.z; } }
    else if (k === 'p') [x, z] = v.split(',').map(Number);
    else if (k === 'r') {
      const [name, pt] = v.split('@'), [px, pz] = pt.split(',').map(Number);
      const r = data.rivers.find((q) => q.name === name);
      if (r) {
        let best = { d: Infinity, x: 0, z: 0, nx: 0, nz: 0 };
        const pts = r.pts as unknown as [number, number][];
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
          const u = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1), cx = ax + dx * u, cz = az + dz * u, d = Math.hypot(px - cx, pz - cz);
          if (d < best.d) { const L = Math.sqrt(L2); let nx = -dz / L, nz = dx / L; if (nx * (px - cx) + nz * (pz - cz) < 0) { nx = -nx; nz = -nz; } best = { d, x: cx, z: cz, nx, nz }; }
        }
        // On the bank on the point's side, facing the water.
        const half = r.w / 2 + 0.9;
        x = best.x + best.nx * half; z = best.z + best.nz * half;
        face = Math.atan2(-best.nx, -best.nz);
      }
    }
    return { x: x + off[0], z: z + off[1], ok: Number.isFinite(x), face };
  };

  /** Where each person of a station stands. */
  const layout = (st: Station): (Placed & { prop?: { x: number; z: number; yaw: number } })[] => {
    const c = where(st.at, st.off);
    if (!c.ok) return [];
    const n = st.who.length, out: (Placed & { prop?: { x: number; z: number; yaw: number } })[] = [];
    const snap = st.street ?? (st.kind === 'group' || st.kind === 'guard' || st.kind === 'work');
    const sp = snap ? T.spot(c.x, c.z) : null;
    const faceTo = (fx: number, fz: number, x: number, z: number) => Math.atan2(fx - x, fz - z);
    if (st.kind === 'guard' && sp) {
      // On the street through the gate, a few metres inside, either side, facing the gate.
      const L = T.streets[sp.st].L, s = sp.s < L / 2 ? Math.min(L, sp.s + 4) : Math.max(0, sp.s - 4);
      const p = T.pointAt(sp.st, s), half = Math.max(0.8, T.streets[sp.st].w / 2 - 0.55);
      const yaw = faceTo(c.x, c.z, p.x, p.z);
      st.who.forEach((_, i) => { const k = n === 1 ? 1 : i ? -1 : 1; out.push({ x: p.x - p.tz * half * k, z: p.z + p.tx * half * k, yaw, kind: 'post' }); });
      return out;
    }
    if (st.kind === 'work' && sp && sp.d < 30) {
      // At the door, at the street's edge, facing out; the work beside.
      const w = T.streets[sp.st].w, dx = c.x - sp.x, dz = c.z - sp.z, dl = Math.hypot(dx, dz) || 1;
      const inset = Math.min(dl, Math.max(0.3, w / 2 - 0.5));
      const bx = sp.x + (dx / dl) * inset, bz = sp.z + (dz / dl) * inset, yaw = Math.atan2(-dx, -dz);
      st.who.forEach((_, i) => {
        const a = (i - (n - 1) / 2) * 1.1;
        out.push({ x: bx + sp.tx * a, z: bz + sp.tz * a, yaw: yaw + (i ? 0.6 * Math.sign(a || 1) : 0), kind: n > 1 ? 'group' : 'post', gi: i });
      });
      if (st.prop) out[0].prop = { x: bx + sp.tx * (n * 0.6 + 0.6), z: bz + sp.tz * (n * 0.6 + 0.6), yaw };
      return out;
    }
    const x0 = sp && sp.d < 40 ? sp.x : c.x, z0 = sp && sp.d < 40 ? sp.z : c.z;
    if (st.kind === 'group' || (st.kind === 'work' && n > 1)) {
      const R = 0.55 + n * 0.08;
      st.who.forEach((_, i) => {
        const ang = (i / n) * Math.PI * 2 + (hash(st.id) % 100) * 0.01;
        out.push({ x: x0 + Math.sin(ang) * R, z: z0 + Math.cos(ang) * R, yaw: ang + Math.PI, kind: 'group', gi: i });
      });
      if (st.prop) out[0].prop = { x: x0 + 1.6, z: z0, yaw: 0 };
      return out;
    }
    // Kneeling or standing in a row, facing a place (or the way the bank faces).
    const f = st.face ? where(st.face) : null;
    st.who.forEach((_, i) => {
      const a = (i - (n - 1) / 2) * 1.4;
      const base = c.face ?? (f?.ok ? faceTo(f.x, f.z, x0, z0) : 0);
      const x = x0 + Math.cos(base) * a, z = z0 - Math.sin(base) * a;
      out.push({ x, z, yaw: f?.ok && c.face === undefined ? faceTo(f.x, f.z, x, z) : base, kind: 'post', pose: st.kind === 'kneel' ? 'kneel' : undefined });
    });
    if (st.prop) out[0].prop = { x: x0 - Math.sin(c.face ?? 0) * 0.9 + Math.cos(c.face ?? 0) * ((n + 1) * 0.7), z: z0 - Math.cos(c.face ?? 0) * 0.9 - Math.sin(c.face ?? 0) * ((n + 1) * 0.7), yaw: c.face ?? 0 };
    return out;
  };

  const timed = <R>(f: () => R) => {
    const t0 = performance.now();
    const r = f();
    const ms = performance.now() - t0;
    popDebug.made++; popDebug.makeMs += ms; popDebug.maxMakeMs = Math.max(popDebug.maxMakeMs, ms);
    if (!popDebug.firstAt) popDebug.firstAt = performance.now();
    return r;
  };
  const count = () => walkers.length + [...live.values()].reduce((n, l) => n + l.people.length, 0);

  function openStation(st: Station) {
    const spots = layout(st);
    const l: Live = { st, people: [], props: [] };
    live.set(st.id, l);
    if (!spots.length) return;
    spots.forEach((s, i) => queue.push(() => {
      if (live.get(st.id) !== l || l.people.length > i) return;
      const id = st.who[i];
      const { person, speed } = timed(() => makeOfGroup(scene, id, hash(st.id) + i * 7919, { name: st.names?.[i] }));
      T.add({ person, kind: s.kind, at: new THREE.Vector3(s.x, 0, s.z), yaw: s.yaw, pose: s.pose, speed, groupIndex: s.gi });
      l.people.push(person);
      if (s.prop && st.prop) {
        const pr = makeWorkProp(st.prop, hash(st.id));
        pr.position.set(s.prop.x, T.ground(s.prop.x, s.prop.z), s.prop.z);
        pr.rotation.y = s.prop.yaw;
        scene.add(pr);
        l.props.push(pr);
      }
    }));
  }
  function closeStation(id: string) {
    const l = live.get(id)!;
    for (const p of l.people) T.remove(p);
    for (const pr of l.props) { scene.remove(pr); pr.traverse((c) => (c as THREE.Mesh).geometry?.dispose()); }
    live.delete(id);
  }

  /** A walker on a street sample at a good distance, of a group from that quarter. */
  function spawnWalker(px: number, pz: number, camF: THREE.Vector3) {
    const cand = samples.filter((q) => { const d = Math.hypot(q.x - px, q.z - pz); return d > W_MIN && d < W_MAX; });
    if (!cand.length) return false;
    // Prefer places out of view (behind, or far): people should not appear before one's eyes.
    const r = mulberry(walkSeed++ * 104729 + 7);
    let s = cand[Math.floor(r() * cand.length)];
    for (let k = 0; k < 6; k++) {
      const q = cand[Math.floor(r() * cand.length)];
      const dx = q.x - px, dz = q.z - pz, d = Math.hypot(dx, dz), dot = (dx * camF.x + dz * camF.z) / d;
      if (dot < 0.3 || d > 70) { s = q; break; }
    }
    const d = districtAt(s.x, s.z), table = WALKERS[d] ?? WALKERS[''];
    if (!table.length) return false;
    const tot = table.reduce((a, [, w]) => a + w, 0);
    let x = r() * tot, gid = table[0][0];
    for (const [g, w] of table) { if ((x -= w) <= 0) { gid = g; break; } }
    const { person, speed } = timed(() => makeOfGroup(scene, gid, Math.floor(r() * 1e9)));
    T.add({ person, kind: 'walk', start: { st: s.st, s: s.s }, zone: zones.get(d) ?? null, speed });
    walkers.push({ p: person, d });
    return true;
  }

  return {
    attach(town) {
      T = town;
      // Street samples every ~8 m, and the streets of each quarter.
      samples = [];
      T.streets.forEach((st, i) => { for (let s = 2; s < st.L - 2; s += 8) { const p = T.pointAt(i, s); samples.push({ x: p.x, z: p.z, st: i, s }); } });
      popDebug.samples = samples.length;
      for (const d of data.districts) {
        const set = new Set<number>();
        T.streets.forEach((st, i) => { if (st.pts.some((p) => inPoly(p.x, p.y, d.poly as [number, number][]))) set.add(i); });
        zones.set(d.id, set.size >= 3 ? set : null);
      }
      centres = STATIONS.map((st) => ({ st, c: where(st.at, st.off) })).filter((q) => q.c.ok);
      const missing = STATIONS.filter((st) => !centres.some((q) => q.st === st)).map((st) => st.id);
      if (missing.length) console.warn('[pop] stations not placed:', missing.join(', '));
    },
    update(dt, player, camera) {
      const tu = performance.now();
      t += dt;
      const px = player.x, pz = player.z;
      // Stations: open the near ones (nearest first), close the far ones.
      const want = centres.map((q) => ({ ...q, d: Math.hypot(q.c.x - px, q.c.z - pz) })).sort((a, b) => a.d - b.d);
      for (const q of want) if (live.has(q.st.id) && q.d > OFF) closeStation(q.st.id);
      let budget = CAP - 3; // leave room for a few walkers
      for (const l of live.values()) budget -= l.st.who.length;
      for (const q of want) {
        if (q.d > ON || live.has(q.st.id)) continue;
        if (q.st.who.length > budget) break;
        budget -= q.st.who.length;
        openStation(q.st);
      }
      // Walkers: away beyond W_OFF, or when stations need the room.
      for (let i = walkers.length - 1; i >= 0; i--) {
        const p = walkers[i].p, d = Math.hypot(p.pos.x - px, p.pos.z - pz);
        if (d > W_OFF || (count() + queue.length > CAP && d > 30 && !p.visible)) { T.remove(p); walkers.splice(i, 1); }
      }
      // One person made at a time, a frame or two apart.
      cool -= dt;
      if (cool <= 0) {
        const job = queue.shift();
        if (job) { job(); cool = 0.08; }
        else if (count() < CAP && walkers.length < Math.max(4, CAP - 10)) {
          const f = camera.getWorldDirection(new THREE.Vector3());
          if (spawnWalker(px, pz, f)) cool = 0.15; else cool = 1;
        }
      }
      popDebug.stations = [...live.values()].reduce((n, l) => n + l.people.length, 0);
      popDebug.live = [...live.keys()];
      popDebug.player = [Math.round(px), Math.round(pz)];
      popDebug.updFrames++;
      popDebug.updMs += performance.now() - tu;
      popDebug.walkers = walkers.length;
    },
    dispose() {
      for (const id of [...live.keys()]) closeStation(id);
      for (const w of walkers) T.remove(w.p);
      walkers.length = 0;
    },
  };
}
