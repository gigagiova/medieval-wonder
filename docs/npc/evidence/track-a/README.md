# Track A townsfolk (`?npc=a`): evidence

Built game (`npx vite build`, `vite preview`), `QUERY='&npc=a' node tools/npc3/game-capture.mjs
<base> <out> Forum,Episcopium,"Porta Aurea" 15 10`, and the same command without `QUERY` for the
default (v2) townsfolk. Headless SwiftShader; brightness auto-stretched in the sheets.

- `a-*.webp`: 12 Track A people (front and side, as captured: 7 of them walking or mid-step,
  2 talking): aldii and a boy in hoods, a Jew, a physician, two merchants, two pilgrims, a monk,
  two townswomen, an armed freeman.
- `main-*.webp`: the default townsfolk captured in the same places (the captures were stopped by the
  session's 30-minute limit, so the two sets overlap in two people only).
- `00-HananelIudaeus.webp`, `01-Stephanusnegotiator.webp`: the matched pairs from
  `tools/npc3/game-pairs.py` (main, then Track A).

Characters, licences and how they are made: `public/models/npca/CREDITS.md`, `tools/npca/README.md`.
