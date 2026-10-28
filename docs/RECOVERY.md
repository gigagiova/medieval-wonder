# Recovery record: the lost Codex NPC workspace (28 October 2026)

The Codex cloud environment failed before it committed its remaining work. On 28 October 2026 the takeover session checked every possible source for that work.

## What was checked

- **GitHub.** The repository has only two branches, `main` and `claude/medieval-town`. `main` is at `df5b806`, which is the last published commit. No ref on GitHub contains `docs/npc-audit/`, `tools/npc3/` or any of the experiment folders.
- **The old workspace.** The takeover environment has no `/workspace`. That means `/workspace/medieval-wonder`, `/workspace/npc-audit/` and the untracked `tools/.cache/prototypes/` and `tools/npc3/` were not reachable.
- **The owner's computers.** No Remote Control folder was available to this session.

## What is missing and was not resumed

None of the following could be recovered. Later work does not continue them; it rebuilds from the committed code (`src/npc2/*`, `tools/npc2/*`).

| Item | Last known state, from the owner's handover message |
|---|---|
| `docs/npc-audit/` | Audit notes, among them `CONTINUATION.md`, `CLOAKS.md`, `TUNIC-CUT-CONSTRUCTION.md` and `README.md` |
| `/workspace/npc-audit/` | Simulation data, screenshots and research caches, including the evidence that several `docs/benevento/*.md` files cite |
| `tools/.cache/prototypes/` | The native asset cache |
| `tools/npc3/` | NPC authoring tools |
| `tools/npc3/wardrobe.json` | Requirements for 35 population groups and ten outfit profiles |
| `wrist-alignment-zero/` | A neutral-wrist preview that passed selected checks and still needed new cloth targets and baking |
| `codim-native/welded-wide-clearance-v1/` | Frames 151–189 passed. Frame 190 failed with 14 cloth/body crossings on the left upper arm. Stopped; not production-ready |
| `belted-tunic-study/` | Rejected, because it distorted the cloth dimensions |
| `codim-native/belt-tightening-authoring-v1/` | Physical belt fitting that kept the original panel dimensions. Frames 0–3 were checked and frame 4 saved; whether it finished is unknown. It still needed arm lowering and locomotion baking |

## Dangling references

Some committed documents still link to `docs/npc-audit/*` or cite `/workspace/npc-audit/*` as evidence:

- `docs/REALISM.md`
- `docs/benevento/HISTORY.md`
- `docs/benevento/WORLD-VALIDATION.md`
- `docs/benevento/TRAJAN-RELIEF-ASSETS.md`
- `docs/benevento/JEWISH-PRESENCE.md`
- and others

Treat those claims as unverifiable, unless the same evidence is also committed under `docs/benevento/*-validation/`.

## What is committed and usable

The native-cloak runtime is on `main` and builds: `src/npc2/native-cloak.ts`, `src/npc2/clearance.ts`, and the kit and springs changes. The validation folders under `docs/benevento/` are committed with their images.
