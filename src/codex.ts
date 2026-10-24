// The reading view: a codex opened full-screen, written in uncial on ruled,
// pricked parchment, with an Insular-style interlaced initial, rubrics in red
// lead, and the nomina sacra abbreviated under a bar as scribes wrote them.
// Every text is public domain and was in Italian monastic libraries by the
// 720s: the Vulgate, the Rule of Benedict, Gregory's Dialogues, Isidore,
// Boethius.

export interface Text {
  id: string; rubric: string; body: string;
  /** Greek texts are written in a Greek majuscule face. */
  greek?: boolean;
  /** A full-page figure on the second leaf. */
  figure?: 'ouroboros';
}

export const TEXTS: Text[] = [
  {
    id: 'iohannes',
    rubric: 'Incipit Evangelium secundum Iohannem',
    body: `In principio erat Verbum, et Verbum erat apud Deum, et Deus erat Verbum. Hoc erat in principio apud Deum. Omnia per ipsum facta sunt, et sine ipso factum est nihil quod factum est. In ipso vita erat, et vita erat lux hominum; et lux in tenebris lucet, et tenebrae eam non comprehenderunt.
Fuit homo missus a Deo, cui nomen erat Iohannes. Hic venit in testimonium, ut testimonium perhiberet de lumine, ut omnes crederent per illum. Non erat ille lux, sed ut testimonium perhiberet de lumine. Erat lux vera, quae inluminat omnem hominem venientem in mundum. In mundo erat, et mundus per ipsum factus est, et mundus eum non cognovit. In propria venit, et sui eum non receperunt. Quotquot autem receperunt eum, dedit eis potestatem filios Dei fieri, his qui credunt in nomine eius; qui non ex sanguinibus, neque ex voluntate carnis, neque ex voluntate viri, sed ex Deo nati sunt.
Et Verbum caro factum est, et habitavit in nobis; et vidimus gloriam eius, gloriam quasi unigeniti a Patre, plenum gratiae et veritatis.`,
  },
  {
    id: 'regula',
    rubric: 'Incipit prologus Regulae sancti Benedicti abbatis',
    body: `Ausculta, o fili, praecepta magistri, et inclina aurem cordis tui, et admonitionem pii patris libenter excipe et efficaciter comple, ut ad eum per oboedientiae laborem redeas, a quo per inoboedientiae desidiam recesseras. Ad te ergo nunc mihi sermo dirigitur, quisquis abrenuntians propriis voluntatibus, Domino Christo vero regi militaturus, oboedientiae fortissima atque praeclara arma sumis.
In primis, ut quidquid agendum inchoas bonum, ab eo perfici instantissima oratione deposcas, ut qui nos iam in filiorum dignatus est numero conputare non debet aliquando de malis actibus nostris contristari.
Otiositas inimica est animae; et ideo certis temporibus occupari debent fratres in labore manuum, certis iterum horis in lectione divina.
In quibus diebus quadragesimae accipiant omnes singulos codices de bibliotheca, quos per ordinem ex integro legant; qui codices in caput quadragesimae dandi sunt.`,
  },
  {
    id: 'dialogi',
    rubric: 'Incipit liber secundus Dialogorum sancti Gregorii papae de vita sancti Benedicti',
    body: `Fuit vir vitae venerabilis, gratia Benedictus et nomine, ab ipso pueritiae suae tempore cor gerens senile. Aetatem quippe moribus transiens, nulli animum voluptati dedit, sed dum in hac terra adhuc esset, quo temporaliter libere uti potuisset, despexit iam quasi aridum mundum cum flore.
Qui liberiori genere ex provincia Nursiae exortus, Romae liberalibus litterarum studiis traditus fuerat. Sed cum in eis multos ire per abrupta vitiorum cerneret, eum quem quasi in ingressum mundi posuerat retraxit pedem, ne si quid de scientia eius adtingeret, ipse quoque postmodum in inmane praecipitium totus iret.`,
  },
  {
    id: 'psalterium',
    rubric: 'Incipit liber Psalmorum',
    body: `Dominus regit me, et nihil mihi deerit; in loco pascuae ibi me conlocavit. Super aquam refectionis educavit me, animam meam convertit. Deduxit me super semitas iustitiae, propter nomen suum. Nam et si ambulavero in medio umbrae mortis, non timebo mala, quoniam tu mecum es; virga tua et baculus tuus, ipsa me consolata sunt.
De profundis clamavi ad te, Domine; Domine, exaudi vocem meam. Fiant aures tuae intendentes in vocem deprecationis meae. Si iniquitates observaveris, Domine, Domine, quis sustinebit? Quia apud te propitiatio est, et propter legem tuam sustinui te, Domine. Sustinuit anima mea in verbo eius, speravit anima mea in Domino. A custodia matutina usque ad noctem speret Israhel in Domino. Quia apud Dominum misericordia, et copiosa apud eum redemptio; et ipse redimet Israhel ex omnibus iniquitatibus eius.`,
  },
  {
    id: 'apocalypsis',
    rubric: 'Incipit Apocalypsis Iohannis apostoli',
    body: `Et cum aperuisset sigillum quartum, audivi vocem quarti animalis dicentis: Veni et vide. Et ecce equus pallidus, et qui sedebat desuper, nomen illi Mors, et inferus sequebatur eum; et data est illi potestas super quattuor partes terrae, interficere gladio, fame, et morte, et bestiis terrae.
Et cum aperuisset quintum sigillum, vidi subtus altare animas interfectorum propter verbum Dei, et propter testimonium quod habebant. Et clamabant voce magna dicentes: Usquequo, Domine, sanctus et verus, non iudicas et vindicas sanguinem nostrum de his qui habitant in terra?`,
  },
  {
    id: 'isidorus',
    rubric: 'Incipit liber primus Etymologiarum Isidori episcopi de grammatica',
    body: `Litterae autem sunt indices rerum, signa verborum, quibus tanta vis est, ut nobis dicta absentium sine voce loquantur. Verba enim per oculos non per aures introducunt.
Usus litterarum repertus propter memoriam rerum. Nam ne oblivione fugiant, litteris alligantur. In tanta enim rerum varietate nec disci audiendo poterant omnia, nec memoria contineri.`,
  },
  {
    id: 'boethius',
    rubric: 'Incipit liber Boetii de consolatione philosophiae',
    body: `Carmina qui quondam studio florente peregi, flebilis heu maestos cogor inire modos. Ecce mihi lacerae dictant scribenda Camenae et veris elegi fletibus ora rigant.
Haec dum mecum tacitus ipse reputarem querimoniamque lacrimabilem stili officio signarem, adstitisse mihi supra verticem visa est mulier reverendi admodum vultus, oculis ardentibus et ultra communem hominum valentiam perspicacibus.`,
  },
  // --- the hidden cabinet: Graeco-Egyptian alchemy, come up from Byzantine Italy.
  {
    id: 'chrysopoeia',
    greek: true,
    figure: 'ouroboros',
    rubric: 'ΧΡΥΣΟΠΟΙΙΑ ΚΛΕΟΠΑΤΡΑΣ',
    body: `ΕΝ ΤΟ ΠΑΝ ΚΑΙ ΔΙ ΑΥΤΟΥ ΤΟ ΠΑΝ ΚΑΙ ΕΙΣ ΑΥΤΟ ΤΟ ΠΑΝ ΚΑΙ ΕΙ ΜΗ ΕΧΟΙ ΤΟ ΠΑΝ ΟΥΔΕΝ ΕΣΤΙ ΤΟ ΠΑΝ.
Ο ΟΦΙΣ Ο ΕΙΣ.
Unum est omne, et per ipsum omne, et in ipsum omne; et si omne non habeat, nihil est omne. Serpens unus.`,
  },
  {
    id: 'physika',
    greek: true,
    figure: 'ouroboros',
    rubric: 'ΔΗΜΟΚΡΙΤΟΥ ΦΥΣΙΚΑ ΚΑΙ ΜΥΣΤΙΚΑ',
    body: `Η ΦΥΣΙΣ ΤΗ ΦΥΣΕΙ ΤΕΡΠΕΤΑΙ ΚΑΙ Η ΦΥΣΙΣ ΤΗΝ ΦΥΣΙΝ ΝΙΚΑ ΚΑΙ Η ΦΥΣΙΣ ΤΗΝ ΦΥΣΙΝ ΚΡΑΤΕΙ.
Natura natura delectatur, et natura naturam vincit, et natura naturam continet.
ΕΝ ΤΟ ΠΑΝ.`,
  },
  {
    id: 'compositiones',
    rubric: 'Incipiunt compositiones ad tingenda musiva et pellis',
    // A short recipe in the manner of the Lucca collection (c. 800), not a transcription.
    body: `De auri petalo. Accipe aurum purum et tunde in petala tenuia, et pone inter pergamenam, et iterum tunde donec fiat tenuissimum.
De colore viridi. Accipe aes et pone in vas cum aceto acerrimo, et obline et pone in fimo per dies triginta; et invenies viride.
De cinnabari. Accipe argentum vivum et sulphur, et commisce in olla, et coque in igne lento donec rubeat.`,
  },
];

