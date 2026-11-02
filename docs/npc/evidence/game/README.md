# In-game evidence: main against the fix (2 November 2026)

Real townsfolk in the built game, not a test rig. Each sheet is one person in
their own clip at that moment (walking, talking or standing as the town
directs them), front and side, **main on the left of each pair, the fix on the
right**, same person, same place, same camera. Brightness is stretched so the
dusk can be read.

Made with `tools/npc3/game-capture.mjs` (two builds served side by side, the
camera put 1.9 m from each person through the game's own teleport) and
`tools/npc3/game-pairs.py`. Headless SwiftShader, 540×720.

| Run | Main build | Place | People |
|---|---|---|---|
| `rD-*` | `b4f8f6a` | Forum, Porta Aurea | Iudaeus, negotiator, medicus, Vulgar de Sepino (Bulgar), two arimanni |
| `rE-*` | `b4f8f6a` | Episcopium, Curtis Ducis | presbyter, mendicus, diaconus, arimannus |
| `r4-*` | `cd9bc69` (same NPC code as `b4f8f6a`) | Porta Aurea | two peregrini (robe and hood), two arimanni, negotiator, puer, faber |

15 different people (the two `rD` arimanni are the two in `r4`, seen again).
`*-people.json`: who each is, the outfit and the clip weights at capture.

What main shows and the fix does not:

- **Torn capes**: cloaks cut through by the tunic and robe beneath, ragged
  front edges (`r4-00`, `r4-05`, `r4-06`, `rD-03`, `rE-03`). The fix leaves
  the cloak off (the same tunic or robe, belt and boots).
- **Twisted arms and glitchy hands**: the arm IK for the spear, shield and
  sword pommel (`rD-03`: the forearm wrenched across the body to the pommel;
  the shield on the arm bulging out of the side). The fix: arms keep their
  clip, spear in the fist, shield on the back, free left hand.
- **Shapes out of the body**: dark flaps at the sleeves and pale or blue patches
  in the tunic skirt (`r4-01`: hose through the skirt). The fix: small push
  capsules, no forearm capsule, no hose above the knee.
- **Belt**: the row of black tabs (`rD-03`) is now a slim set with tapered
  bronze strap ends.

Still visible in the fix (not caused by this work, open):

- the priest's and deacon's white robes show a few dark specks (the cloth's
  inner faces where the robe folds) at the elbows and the skirt (`rE-00`, `rE-02`);
- people standing inside the well's rim at the Episcopium (`rE-01`, `rE-02`):
  a station placed on the well, a population/map placement issue;
- a bright highlight on the arimannus's left boot near the brazier (`rE-03`,
  both builds).

A few side views are blocked by a wall next to the person (the camera has no
line-of-sight check).
