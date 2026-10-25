// Things to read in Benevento, AD 700. Each says where it comes from:
// 'attested' = a real text, quoted; 'paraphrase' = a real source retold;
// 'style' = invented, in the formulas of the period; 'legend' = later
// tradition shown as tradition. The trail of the golden viper (VIPER_TRAIL)
// links five of them across the town. See docs/benevento/SECRETS.md.

export type LoreStatus = 'attested' | 'paraphrase' | 'style' | 'legend';
export interface Lore {
  id: string;
  /** Short title (shown on the button and the map). */
  title: string;
  /** The place it belongs to (for explorable houses). */
  place?: string;
  kind: 'inscription' | 'codex' | 'graffito' | 'charter' | 'label' | 'note' | 'relic';
  latin: string;
  greek?: boolean;
  english: string;
  source: string;
  status: LoreStatus;
  /** Readable from far off (monumental inscriptions), in metres. */
  range?: number;
  /** Part of the trail of the golden viper (step 1..5). */
  trail?: number;
}

const L: Lore[] = [
  // ------------------------------------------------------------ monuments
  {
    id: 'arcusInscriptio', title: 'The attic of the arch', kind: 'inscription', status: 'attested', range: 30,
    latin: 'IMP · CAESARI · DIVI · NERVAE · FILIO\nNERVAE · TRAIANO · OPTIMO · AVG\nGERMANICO · DACICO · PONTIF · MAX · TRIBVNIC\nPOTEST · XVIII · IMP · VII · COS · VI · P · P\nFORTISSIMO · PRINCIPI · SENATVS · P · Q · R',
    english: 'To the Emperor Caesar Nerva Trajan, son of the deified Nerva, Best, Augustus, conqueror of the Germans and the Dacians, high priest, in the eighteenth year of his tribunician power, seven times acclaimed imperator, six times consul, father of his country, the bravest of princes: the Senate and People of Rome (AD 114). Six centuries on, the arch is the Golden Gate of a Lombard duke.',
    source: 'CIL IX 1558, the attic inscription of the Arch of Trajan, Benevento.',
  },
  {
    id: 'sesualdus', title: 'A head scratched on the pier', kind: 'graffito', status: 'paraphrase',
    latin: 'SESVALDVS',
    english: 'Someone has scratched a bearded head and a name into the marble. Old men tell why: in the siege of 663 the emperor Constans caught Sesuald, tutor of the young duke Romuald, and bade him tell the town that no help was coming. Under the walls Sesuald shouted that King Grimoald was near. The emperor had his head cut off and hurled into the town from a siege engine; Romuald kissed it, and had it buried.',
    source: 'After Paul the Deacon, Historia Langobardorum V 7-8 (late 8th c.).',
  },
  {
    id: 'sacramentum', title: 'Clamp holes', kind: 'note', status: 'style',
    latin: 'Hic marmora fuerunt.',
    english: '"There was marble here." The arch at the old forum has been stripped to its brick: the cladding went into lime and into the bishop\'s church. The arch is now a gate of the walls raised about the year 600, which leave the theatre and the baths outside.',
    source: 'Gate use and the circuit: Bertelli Buquicchio, EAM (1992); Rotili (2004).',
  },
  {
    id: 'theatrum', title: 'A name on the stage wall', kind: 'graffito', status: 'style',
    latin: 'HIC HABITAT IOHANNES CVM FILIIS · NOLI FVRARI',
    english: '"John lives here with his sons. Do not steal." Families live in the arches of Hadrian\'s theatre, outside the walls since the year 600; the reuse of the theatre for houses is certain from the archaeology.',
    source: 'Reuse: Rotili, Benevento romana e longobarda (1986). Text invented.',
  },
  {
    id: 'calcaria', title: "The lime-burner's tally", kind: 'note', status: 'style',
    latin: 'III carra marmoris · II statuae · I titulus · in calcem',
    english: '"Three cartloads of marble, two statues, one inscribed stone: for lime." The amphitheatre, abandoned, is a quarry. Its blocks are in the footings of the town walls, and what is not good for building burns in the kiln. The place will be called the Gate of the Lime-Kilns, Porta delle Calcare.',
    source: 'Spoil in the walls: Bertelli Buquicchio (1992). Toponym: Meomartini (1889).',
  },
  {
    id: 'catena', title: 'The watch roll', kind: 'note', status: 'style',
    latin: 'Vigiliae: Ratchis · Aldo · Gaido · Theodo · Ursus',
    english: 'Names of the men who keep the tower this week, Lombard and Roman mixed. The tower was raised in the 7th century to watch the theatre, the amphitheatre and the Appia coming up from the Ponte Leproso.',
    source: 'Tower: Bertelli Buquicchio (1992). Names invented.',
  },
  {
    id: 'hilarius', title: 'The altar of St Hilary', kind: 'inscription', status: 'style',
    latin: '+ IN HONOREM SCI HILARII · QVI LEGERIT ORET PRO ME PECCATORE',
    english: '"In honour of St Hilary. Whoever reads this, pray for me, a sinner." The little church with two domes in a row is new; its walls are built just like the town\'s walls of the last century.',
    source: 'Dating by masonry to the late 7th/early 8th c.: Bertelli Buquicchio (1992). Text invented.',
  },
  {
    id: 'obeliscus', title: 'Signs of Egypt', kind: 'inscription', status: 'paraphrase', range: 6,
    latin: '[ an owl · a reed · the throne-sign of Isis · a seated woman · a coiled serpent · a falcon on a standard · … ]',
    english: 'No one in Beneventum can read these signs. Scholars twelve centuries later will: the obelisk was set up for Isis, the Great, Lady of Beneventum, by one Lucilius Rufus, for the health and safe return of the emperor Domitian. Its broken brothers lie in the mud of the goddess\'s temple.',
    source: 'Obelisks of the Iseum of Benevento (AD 88); reading after A. Erman (1893).',
  },
  {
    id: 'apis', title: 'The bull with the sun between its horns', kind: 'note', status: 'attested',
    latin: 'APIS',
    english: 'A granite bull, couchant, sunk to its belly: Apis, the living image of the god Ptah, brought here with the cult of Isis. People call it the cow and touch its nose for luck.',
    source: 'The Apis of Benevento survives (now on Viale San Lorenzo); its place here is reconstruction.',
  },
  {
    id: 'isisVipera', title: 'The serpent-crowned Lady', kind: 'inscription', status: 'attested', trail: 3,
    latin: 'TE TIBI · VNA QVAE ES OMNIA · DEA ISIS',
    english: '"To you, goddess Isis, who being one are all things." On the relief the goddess wears a serpent at her brow, the uraeus. Scratched below, newer: "the gold one sleeps under the dukes\' apples."',
    source: 'Formula of a dedication from Capua (CIL X 3800), standing in for the lost texts of the Iseum. The scratched line is fiction.',
  },
  {
    id: 'perticae', title: 'Why the poles', kind: 'note', status: 'attested',
    latin: 'Si quis enim aliquando Langobardorum in aliqua parte aut bello aut quolibet modo extinctus fuisset, consanguinei eius intra sepulchra sua perticam figebant, in cuius summitate columbam ex ligno factam ponebant, quae illuc versa esset, ubi illorum dilectus obisset.',
    english: '"If ever a Lombard had been killed somewhere, in war or in any other way, his kinsmen set up a pole among their tombs, with a dove made of wood on its top, turned towards the place where their loved one had died."',
    source: 'Paul the Deacon, Historia Langobardorum V 34 (of the perticae at Pavia).',
  },
  {
    id: 'nux', title: 'The stump by the Sabato', kind: 'note', status: 'legend', trail: 1,
    latin: 'arbor quam votivam nuncupabant',
    english: 'Here stood the tree the Lombards called holy. They hung a hide in it, and riding away from it at full gallop threw their spears backwards at it; each ate a scrap of the hide. Bishop Barbatus had it cut down, roots and all, when the emperor\'s siege was lifted. They also had a viper of gold, which they worshipped. Where did it go? Ask an old man of the duke\'s people.',
    source: 'After the Vita Barbati (9th c.). The later "witches\' walnut" of Benevento grows from this story.',
  },
  {
    id: 'molendinum', title: "The miller's breve", kind: 'charter', status: 'style',
    latin: 'Breve de molino in fluvio Sabbato: reddit per annum modia XL de grano.',
    english: '"Note of the mill on the river Sabato: it renders forty measures of grain a year." Mills and baths on the rivers by the roads are in the charters of Benevento from the early 8th century.',
    source: 'Cf. the gift to S. Sofia a Ponticello under Romuald II (Bertelli Buquicchio 1992). Text invented.',
  },
  {
    id: 'genius', title: 'An old dedication', kind: 'inscription', status: 'style', range: 4,
    latin: 'GENIO · COLONIAE · BENEVENTANAE · SACRVM',
    english: '"Sacred to the Genius of the colony of Beneventum." The base has lost its statue; market women set their baskets on it.',
    source: 'Illustrative, on the pattern of Roman dedications.',
  },
  {
    id: 'cisterna', title: 'The serpent hollow', kind: 'note', status: 'legend', trail: 4,
    latin: 'Hic latuit.',
    english: '"Here it was hidden." In the plaster of the niche there is the print of a coiled snake, a hand long, and nothing in it. Romuald\'s wife Theuderada was a Christian; while the duke was away she gave the golden viper to the bishop. What did Barbatus make of it? Look at his altar.',
    source: 'Legend after the Vita Barbati. The cistern under the future S. Sofia is invented.',
  },
  {
    id: 'calix', title: 'The chalice of Barbatus', kind: 'relic', status: 'legend', trail: 5,
    latin: 'De vipera aurea calicem et patenam fecit.',
    english: '"Of the golden viper he made a chalice and a paten." The cup on the altar is plain gold, heavy, and a little crooked. The trail ends here: an idol turned into the vessel of the mass, the old faith of the Lombards melted down as their dukes became Catholic.',
    source: 'Vita Barbati (9th c.): legend. The first cathedral of S. Maria was consecrated on 15 December 600.',
  },
  // ------------------------------------------------------------ houses
  {
    id: 'domusAudoini', place: 'Domus Audoini', title: 'An old soldier\'s keepsake', kind: 'note', status: 'style', trail: 2,
    latin: 'Viperam auream adoravimus. Nunc dormit ubi domina Aegyptiorum in luto iacet.',
    english: '"We worshipped the golden viper. Now it sleeps where the Lady of the Egyptians lies in the mud." Scratched on a board under the bed of Audoin, who rode with Romuald against the emperor.',
    source: 'Fiction built on the Vita Barbati.',
  },
  {
    id: 'fabricaAurea', place: 'Fabrica', title: 'Marks on the forge', kind: 'graffito', status: 'style',
    latin: 'GAIDVALD FECIT',
    english: '"Gaidwald made (this)." A smith\'s name over tallies of spearheads and horseshoes for the duke\'s men.',
    source: 'Invented.',
  },
  {
    id: 'hospitiumSummae', place: 'Hospitium', title: 'Verses on the inn wall', kind: 'graffito', status: 'attested',
    latin: 'TENDIMVS HINC RECTA BENEVENTVM VBI SEDVLVS HOSPES\nPAENE MACROS ARSIT DVM TVRDOS VERSAT IN IGNI',
    english: '"From there we go straight to Beneventum, where our busy host nearly burned down (his house) while turning lean thrushes over the fire." Some lettered guest has written Horace on the wall of the inn, seven hundred years on.',
    source: 'Horace, Satires I 5, 71-72.',
  },
  {
    id: 'domusNotarii', place: 'Domus Notarii', title: 'A deed of sale', kind: 'charter', status: 'style',
    latin: 'In nomine Domini. Temporibus domni nostri Gisulfi summi ducis gentis Langobardorum, anno ducatus eius duodecimo, mense Martio, indictione tertiadecima. Ego Ursus filius quondam Iohanni vindedi tibi Lupo casam meam solariatam infra civitatem Beneventanam ...',
    english: '"In the name of the Lord. In the time of our lord Gisulf, highest duke of the people of the Lombards, in the twelfth year of his dukedom, in March, in the thirteenth indiction. I, Ursus, son of the late John, have sold to you, Lupus, my house with an upper storey within the city of Benevento ..."',
    source: 'In the formulas of Beneventan charters; Gisulf I ruled 689-706.',
  },
  {
    id: 'horreumCurtis', place: 'Horreum', title: 'The tally sticks', kind: 'note', status: 'style',
    latin: 'De curte Ducis: modia CCC frumenti, C ordei, LX fabae.',
    english: '"For the duke\'s court: three hundred measures of wheat, a hundred of barley, sixty of beans." Notched sticks hang by the door, one for each farm that owes.',
    source: 'Invented.',
  },
  {
    id: 'aurifices', place: 'Aurifices', title: 'A gold coin of Benevento', kind: 'label', status: 'paraphrase',
    latin: 'D N IVSTINIANVS P P AVG',
    english: 'On the bench, a small gold tremissis struck in Benevento: it copies the coin of the emperor in Constantinople, name and all, but it is the duke\'s gold. Beside it, a cross of gold foil for a grave, stamped with interlace.',
    source: 'Beneventan imitative gold coinage of the later 7th-8th c.; gold-foil crosses from Lombard graves. Details of this piece illustrative.',
  },
  {
    id: 'figulina', place: 'Figulina', title: 'A brick with a stamp', kind: 'inscription', status: 'style',
    latin: 'EX · FIGLINIS · CAESARIS · N',
    english: '"From the brickworks of our Caesar." Old bricks are dug from the ruins and used again; the potter keeps the best-stamped one on a shelf.',
    source: 'Roman brick stamps; this one illustrative.',
  },
  {
    id: 'textrinum', place: 'Textrinum', title: 'A spindle whorl', kind: 'label', status: 'style',
    latin: 'GISA',
    english: 'A woman\'s name cut in a bone spindle whorl: Gisa. Wool and linen are spun and woven in nearly every house; the loom stands by the light of the door.',
    source: 'Invented.',
  },
  {
    id: 'domusGraeca', place: 'Domus Graeca', title: 'A small icon', kind: 'inscription', status: 'attested', greek: true,
    latin: 'ΚΥΡΙΕ ΒΟΗΘΕΙ ΤΩ ΔΟΥΛΩ ΣΟΥ',
    english: '"Lord, help your servant." A painted wooden panel of the Mother of God, from the East. A Greek merchant on the road to Apulia keeps a room here.',
    source: 'Standard Byzantine invocation. Eastern communities in Benevento are attested only later (churches "de Grecis").',
  },
  {
    id: 'cellaVinaria', place: 'Cella Vinaria', title: 'Chalk on the trapdoor', kind: 'graffito', status: 'style',
    latin: 'SVB POMIS DVCIS AQVA ANTIQVA',
    english: '"Under the duke\'s apple trees, old water." The cellar runs into a Roman drain. Someone has marked where it leads.',
    source: 'Fiction.',
  },
  {
    id: 'medicus', place: 'Medicus', title: 'A page of Isidore', kind: 'codex', status: 'attested',
    latin: 'Medicina est quae corporis vel tuetur vel restaurat salutem: cuius materia versatur in morbis et vulneribus.',
    english: '"Medicine is what protects or restores the health of the body; its matter is diseases and wounds." The physician\'s few leaves of the Etymologies, copied in Italy.',
    source: 'Isidore of Seville, Etymologiae IV 1, 1 (c. 630).',
  },
  {
    id: 'pistrinum', place: 'Pistrinum', title: 'The baker\'s marks', kind: 'note', status: 'style',
    latin: 'XII panes pro ecclesia · VI pro pauperibus',
    english: '"Twelve loaves for the church, six for the poor."',
    source: 'Invented.',
  },
  {
    id: 'oratoriumDomus', place: 'Oratorium', title: 'A relic label', kind: 'relic', status: 'style',
    latin: '+ DE PVLVERE SEPVLCRI SCI BARBATI EPISCOPI',
    english: '"Of the dust of the tomb of St Barbatus, bishop." Barbatus died in 682; his household-saint\'s cult is just beginning.',
    source: 'Barbatus, bishop 663-682. Label invented.',
  },
  {
    id: 'domusSculdahis', place: 'Domus Sculdahis', title: 'A law of King Rothari', kind: 'codex', status: 'attested',
    latin: 'Nullus praesumat haldiam alienam aut ancillam quasi strigam, quae dicitur masca, occidere; quod christianis mentibus nullatenus est credendum, nec possibilem est, ut mulier hominem vivum intrinsecus possit comedere.',
    english: '"Let no one presume to kill another man\'s half-free woman or slave woman as a witch, which is called masca: for it is in no way to be believed by Christian minds, nor is it possible, that a woman can eat a living man from within." The local judge keeps the Edict of 643.',
    source: 'Edictum Rothari 376 (643).',
  },
  {
    id: 'domusVidua', place: 'Domus Viduae', title: 'A psalm line', kind: 'codex', status: 'attested',
    latin: 'Dominus custodit advenas, pupillum et viduam suscipiet.',
    english: '"The Lord keeps the strangers; he will uphold the fatherless and the widow." Written on a scrap and pinned over the door.',
    source: 'Psalm 145 (146), 9, Vulgate (Gallican psalter).',
  },
  {
    id: 'domusFabri', place: 'Domus Fabri', title: 'A pilgrim\'s scratch', kind: 'graffito', status: 'style',
    latin: '+ EGO LEO FUI AD SCM MICHAELEM',
    english: '"I, Leo, was at St Michael\'s." The joiner has been to the cave of the archangel on Monte Gargano, the great shrine of the Lombards of Benevento.',
    source: 'Lombard pilgrims\' graffiti at Monte Sant\'Angelo are real; this one is invented.',
  },
];

export const LORE: Record<string, Lore> = Object.fromEntries(L.map((l) => [l.id, l]));
/** Lore id for an explorable house (by its id). */
export const explorableLore = (id: string) => id;
export const VIPER_TRAIL = L.filter((l) => l.trail).sort((a, b) => a.trail! - b.trail!).map((l) => l.id);
