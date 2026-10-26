# Instructions for coding agents

Read `docs/HANDOVER.md` first: it has the project state, the open defects and the map of the code.

## The project

A mobile-first Three.js browser game: **Lombard Benevento in AD 700**. You walk through it at 1:1 scale, at dusk, in fog.
It should feel historical and anthropological, with a mysterious, quasi-magical mood.
The owner reviews on an iPhone, and frame rate on a phone is a hard constraint.

The README intro still describes the earlier "Abbatia Nebularum" prototype. The techniques it lists are current, but the setting is now Benevento.

## Working branch

- Work from `main`, the default branch. On 26 October 2026 it was fast-forwarded to `claude/medieval-town`, where all earlier work was done.
- Open pull requests against `main`.

## Build and check

```sh
npm ci
npx tsc --noEmit -p .   # must pass
npx vite build          # static site in dist/ (base './', so it works from any sub-path)
npx vite preview        # serve the build
```

There is no unit test suite. Verify changes by building the game and looking at it, for example with headless Chromium and screenshots.

URL flags:

| Flag | Effect |
|---|---|
| `?debug` | Performance HUD (`src/perf.ts`): fps, ms per subsystem, triangles, draw calls |
| `?at=<name>` | Start at a named teleport, matched by substring, e.g. `?at=Templum`, `?at=Curtis`, `?at=Pons`, `?at=Caballum`. Names are built in `src/world.ts` (`getTeleports`) |
| `&yaw=`, `&pitch=` | Camera direction, used with `?at=` |
| `?shot=x,y,z,yaw,pitch` | Place the camera; used for headless screenshots |
| `?npc=v1` | The older townsfolk. The default is v2 (`src/npc2`) |

The `*-test.html` pages at the root are isolated test scenes (npc, props, palace, forest and others). Open them with `npx vite`.

## Hard rules from the owner

- **Follow the urban plan exactly.** It is `docs/benevento/urban-plan-reference.webp`, registered in `src/benevento/geo.json` and `layout.ts`:
  - grey blocks are built;
  - green areas stay open;
  - drawn building outlines are footprints.

  Do not invent a layout that deviates from it.
- **Be historically accurate for AD 700**, with sources. Record evidence and certainty (attested / inferred / hypothesis) in `docs/benevento/HISTORY.md`. Mark guesses as guesses.
- **People** are Lombards, Latins, clergy and monks, and a few Greek or Eastern traders. Skin tones range from fair to olive to light tan only; the owner considers anything darker historically wrong for this setting. Clothing must look like coarse, rough period cloth, not smooth or synthetic.
- **Realism without plastic**, without a grain overlay on the fog, and with no impossible shadows. Before inventing a technique, search for published solutions and cite them (see `docs/REALISM.md`).
- **Phone budget.** At street level in the `?debug` HUD at 390×844, stay at or below about 350k triangles and about 130 draw calls. Keep texture memory low: an iPhone has crashed on it before. Textures are capped at 1024² for the world and 512² for props, with KTX2 where available. There is a single quality mode; do not add a quality toggle.
- **Never commit secrets.** The repo has never contained an API token, and it must stay that way. Tools that need Sketchfab read the environment variable `SKETCHFAB_TOKEN`.
- **Show before/after evidence.** Every visual change needs screenshots from the same view, and every performance change needs `?debug` numbers.

## Asset formats

The build has run on a static host that cannot serve some file types, so keep these formats unless the owner moves hosting:

- Models are JSON glTF (`.json`) with embedded buffers and external `.webp` textures, not `.glb`. They load through `src/gltf.ts`, which turns data URIs into Blob URLs for iOS Safari.
- KTX2 textures are named `*.ktx2.wasm` (plain KTX2 inside). See `src/ktx2.ts`.
