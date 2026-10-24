// What the townsfolk say. Monks speak Church Latin; laymen the Latin of the
// Lombard charters, half-way to Italian, salted with Lombard law words
// (fara, gahagium, mundoald, guidrigild, arimannus, gastaldius). Each line
// has an English gloss. Some lines point at the library's hidden press and
// at the crypt outside the north postern.

export interface Line { la: string; en: string; bless?: boolean }
export type Speaker = 'monk' | 'peasant' | 'woman' | 'soldier';

export const NAMES: Record<Speaker, string[]> = {
  monk: ['Frater Ambrosius', 'Frater Anselmus', 'Frater Petronax', 'Frater Theodorus', 'Frater Benedictus', 'Frater Ursus'],
  peasant: ['Rodoald', 'Gisulf', 'Aldo', 'Lupo', 'Teuderad', 'Agipert', 'Ursus', 'Fridolin'],
  woman: ['Gaila', 'Ansa', 'Rotruda', 'Teudelinda', 'Gundiperga', 'Wallia', 'Adalberga', 'Ratperga'],
  soldier: ['Ratchis', 'Aistulf', 'Hildeprand', 'Arichis', 'Audoald', 'Romuald', 'Grimoald'],
};
export const TITLE: Record<Speaker, string> = { monk: 'monachus', peasant: 'rusticus', woman: 'mulier', soldier: 'arimannus' };

export const LINES: Record<Speaker, Line[]> = {
  monk: [
    { la: 'Pax tecum, peregrine. Nebula haec quadraginta dies non recessit.', en: 'Peace be with you, pilgrim. This fog has not lifted in forty days.' },
    { la: 'Benedicat te omnipotens Deus, Pater, et Filius, et Spiritus Sanctus.', en: 'May almighty God bless you: Father, Son and Holy Spirit.', bless: true },
    { la: 'In bibliotheca armarium est quod non recte stat. Pavimentum ante illud abrasum est… sed abbati ne dixeris.', en: 'In the library there is a press that does not stand true. The floor before it is scraped… but do not tell the abbot I said so.' },
    { la: 'Extra posticum septentrionale, sub memoria martyris, fratres nostri dormiunt. Descende cum lucerna.', en: 'Outside the north postern, beneath the martyr’s shrine, our brothers sleep. Go down with a lantern.' },
    { la: 'Otiositas inimica est animae.', en: 'Idleness is the enemy of the soul. (Rule of St Benedict, 48)' },
    { la: 'Frater Theodorus libros Graecos describit. Dicit eos de auro faciendo loqui, et lucernam eius usque ad matutinum ardere.', en: 'Brother Theodore copies Greek books. He says they speak of making gold, and his lamp burns until Matins.' },
    { la: 'Signum ad vesperas mox pulsabitur. Festina; nox venit.', en: 'The bell will soon ring for Vespers. Hurry; night is coming.' },
    { la: 'Deo gratias. Panem habemus, et lucernam, et silentium.', en: 'Thanks be to God. We have bread, and a lantern, and silence.' },
    { la: 'Dominus custodiat introitum tuum et exitum tuum.', en: 'The Lord keep your going in and your coming out.', bless: true },
  ],
  peasant: [
    { la: 'Ave, domine. Ista nebula… porci mei in gahagio se perdunt.', en: 'Greetings, sir. This fog… my pigs get lost in the fenced wood.' },
    { la: 'Gastaldius iterum tertiam partem de vino volet. Unde dabo?', en: 'The gastald will want his third of the wine again. Where am I to find it?' },
    { la: 'Noli exire foras portam de nocte. In sepulcra antiqua lumina ambulant.', en: 'Don’t go out of the gate at night. Lights walk among the old tombs.' },
    { la: 'De fara Rodoaldi sum. Venimus cum rege Alboin, dicunt avii nostri.', en: 'I am of Rodoald’s fara. We came with King Alboin, so our grandfathers say.' },
    { la: 'Monachi cellarium plenum habent. Et aliquid aliud subtus ecclesia…', en: 'The monks have a full cellar. And something else under the church…' },
    { la: 'Ligna porto ad furnum. Sine ligna, nec panis.', en: 'I’m taking wood to the oven. No wood, no bread.' },
    { la: 'Thermas Romanorum? Ibi modo solo ranae lavant.', en: 'The Romans’ baths? Only frogs bathe there now.' },
    { la: 'Frater cum lucerna in bibliotheca intravit, et non exivit. Per fidem meam!', en: 'A brother with a lantern went into the library and never came out. On my faith!' },
  ],
  woman: [
    { la: 'Salve. Aqua de puteo hodie turbida est. Malum signum.', en: 'Greetings. The well water is cloudy today. A bad sign.' },
    { la: 'Filius meus in palatio gastaldio servit. Dicit ibi frigus esse etiam ad focum.', en: 'My son serves the gastald in the palace. He says it’s cold there even by the hearth.' },
    { la: 'Tota nocte lanam filo. Ad Pascha tunicas novas habebimus.', en: 'I spin wool all night. By Easter we’ll have new tunics.' },
    { la: 'Mundoaldus meus me Gisulfo dare vult. Gisulfus fetet.', en: 'My mundoald wants to give me to Gisulf. Gisulf stinks.' },
    { la: 'Iuxta posticum septentrionale cella antiqua est. Mater mea dicebat: sancti ibi sub terra.', en: 'By the north postern there’s an old cell. My mother used to say: saints under the earth there.' },
    { la: 'Deus te salvet. Et cave canes in vico.', en: 'God keep you. And mind the dogs in the lane.' },
    { la: 'Monachi in bibliotheca nocte susurrant. Et armarium moventur, audivi.', en: 'The monks whisper in the library at night. And the presses move, I’ve heard.' },
  ],
  soldier: [
    { la: 'Sta! Quis es tu? …Peregrinus. Bene, transi.', en: 'Halt! Who are you? …A pilgrim. Fine, go through.' },
    { la: 'Arimannus sum domni Liutprandi regis. Lanceam habeo et scutum, et caballum — quando non claudicat.', en: 'I am an arimannus of our lord King Liutprand. I have spear and shield, and a horse — when it isn’t lame.' },
    { la: 'Gastaldius dormit. Nemo in palatio intrat sine verbo eius.', en: 'The gastald is sleeping. No one enters the palace without his word.' },
    { la: 'Ad Ravennam ibimus contra Graecos, dicunt. Melius quam hic in nebula stare.', en: 'We’ll march on Ravenna against the Greeks, they say. Better than standing here in the fog.' },
    { la: 'Spatha ista fuit avi mei. Nomen eius tibi non dico.', en: 'This spatha was my grandfather’s. I won’t tell you its name.' },
    { la: 'Si furaveris, guidrigild conponis. Si non habes, manum perdis. Sic edictum Rothari.', en: 'If you steal, you pay the wergild. If you can’t, you lose a hand. So says Rothari’s edict.' },
    { la: 'Noctu porta clauditur. Si foris es, in sepulcra dormis.', en: 'At night the gate is shut. If you’re outside, you sleep among the tombs.' },
  ],
};
