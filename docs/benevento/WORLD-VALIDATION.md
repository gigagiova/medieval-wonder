# Full-world validation notes

## Capture reliability

`tools/check-world-capture.py` captures at 390×844 with one Chromium process and writes loading stages, network failures, JavaScript exceptions and rendering counters to `progress.jsonl`. Its `--reuse` option teleports through a single loaded world to retain compiled GPU programs. `--check-lore` checks the real placed synagogue and burial readables using the existing reading UI, including Hebrew language/direction and absence of source/status disclaimers.

The previous 240-second `window.__done` timeout was too short in the current CPU-constrained software-rendering environment. A diagnostic Curtis run completed as follows:

- World construction and nearby streaming complete: approximately 103 seconds.
- Shader preparation finishes and entry becomes available: approximately 160 seconds.
- Shot settling completes: approximately 288 seconds; image readback then completes successfully.

There were no pending asset requests at the shader-preparation stage. `KHR_parallel_shader_compile` was unavailable in SwiftShader, so preparation blocked. The original pooled geometry also logged missing manual bounding spheres; this was reported for a separate production fix. Google Fonts requests failed certificate validation and fell back to installed fonts. No TLS verification was disabled.

The baseline image was visually inspected. It shows the expected Curtis stone doorway and street scene, without missing wall faces. This baseline is **after** the point-light microshadow fix but **before** the new interiors and pool-bound fix. Baseline counters: **305,421 triangles, 115 calls, 128 textures**. Evidence is `/workspace/npc-audit/world-interiors-before/{Curtis.png,report.json,progress.jsonl}`.

The smoothed FPS in the browser title is not a reliable measure during startup. Software-renderer frame times are not iPhone performance evidence. Rendering counts and visual/collision behavior can be checked here; real-device frame time remains a separate check.

## Build and capture follow-up

After the synagogue, burial rooms and pool-bound changes were frozen, `npm run build` passed (`tsc` and Vite, 155 modules). Vite reported its existing large-bundle warning; there were no build errors.

A fresh source server at 5390 captured final Curtis at the exact baseline camera coordinates: **305,421 triangles, 114 calls, 128 textures**. The image was inspected; the doorway and surrounding surfaces remained intact. The missing-GLBufferAttribute-bound warnings were absent. This is a count comparison, not a measured phone-speed improvement.

The first reused-view harness then exposed a **test-tool defect**: it waited for 44 m of full-detail chunks while the production stream requests only within 40 m. The initial game load correctly uses 36 m. The pending Episcopium check was aborted, and is not counted as passed. The tool was corrected to `min(36,R_IN-4)`, given a 90-second streaming deadline and progress output, and a local CDP endpoint for recovery. A focused run was restarted for the new interiors. No production streaming change was needed.

Final Curtis evidence: `/workspace/npc-audit/world-interiors-after/`. Focused interior evidence is written separately to `/workspace/npc-audit/world-interiors-newviews/`.


## Completed focused run

The four new-location captures and both reading-card checks completed successfully. Reviewed images, final counters and limitations are preserved in [world-interiors-validation](world-interiors-validation/README.md). The synagogue exterior/interior rendered 74,545/45,177 triangles and 53/50 calls; burial entrance/interior rendered 100,756/142,017 triangles and 87/76 calls. All are within the approximate geometry/draw-call limits, without claiming phone frame-rate validation.

The Hebrew card has `lang="he"` and `dir="rtl"`; both new cards expose neither source/status elements nor reconstruction disclaimers. The burial screenshot is dark with the player lantern off, and the entrance's level angle does not clearly show treads; those limitations are documented alongside the separate geometry/controller evidence. The final browser closed normally and the paused cloth solver was notified to resume.
