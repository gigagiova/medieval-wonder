# Usable source imagery for the Arch of Trajan reliefs

Research checked 27 October 2026. This is exact-monument imagery, not substitute Roman sculptures. No production source changed during this asset search.

## Recommended first candidates: CC0 photographs

Three full-resolution photographs by **Bernard Gagnon / User:Bgag**, taken 26 April 2022, are explicitly dedicated under **CC0 1.0**. Commons imageinfo metadata states `AttributionRequired: false`, `LicenseShortName: CC0` and `License: cc0`. Credit is still recommended for provenance. Originals were successfully downloaded and visually inspected.

| File | Resolution | Visually verified content | Source |
|---|---:|---|---|
| Arch of Trajan (Benevento) 03.jpg | 4313 × 3081 | Complete upper right pier relief of overlapping draped figures; also a full narrow Victories/trophy band below. Near-frontal, with low-angle perspective. | [Commons description / licence](https://commons.wikimedia.org/wiki/File%3AArch_of_Trajan_%28Benevento%29_03.jpg) |
| Arch of Trajan (Benevento) 04.jpg | 3334 × 4668 | Complete right attic relief beside inscription, emperor and kneeling figure/personification, with cornice/frieze context. Near-frontal, low-angle perspective. | [Commons description / licence](https://commons.wikimedia.org/wiki/File%3AArch_of_Trajan_%28Benevento%29_04.jpg) |
| Arch of Trajan (Benevento) 05.jpg | 5094 × 3120 | Complete wide alimenta scene in passage, with distribution table, children, damaged heads, foliage borders and coffered vault context. | [Commons description / licence](https://commons.wikimedia.org/wiki/File%3AArch_of_Trajan_%28Benevento%29_05.jpg) |

Licence: https://creativecommons.org/publicdomain/zero/1.0/
Photographer: https://commons.wikimedia.org/wiki/User:Bgag

The descriptions above identify visually obvious placement/composition. The Commons metadata only says “Detail of Arch of Trajan in Benevento, Italy”; it does **not** establish every scene's historical interpretation. Do not assign a precise named event solely from these filenames.

Original files and preserved API metadata:
`/workspace/npc-audit/trajan-relief-assets/` (not game-distributed assets).
`commons-category-metadata.json` preserves the per-file artist, licence, source URL, dimensions and descriptions.

Approximate initial crop guides, as percentages of original image, to verify before use:

- 03 main relief: x25–72%, y10–65%; retain all figures, remove surrounding column shafts and sky. Its complete narrow Victory band is separately available beneath it.
- 04 attic relief: x19–67%, y27–65%; preserve kneeling figures at bottom.
- 05 passage relief: x14–86%, y27–86%; include the full width, avoid sky and later adjoining building.

## Candidate limitations and production requirements

These images have strong directional sunlight and cast shadows. They are suitable as source appearance and detailed reference, but **grayscale is not measured relief height**: dark cast shadows become false pits if converted directly into depth. A careful photo-plane prototype, manually guided shallow relief, or a genuine scan bake should be compared under matched moving-light and oblique views. Any inferred depth is an artistic reconstruction, not photogrammetry.

A 1024² atlas of three fields plus a narrow ornament band can meet the current world texture-size cap; mipmapped GPU memory and new draw calls must still be counted. Full-resolution source JPEGs should remain outside the runtime package. Preserve original aspect ratios when mapping the wide passage scene; stretching it into a tall pier register is visibly wrong. Repeating a single relief into every register is also not an accurate reproduction.

## Additional exact-monument photographs with verified reusable licences

These alternatives provide more scene diversity, but require attribution and ShareAlike when adapted. Their listed dimensions/licences/authors come from Commons imageinfo metadata; the three CC0 originals and several named comparison photographs were downloaded and visually inspected in this pass.

| File | Resolution | Author | Licence | Source |
|---|---:|---|---|---|
| Arco di Traiano (Benevento), Gli Dei dell’Olimpo attendono Traiano.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_Gli_Dei_dell%E2%80%99Olimpo_attendono_Traiano.jpg) |
| Arco di Traiano (Benevento), Il sacrificio della cerimonia per l'apertura della via Traiana.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_Il_sacrificio_della_cerimonia_per_l%27apertura_della_via_Traiana.jpg) |
| Arco di Traiano (Benevento), L'istituzione a Benevento, nel 101 dell'Institutio alimentaria.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_L%27istituzione_a_Benevento%2C_nel_101_dell%27Institutio_alimentaria.jpg) |
| Arco di Traiano (Benevento), La stabilità e la sicurezza raggiunta dall'Impero sotto Traiano.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_La_stabilit%C3%A0_e_la_sicurezza_raggiunta_dall%27Impero_sotto_Traiano.jpg) |
| Arco di Traiano (Benevento), Nel campo di Marte, dinanzi al tempio del dio, Traiano, con Adriano al fianco e seguito dai littori, riceve dai due consoli, alla presenza della dea Roma.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_Nel_campo_di_Marte%2C_dinanzi_al_tempio_del_dio%2C_Traiano%2C_con_Adriano_al_fianco_e_seguito_dai_littori%2C_riceve_dai_due_consoli%2C_alla_presenza_della_dea_Roma.jpg) |
| Arco di Traiano (Benevento), Traiano appare in primo piano a sinistra seguito dai littori. Il tema è forse legato alle provvidenze per i veterani nelle regioni del Reno e del Danubio.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_Traiano_appare_in_primo_piano_a_sinistra_seguito_dai_littori._Il_tema_%C3%A8_forse_legato_alle_provvidenze_per_i_veterani_nelle_regioni_del_Reno_e_del_Danubio.jpg) |
| Arco di Traiano (Benevento), Traiano fa il suo ingresso a Roma nell'estate del 99, dopo aver sistemato il confine renano della provincia della Germania superiore di cui era governatore all'atto della sua proclamazione ad imperatore.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_Traiano_fa_il_suo_ingresso_a_Roma_nell%27estate_del_99%2C_dopo_aver_sistemato_il_confine_renano_della_provincia_della_Germania_superiore_di_cui_era_governatore_all%27atto_della_sua_proclamazione_ad_imperatore.jpg) |
| Arco di Traiano (Benevento), Traiano è accolto dai Geni del Popolo Romano, del Senato e dell'Ordine Equestre.jpg | 6000 × 4000 | Mongolo1984 | CC BY-SA 4.0 | [File](https://commons.wikimedia.org/wiki/File%3AArco_di_Traiano_%28Benevento%29%2C_Traiano_%C3%A8_accolto_dai_Geni_del_Popolo_Romano%2C_del_Senato_e_dell%27Ordine_Equestre.jpg) |

