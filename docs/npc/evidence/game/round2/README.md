# In-game evidence, round 2: main `cb84d0a` against the fix (2 November 2026)

18 different townsfolk in the built game, matched by name across the two builds
(`tools/npc3/game-pairs.py`), front and side, **main left, fix right** in each
pair. The label gives the outfit and how far into the walk clip the person was
(`walk 1.00` = walking). Places: Forum, Episcopium, Curtis Ducis (`rH-*`);
Porta Aurea, Theatrum, Episcopium (`rI-*`). 10 of the 18 are mid-walk (walk weight above
0.5) in at least one view.

What changed since round 1, and where to see it:

- **Dark specks on light robes**: the priest (`rI-11`, main side view: dark
  shapes on the sleeve and shoulder cape). They were back faces of folded cloth
  drawn darkened; now only the inside near a hem, cuff or neckline is darkened.
- **People inside props**: the Episcopium group no longer stands in the well
  (standable(), src/main.ts).
- **Cloaks**: tried again as a trunk-skinned short mantle without springs and
  rejected; the tunic and robe came through it in every clip
  (`../mantle-rejected.webp`). They stay off.

Still visible in the fix:

- the priest's shoulder cape shows a pale-grey fold or two at its edge in the
  side view (`rI-11`): the shoulder cape's own inside, within the darkened rim;
- small dark dots at the women's girdle and skirt in the walk (`rH-01`,
  `rI-06`), in both builds;
- the veil standing off the head under a jar (round 1, `rG`), both builds.
