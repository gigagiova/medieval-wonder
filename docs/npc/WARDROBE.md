# Townsfolk wardrobe: belts, necklines, wrists and cloth clearance

State of 29 October 2026. This replaces the lost `docs/npc-audit/` notes (see
[Lost work](#lost-work)). Requirements per population group and outfit, with
sources and certainty: [`tools/npc3/wardrobe.json`](../../tools/npc3/wardrobe.json).
Historical claims are summarised in [`../benevento/HISTORY.md`](../benevento/HISTORY.md)
("Belts and girdles by role"); the groups themselves in
[`../benevento/PEOPLE.md`](../benevento/PEOPLE.md).

## What the owner asked for, and what is done

| Priority | Done | Where |
|---|---|---|
| 1. Keep the accepted faces | The six v2 bodies were edited in place, not re-baked. The body, head, eyes, skin weights, bones and images are checked bit-identical against the pristine files by `gltfio.body_digest` on every build (only the body's `_HIDE` bits, which drop covered triangles, may gain bits, never on the head or neck). | `tools/npc3/gltfio.py`, `wardrobe_build.py` |
| 2. Wrist bend ~0° | Every hand is turned onto its forearm's line after all other pose corrections (`straightWrists`). Hands that hold something use `grasp`: the fist closes round a bar with the wrist straight, and the roll round the bar and a short slide along it are searched so that the elbow is reachable. The shield now hangs from the fist (grip fore and aft); the sword hand rests over the pommel. | `src/npc.ts` |
| 3. Belts by role | Leather strap (bronze buckle for Lombard men, iron for townsmen; Lombard office-holders keep their multi-part set; the seax for armed men without a cloak), cord (monks: hemp; priests and deacons: white linen cingulum; slaves and beggars: hemp), woven sash girdle for all women. Each belt cinches the cloth physically with the panels' dimensions kept. | `tools/npc3/wardrobe_build.py`, `src/npc/population.ts`, `src/npc2/kit.ts` |
| 4. Complete collars | Every neckline and sleeve cuff of the body garments has a turned-in facing: a 4 mm rim and a 2.5 cm band inside, facing the body. | `wardrobe_build.py` (`facing`) |
| 5. No crossings, natural motion | Garment vertices are pushed out of limb capsules on the GPU after skinning (legs and feet under skirts, hands in sleeves, arms and shoulders under cloaks and hood capes); skin strips left visible under long garments are hidden; split seams share one skin. Crossings are measured per frame over full loops. | `src/npc2/push.ts`, `wardrobe_build.py`, `tools/npc3/audit.mjs` |

## Belts: how the cinch works

A belt's job is to gather a loose garment at the waist. The rejected
"belted-tunic study" reshaped the tunic's panels to fit the belt; here the
panels keep their size and the cloth gathers instead:

1. The garment (welded at its texture seams) is solved as a cloth in its bind
   pose: Jacobi projection of every edge to its authored length (Müller et
   al., *Position Based Dynamics*, 2007) and weak bending pairs (the compliant
   form of Macklin et al., *XPBD*, 2016); collision against the body skin
   (3 mm clearance) near the belt; the shoulders and sleeves fixed.
2. A band of the belt's height is drawn in, gradually, to the convex hull of
   the waist (a strap under tension spans the small of the back) plus 1.5 cm
   of gathered cloth, but never more than 1.2 cm at the back and 4.2 cm at the
   front from where the cloth hung: the cloth hanging straight from the
   shoulder blades has no length to spare for the hollow of the back.
3. Triangles that would turn over are eased back while the solve continues.
4. The result is accepted only if the garment's dimensions hold: per-edge
   length change (judged per centimetre on sub-centimetre edges) at most 3 %
   at the 99th percentile and 20 % on the worst edge, and every hem, neck and
   cuff perimeter within 1 %. If not, the belt is drawn in less (`alpha`).
5. Cloth under and next to the belt takes the body's skinning there, so belt,
   cloth and body move together; the belt ring is skinned like the body and
   its hanging ends like the cloth they lie on (its spring bones), offset
   outward, so they swing with the skirt.

The gown is cut with a fitted bodice: its girdle is tied over it and nothing
is drawn in.

Per-garment numbers: [`evidence/wardrobe-build-report.json`](evidence/wardrobe-build-report.json).

## Cloth clearance at run time

`src/npc2/push.ts` projects each garment vertex out of up to 12 capsules after
skinning, in the vertex shader (the capsule colliders of game cloth, NVIDIA
NvCloth, Unity Cloth; here a projection, not a simulation). The capsules
follow the bones; each radius is measured once per person from what actually
lies beneath that garment in that outfit (visible skin and lower layers, e.g.
the hose under a skirt, the shirt sleeves under a cloak) plus 8 mm. CPU cost:
the capsule ends, once per animated frame. The audit applies the identical
projection on the CPU.

## Measuring

- `tools/npc3/audit.mjs`: for 15 people covering all ten outfit profiles and
  the belt styles, each of idle, walk and talk is stepped through one full
  loop at 30 fps; every frame counts the visible vertices of an inner layer
  that have come out through an outer layer (`src/npc2/audit.ts`), per layer
  pair, and the wrist bend of both hands.
- `tools/npc3/capture.mjs`: matched close-ups (front, side, back, neck, waist,
  hands, feet) in each clip, for the old and the new build side by side.

Results and image paths: [`evidence/README.md`](evidence/README.md).

## Lost work

A previous agent's workspace failed before its NPC experiments were committed.
These are **not** in the repository or on GitHub and could not be recovered:

- `docs/npc-audit/` (including `README.md`, `CONTINUATION.md`, `CLOAKS.md`,
  `TUNIC-CUT-CONSTRUCTION.md`), and the local caches under `/workspace/npc-audit/`
  that several documents still name as the place of retrieved research
  (`docs/benevento/JEWISH-PRESENCE.md`, `INTERIOR-ANALOGUES.md`,
  `UNDERGROUND-RESEARCH.md`, `PIAZZA-PACCA.md`, `MISSING-CHURCHES.md`,
  `WORLD-VALIDATION.md`, `TRAJAN-RELIEF-ASSETS.md`, `trajan-relief-world/README.md`;
  `tools/capture-churches.py`, `tools/bake-trajan-*.py`). Those paths are
  dead; the documents' own text and URLs are what remains.
- `tools/npc3/wardrobe.json` (35 groups, ten outfit profiles): rebuilt from
  scratch here, from `population.ts`, `PEOPLE.md` and the sources listed in it.
- `tools/.cache/prototypes/` and these experiments, none resumed:
  - `wrist-alignment-zero/` (neutral-wrist preview needing new cloth targets
    and baking): superseded by the run-time `straightWrists`/`grasp`, which
    needs no re-bake;
  - `codim-native/welded-wide-clearance-v1/` (frames 151–189 passed, frame
    190 failed with 14 left-upper-arm crossings): not resumable; its native
    character assets were never shipped (the shipped bodies are the MPFB v2
    bodies), and its checkpoints are gone;
  - `belted-tunic-study/` (rejected for distorting the cloth): not resumed by
    design;
  - `codim-native/belt-tightening-authoring-v1/` (belt fitting keeping the
    panel dimensions, completion unknown): its idea is re-done from scratch
    on the shipped bodies by `wardrobe_build.py`.

## Rebuilding

```sh
# the pristine bodies (as baked by tools/npc2), e.g. from commit df5b806:
mkdir -p /tmp/npc2-src && for b in m_young m_mid m_old m_elder w_young w_mid; do git show df5b806:public/models/npc2/$b.json > /tmp/npc2-src/$b.json; done
python3 tools/npc3/wardrobe_build.py /tmp/npc2-src public/models/npc2   # numpy + scipy; ~25 min
mv public/models/npc2/wardrobe-build-report.json docs/npc/evidence/
```

The build refuses a body it has already processed (`meta.npc3`).
