# Full-world missing-site review

Production build at390×844, original game lighting/materials, three named
teleports: Sanctus Modestus, Sanctus Petrus ad Forum, Sepulcra Sancti Petri.
Run tools/capture-missing-sites-world.py against the built site. report.json
records camera, drawcalls/triangles and errors, with a second performance sample
after each screenshot. Software-rendered timings are not iPhone benchmarks.

For historical identification and uncertainty, see MISSING-CHURCHES.md and
PIAZZA-PACCA.md one directory up. The map labels are the reconstruction's names,
not evidence that the ad Forum alias or AD700 plans were independently verified.

Observed unlit samples: San Modesto93,728triangles/63draws; San Pietro
141,398/65; burial room234,240/59. All are below350,000/130. The first
three images preceded the final location-title labels; geometry/materials
are identical. The lantern subdirectory checks the player-operated lantern
and current parchment map on the release build.