// Nomina sacra: written contracted under a bar.
const NOMINA: Record<string, string> = {
  deus: 'ds', dei: 'di', deo: 'do', deum: 'dm',
  dominus: 'dns', domini: 'dni', domino: 'dno', dominum: 'dnm', domine: 'dne',
  christus: 'xps', christi: 'xpi', christo: 'xpo', iesus: 'ihs',
  israhel: 'isrl', spiritus: 'sps', sanctus: 'scs', sancti: 'sci',
};

interface Tok { t: string; bar?: boolean; red?: boolean; big?: boolean }
interface Line { toks: Tok[]; indent: number }
interface Page { cols: Line[][]; initial?: string; rubric?: string; explicit?: boolean; figure?: boolean; font: string }

const LINES = 24;
const PAGE_ASPECT = 1.38; // height / width

const fontOf = (t: Text) => (t.greek ? '"Cardo", "Times New Roman", serif' : '"Uncial Antiqua", serif');

function tokenize(word: string): Tok {
  const bare = word.replace(/[.,;:?!]/g, '').toLowerCase();
  const tail = word.slice(bare.length).replace(/[^.,;:?!]/g, '');
  const ab = NOMINA[bare];
  if (ab) {
    const cap = word[0] === word[0].toUpperCase();
    return { t: (cap ? ab[0].toUpperCase() + ab.slice(1) : ab) + tail, bar: true };
  }
  return { t: word };
}

