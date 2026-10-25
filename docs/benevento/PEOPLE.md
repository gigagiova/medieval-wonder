# The people of Beneventum, AD 700

Who lived in Benevento in AD 700, what they wore, what they did, where, what they believed and how
they spoke, and how the game puts them in the streets. Read with `HISTORY.md` (the town) and
`SECRETS.md` (the mysteries). Code: `src/npc/population.ts` (groups, quarters, stations, the
director that makes people about the player), `src/npc/lines-people.ts` (what they say),
`src/npc/population-props.ts` (staff, apron, brooch, scrip, things set down at work). Test page:
`population-test.html?groups=gasindus,presbyter,…` (`&focus=i` for talk distance, `&outfit=n`,
`&props=anvil,stall,pots,sacks,laundry,kiln,loom`).

Each statement is marked:

- **A — attested**: a source of the period (or near it) says so for Benevento, or archaeology shows it there.
- **I — inference**: attested for Lombard Italy or southern Italy generally, or for Benevento a little
  earlier or later, and safe to assume in 700.
- **H — hypothesis**: plausible, not attested; a choice the game makes.
- **L — legend**: a later story; in the game only in the mouths of people, as rumour.

## 1. Sources

Primary:

- Paul the Deacon, *Historia Langobardorum* (c. 790), esp. IV 22 (Lombard dress and hair, from
  Theodelinda's paintings at Monza), IV 46 (St Michael and Siponto), V 7–10 (Constans II's siege of
  663, Sesuald's head), V 25 (Theuderada, daughter of Lupus, married to Romuald I; their sons Grimoald,
  Gisulf, Arechis), V 29 (Alzeco's Bulgars settled at Sepino, Boiano, Isernia; "they still speak Latin
  but have not lost their own language"; Alzeco styled gastald), V 34 (*perticae*), VI 1 (Romuald takes
  Taranto and Brindisi; Theuderada builds St Peter's outside the walls with a community of *ancillae
  Dei*), VI 2 (Gisulf I duke for 17 years, his wife Winiperga, their son Romuald), VI 27 (Gisulf takes
  Sora, Arpino, Arce; raids Campania to Horrea in Pope John VI's time, 701–705; the pope ransoms the
  captives). Latin text: https://www.thelatinlibrary.com/pauldeacon.html
- *Vita Barbati episcopi Beneventani* (late 9th c.; MGH SS rer. Lang. pp. 555–563): the tree, the hide,
  the golden viper, the chalice. Hagiography written ~200 years after the events (dated by J.-M.
  Martin to the late 800s); a retrospective portrait, not a record. Summary and dating:
  https://en.wikipedia.org/wiki/Barbatus_of_Benevento ; N. Everett, *Patron Saints of Early Medieval
  Italy* (2016), pp. 39–59.
- *Edictum Rothari* (643) and Grimoald's additions (668): wergild and composition (*guidrigild*,
  *octogild*), *aldius*, *servus ministerialis*, *massarius*, *mundium*, *morgincap*, *fara*,
  *gahagium*, *amund* (manumission), c. 376 on the *masca* (striga). MGH LL IV (Bluhme 1868); English:
  K. F. Drew, *The Lombard Laws* (1973). The laws of Liutprand (713–735) are later than 700 and are used
  only as the end of a development (e.g. the morning-gift's limit of a quarter, 717).
- *Chronicon Vulturnense* (12th c.) on Paldo, Tato and Taso, Beneventan nobles who founded S. Vincenzo
  al Volturno c. 703 (late source; **I/L**).
- Coins: Beneventan gold solidi and tremisses imitating Byzantine types from c. 680; under Gisulf I the
  duke's initial appears; a tremissis in the name of Justinian II attributed to Gisulf I (British
  Museum C 1863,0711.56). https://en.wikipedia.org/wiki/Lombard_coinage_of_Benevento ;
  https://www.britishmuseum.org/collection/object/C_1863-0711-56
- Jewish inscriptions of Venosa (5th–6th c. in Latin and Greek with Hebrew words; 9th-c. Hebrew
  epitaphs): D. Noy, *Jewish Inscriptions of Western Europe* I (1993); G. Lacerenza's inventory (2019)
  and his study of their languages (2021, "deeply Latinized"): https://unora.unior.it/handle/11574/187698 ;
  overview https://www.jewishvirtuallibrary.org/venosa . *Megillat Ahimaaz* (1054) for the
  9th–10th-c. communities of Oria, Venosa, Benevento.
