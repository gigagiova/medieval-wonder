import type { Line } from './lines';

// What the people of Beneventum say in AD 700, group by group (see
// docs/benevento/PEOPLE.md for who they are and the sources). Laymen speak
// the Latin of the charters, half-way to the vernacular, with Lombard law
// words (gasindius, aldius, guidrigild, mundium, morgincap, gahagium, fara,
// masca); Greeks speak Greek; a Jew greets in Hebrew. Each line has an
// English gloss.
//
// Facts are put in their mouths only where a source holds them (Paul the
// Deacon, the Edict of Rothari, coins, inscriptions). Legend is told as
// rumour ("they say", "my grandmother said"): the golden viper and the tree
// come from the 9th-century Vita Barbati, the witches of the walnut are much
// later. Lines marked "hint" lead along the viper trail (SECRETS.md).

export type GroupId =
  | 'gasindus' | 'gastaldius' | 'sculdahis' | 'arimannus' | 'langobarda' | 'senexLangobardus' | 'bulgarus'
  | 'aldius' | 'rustica' | 'servus' | 'mulier' | 'anus' | 'puer' | 'puella' | 'mendicus'
  | 'faber' | 'aurifex' | 'figulus' | 'pistor' | 'molendinarius' | 'calcarius' | 'lavandaria' | 'textrix'
  | 'negotiator' | 'notarius' | 'medicus'
  | 'presbyter' | 'diaconus' | 'monachus' | 'sanctimonialis' | 'peregrinus'
  | 'graecus' | 'graeca' | 'iudaeus' | 'afer';