let measure: CanvasRenderingContext2D | null = null;
function m(): CanvasRenderingContext2D {
  if (!measure) measure = document.createElement('canvas').getContext('2d')!;
  return measure;
}

/** Page geometry in units of page width. */
function frame(cols: number) {
  const W = 1, H = PAGE_ASPECT;
  const top = 0.1 * H, bottom = 0.17 * H, inner = 0.1, outer = 0.16;
  const blockW = W - inner - outer, blockH = H - top - bottom;
  const gap = cols === 2 ? 0.05 : 0;
  const colW = (blockW - gap) / cols;
  const pitch = blockH / LINES;
  return { W, H, top, inner, outer, blockW, colW, gap, pitch, fs: pitch * 0.62 };
}

const layoutCache = new Map<string, Page[]>();
/** Paginate a text into pages of `cols` columns (layout is resolution independent). */
export function paginate(text: Text, cols: number): Page[] {
  const key = text.id + cols;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const f = frame(cols);
  const ctx = m();
  const S = 1000; // measure at 1000 px per page width
  const font = fontOf(text);
  ctx.font = `${f.fs * S}px ${font}`;
  const space = ctx.measureText(' ').width / S;
  const initLines = 5;
  const initW = f.pitch * initLines * 0.92;
  const pages: Page[] = [];
  let page: Page = { cols: Array.from({ length: cols }, () => []), rubric: text.rubric, initial: text.body[0], font };
  pages.push(page);
  let figureDone = !text.figure;
  let col = 0;
  // The rubric takes the first two lines of the first column.
  page.cols[0].push({ toks: [], indent: 0 }, { toks: [], indent: 0 });
  const paras = text.body.split('\n');
  const newLine = () => {
    if (page.cols[col].length >= LINES) {
      col++;
      if (col >= cols) {
        if (!figureDone) {
          pages.push({ cols: Array.from({ length: cols }, () => []), figure: true, font });
          figureDone = true;
        }
        page = { cols: Array.from({ length: cols }, () => []), font };
        pages.push(page);
        col = 0;
      }
    }
    const firstPage = pages.length === 1 && col === 0;
    const li = page.cols[col].length;
    const indent = firstPage && li >= 2 && li < 2 + initLines ? initW : 0;
    const line: Line = { toks: [], indent };
    page.cols[col].push(line);
    return line;
  };
  paras.forEach((para, pi) => {
    const words = para.trim().split(/\s+/);
    if (pi === 0) words[0] = words[0].slice(1); // the first letter is the initial
    let line = newLine();
    let w = 0;
    words.forEach((word, wi) => {
      if (!word) return;
      const tok = tokenize(word);
      if (pi > 0 && wi === 0) { tok.red = true; tok.big = true; }
      const tw = ctx.measureText(tok.t).width / S * (tok.big ? 1.25 : 1);
      if (w > 0 && w + space + tw > f.colW - line.indent) {
        line = newLine();
        w = 0;
      }
      line.toks.push(tok);
      w += (w > 0 ? space : 0) + tw;
    });
  });
  page.explicit = true;
  if (!figureDone) pages.push({ cols: Array.from({ length: cols }, () => []), figure: true, font });
  layoutCache.set(key, pages);
  return pages;
}

