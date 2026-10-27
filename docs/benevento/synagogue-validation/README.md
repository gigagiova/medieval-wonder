# Synagogue geometry review

`prayer-room.png` and `exterior.png` show the implemented prayer room on actual
selected lot795, using production materials under neutral audit lighting.
`control-domestic.png` is the **generic domestic furnishing control in the same
shell and camera**, not the previous map state: the old selected building was
not an explorable domestic interior. These screenshots exclude nearby buildings.

The existing lot is approximately5.47 ×5.08m, near the later Piano di Corte
quarter, without moving its footprint. Its doorway is at world
`[517.513,-102.246]`; the scroll/readable anchor is `[519.190,0.95,-100.346]`
before the usual terrain placement. The cupboard wall points southeast
`[0.507,0.862]`, the closest available side/back wall toward Jerusalem.

Visual review: doorway opens into a compact prayer room with a clear route;
the timber cupboard, reading table/open scroll and wall seating are visible.
There is no domestic hearth, bed, Christian altar, crucifix or modern signage.
The isolated light is for inspecting geometry; whole-world dusk appearance is a
separate check. Archaeological interpretation belongs in `JEWISH-PRESENCE.md`.

`render-check.json` records5 draws/18,068 submitted triangles for the prayer-room
fixture versus6/17,484 for the domestic furnishing control. Both include the
same shell/roof and audit floor; these are not net world-budget deltas. The
doorway collision ray from outside returns zero hits; furniture has matching
solid collision proxies. No browser page errors were recorded.

To inspect interactively, serve the repository with Vite and open
`/tools/synagogue-audit.html`. `window.render(false,'inside')` shows the prayer
room; `window.render(false,'outside')` shows the entrance;
`window.render(true,'inside')` shows the domestic furnishing control.