export const PEOPLE_LINES: Record<GroupId, Line[]> = {
  // ------------------------------------------------------------ the duke's people
  gasindus: [
    { la: 'Gasindius sum domni Gisulfi ducis. Panem eius manduco, et pro eo equito.', en: 'I am a gasindius of our lord Duke Gisulf. I eat his bread, and I ride for him.' },
    { la: 'Vide cingulum meum: viginti laminae, omnes de auro et aere. Pater meus de praeda Graecorum habuit.', en: 'Look at my belt: twenty plates, all gold and bronze. My father had it from the plunder of the Greeks.' },
    { la: 'Romani de Campania muros suos reficiunt. Bene faciunt — dux noster iuvenis est, et pugnare amat.', en: 'The Romans of Campania are mending their walls. They are wise — our duke is young, and he loves a fight.' },
    { la: 'Paldo et Tato et Taso, filii nobilium, dicunt se ad fontes Vulturni ituros, ut monachi fiant. Insani!', en: 'Paldo, Tato and Taso, noblemen’s sons, say they will go to the springs of the Volturno and become monks. Madmen!' },
    { la: 'Audivisti? Rex Cunincpert in Ticino infirmatur. Si moritur, Langobardi de regno rixabunt, et nos hic in pace erimus.', en: 'Have you heard? King Cunincpert lies sick at Pavia. If he dies, the Lombards up there will quarrel over the kingdom, and we down here will be left in peace.' },
    { la: 'Capillos sicut avi nostri: cervix rasa, coma per frontem divisa. Iuvenes modo sicut Romani se tondent.', en: 'I wear my hair like our grandfathers: neck shaved, the long hair parted on the brow. The young men cut theirs like Romans now.' },
  ],
  gastaldius: [
    { la: 'Gastaldius sum curtis ducalis. Omnis modius qui in horreum intrat, ego numero.', en: 'I am the gastald of the duke’s curtis. Every measure of grain that goes into the granary, I count.' },
    { la: 'Aldii de Cerreto tertiam partem vini non dederunt. Cras sculdahis eos videbit.', en: 'The aldii of Cerreto have not given their third of the wine. Tomorrow the sculdahis will see them.' },
    { la: 'Tremissis aureus, tertia pars solidi. In moneta ducis nomen imperatoris scribitur — sic semper fuit.', en: 'A gold tremissis is a third of a solidus. The duke’s mint still writes the emperor’s name on it — it was ever so.' },
    { la: 'Virgam istam a duce accepi. Qui eam contemnit, ducem contemnit.', en: 'This rod I had from the duke. Whoever scorns it scorns the duke.' },
    { la: 'Nebula ascendit de Sabato et Calore et sedet super civitatem. Mane nemo videt portam suam.', en: 'The fog rises from the Sabato and the Calore and sits on the town. In the morning no one can see his own door.' },
  ],
  sculdahis: [
    { la: 'Sculdahis sum huius loci. Lites de terminis et de porcis iudico, secundum edictum.', en: 'I am the sculdahis of this district. I judge quarrels over boundaries and pigs, according to the Edict.' },
    { la: 'Edictum Rothari regis dicit: nemo mulierem quasi mascam occidat. Christianae menti credibile non est hominem vivum a muliere comedi.', en: 'King Rothari’s Edict says: let no one kill a woman as if she were a masca, a witch. It is not believable to a Christian mind that a woman could eat a living man.', },
    { la: 'Pro aldio occiso sexaginta solidi conponuntur; pro servo ministeriali docto quinquaginta. Sic scriptum est.', en: 'For a slain aldius, sixty solidi are paid; for a trained household slave, fifty. So it is written.' },
    { la: 'Qui puellam sine voluntate mundoaldi sui uxorem tollit, mundium solvat et conponat. Lex non dormit.', en: 'Whoever takes a girl to wife without her guardian’s consent pays her mundium and a fine besides. The law does not sleep.' },
    { la: 'Mulieres iuxta Sabatum de nocte cantant, dicunt rustici. Ego dico: rustici bibunt.', en: 'The peasants say women sing by the Sabato at night. I say: the peasants drink.' },
  ],
  arimannus: [
    { la: 'Sta! Quis es? …Peregrinus? Transi, sed in civitate cave furta.', en: 'Halt! Who are you? …A pilgrim? Go through, but mind your purse in the town.' },
    { la: 'Exercitalis sum ducis. Lanceam habeo et scutum et caballum; quando vocat, venio.', en: 'I am a soldier of the duke’s host. I have a spear, a shield and a horse; when he calls, I come.' },
    { la: 'Avus meus hanc portam custodivit quando Constans imperator civitatem obsedit. Caput Sesualdi intra muros proiecerunt.', en: 'My grandfather kept this gate when the emperor Constans besieged the town. They threw Sesuald’s head over the walls.' },
    { la: 'Si furaveris, in octogild reddis: novies quod tulisti. Sic edictum.', en: 'If you steal, you pay it back “in octogild”: nine times what you took. So says the Edict.' },
    { la: 'Noctu porta clauditur. Qui foris est, inter sepulcra dormit — et ibi lumina ambulant.', en: 'At night the gate is shut. Whoever is outside sleeps among the tombs — and lights walk there.' },
    { la: 'Sanctus Michahel in monte Gargano pro nobis pugnat. Ante proelium ei candelam ponimus.', en: 'Saint Michael on Mount Gargano fights for us. Before a battle we set a candle to him.' },
  ],
  langobarda: [
    { la: 'Fibula mea de matre mea fuit, et de matre eius. Granatum in medio sicut gutta sanguinis.', en: 'My brooch was my mother’s, and her mother’s. The garnet in the middle is like a drop of blood.' },
    { la: 'Morgincap meum maritus mihi dedit mane post nuptias. Sine eo, vidua mendicat.', en: 'My husband gave me my morning-gift the morning after the wedding. Without it, a widow begs.' },
    { la: 'Domna Theuderada, mater ducis, monasterium Sancti Petri foris muros fecit. Ancillae Dei ibi pro nobis orant.', en: 'The lady Theuderada, the duke’s mother, built the nunnery of St Peter outside the walls. The handmaids of God pray for us there.' },
    { la: 'Aviae nostrae columbas ligneas super perticas ponebant, pro viris qui in bello perierant. Vade ad sepulcra et vide.', en: 'Our grandmothers set wooden doves on poles for the men who died in war far away. Go to the graves and see.' },
    { la: 'Vipera aurea? Mater mea dicebat: domna Theuderada eam episcopo Barbato dedit, et ille calicem fecit. Sed hoc in secreto.', en: 'The golden viper? My mother used to say the lady Theuderada gave it to Bishop Barbatus, and he made a chalice of it. But that’s between us.' }, // hint 5
  ],
  senexLangobardus: [
    { la: 'Ego vidi arborem. Iuvenis eram; viri equitabant circa eam et corium pendens lanceis feriebant. Postea Barbatus eam succidit.', en: 'I saw the tree. I was young; men rode round it and struck the hanging hide with their spears. Afterwards Barbatus cut it down.' }, // legend, told as memory
    { la: 'Audoinus, socius meus de exercitu, aliquid de illis diebus in domo sua servavit. Domus eius prope curtem est. Ille iam non loquitur.', en: 'Audoin, my comrade from the host, kept something from those days in his house. His house is near the curtis. He speaks no more.' }, // hint 2
    { la: 'Tempore meo Langobardi linea vestimenta habebant, laxa, cum institis coloratis. Modo omnes in lana sicut Romani.', en: 'In my day Lombards wore loose linen clothes with broad coloured borders. Now everyone goes in wool like the Romans.' },
    { la: 'Calceos usque ad pollicem apertos portabam, corrigiis ligatos. Iuvenes nunc osas habent. Molles!', en: 'I wore shoes open to the big toe, laced with thongs. The young ones wear hose now. Soft!' },
    { la: 'Septuaginta annos habeo. Tres duces vidi et duas pestilentias. Nebula nihil est.', en: 'I am seventy. I have seen three dukes and two plagues. Fog is nothing.' },
  ],
  bulgarus: [
    { la: 'De Sepino venio. Dux Romualdus avis nostris terras desertas dedit, quando Alzeco cum Vulgaris venit.', en: 'I come from Sepinum. Duke Romuald gave our grandfathers the deserted lands, when Alzeco came with the Bulgars.' },
    { la: 'Latine loquimur, sed linguam nostram non perdidimus. Domi aliter loquimur — tu non intellegeres.', en: 'We speak Latin, but we have not lost our own tongue. At home we speak otherwise — you would not understand.' },
    { la: 'Equos vendo. Unum caballum bonum, duo solidi. Pro mula, minus.', en: 'I sell horses. One good horse, two solidi. A mule, less.' },
    { la: 'Alzeco non dux sed gastaldius vocatur hic. Langobardi nomina mutant, sicut vestimenta.', en: 'Here Alzeco is called not duke but gastald. The Lombards change names as they change clothes.' },
  ],
  // ------------------------------------------------------------ townsfolk and country people
  aldius: [
    { la: 'Aldius sum: nec servus nec liber. Terram domini colo, et pro me sexaginta solidi, si quis me occidat.', en: 'I am an aldius: neither slave nor free. I till my lord’s land, and sixty solidi are owed for me if someone kills me.' },
    { la: 'Porci mei in gahagio ducis glandes comedunt. Gastaldius numerat eos melius quam filios meos.', en: 'My pigs eat acorns in the duke’s fenced wood. The gastald counts them better than he counts my children.' },
    { la: 'Hordeum, faba, castaneae. Panem triticeum ad Pascha tantum.', en: 'Barley, beans, chestnuts. Wheat bread only at Easter.' },
    { la: 'Iuxta Sabatum, ubi semita de Turre Catenae descendit, truncus antiquus stat. Corrigia de corio adhuc in rubis pendent. Non transeo ibi.', en: 'By the Sabato, where the path comes down from the Chain Tower, there’s an old stump. Strips of hide still hang in the brambles. I don’t go that way.' }, // hint 1
    { la: 'Noli exire portam de nocte. Inter sepulcra antiqua lumina ambulant.', en: 'Don’t go out of the gate at night. Lights walk among the old tombs.' },
    { la: 'Pluvia nulla per totum mensem, et tamen nebula omni mane. Quid significat?', en: 'No rain all month, and yet fog every morning. What does it mean?' },
  ],
  rustica: [
    { la: 'Ova et caseum habeo, et ficus siccas. Pro uno tremisse multa tibi do.', en: 'I have eggs and cheese, and dried figs. For one tremissis I’ll give you a great deal.' },
    { la: 'Tremissem non habes? Da mihi panem, vel sal. Sal melius quam aurum.', en: 'No tremissis? Give me bread, or salt. Salt is better than gold.' },
    { la: 'Ad Sanctum Petrum foris muros ova porto. Ancillae Dei pro me orant.', en: 'I take eggs to St Peter’s outside the walls. The handmaids of God pray for me.' },
    { la: 'Filiam meam mundoaldus suus dabit cui vult. Ego nihil dico; mater sum tantum.', en: 'My daughter’s guardian will give her to whom he pleases. I say nothing; I am only her mother.' },
  ],
  servus: [
    { la: 'Servus sum gastaldii. Ligna, aqua, iterum ligna.', en: 'I am the gastald’s slave. Wood, water, wood again.' },
    { la: 'In Campania captus sum, puer. Pater meus Neapoli est, si adhuc vivit. Nemo me redemit.', en: 'I was taken in Campania as a boy. My father is in Naples, if he still lives. No one ransomed me.' },
    { la: 'Si dominus me «amund» fecerit, liber ero ab omni mundio. Spero.', en: 'If my lord makes me “amund”, I’ll be free of every bond. I hope.' },
    { la: 'Sub pomis ducis, in horto, gradus antiqui in terram descendunt. Hortulanus dicit ibi aquam veterem esse… et aliud.', en: 'Under the duke’s apple trees, in the orchard, old steps go down into the earth. The gardener says there is old water down there… and something else.' }, // hint 4
  ],
  mulier: [
    { la: 'Salve. Aqua de puteo hodie turbida est. Malum signum.', en: 'Greetings. The well water is cloudy today. A bad sign.' },
    { la: 'Ad medicum vado. Filius meus tussit, et medicus Isidorum legit, non filium meum.', en: 'I’m going to the physician. My son coughs, and the physician reads Isidore instead of looking at my son.' },
    { la: 'In quadragesima nec carnem nec caseum. Pisces de Calore, si piscator vendit.', en: 'In Lent no meat and no cheese. Fish from the Calore, if the fisherman will sell.' },
    { la: 'Pulverem de sepulcro sancti Barbati in sacculo porto. Contra febres.', en: 'I carry dust from St Barbatus’ tomb in a little bag. Against fevers.' },
    { la: 'Mater mea Romana erat, pater Langobardus. Ego? Beneventana sum.', en: 'My mother was Roman, my father Lombard. Me? I’m from Benevento.' },
  ],
  anus: [
    { la: 'Sale ante ostium sparge, fili. Quae de nocte venit, grana numerare debet antequam intrat; et interim dies venit.', en: 'Scatter salt before your door, son. She who comes by night must count the grains before she enters; and meanwhile the day comes.' }, // folk belief
    { la: 'Herbas colligo: rutam, verbenam, artemisiam. Sacerdos dicit hoc malum esse. Sacerdos febrem non habet.', en: 'I gather herbs: rue, vervain, mugwort. The priest says it’s wicked. The priest doesn’t have a fever.' },
    { la: 'Extra portam orientalem iacent lapides Dominae Aegyptiorum. Corona eius de serpentibus est. Ibi ne dormias.', en: 'Outside the east gate lie the stones of the Lady of the Egyptians. Her crown is made of serpents. Don’t sleep there.' }, // hint 3
    { la: 'Nux sacra cecidit, sed radices non moriuntur. Ita aiunt.', en: 'The holy walnut fell, but roots do not die. So they say.' },
    { la: 'Viginti annos vidua sum. Nemo me mundoaldus regit nisi Deus.', en: 'I’ve been a widow twenty years. No guardian rules me but God.' },
  ],
  puer: [
    { la: 'Vis videre? In theatro antiquo ossa magna inveni! Gigantis sunt!', en: 'Want to see? I found big bones in the old theatre! They’re a giant’s!' },
    { la: 'Avia mea dicit viperam auream sub terra dormire, et oculos eius de granato esse.', en: 'My grandmother says a golden viper sleeps under the ground, and its eyes are garnets.' },
    { la: 'Ego miles ducis ero, cum lancea et caballo!', en: 'I’ll be one of the duke’s soldiers, with a spear and a horse!' },
    { la: 'Capras pasco iuxta lapides Aegyptios. Unus lapis taurum habet. Taurus non movetur.', en: 'I graze goats by the Egyptian stones. One stone has a bull on it. The bull doesn’t move.' },
  ],
  puella: [
    { la: 'Lanam filare disco. Fusus semper cadit.', en: 'I’m learning to spin wool. The spindle always falls.' },
    { la: 'Mater dicit: noli ad Sabatum de nocte. Mulieres ibi volant!', en: 'Mother says: don’t go to the Sabato at night. Women fly there!' },
    { la: 'Monachus mihi litteras ostendit. A, B, C… postea oblita sum.', en: 'A monk showed me letters. A, B, C… then I forgot.' },
  ],
  mendicus: [
    { la: 'Elemosinam, propter Deum! Unum panem, unum nummum!', en: 'Alms, for God’s sake! One loaf, one coin!' },
    { la: 'Episcopus pauperes in matricula sua pascit. Ego non sum in matricula. Ego sum hic.', en: 'The bishop feeds the poor on his list. I am not on his list. I am here.' },
    { la: 'In crypta extra muros, apud Sanctos Quadraginta, ossa sanctorum iacent. Dormivi ibi una nocte. Numquam iterum.', en: 'In the crypt outside the walls, at the Forty Saints, lie the bones of saints. I slept there one night. Never again.' },
  ],
  // ------------------------------------------------------------ crafts and trade
  faber: [
    { la: 'Ferrum de montibus venit, carbonem de silva. Ego tantum malleum habeo et brachia.', en: 'The iron comes from the mountains, the charcoal from the forest. I have only my hammer and my arms.' },
    { la: 'Spatham novam? Viginti solidi, et unum annum expectas. Cultellum? Hodie.', en: 'A new spatha? Twenty solidi, and you wait a year. A knife? Today.' },
    { la: 'Avus meus dicebat gladios antiquos nomina habuisse, sicut homines. Iste cultellus nondum nomen habet.', en: 'My grandfather said the old swords had names, like men. This knife has no name yet.' },
    { la: 'Ferramenta equorum ducis facio. Gasindii non solvunt; dux solvit, aliquando.', en: 'I shoe the duke’s horses. His gasindii don’t pay; the duke pays, sometimes.' },
  ],
  aurifex: [
    { la: 'Aurifex sum. Granata de oriente veniunt, per mare et per Neapolim. Aurum, de solidis antiquis.', en: 'I am a goldsmith. The garnets come from the East, by sea and by Naples. The gold, from melted old coins.' },
    { la: 'Crucem auream pro mortuo facio — in velo suturam, ut in sepulcro cum illo iaceat.', en: 'I’m making a gold-leaf cross for a dead man — sewn to the shroud, to lie with him in the grave.' },
    { la: 'Nomen ducis in moneta: «GI». Ego litteras non scio, sed formas scio.', en: 'The duke’s name on the coin: “GI”. I can’t read, but I know the shapes.' },
  ],
  figulus: [
    { la: 'Ollas facio de argilla Caloris. Bonae ad fabam coquendam.', en: 'I make pots from the Calore clay. Good for cooking beans.' },
    { la: 'Lateres antiquos in ruinis invenimus, cum litteris Romanorum. Meliores erant figuli tunc.', en: 'We find old bricks in the ruins, with Roman letters stamped on them. The potters were better then.' },
    { la: 'Una olla, unus denarius… sed denarios nemo habet. Da mihi ova.', en: 'One pot, one penny… but nobody has pennies. Give me eggs.' },
  ],
  pistor: [
    { la: 'Furnum calefacio ante lucem. Tota vicinia panem suum huc portat.', en: 'I heat the oven before dawn. The whole neighbourhood brings its loaves here.' },
    { la: 'Signum suum quisque in pane facit, ne permisceantur. Crux, stella, tres digiti.', en: 'Everyone marks his loaf so they don’t get mixed: a cross, a star, three fingers.' },
  ],
  molendinarius: [
    { la: 'Mola aquaria Sabati die noctuque volvit. Decimam partem de farina accipio.', en: 'The Sabato’s water-mill turns day and night. I take a tenth of the flour.' },
    { la: 'Fluvius de nocte aliter loquitur. Rota numquam tacet, sed aliquando quasi canit.', en: 'The river speaks differently at night. The wheel is never silent, but sometimes it almost sings.' },
    { la: 'Lavandariae infra molam lavant. Audiunt omnia, dicunt omnia.', en: 'The washerwomen wash below the mill. They hear everything, and they tell everything.' },
  ],
  calcarius: [
    { la: 'Amphitheatrum in fornacem mittimus. Marmor bonam calcem facit.', en: 'We put the amphitheatre into the kiln. Marble makes good lime.' },
    { la: 'Litterae in lapidibus? Nescio quid dicunt. Ignis omnes legit.', en: 'Letters on the stones? I don’t know what they say. The fire reads them all.' },
    { la: 'Pro uno curru calcis, unum tremissem. Muros novos facit dux.', en: 'One cartload of lime, one tremissis. The duke is building new walls.' },
  ],
  lavandaria: [
    { la: 'Aqua Sabati frigida est, sed linum album facit.', en: 'The Sabato’s water is cold, but it makes the linen white.' },
    { la: 'Infra, iuxta ripam, ubi semita de Turre Catenae descendit, nux antiqua stabat. Corrigiae de corio adhuc ibi pendent. Ego non tango.', en: 'Downstream, on the bank where the path comes down from the Chain Tower, the old walnut stood. Strips of hide still hang there. I don’t touch them.' }, // hint 1
    { la: 'Dicunt mulieres de nocte ad nucem convenire. Fabulae! …Sed ego ante noctem domum redeo.', en: 'They say women meet at the walnut by night. Stories! …But I’m home before dark.' }, // legend (later), told as gossip
    { la: 'Uxor gastaldii tunicas suas mihi dat. Sanguinem in manicis inveni. Nihil dico.', en: 'The gastald’s wife gives me her husband’s tunics. I found blood on the sleeves. I say nothing.' },
  ],
  textrix: [
    { la: 'Telam ponderibus tendimus. Viginti pondera de argilla, et tota dies.', en: 'We stretch the warp with weights. Twenty clay weights, and the whole day.' },
    { la: 'Rubeum de radice rubiae, caeruleum de glasto, croceum de herba lutea. Purpura pro imperatore tantum.', en: 'Red from madder root, blue from woad, yellow from weld. Purple only for the emperor.' },
    { la: 'Lineam vestem pro sponsa texo. Mundium iam solutum est.', en: 'I’m weaving a linen gown for a bride. Her mundium has already been paid.' },
  ],
  negotiator: [
    { la: 'Sal de Neapoli, oleum de Apulia, piper — si Deus vult — de Alexandria. Sed Alexandria Saracenorum est nunc.', en: 'Salt from Naples, oil from Apulia, pepper — God willing — from Alexandria. But Alexandria belongs to the Saracens now.' },
    { la: 'Solidos omnes pondero: non omnes nummi eiusdem ponderis sunt.', en: 'I weigh every solidus: not all coins are of the same weight.' },
    { la: 'Per viam Traianam ad Sipontum vado, et inde ad montem Garganum. Peregrini omnia emunt.', en: 'I travel the Via Traiana to Siponto, and on to Monte Gargano. Pilgrims buy everything.' },
    { la: 'Pro servo iuvene, decem solidi. Non ego, non ego… sed alii vendunt.', en: 'For a young slave, ten solidi. Not me, not me… but others sell.' },
  ],
  notarius: [
    { la: 'Chartam venditionis scribo: «Ego Ursus vendidi tibi Iohanni vineam meam…» Testes tres, et pretium.', en: 'I’m writing a deed of sale: “I, Ursus, have sold you, Iohannes, my vineyard…” Three witnesses, and the price.' },
    { la: 'Annus domni Gisulfi ducis undecimus. Sic in chartis scribimus, non annum Domini.', en: 'The eleventh year of our lord Duke Gisulf. That is how we date our deeds, not by the year of the Lord.' },
    { la: 'In bibliotheca episcopi armarium est quod nemo aperit. Ego claves non habeo. Nemo habet.', en: 'In the bishop’s library there is a press nobody opens. I don’t have the keys. Nobody does.' },
  ],
  medicus: [
    { la: 'Isidorus scribit: medicina est quae corporis vel tuetur vel restaurat salutem.', en: 'Isidore writes: medicine is that which protects or restores the health of the body.' },
    { la: 'Febres de paludibus Caloris veniunt, cum nebula. Allium et vinum calidum.', en: 'Fevers come from the Calore marshes, with the fog. Garlic and warm wine.' },
    { la: 'Libros Graecos Galeni habeo, sed Graece non lego. Iudaeus de foro mihi legit.', en: 'I own Greek books of Galen, but I can’t read Greek. The Jew at the market reads them to me.' },
  ],
  // ------------------------------------------------------------ the Church
  presbyter: [
    { la: 'Pax tecum. Episcopus noster in matricula pauperes pascit, et pro duce orat.', en: 'Peace be with you. Our bishop feeds the poor on his list, and prays for the duke.' },
    { la: 'Hanc ecclesiam Sanctae Mariae consecraverunt anno sexcentesimo. Centum annos stat.', en: 'This church of St Mary was consecrated in the year 600. It has stood a hundred years.', },
    { la: 'Benedicat te omnipotens Deus.', en: 'May almighty God bless you.', bless: true },
    { la: 'Rustici adhuc arbores et fontes colunt. Barbatus noster arborem succidit; radices in cordibus manent.', en: 'The country people still revere trees and springs. Our Barbatus cut down the tree; the roots remain in their hearts.' },
    { la: 'In festis calix aureus in altari stat. Unde aurum? Ne interroges.', en: 'On feast days a gold chalice stands on the altar. Where did the gold come from? Don’t ask.' }, // hint 5
  ],
  diaconus: [
    { la: 'Diaconus sum. Evangelium lego et pauperibus panem distribuo.', en: 'I am a deacon. I read the Gospel and hand out bread to the poor.' },
    { la: 'Papa Sergius Syrus est, natus in Sicilia. Romae Graece et Latine cantant.', en: 'Pope Sergius is a Syrian, born in Sicily. In Rome they sing in Greek and in Latin.' },
    { la: 'Kyrie eleison! Christe eleison! Graeca verba in missa nostra — et nemo miratur.', en: 'Lord, have mercy! Christ, have mercy! Greek words in our Mass — and nobody wonders at it.' },
    { la: 'Reliquias sanctorum in capsellis servamus. Pulvis, filum, ossa parva. Virtus in eis.', en: 'We keep the saints’ relics in little boxes. Dust, a thread, small bones. There is power in them.' },
  ],
  monachus: [
    { la: 'Pax tecum, peregrine. Nebula haec quadraginta dies non recessit.', en: 'Peace be with you, pilgrim. This fog has not lifted in forty days.' },
    { la: 'Benedicat te omnipotens Deus, Pater, et Filius, et Spiritus Sanctus.', en: 'May almighty God bless you: Father, Son and Holy Spirit.', bless: true },
    { la: 'Casinum desertum est ex quo Langobardi illud destruxerunt. Corpus sancti Benedicti sub ruinis iacet, aiunt.', en: 'Monte Cassino has lain empty since the Lombards destroyed it. St Benedict’s body lies under the ruins, they say.' },
    { la: 'Extra muros, apud Sanctos Quadraginta, sub memoria martyris, fratres nostri dormiunt. Descende cum lucerna.', en: 'Outside the walls, at the Forty, beneath the martyr’s shrine, our brothers sleep. Go down with a lantern.' },
    { la: 'Otiositas inimica est animae.', en: 'Idleness is the enemy of the soul. (Rule of St Benedict, 48)' },
  ],
  sanctimonialis: [
    { la: 'Ancilla Dei sum in monasterio Sancti Petri. Domna Theuderada nos hic posuit.', en: 'I am a handmaid of God at the nunnery of St Peter. The lady Theuderada set us here.' },
    { la: 'Septies in die laudem dicimus. Etiam in nebula campana sonat.', en: 'Seven times a day we sing his praise. Even in the fog, the bell rings.' },
    { la: 'Domna Theuderada aliquid aureum episcopo Barbato tradidit, quod dux in secreto servabat. In altari Sanctae Mariae nunc lucet.', en: 'The lady Theuderada handed Bishop Barbatus something golden that the duke kept in secret. It shines now on the altar of St Mary.' }, // hint 5
    { la: 'Pro animabus ducum oramus. Et pro tua, si vis.', en: 'We pray for the souls of the dukes. And for yours, if you wish.' },
  ],
  peregrinus: [
    { la: 'Ad Sanctum Michahelem in monte Gargano pergo. Spelunca eius sine manu hominis consecrata est.', en: 'I am going to St Michael on Monte Gargano. His cave was consecrated by no human hand.' },
    { la: 'De Francia venio, per Romam. Viginti septimanas in via sum.', en: 'I come from Francia, by way of Rome. Twenty weeks on the road.' },
    { la: 'In hospitio iuxta portam orientalem versus scripti sunt in muro. Poeta antiquus hic dormivit, dicunt.', en: 'In the inn by the east gate there are verses written on the wall. An ancient poet slept there, they say.' },
    { la: 'Pulverem de spelunca Michahelis domum portabo. Contra tempestates.', en: 'I’ll carry dust from Michael’s cave home with me. Against storms.' },
  ],
  // ------------------------------------------------------------ strangers
  graecus: [
    { la: 'Χαῖρε, φίλε. Ἐκ Τάραντός εἰμι. — Taranto nunc ducis est; nos mercatores manemus.', en: 'Greetings, friend. I am from Taranto. — Taranto belongs to the duke now; we merchants stay.' },
    { la: 'In Constantinopoli Tiberius regnat; Iustinianus, cui nasum absciderunt, in exilio est. Sed nummi vestri adhuc nomen Iustiniani portant!', en: 'In Constantinople Tiberius reigns; Justinian, whose nose they cut off, is in exile. Yet your coins still bear Justinian’s name!' },
    { la: 'Θεοτόκε, βοήθει. — In domo mea iconem habeo, de Constantinopoli. Veni et vide.', en: 'Mother of God, help us. — I have an icon in my house, from Constantinople. Come and see.' },
    { la: 'Extra portam orientalem lapides Isidis iacent. Mater mea Aegyptiorum deam serpentibus coronatam esse dicebat.', en: 'Outside the east gate lie the stones of Isis. My mother said the goddess of the Egyptians was crowned with serpents.' }, // hint 3
    { la: 'Carthago a Saracenis capta est ante duos annos. Mare nostrum non est iam nostrum.', en: 'Carthage fell to the Saracens two years ago. Our sea is not ours any more.' },
  ],
  graeca: [
    { la: 'Χαῖρε. — Latine parum loquor. Maritus meus loquitur.', en: 'Greetings. — I speak little Latin. My husband speaks it.' },
    { la: 'Ad Sanctum Hilarium vado. Parva ecclesia, duo tholi, sicut domi.', en: 'I go to St Hilary’s. A small church with two domes, like at home.' },
    { la: 'Κύριε ἐλέησον. — Pro filio meo in mari.', en: 'Lord, have mercy. — For my son at sea.' },
  ],
  iudaeus: [
    { la: 'Shalom — שָׁלוֹם. Pax tibi. Vestes tingo et vendo.', en: 'Shalom. Peace to you. I dye cloth and sell it.' },
    { la: 'Familia mea de Venusia est. Ibi patres nostri sub terra iacent, et in lapidibus scriptum est: «pax super requiem eius».', en: 'My family is from Venosa. Our fathers lie underground there, and on the stones it is written: “peace upon his resting place”.' },
    { la: 'Sabbato non vendo. Veni cras, vel heri.', en: 'On the Sabbath I don’t sell. Come tomorrow — or yesterday.' },
    { la: 'Graece, Latine, et linguam sanctam lego. Medicus civitatis me rogat ut libros eius legam.', en: 'I read Greek, Latin and the holy tongue. The town physician asks me to read his books to him.' },
  ],
  afer: [
    { la: 'De Carthagine fugi, quando Saraceni urbem ceperunt. Nunc Beneventi pauper sum, sed vivus.', en: 'I fled Carthage when the Saracens took the city. Now I am poor in Benevento, but alive.' },
    { la: 'In Africa episcopi nostri ducenti erant. Quot nunc? Deus scit.', en: 'In Africa we had two hundred bishops. How many now? God knows.' },
    { la: 'Latine loquor sicut Augustinus, non sicut Langobardi. Rident de me.', en: 'I speak Latin like Augustine, not like the Lombards. They laugh at me.' },
  ],
};
