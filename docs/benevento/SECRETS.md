# Beneventum, AD 700: secrets, explorables and easter eggs

Spoilers. Positions are world metres (x east, z south of 41.1305 N, 14.7745 E). In game, walk near a
readable and press **E** (or the *Lege* button) to read the Latin and its English. What you have found
is kept in the browser (`localStorage: beneventum-found-v1`) and shown in red on the map.
`getMapData()` exposes the same lists (`explorables`, `readables`, `districts`, `landmarks`).

Status of each text: **attested** (a real text, quoted), **paraphrase** (a real source retold),
**style** (invented in the manner of the period), **legend** (a real legend, or a story built on one).

## The trail of the golden viper

The *Vita Barbati* (9th c.) says the Lombards of Benevento worshipped a golden viper and a sacred tree,
and that Bishop Barbatus had the tree cut down and the viper melted into a chalice and paten. The
game turns this legend into a trail of five clues. Each clue points to the next one.

| # | Readable | Where | The clue |
|---|----------|-------|----------|
| 1 | `nux` (The stump by the Sabato) | Nux Sacra, by the Sabato (-330, 478) | The holy tree is cut down. "Ask an old man of the duke's people." |
| 2 | `domusAudoini` (An old soldier's keepsake) | Domus Audoini, an enterable house in the curtis quarter (444, -80) | The viper "sleeps where the Lady of the Egyptians lies in the mud" |
| 3 | `isisVipera` (The serpent-crowned Lady) | Iseum, the remains of the temple of Isis in the square before S. Maria (-33, -73): the relief propped against the podium | Real dedication formula. A newer scratch says "under the dukes' apples" |
| 4 | `cisterna` (The serpent hollow) | Cisterna, below the duke's garden (Hortus Curtis, 566, -16); reached by a stair | An empty niche with the print of a snake. "Look at his altar." |
| 5 | `calix` (The chalice of Barbatus) | Altar of S. Maria, the bishop's church (Episcopium) | The idol became the chalice. The trail ends here. |

### People who know (rumours along the trail)

The townsfolk (`src/npc/lines-people.ts`, see `PEOPLE.md`) pass on the trail as gossip, never as fact:

| Clue | Who says it | Where they are |
|------|-------------|----------------|
| 1, the stump | washerwomen at the Sabato; aldii (peasants) | below the mill; everywhere |
| 2, Audoin's keepsake | Aio, an old Lombard veteran who saw the tree | by Domus Audoini |
| 3, the Lady of the Egyptians | old women; the Greek merchant | the widow's house, the theatre, the walnut stump; the eastern house by Porta Aurea |
| 4, the hollow under the dukes' apples | slaves | the duke's orchard, the granary, the streets |
| 5, the chalice | Lombard women, priests, the nuns of St Peter | the curtis, the atrium of S. Maria, St Peter's |

## Places you can enter

These are the **interiors**: houses and workshops picked from the generated town nearest to their
intended place. Each one has a lit hearth, furniture for its trade, an upper storey, and one readable.
Each is a small culled zone with simple box collision.

| id | Kind | ~Position | Readable | Status |
|----|------|-----------|----------|--------|
| domusAudoini | house of a Lombard veteran | 444, -80 | An old soldier's keepsake (viper trail 2) | style |
| fabricaAurea | smithy by Porta Aurea | 354, -201 | Marks on the forge | style |
| hospitiumSummae | inn near Porta Summa | 513, 31 | Verses on the inn wall (Horace, *Sat.* I 5, on a Beneventan inn) | attested |
| domusNotarii | notary's house / school | 86, -143 | A deed of sale | style |
| horreumCurtis | granary of the curtis | 433, -178 | The tally sticks | style |
| aurifices | goldsmiths' workshop | 220, -102 | A gold coin of Benevento | paraphrase |
| figulina | potter / brick kiln | 147, -4 | A brick with a stamp | style |
| textrinum | weaving house | 280, -19 | A spindle whorl | style |
| domusGraeca | house of an eastern family | 331, -239 | A small icon (Greek) | attested (Psalm text) |
| cellaVinaria | wine cellar, trapdoor | 101, -209 | Chalk on the trapdoor | style |
| medicus | physician | 24, -37 | A page of Isidore, *Etym.* IV 1, 1 | attested |
| pistrinum | bakery | 181, -144 | The baker's marks | style |
| oratoriumDomus | house oratory | -145, -193 | A relic label: dust of St Barbatus' tomb | style |
| domusSculdahis | house of the *sculdahis* (local judge) | -260, -275 | A law of King Rothari (Ed. Roth. 376, on the *masca*, the witch) | attested |
| domusVidua | widow's house | 252, -155 | A psalm line (Ps. 145, 9) | attested |
| domusFabri | carpenter's house | -43, -230 | A pilgrim's scratch | style |

Underground and high places:
- **Cisterna**: a Roman cistern under the duke's garden. A long stair leads down to a niche (viper trail 4).
- **Catacumbae / Crypta**: the hypogeum and crypt at Sancti Quadraginta, west of the town.
- **Turris Catenae**: the chain tower on the Sabato. Its room is enterable and holds the watch roll.
- **Bibliotheca**: the bishop's library and scriptorium, beside S. Maria.

## Readables at the monuments

| id | Where | What | Status |
|----|-------|------|--------|
| arcusInscriptio | Arch of Trajan (Porta Aurea), attic | CIL IX 1558, the real dedication | attested |
| sesualdus | Arch of Trajan, pier | A scratched head: Sesuald's head thrown into the town in 663 (Paul the Deacon, HL V 7-8) | paraphrase |
| sacramentum | Arch of Sacramento | Clamp holes, where the marble facing was robbed | style |
| theatrum | Roman theatre, stage wall | A name scratched by a family living in the arcades | style |
| calcaria | Amphitheatre | The lime-burner's tally: the monument is going into the kiln | style |
| catena | Turris Catenae | The watch roll | style |
| hilarius | S. Ilario ad Portam Auream | The altar | style |
| obeliscus, apis, isisVipera | Iseum, before the bishop's church | The fallen obelisk, the Apis bull, the serpent-crowned Isis; granite sphinxes guard the atrium gate | paraphrase / attested |
| perticae | Lombard cemetery | Paul the Deacon HL V 34: poles topped with wooden doves | attested |
| nux | The sacred walnut stump | Vita Barbati (viper trail 1) | legend |
| molendinum | The mill on the Sabato | The miller's breve | style |
| genius | The forum market | A base dedicated to the Genius of the colony | style |
| cisterna, calix | Viper trail 4 and 5 | See above | legend |
| pontisTitulus | Ponte Leproso, the parapet over the middle arch (upstream) | The names of Valentinian, Valens and Gratian, who restored the bridge (367-375) | paraphrase |
| castellum | Castellum Aquae, by the open arch | The Roman water-castle of the Serino aqueduct | paraphrase |
| rocca | Castellum Aquae, on the Lombard watch platform | Easter egg: the Torrione, the castrum and the Rocca dei Rettori that will stand here | paraphrase |
| sophia | Hortus Curtis, by the ring of Roman columns | Foreshadowing S. Sofia (c. 760) and its six Roman columns | paraphrase |

## Easter eggs

- **Paul the Deacon**: his story of Sesuald's head is on the Arch of Trajan, and his note on the
  *perticae* is at the Lombard cemetery.
- **Romuald I**: his tutor Sesuald (the Arch of Trajan) and his Christian wife Theodorada (the cistern).
- **Barbatus**: the relic label in the house oratory, the cut walnut, and the chalice on the altar.
- **The witches' walnut** (*la noce di Benevento*): its stump is by the Sabato, with the hide strips still
  in the brambles. Rothari's law on the *masca* lies in the judge's house. Together they are the seed of
  the later witch legend; in 700 it does not yet exist.
- **Isis**: the Iseum's remains in the town's heart, before the bishop's church, where a red-granite sphinx was dug up in 2009 and where the obelisk stood by 1597 (today in Piazza Papiniano). The Apis survives on Viale San Lorenzo. The sphinxes at the atrium gate are a Christian church guarded by Egyptian beasts, as the trail's last step turns the idol into a chalice.
- **The Rocca dei Rettori**: climb the water-castle outside Porta Summa to the Lombard lookout; the
  readable there tells of the Torrione (871/875), the castrum and the papal Rocca (1321) to come.
- **S. Sofia**: six Roman columns stacked in the dukes' orchard, two holding up a vine: sixty years on,
  Arechis II will raise his star-shaped church here round six such columns.
- **The marble bridge**: the three emperors' names on the Ponte Leproso's parapet.
