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
| 3 | `isisVipera` (The serpent-crowned Lady) | Iseum, the ruined temple of Isis, outside the east wall (660, 168) | Real dedication formula. A newer scratch says "under the dukes' apples" |
| 4 | `cisterna` (The serpent hollow) | Cisterna, below the duke's garden (Hortus Curtis, 566, -16); reached by a stair | An empty niche with the print of a snake. "Look at his altar." |
| 5 | `calix` (The chalice of Barbatus) | Altar of S. Maria, the bishop's church (Episcopium) | The idol became the chalice. The trail ends here. |

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
| obeliscus, apis, isisVipera | Iseum | Obelisks, the Apis bull, the serpent-crowned Isis | paraphrase / attested |
| perticae | Lombard cemetery | Paul the Deacon HL V 34: poles topped with wooden doves | attested |
| nux | The sacred walnut stump | Vita Barbati (viper trail 1) | legend |
| molendinum | The mill on the Sabato | The miller's breve | style |
| genius | The forum market | A base dedicated to the Genius of the colony | style |
| cisterna, calix | Viper trail 4 and 5 | See above | legend |

## Easter eggs

- **Paul the Deacon**: his story of Sesuald's head is on the Arch of Trajan, and his note on the
  *perticae* is at the Lombard cemetery.
- **Romuald I**: his tutor Sesuald (the Arch of Trajan) and his Christian wife Theodorada (the cistern).
- **Barbatus**: the relic label in the house oratory, the cut walnut, and the chalice on the altar.
- **The witches' walnut** (*la noce di Benevento*): its stump is by the Sabato, with the hide strips still
  in the brambles. Rothari's law on the *masca* lies in the judge's house. Together they are the seed of
  the later witch legend; in 700 it does not yet exist.
- **Isis**: the Iseum ruins, east of the walls. Its obelisk and Apis survive today in the town.
