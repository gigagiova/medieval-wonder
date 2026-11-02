# Track A townsfolk (`?npc=a`): packing

Artist-made characters whose clothes were modelled and skinned with the figure (no garments
layered over a body at run time). Sources, all CC0, by Quaternius (free "Standard" editions on
itch.io, name-your-own-price at 0):

- https://quaternius.itch.io/modular-character-outfits-fantasy → unzip into `<dl>/mcof/`
- https://quaternius.itch.io/universal-base-characters → unzip into `<dl>/ubc/`

(itch.io's free download: POST `<page>/download_url` with the page's `csrf_token`, open the
returned URL, then POST `<page>/file/<upload_id>?source=game_download` with that page's
`csrf_token`; the `key` that `tools/fetch-npc.ts` sends is now refused.)

```sh
python3 tools/npca/build.py <dl> public/models/npca     # numpy + Pillow
node tools/npca/simplify.mjs public/models/npca         # meshoptimizer, open edges locked
```

`build.py`: one skeleton per sex renamed to Mixamo's bones; every outfit part a node
`P_<part>`; head and neck cut from the base character; the ankle-length skirt for robes and
gowns generated under the tunic's hem; cloth and skin atlases (1024²). Run time:
`src/npca/kit.ts` picks the parts per outfit profile and merges them into two meshes.

Checks: `node tools/npca/shots.mjs <outdir> 15000 name=http://127.0.0.1:<port>/npc-test.html?npc=a&view=lineup&anim=walk&focus=0&cam=side`
(the test page), and `QUERY='&npc=a' node tools/npc3/game-capture.mjs ...` in the built game.