Additional collection: Following Hadrian has numerous 3,264–4,928 px exact relief photographs, mostly CC BY-SA 2.0, including the sacrifice scene, alimenta scene, Trajan received by Rome, Dacia personification and vaulted ceiling. Their full metadata and direct URLs are in the preserved API file. The earlier cached `Benevento arco di Traiano.JPG` is by **Camster2**, 3,264 × 2,448, CC BY-SA 3.0 (other licences also offered); it depicts *Receptio in fidem di principi barbari* according to the file description.

Category verified via API:
https://commons.wikimedia.org/wiki/Category:Arch_of_Trajan_(Benevento)_-_Reliefs

No downloadable 3D scan was independently verified in this subtask; the parent agent is investigating scan candidates separately. Do not infer download permission from a viewable Sketchfab page.

## Scene 03 cross-check

The Bernard Gagnon 03 field was matched visually against Mongolo1984's photograph
“Arco di Traiano (Benevento), La stabilità e la sicurezza raggiunta dall’Impero
sotto Traiano.jpg” (`named-0.jpg` in the working reference directory): identical
head profiles, armoured foreground figure, rear nude deities and drapery confirm
that they depict the same field. “Imperial stability and security” is the Commons
uploader's identification, not a newly verified scholarly attribution. The named
comparison photo has softer illumination and 6000 × 4000 resolution, but its
CC BY-SA 4.0 licence differs from the recommended CC0 source.

The named “Traiano è accolto dai Geni del Popolo Romano, del Senato e dell'Ordine
Equestre” photograph was also inspected and is a different field; do not label
source 03 as that scene.

## Integration manifest: 14 distinct fields

The final source selection is `/workspace/npc-audit/trajan-relief-assets/field-manifest.json`.
Each entry has a unique working filename, original title/source/author/licence,
integer pixel crop, optional perspective quad **TL, TR, BR, BL**, a field `slot`,
and visual-quality notes. There are 14 distinct slots: eight pier fields, four
attic fields and two passage fields. No photograph is repeated as a different
narrative scene.

Placements were corrected by direct visual comparison against full facade
photographs. **Gagnon's Arch of Trajan (Benevento) 01 and 02 both show the city
face**, despite differing viewpoints. His detail 03 is city upper-right; his
detail 04 is country attic-right. Photo filenames/counters and generalised scene
captions are not sufficient evidence of placement. Earlier working messages
misidentified the 01 facade as country-facing; that was corrected before the
manifest was frozen.

The full country-facing photograph is Phil Tizzani's
[Benevento-Arch of Trajan from North.jpg](https://commons.wikimedia.org/wiki/File:Benevento-Arch_of_Trajan_from_North.jpg),
CC BY-SA 2.0. Five crops provide the remaining country fields with approximately
250–350 pixels per field. Those fields are intentionally documented as lower
resolution than dedicated close-ups. They were all visually checked in
`country-crop-check.jpg`: each contains a distinct complete field.

The city attic-left close-up contains a real pigeon sitting on a carved head.
It was rejected and replaced with the same field from Gagnon's CC0 full-facade
photo, avoiding baking a contemporary bird into the sculpture. The two passage
scenes from Mongolo1984 are perspective views: the manifest includes quads for
rectification. Gagnon's CC0 05 is an alternate frontal **alimenta** scene, not the
sacrifice scene (the preliminary visual label was corrected after comparing the
bread table/children against the separate sacrifice photograph with a bull).

All scene labels remain uploader descriptions, not new scholarly iconographic
claims. Slot mapping instead follows visible sculpture and facade context.
The sacrifice is on the left when exiting the city (local -x); alimenta is on
the right (local +x), following the monument description in
[Italian Wikipedia, decoration section](https://it.wikipedia.org/wiki/Arco_di_Traiano_(Benevento)#La_decorazione_scultorea).

### Credits required for derived atlas

- Bernard Gagnon / User:Bgag: CC0 1.0, city attic-left and country attic-right.
- Mongolo1984: CC BY-SA 4.0, the seven dedicated scene fields in the manifest.
- Phil Tizzani: CC BY-SA 2.0, five country-facade field crops.

A distributed derived atlas must credit these authors, link the individual source
pages and licences, identify cropping/perspective correction/appearance changes,
and carry the applicable ShareAlike licence. The working manifest provides the
per-field source links. Preserve that provenance with the shipped derived asset;
research-only files outside the repository are not a runtime attribution record.
