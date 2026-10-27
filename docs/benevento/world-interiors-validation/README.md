# Full-world interior validation

`npm run build` passed after the synagogue, burial rooms and pooled-geometry bounds changes were frozen. This includes TypeScript and the Vite production build. Vite emitted its large-bundle warning.

These captures use the actual world at **390×844**, Chromium with SwiftShader. **Software-renderer FPS is not iPhone performance evidence.** All captured views remain below the project's approximate 350k-triangle /130-call limits.

| View | Triangles | Calls | GPU texture objects | Image |
|---|---:|---:|---:|---|
| Curtis baseline | 305,421 | 115 | 128 | [Before](curtis-before.png) |
| Curtis final, identical camera | 305,421 | 114 | 128 | [After](curtis-after.png) |
| Synagogue doorway | 74,545 | 53 | 83 | [Exterior](synagoga-exterior.png) |
| Synagogue prayer room | 45,177 | 50 | 83 | [Interior](synagoga-interior.png) |
| Burial stair entrance | 100,756 | 87 | 134 | [Entrance](burial-entrance.png) |
| Burial room, player lantern off | 142,017 | 76 | 170 | [Interior](burial-interior.png) |

Texture-object counts are not memory-byte measurements. The four interior-related views reuse one loaded world, so later counts include cached resources from earlier locations. The Curtis baseline already includes the earlier point-light microshadow fix; it precedes the new interiors and explicit pooled-geometry bounds.

## Visual and runtime findings

All images were inspected. The synagogue has an open entrance, visible cupboard/scroll table and working reading prompt. Its nearby oil lamp produces strong bloom in the existing lighting style. The Curtis doorway remains intact. There were no JavaScript exceptions or application HTTP asset failures in the completed captures. The previously logged `GLBufferAttribute requires a manual bounding sphere` errors are absent after the explicit bounds fix.

The burial entrance image verifies the open stair mouth in the surrounding street, but its level camera does not clearly show the treads. The burial interior is dark with the player lantern off; its screenshot shows the game's prompt to light the lantern. It is not a well-lit inspection of all graves. Use the [burial geometry and real-controller checks](../triggio-validation/README.md) for the clearer structural review and descent/return evidence. The browser had closed before additional downward-looking and lantern-on shots could be taken; it was not restarted solely for those camera changes.

External Google Fonts requests failed certificate validation and fallback fonts were used; TLS verification was not disabled. SwiftShader lacks `KHR_parallel_shader_compile`. These environment messages are retained in [the progress log](progress.jsonl).

## Reading UI

The actual placed readables and exported reading UI were exercised using a test camera near each readable. The rendered world background remained at the burial viewpoint; these card screenshots are UI checks, not proof that the synagogue scroll is located in the burial room.

- [Synagogue card](synagoga-lore.png): Hebrew `lang="he"`, `dir="rtl"`; text and translation visible.
- [Burial card](burial-lore.png): Latin `lang="la"`, `dir="ltr"`; epitaph and translation visible.
- Both cards passed assertions for no source/status elements, no exposed source metadata and no reconstruction-status disclaimer in displayed text.

## Evidence and reproduction

[Machine-readable report](report.json) records counters, cameras, build result, UI assertions and limitations. Run a fresh Vite source server, then:

```sh
python tools/check-world-capture.py --base http://127.0.0.1:5390 \
  --out /tmp/world-interiors --places Synagoga 'Synagoga interior' \
  'Ad Sepulcra' 'Sepulcra Langobardorum' --reuse --check-lore
```

Only one full-world browser should run at a time. The tool logs loading stages and exposes a local CDP endpoint on 9227. Its corrected reuse wait requests at most 36 m of ready chunks, below the production stream's 40 m request radius, with a 90-second streaming deadline.

An earlier harness version incorrectly waited for 44 m and stalled before capturing Episcopium. That failed check is **not** represented as passed, and no production streaming change was needed. The first initial-render diagnostic also demonstrated that a 240-second startup timeout is too short under the current CPU/software-GPU contention. Details are in [WORLD-VALIDATION.md](../WORLD-VALIDATION.md).