// --------------------------------------------------------------- drawing

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INK = '#3d2616', RED = '#a83a22', YELLOW = '#d9a93a', GREEN = '#4f7a4a';

function parchment(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, left: boolean) {
  const r = rng(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#eadbb6');
  g.addColorStop(1, '#e2cfa4');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Mottling and the faint yellow of the hair side.
  for (let i = 0; i < 70; i++) {
    const cx = x + r() * w, cy = y + r() * h, rad = (0.04 + r() * 0.2) * w;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const a = 0.03 + r() * 0.05;
    rg.addColorStop(0, r() < 0.5 ? `rgba(150,110,60,${a})` : `rgba(255,248,225,${a})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  ctx.fillStyle = 'rgba(90,60,30,0.18)';
  for (let i = 0; i < 400; i++) ctx.fillRect(x + r() * w, y + r() * h, w * 0.0025, w * 0.0025);
  // A tide-mark stain on some leaves.
  if (r() < 0.45) {
    const cx = x + (0.2 + r() * 0.6) * w, cy = y + (0.5 + r() * 0.45) * h, rad = (0.08 + r() * 0.12) * w;
    ctx.strokeStyle = 'rgba(120,80,40,0.16)';
    ctx.lineWidth = w * 0.006;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad, rad * (0.7 + r() * 0.4), r() * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(140,100,50,0.06)';
    ctx.fill();
  }
  // Thumbed lower outer corner, gutter shadow, worn edges.
  const ox = left ? x : x + w;
  const cg = ctx.createRadialGradient(ox, y + h, 0, ox, y + h, w * 0.35);
  cg.addColorStop(0, 'rgba(110,75,40,0.28)');
  cg.addColorStop(1, 'rgba(110,75,40,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(x, y, w, h);
  const gx = left ? x + w : x;
  const gg = ctx.createLinearGradient(gx, 0, gx + (left ? -w * 0.14 : w * 0.14), 0);
  gg.addColorStop(0, 'rgba(60,40,20,0.45)');
  gg.addColorStop(1, 'rgba(60,40,20,0)');
  ctx.fillStyle = gg;
  ctx.fillRect(x, y, w, h);
  const eg = ctx.createLinearGradient(0, y, 0, y + h);
  eg.addColorStop(0, 'rgba(100,70,35,0.18)');
  eg.addColorStop(0.06, 'rgba(100,70,35,0)');
  eg.addColorStop(0.94, 'rgba(100,70,35,0)');
  eg.addColorStop(1, 'rgba(100,70,35,0.22)');
  ctx.fillStyle = eg;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** A decorated initial: interlace in orpiment and verdigris, red-lead dots around it. */
function initial(letter: string, size: number, family = '"Uncial Antiqua", serif'): HTMLCanvasElement {
  const pad = size * 0.25;
  const S = Math.ceil(size + pad * 2);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const font = `${size}px ${family}`;
  const glyph = (c: HTMLCanvasElement, stroke = 0) => {
    const x = c.getContext('2d')!;
    x.font = font;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (stroke) { x.lineWidth = stroke; x.lineJoin = 'round'; x.strokeText(letter, S / 2, S / 2 + size * 0.06); }
    x.fillText(letter, S / 2, S / 2 + size * 0.06);
    return x;
  };
  const out = mk();
  const o = out.getContext('2d')!;
  // Fill: the letter body, then woven bands clipped to it.
  const body = mk();
  const b = glyph(body);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = '#2a1a10';
  b.fillRect(0, 0, S, S);
  b.globalCompositeOperation = 'source-atop';
  b.fillStyle = YELLOW;
  b.fillRect(0, 0, S, S);
  const bw = size * 0.07;
  for (let k = -6; k < 12; k++) {
    for (const dir of [1, -1]) {
      b.strokeStyle = '#1e140c';
      b.lineWidth = bw * 1.6;
      b.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const yy = t * S;
        const xx = k * bw * 3.2 + dir * yy * 0.6 + Math.sin(t * 14 + k) * bw * 0.9;
        if (t === 0) b.moveTo(xx, yy); else b.lineTo(xx, yy);
      }
      b.stroke();
      b.strokeStyle = (k + (dir > 0 ? 0 : 1)) % 2 ? GREEN : RED;
      b.lineWidth = bw * 0.8;
      b.stroke();
    }
  }
  // Red-lead dots following the outline at a distance.
  const outer = mk(), inner = mk();
  glyph(outer, size * 0.2);
  glyph(inner, size * 0.12);
  const od = outer.getContext('2d')!.getImageData(0, 0, S, S).data;
  const id = inner.getContext('2d')!.getImageData(0, 0, S, S).data;
  o.fillStyle = RED;
  const step = Math.max(3, Math.round(size * 0.055));
  for (let yy = 0; yy < S; yy += step) for (let xx = (yy / step) % 2 ? step / 2 : 0; xx < S; xx += step) {
    const k = (Math.floor(yy) * S + Math.floor(xx)) * 4 + 3;
    if (od[k] > 128 && id[k] < 20) {
      o.beginPath();
      o.arc(xx, yy, size * 0.018, 0, Math.PI * 2);
      o.fill();
    }
  }
  o.drawImage(body, 0, 0);
  // Ink outline.
  o.font = font;
  o.textAlign = 'center';
  o.textBaseline = 'middle';
  o.lineWidth = Math.max(1, size * 0.02);
  o.strokeStyle = '#1e140c';
  o.strokeText(letter, S / 2, S / 2 + size * 0.06);
  return out;
}

const initialCache = new Map<string, HTMLCanvasElement>();

/**
 * The serpent biting its tail, after the Chrysopoeia of Cleopatra: upper half
 * dark, lower half pale, ΕΝ ΤΟ ΠΑΝ written in its circle.
 */
function ouroboros(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed);
  const cx = x + w * 0.52, cy = y + h * 0.46, R0 = w * 0.3, bw = w * 0.07;
  ctx.save();
  ctx.lineCap = 'round';
  // Body: drawn as many short segments so it can taper and change colour.
  const a0 = Math.PI * 0.95, a1 = a0 + Math.PI * 2 * 0.93;
  const N = 140;
  for (let i = 0; i < N; i++) {
    const t = i / N, a = a0 + (a1 - a0) * t, an = a0 + (a1 - a0) * (i + 1.2) / N;
    const thick = bw * (0.35 + 0.65 * Math.min(1, (1 - t) * 3)) * (t < 0.05 ? 0.6 + t * 8 : 1);
    const upper = Math.sin(a) < 0; // canvas y down: sin < 0 is the upper half
    ctx.strokeStyle = upper ? '#2f4a2a' : '#c9a24a';
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
    ctx.lineTo(cx + Math.cos(an) * R0, cy + Math.sin(an) * R0);
    ctx.stroke();
  }
  // Scales and the ink outline.
  ctx.strokeStyle = 'rgba(30,20,12,0.85)';
  ctx.lineWidth = Math.max(1, w * 0.004);
  for (const off of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = a0 + (a1 - a0) * t;
      const thick = bw * (0.35 + 0.65 * Math.min(1, (1 - t) * 3)) * (t < 0.05 ? 0.6 + t * 8 : 1);
      const rr = R0 + off * thick / 2;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  for (let i = 4; i < N - 8; i += 3) {
    const a = a0 + (a1 - a0) * (i / N);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0, bw * 0.22, a + Math.PI * 0.2, a + Math.PI * 0.8);
    ctx.stroke();
  }
  // Head with open jaws taking the tail.
  const hx = cx + Math.cos(a0) * R0, hy = cy + Math.sin(a0) * R0;
  ctx.fillStyle = '#2f4a2a';
  ctx.beginPath();
  ctx.ellipse(hx - bw * 0.2, hy + bw * 0.2, bw * 0.95, bw * 0.62, a0 + Math.PI / 2 + 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a83a22';
  ctx.beginPath();
  ctx.arc(hx - bw * 0.45, hy + bw * 0.05, bw * 0.12, 0, Math.PI * 2);
  ctx.fill();
  // Inscription inside, and the long one beneath.
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = `${w * 0.075}px "Cardo", serif`;
  ctx.fillText('ΕΝ ΤΟ', cx, cy - w * 0.015);
  ctx.fillText('ΠΑΝ', cx, cy + w * 0.07);
  ctx.font = `${w * 0.036}px "Cardo", serif`;
  ctx.fillStyle = '#a83a22';
  ctx.fillText('Ο ΟΦΙΣ Ο ΕΙΣ', cx, cy + R0 + bw + w * 0.07);
  ctx.textAlign = 'left';
  // A little apparatus sketched in the margin: a cucurbit and its ambix.
  ctx.strokeStyle = 'rgba(61,38,22,0.8)';
  ctx.lineWidth = Math.max(1, w * 0.003);
  const ax = x + w * 0.2, ay = y + h * 0.82;
  ctx.beginPath();
  ctx.ellipse(ax, ay, w * 0.045, w * 0.055, 0, 0, Math.PI * 2);
  ctx.moveTo(ax - w * 0.02, ay - w * 0.05); ctx.lineTo(ax - w * 0.02, ay - w * 0.09);
  ctx.moveTo(ax + w * 0.02, ay - w * 0.05); ctx.lineTo(ax + w * 0.02, ay - w * 0.09);
  ctx.ellipse(ax, ay - w * 0.11, w * 0.035, w * 0.025, 0, 0, Math.PI * 2);
  ctx.moveTo(ax + w * 0.03, ay - w * 0.11); ctx.lineTo(ax + w * 0.12, ay - w * 0.06);
  ctx.stroke();
  void r;
  ctx.restore();
}

/** Draw one page (index `p` of `pages`) into the rectangle, written up to fraction `upto`. */
export function drawPage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, pages: Page[], p: number, cols: number, left: boolean, seed: number, upto = 1) {
  const f = frame(cols);
  const h = w * f.H;
  parchment(ctx, x, y, w, h, seed * 131 + p * 7, left);
  const page = pages[p];
  if (!page) return;
  if (page.figure) { ouroboros(ctx, x, y, w, h, seed + p); return; }
  const r = rng(seed * 977 + p);
  const inner = left ? f.outer : f.inner; // verso: outer margin on the left
  const bx = x + inner * w, by = y + f.top * w;
  // Prickings and drypoint ruling.
  ctx.save();
  ctx.strokeStyle = 'rgba(150,120,80,0.28)';
  ctx.lineWidth = Math.max(0.5, w * 0.0012);
  for (let i = 0; i <= LINES; i++) {
    const ly = by + i * f.pitch * w;
    ctx.beginPath(); ctx.moveTo(bx - w * 0.01, ly); ctx.lineTo(bx + f.blockW * w + w * 0.01, ly); ctx.stroke();
    ctx.fillStyle = 'rgba(70,45,25,0.5)';
    const px = left ? x + w * 0.035 : x + w * 0.965;
    ctx.fillRect(px, ly - w * 0.002, w * 0.004, w * 0.004);
  }
  for (let c = 0; c < cols; c++) {
    for (const e of [0, f.colW]) {
      const lx = bx + (c * (f.colW + f.gap) + e) * w;
      ctx.beginPath(); ctx.moveTo(lx, y + w * 0.05); ctx.lineTo(lx, y + h - w * 0.06); ctx.stroke();
    }
  }
  ctx.restore();
  // Text.
  const fs = f.fs * w;
  const total = page.cols.reduce((a, c) => a + c.length, 0);
  let drawn = 0;
  ctx.textBaseline = 'alphabetic';
  page.cols.forEach((lines, c) => {
    const cx = bx + c * (f.colW + f.gap) * w;
    lines.forEach((line, li) => {
      if (++drawn > total * upto) return;
      const ly = by + (li + 0.82) * f.pitch * w;
      let xx = cx + line.indent * w;
      ctx.globalAlpha = 0.8 + r() * 0.2;
      for (const tok of line.toks) {
        const size = tok.big ? fs * 1.25 : fs;
        ctx.font = `${size}px ${page.font}`;
        ctx.fillStyle = tok.red ? RED : INK;
        if (tok.red && tok.big) {
          ctx.fillStyle = r() < 0.5 ? RED : GREEN;
          ctx.fillText(tok.t[0], xx, ly);
          const w0 = ctx.measureText(tok.t[0]).width;
          ctx.font = `${fs}px ${page.font}`;
          ctx.fillStyle = INK;
          ctx.fillText(tok.t.slice(1), xx + w0, ly);
          xx += w0 + ctx.measureText(tok.t.slice(1) + ' ').width;
          continue;
        }
        ctx.fillText(tok.t, xx, ly);
        const tw = ctx.measureText(tok.t).width;
        if (tok.bar) {
          ctx.fillRect(xx + tw * 0.1, ly - fs * 0.92, tw * 0.8, Math.max(1, fs * 0.06));
        }
        xx += tw + ctx.measureText(' ').width;
      }
      ctx.globalAlpha = 1;
    });
  });
  // Rubric in red lead, and the great initial on the first page.
  if (page.rubric) {
    ctx.fillStyle = RED;
    ctx.font = `${fs * 0.95}px ${page.font}`;
    const words = page.rubric.toUpperCase().split(' ');
    let line = '', ly = by + 0.82 * f.pitch * w;
    for (const wd of words) {
      const t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width > f.colW * w && line) {
        ctx.fillText(line, bx, ly);
        line = wd;
        ly += f.pitch * w;
      } else line = t;
    }
    ctx.fillText(line, bx, ly);
  }
  if (page.initial) {
    const size = f.pitch * w * 5.2;
    const key = page.initial + Math.round(size);
    let img = initialCache.get(key + page.font);
    if (!img) { img = initial(page.initial, size, page.font); initialCache.set(key + page.font, img); }
    ctx.drawImage(img, bx - size * 0.32, by + f.pitch * w * 1.75 - size * 0.25);
  }
  if (page.explicit && upto >= 1) {
    ctx.fillStyle = RED;
    ctx.font = `${fs}px ${page.font}`;
    const lastCol = page.cols[page.cols.length - 1].length ? page.cols.length - 1 : 0;
    const ln = page.cols[lastCol].length;
    if (ln < LINES) ctx.fillText('EXPLICIT', bx + lastCol * (f.colW + f.gap) * w, by + (ln + 0.82) * f.pitch * w);
  }
}

export const pageAspect = PAGE_ASPECT;

/** Render an open spread (verso + recto) to a canvas, for the books lying open in the room. */
export function spreadTexture(text: Text, spread: number, seed: number, px = 1024, upto = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px / 2) * PAGE_ASPECT);
  const ctx = c.getContext('2d')!;
  const pages = paginate(text, 2);
  const w = px / 2;
  drawPage(ctx, 0, 0, w, pages, spread * 2, 2, true, seed);
  drawPage(ctx, w, 0, w, pages, spread * 2 + 1, 2, false, seed, upto);
  return c;
}

// --------------------------------------------------------------- overlay

let ui: { root: HTMLDivElement; canvas: HTMLCanvasElement; label: HTMLDivElement } | null = null;
let current: { text: Text; page: number; seed: number } | null = null;

export const isReading = () => current !== null;

function ensureFonts() {
  if (!document.querySelector('link[data-uncial]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Uncial+Antiqua&family=Cardo&display=swap';
    l.dataset.uncial = '1';
    document.head.appendChild(l);
  }
  return Promise.all([document.fonts.load('40px "Uncial Antiqua"'), document.fonts.load('40px "Cardo"', 'ΕΝ')]).catch(() => []);
}
export const fontsReady = () => ensureFonts();

function build() {
  const style = document.createElement('style');
  style.textContent = `
  #codex { position: fixed; inset: 0; z-index: 20; display: none; background: radial-gradient(ellipse at center, rgba(28,20,12,0.94), rgba(6,5,4,0.98));
    touch-action: none; user-select: none; -webkit-user-select: none; }
  #codex.open { display: block; }
  #codex canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
  #codex button { position: absolute; width: 48px; height: 48px; border-radius: 50%; border: 2px solid rgba(201,154,86,0.8);
    background: radial-gradient(circle at 38% 32%, rgba(70,50,26,0.9), rgba(16,11,6,0.9)); color: #e3c88e; font: 22px 'IM Fell English', Georgia, serif;
    cursor: pointer; display: grid; place-items: center; padding: 0; }
  #codex .close { top: max(14px, calc(env(safe-area-inset-top, 0px) + 10px)); right: max(14px, calc(env(safe-area-inset-right, 0px) + 10px)); }
  #codex .prev { left: max(10px, env(safe-area-inset-left, 0px)); top: 50%; transform: translateY(-50%); }
  #codex .next { right: max(10px, env(safe-area-inset-right, 0px)); top: 50%; transform: translateY(-50%); }
  #codex .label { position: absolute; bottom: max(14px, calc(env(safe-area-inset-bottom, 0px) + 8px)); width: 100%; text-align: center;
    color: #cdb688; font: italic 15px 'IM Fell English', Georgia, serif; opacity: 0.8; pointer-events: none; }
  #codex button:focus-visible { outline: 2px solid #e8c88a; outline-offset: 3px; }`;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'codex';
  const canvas = document.createElement('canvas');
  const close = document.createElement('button');
  close.className = 'close'; close.textContent = '✕'; close.setAttribute('aria-label', 'Close the book');
  const prev = document.createElement('button');
  prev.className = 'prev'; prev.textContent = '‹'; prev.setAttribute('aria-label', 'Previous leaf');
  const next = document.createElement('button');
  next.className = 'next'; next.textContent = '›'; next.setAttribute('aria-label', 'Next leaf');
  const label = document.createElement('div');
  label.className = 'label';
  root.append(canvas, close, prev, next, label);
  document.body.appendChild(root);
  close.addEventListener('click', closeCodex);
  prev.addEventListener('click', () => turn(-1));
  next.addEventListener('click', () => turn(1));
  let sx = 0, sy = 0, down = false;
  canvas.addEventListener('pointerdown', (e) => { down = true; sx = e.clientX; sy = e.clientY; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    down = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) turn(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      if (e.clientX < innerWidth * 0.3) turn(-1);
      else if (e.clientX > innerWidth * 0.7) turn(1);
    }
  });
  // While reading, the keys belong to the book, not to the walker.
  window.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') turn(1);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') turn(-1);
    else if (e.code === 'Escape' || e.code === 'KeyE') closeCodex();
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
  addEventListener('resize', () => { if (current) render(); });
  ui = { root, canvas, label };
}