- Isidore, *Etymologiae* IV 1, 1 (the physician's book; already a readable in the game).

Studies (synthesis; used for what is typical): C. Wickham, *Early Medieval Italy* (1981) and *Framing the
Early Middle Ages* (2005); S. Gasparri, *Italia longobarda* (2012) and on *gasindi*, *arimanni*,
*exercitales*; M. Rotili, *Benevento romana e longobarda* (1986), *La necropoli longobarda di Benevento*
(1977); A. Lepore and P. Peduto on Lombard Campania; J.-M. Martin, *La Pouille du VIe au XIIe siècle*
(1993); V. von Falkenhausen, "I Longobardi meridionali" (*Storia d'Italia* III, 1983) and on Greeks in
southern Italy; on dress, the grave goods of Castel Trosino, Nocera Umbra and the Benevento necropolis
(belt sets, disc brooches, gold-leaf crosses). Encyclopaedic entries used as starting points:
it.wikipedia "Noce di Benevento" (the later witch legend and Piperno 1639), "Ducato di Benevento".

## 2. The town's people in 700, in one paragraph

Benevento was the capital of a Lombard duchy that was all but independent of the king at Pavia.
Duke **Gisulf I** (689–706; **A**), son of Romuald I and Theuderada, ruled with his wife **Winiperga**
(**A**, HL VI 2; the game's opening text and older lines say "Theodorada": Paul writes *Theuderada*).
Around the duke stood a Lombard aristocracy of *gasindi* (sworn followers) and officials
(*gastaldi*, *sculdahis*); below them the free Lombard warriors (*arimanni*, *exercitales*). Most of the
town and country people were Latin-speaking descendants of the Roman population: free smallholders and
tenants, craftsmen, and many unfree (*aldii*, half-free; *servi*, slaves). The Church — the bishop at
S. Maria (his name in 700 is not known), priests, deacons, monks, the nuns of St Peter founded by
Theuderada — was rich and growing. Greek was spoken by people from the newly conquered Apulian towns
(Taranto, Brindisi: **A** that they were taken, **I** that Greek-speakers came to the capital) and by
visitors from Byzantine Naples and the East. Jews lived in Venosa and Oria (**A**) and are documented in
Benevento from the 9th century (**A**); one or two Jewish families in 700 are **H**. A Bulgar from
Alzeco's settlement at Sepino, a day's ride away, is **A** for the region and **H** for the street. An
African Latin who fled Carthage after its fall in 698 is **H** (refugees from Africa reached Italy;
none is named in Benevento).

## 3. The groups

Skin in the game is always within fair–olive–light tan (a tone shift over the scan's own skin):
Lombards the fairest, Latins Mediterranean olive, Greeks, Jews and Africans olive to light tan, outdoor
workers weathered. No group is shown darker.

### The duke's people (Lombard)

**Gasindius** (`gasindus`) — the duke's sworn retainer, fed and armed by him. **A** (the word is in
Rothari and Beneventan charters). Dress: knee-length tunic of good wool or linen in strong dyes (madder
red, woad blue, weld yellow), the borders once woven in bright colours (Paul IV 22, **A** for the 6th c.),
cloak closed at the right shoulder with a gold **disc brooch** (Scheibenfibel, 7th-c. fashion, **I**
from graves), leg wraps over hose, the **multi-part belt set** (vielteilige Gürtelgarnitur) with
spatha and seax (**A** in Lombard graves, incl. Benevento's necropolis). Hair: the old style was the nape
shaved and the long hair parted on the brow (Paul IV 22, **A** for the earlier Lombards; by 700 Romanised,
**I**). Beards long. Where: the curtis, the Lombard quarter. Says: duty to the duke, his belt,
Cunincpert's sickness (the king died in 700, **A**), the Campanian raids to come (702, **A**), Paldo,
Tato and Taso (**I/L**).

**Gastaldius** (`gastaldius`) — the duke's steward of the curtis lands and granary; **A** as an office
(Rothari; Alzeco's title, HL V 29). An older man with a rod of office (staff), a felt cap, belt set,
brooch. At the granary (`horreumCurtis`) with slaves and sacks. Says: dues of wine, the tremissis as a
third of a solidus, the emperor's name on the duke's coins (**A**), the fog.

**Sculdahis** (`sculdahis`) — a local judge under the gastald; **A** (Rothari; the game's
`domusSculdahis` holds Rothari 376). With petitioners at his door. Says: Rothari 376 on the *masca*
(**A**, paraphrased), compositions for an aldius (60 solidi) and a trained household slave (50) —
**A** as recalled from Rothari cc. 129–130 (to be checked against Bluhme), the *mundium*.

**Arimannus** (`arimannus`) — the free Lombard in arms; **A**. Spear, round shield (painted), spatha,
seax, Spangenhelm or lamellar helmet for some, felt cap for others (the existing soldier). At the gates
(Porta Aurea, Summa, Rufina, S. Lorenzo, Gloriosa, Arcus Sacramenti), the palace, the chain tower.
Says: the gate is shut at night, his grandfather at the siege of 663 and Sesuald's head (**A**, HL V 8),
*octogild* for theft (Rothari, **A**), St Michael of the Gargano as the Lombards' saint (**A**).

**Femina Langobarda** (`langobarda`) — a free Lombard woman, under a *mundoald*'s *mundium*; she had a
*morgincap* (morning-gift) and *meta* (bride-price) (**A** in Rothari). Dress: long tunic and over-gown
in good dyes, linen veil, a disc brooch at the throat (**I**: the 7th-c. graves replace the older pairs
of bow brooches with a single disc brooch), a sash belt (the hanging belt pendants of graves are not
modelled). Says: her grandmother's brooch, the morning-gift, Theuderada's nunnery (**A**), the wooden
doves on poles for men lost in war (Paul V 34, **A** for Pavia), the viper given to Barbatus (**L**,
hint 5).

**Senex Langobardus** (`senexLangobardus`, "Aio" by Audoin's house) — an old Lombard veteran who
remembers the tree. Grey, with staff and brooch. Says: he saw men ride round the tree and strike the hide
(**L**, the *Vita Barbati*; told as memory), his comrade Audoin kept something from those days (**H**,
hint 2), the old linen dress and open laced shoes (Paul IV 22, **A**), seventy years, two plagues.

**Vulgar de Sepino** (`bulgarus`) — a Bulgar of Alzeco's people, settled by Romuald at Sepino, Boiano
and Isernia (HL V 29, **A**). In Benevento selling horses (**H**). Dressed as a Lombard freeman with a
felt cap, seax and sword. Says Paul's own facts: they speak Latin but keep their tongue; Alzeco is called
gastald, not duke.

### Townsfolk and country people (mostly Latin)

**Aldius** (`aldius`) — half-free, bound to a lord's land, with his own wergild (**A**). Homespun undyed
wool, hood or cloak, leg wraps, felt cap; carries sticks, buckets, baskets. Everywhere, the market, the
gardens. Says: neither slave nor free, pigs in the duke's *gahagium* (**A** word), barley, beans and
chestnuts (**I**), the stump by the Sabato (**L/H**, hint 1).

**Rustica** (`rustica`) — a country woman selling at the forum stall: eggs, cheese, dried figs (**I**);
basket or jar on the head. Says: prices in tremisses and barter (salt), her daughter's *mundoald*.

**Servus** (`servus`) — a slave of the curtis or of a household (**A**; slaves are everywhere in
Rothari). Worn, dark, patched wool; carries wood and water. One was taken as a boy in Campania (raids on
the Byzantine duchy of Naples, **I** for the 690s, **A** for 702). Says: hopes to be made *amund*
(Rothari's term for full manumission, **A**), the old steps under the duke's apple trees (**H**, hint 4).

**Mulier Beneventana** (`mulier`) — a Latin townswoman: long tunic, over-gown, linen veil, jar or
basket. Says: the cloudy well, the physician who reads Isidore, Lent, dust from St Barbatus' tomb against
fevers (relic practice **I**; Barbatus' cult **A** later), a Roman mother and a Lombard father (mixed
marriages **I**).

**Anus** (`anus`) — an old woman, widow; herbs (rue, vervain, mugwort), salt before the door against the
night-walker (**L**: a later Beneventan folk belief, given as advice). At the stump of the walnut, alone
(**H**, for the mood). Says: the stones of the Lady of the Egyptians outside the east gate (hint 3; the
Iseum fragments are **A**), "the walnut fell but roots don't die" (**L**).

**Puer / puella** (`puer`, `puella`) — children, at about 0.6 of adult height with a larger head;
graze goats by the Iseum, help the smith and potter, learn to spin. Says: giant's bones in the theatre,
the golden viper with garnet eyes (**L**, as grandmother's tale), women who fly by the Sabato (**L**).

**Mendicus** (`mendicus`) — a beggar at the bishop's atrium; the Church kept a list (*matricula*) of the
poor it fed (**I**). Says: the crypt at the Forty Saints.

### Crafts and trade

**Faber ferrarius** (`faber`) at the smithy inside Porta Aurea, leather apron, anvil on a stump.
**Aurifex** (`aurifex`) at the goldsmiths' (a *pontile de aurificibus* is attested later, **A** for the
trade in Benevento's later charters, **I** for 700): garnets from the East, gold-leaf crosses sewn to
burial veils (**A** in Lombard graves). **Figulus** (`figulus`) at the kiln by Porta Rufina, pots set out.
**Pistor** (`pistor`) at the bakery: neighbours bring their loaves marked with a sign (**I**).
**Molinarius** (`molendinarius`) at the water-mill on the Sabato, white with flour, sacks; mills on the
rivers in early 8th-c. charters (**I**). **Calcarius** (`calcarius`) at the amphitheatre, burning marble
for lime (**A** from the remains; the "Porta delle Calcare"). **Lavandaria** (`lavandaria`) — three
washerwomen kneeling at the Sabato bank below the mill, a basket of linen and a beating stone (**H**,
for the river's life; washing in rivers is universal). **Textrix** (`textrix`) at the weaving house with
a warp-weighted loom (loom weights are common finds, **A**): madder, woad, weld.

**Negotiator** (`negotiator`) — a merchant at a forum stall or on the Via Traiana to Siponto and the
Gargano: salt from Naples, oil from Apulia, pepper once from Alexandria (Arab since 641). Long tunic,
mantle, a scrip. Slaves are sold (**A** in principle; the price of ten solidi is **H**).
**Notarius** (`notarius`) — writes deeds dated by the duke's regnal year (**A** for Beneventan charters).
**Medicus** (`medicus`) — the town physician (the game's `medicus` house): Isidore; Greek Galen read to him
by a Jew (**H**).

### The Church

**Presbyter** (`presbyter`) and **diaconus** (`diaconus`) at the atrium of S. Maria: white linen tunic
(alb) to the ankles, the priest with a dark mantle (*paenula*/chasuble); clean-shaven (the Latin custom,
**I**); the Roman tonsure is not modelled. Say: the church consecrated in 600 (**A**), the *matricula*,
Pope Sergius I is a Syrian born in Sicily (**A**), the Greek *Kyrie* in the Latin Mass (**A**), relics
in little boxes, the gold chalice (**L**, hint 5).

**Monachus** (`monachus`) — the existing monks, here clerics living by a rule at the bishop's church and
at the Forty Saints; Monte Cassino lay deserted from c. 580 until Petronax (717) (**A**).

**Ancilla Dei** (`sanctimonialis`) — nuns of St Peter's outside the walls, Theuderada's foundation
(**A**, HL VI 1): dark wool, dark veil. Say: the hours, Theuderada, the golden thing given to Barbatus
(**L**, hint 5).

**Peregrinus** (`peregrinus`) — pilgrims to St Michael on Monte Gargano, which Duke Romuald placed under
Bishop Barbatus (673, **A** in later sources); some from Francia or England by way of Rome (**I**: the
route Rome–Benevento–Siponto on the Via Traiana). Hooded cloak or mantle, staff, scrip. At Porta Aurea,
kneeling at S. Ilario, at the bishop's church, on the Via Traiana.

### Strangers

**Graecus / Graeca** (`graecus`, `graeca`) — a merchant family from Taranto in the "eastern house" by
Porta Aurea (the district is **H**; churches "de Grecis" are later). Long tunics in orchil purple, woad,
weld; the man bearded. Greek greetings (*Χαῖρε*, *Θεοτόκε, βοήθει*, *Κύριε ἐλέησον*). Say: Tiberius
reigns in Constantinople while the exiled Justinian II's name is still on Benevento's coins (**A**),
Carthage fell to the Arabs two years ago (698, **A**), the Isis stones (hint 3).

**Iudaeus** (`iudaeus`) — a dyer and cloth-seller whose family is from Venosa (**H** for Benevento in 700;
**A** for Venosa). No distinctive dress was required in 700; he dresses like other townsmen, bearded,
sometimes with a dyer's apron. *Shalom*, the Sabbath, the epitaph formula "peace upon his resting place"
(**A** at Venosa, Hebrew 9th c.), reading Greek and Hebrew.

**Afer de Carthagine** (`afer`) — an African Latin refugee after 698 (**H**). Speaks "like Augustine".

## 4. Where they are (the game)

`getMapData().districts` give each quarter its walkers (weights in `WALKERS`): the curtis and the
Lombard quarter (arimanni, gasindi, Lombard women, slaves), the episcopium (clergy, monks, pilgrims,
beggars), the forum (merchants, country women, aldii, the Jew, the Greek, the rare Bulgar or African),
the decumanus and the western blocks (Latin townsfolk, children, the old), the eastern house (Greeks),
the gardens (aldii, slaves, children), the theatre (poor families), the river (millers, pilgrims on the
Appia), the lime-kilns, St Peter's (nuns), the cemetery, the Via Traiana (pilgrims, merchants).

**Stations** (`STATIONS`): guards at every gate and the palace; pilgrims and a merchant inside Porta
Aurea; a pilgrim kneeling at S. Ilario and a Greek couple outside it; the smith and his boy with the
anvil; the Greek house; the gasindi in the curtis; the gastald and slaves at the granary with sacks; old
Aio and a boy by Audoin's house (hint 2); Lombard women in the quarter; a slave in the duke's orchard
(hint 4); priest, deacon and beggar at the atrium, a pilgrim kneeling there; monks by the bishop's church;
two stalls at the forum and a knot of the Jew, the physician and a Bulgar; the notary, the physician,
goldsmith, baker, weavers with their loom, potter with pots, the widow, the house-oratory, the
sculdahis with petitioners, the inn by Porta Summa; women and children at the theatre; lime-burners with
a kiln heap; a guard at the chain tower; the miller and his slave with sacks; three washerwomen kneeling
at the Sabato; a monk and beggar at the Forty Saints; nuns at St Peter's; a Lombard woman kneeling at
the cemetery with an old man; an old woman at the walnut stump; a goatherd boy at the Iseum.

## 5. Making them (performance)

People exist only near the player: stations within 100 m (put away beyond 125 m), walkers made on a
street 40–95 m away, preferably behind the player or far into the fog, put away beyond 120 m. At most
24 people (18 on phones / small screens), one made every ~0.1 s. Bodies are the five scans; clothes are
the tailored outfit/body pairings of `src/npc.ts` plus two new cuts (`robe` on two bodies, `robeCloak` on
one; ~0.15–0.2 s each at load). Variety comes from dyes, fabric kinds, skin, hair and beard, size
(children), and gear (staff, apron, brooch, scrip, belt set, caps, helmets, baskets, jars, buckets,
sticks). See the commit notes for the measured numbers.

## 6. Uncertainties

- The bishop of Benevento in 700 is not known by name; nobody names him.
- Compositions of 60 and 50 solidi (Rothari 129–130) are quoted from memory of Drew's translation.
- Prices in tremisses (a horse for two solidi, a young slave for ten, a cartload of lime for a
  tremissis) are illustrative, not documented for Benevento in 700.
- Greek-speakers, Jews, the Bulgar and the African in the streets are reasoned choices, not records.
- The tree rite (riders, hide, eating strips of it) and the viper come from the *Vita Barbati*, a
  9th-c. text; the witches of the walnut are a 13th–17th-c. development. In the game both are rumour.
- Nuns' and clerics' dress in 700 was not yet standardised; dark wool and a veil for nuns, white linen
  for clergy at the altar, are the safe minimum.
- The Lombard hair style of Paul IV 22 belongs to the 6th-c. generation; the game leaves hair as scanned.
