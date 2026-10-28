# Missing churches: geometry and placement checks

Matched outside views use production builders, fixed studio illumination and
neutral context ground. These isolated views do not show the full town, NPCs,
fog, or street grading. After views use the final4.2m San Pietro and4m San
Modesto elevations. The before Pietro view uses the original6.1616m house;
before Modesto shows the unbuilt site. Interior after views show the altar,
cross, lamp and continuous enclosure without domestic furniture.

Both door approaches pass three clearance rays at body height, offset0/±.22m.
The generated Modesto shell fits the registered built parcel at404 edge
samples. All6,019 existing lot footprints remain byte-for-byte coordinate
matches to the pre-change snapshot. TypeScript validation passes.

Reproduce: start a fresh Vite server, set its URL in
`tools/capture-churches.py`, then run that script. It serializes heavy browser
work through the shared capture lock. `tools/check-missing-churches.ts` accepts
a baseline lot JSON as its optional first argument. Full-world phone-size
performance and production lighting were checked separately by the parent task.

Historical sources, chronology conflicts and reconstructed dimensions are in
[the research brief](../MISSING-CHURCHES.md). Neither an early San Modesto
foundation nor a precise identification of the Pacca predecessor with the
name ad Forum is claimed as definitive.