const twoUp = () => innerWidth > innerHeight * 1.05;
const colsFor = (pageCssW: number) => (pageCssW > 400 ? 2 : 1);

function geometry() {
  const two = twoUp();
  const availW = innerWidth - 120, availH = innerHeight - 90;
  const pw = Math.min(two ? availW / 2 : innerWidth - 24, availH / PAGE_ASPECT);
  return { two, pw, cols: colsFor(pw) };
}

function toRoman(n: number) {
  const t: [number, string][] = [[50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}

function render() {
  if (!ui || !current) return;
  const { two, pw, cols } = geometry();
  const dpr = Math.min(devicePixelRatio, 2);
  const c = ui.canvas;
  c.width = Math.round(innerWidth * dpr);
  c.height = Math.round(innerHeight * dpr);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const pages = paginate(current.text, cols);
  current.page = Math.max(0, Math.min(current.page, pages.length - 1));
  const ph = pw * PAGE_ASPECT;
  const y = (innerHeight - ph) / 2 - 8;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 30;
  if (two) {
    const first = current.page - (current.page % 2);
    const x = innerWidth / 2 - pw;
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(x - 10, y - 8, pw * 2 + 20, ph + 16); // the boards beneath
    ctx.shadowBlur = 0;
    drawPage(ctx, x, y, pw, pages, first, cols, true, current.seed);
    drawPage(ctx, x + pw, y, pw, pages, first + 1, cols, false, current.seed);
    ui.label.textContent = `${current.text.rubric.replace(/^Incipit /, '')} · f. ${toRoman(Math.floor(first / 2) + 1)}v–${toRoman(Math.floor(first / 2) + 2)}r`;
  } else {
    const x = (innerWidth - pw) / 2;
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(x - 8, y - 8, pw + 16, ph + 16);
    ctx.shadowBlur = 0;
    const left = current.page % 2 === 1;
    drawPage(ctx, x, y, pw, pages, current.page, cols, left, current.seed);
    ui.label.textContent = `f. ${toRoman(Math.floor((current.page + 1) / 2) + 1)}${left ? 'v' : 'r'} · ${pages.length > 1 ? 'swipe to turn' : ''}`;
  }
}

function turn(d: number) {
  if (!current) return;
  const { two, cols } = geometry();
  const n = paginate(current.text, cols).length;
  const step = two ? 2 : 1;
  const nextPage = current.page - (two ? current.page % 2 : 0) + d * step;
  if (nextPage < 0 || nextPage >= n) return;
  current.page = nextPage;
  render();
}

export async function openCodex(text: Text, page = 0, seed = 1) {
  if (!ui) build();
  await ensureFonts();
  current = { text, page, seed };
  layoutCache.clear(); // fonts may have arrived since a fallback layout
  ui!.root.classList.add('open');
  if (document.pointerLockElement) document.exitPointerLock();
  render();
}

export function closeCodex() {
  current = null;
  ui?.root.classList.remove('open');
}
