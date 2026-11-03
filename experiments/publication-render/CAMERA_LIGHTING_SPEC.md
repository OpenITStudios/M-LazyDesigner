# ADR-R03 — Camera & Lighting Director for MCP-Authored Publication Renders

**Repository:** OpenITStudios/M-LazyDesigner · branch **Render** only  
**Date:** 2026-11-03  
**Decision state:** SOURCE-AUTHORED, NO NATIVE/IMAGE ACCEPTANCE  
**Depends on:** [ADR-R01 Object-to-Render](./OBJECT_TO_RENDER_CONTRACT.md) and [ADR-R02 Material Translation](./MATERIAL_TRANSLATION_SPEC.md)  
**Purpose:** one physically rendered Cycles PNG of the actual current MCP-authored Cube object, with deterministic geometry-based composition and source-respecting studio lighting. No second Blender MCP, new modeler, generated environment, render-farm, alternate renderer or autonomous unlimited rerender loop.

This ADR is the behavior contract and exact-source owner map. **Source code presence is not proof that Blender runs correctly**, and geometric camera metrics are not a subjective quality verdict. The user has deferred local/native tests; no Bun, TypeScript build, Blender 5.2 or visual acceptance was executed in this session.

## 1. Scope and immutability

The input is the validated detached Bedrock Entity GLB from ADR-R01. It includes exactly the geometry/UV/texture/material data already authored by LazyDesigner MCP. ADR-R02 must have accepted the material bindings before any camera or lighting operations.

**Allowed presentation changes:** world/background/HDRI, studio ground and contact shadows, camera parameters, lighting objects, Cycles sampling, view transform and restrained compositor.  
**Forbidden modifications:** authored Cube vertices, Group transform, skeleton/pose, UV, texture bytes, PBR source maps, material provenance, named object generation or speculative detail enhancement.

Single source-of-truth entry: \`mcp/server/publication/worker/render.py\`. It calls \`core_assets.py\` -> \`compositor_director.configure_cycles()\` (sets output dimensions first) -> \`camera_director.configure_camera()\` -> \`lighting_director.configure_environment_and_lighting()\` -> compositor -> one Cycles render -> factual PNG diagnostics.

## 2. Camera contract

**Inputs:** source geometry world bounds and Cube mesh list; output width/height; request mode \`auto|manual\`, yaw [-180,180], elevation [-30,80], perspective/orthographic, framing padding [1.08,2.2]. The user-requested yaw/elevation is the directional anchor for automatic candidate comparison.

**Outputs:** resolved yaw/elevation, Blender world-frame projected NDC bounds, projected geometric convex-hull proxy, rectangle projected area, frame-safe result, camera fit multiplier and number of fit attempts, and number of considered camera angles. These outputs are *factual geometry diagnostics*, not proof of occlusion, silhouette quality or aesthetics.

Official source of projection coordinates: [Blender 5.2 world_to_camera_view](https://docs.blender.org/api/5.2/bpy_extras.object_utils.html). Its NDC uses (0,0) lower left, (1,1) upper right; positive view Z is in front of the camera. The function uses the actual camera lens/sensor/shift/projection and scene render resolution. **Do not independently guess vertical FOV when deciding final camera safety.**

### 2.1 Deterministic decision sequence

| Step | Algorithm | Upper bound | Fail condition |
| --- | --- | --- | --- |
| 1 | Import the actual GLB, compute world-space AABB corners from original meshes; DO NOT move mesh | Existing 10,000-Cube GLB source budget | Missing or invalid imported mesh |
| 2 | Set Cycles resolution and aspect BEFORE camera projection | One setup | Width/height outside job schema |
| 3 | Generate auto yaw offsets (-30,-15,0,15,30) and elevation offsets (-10,0,10); manual has one exact candidate | **15** auto, **1** manual | Invalid request |
| 4 | For each candidate, place camera, update Blender dependency graph, project representative mesh-bounds corners | Max **128** mesh representatives | NaN projection or invalid camera |
| 5 | Fit actual projected corners by increasing distance (perspective) or ortho scale (orthographic), rather than immediately rejecting the candidate | Up to **6** geometry-only fit multipliers: 1.0, 1.12, 1.30, 1.60, 2, 3 | Still clipped after fit budget |
| 6 | Rank candidates by screen-space convex hull area of the projected *bounding corners*, minus centering and directional-change penalties | No Cycles rendering required | All candidates invalid |
| 7 | Validate all imported Cube bounds for at most **3** best-ranked camera directions, with fit loop if needed | Max 3 finalists × 6 fits | All selected camera directions clipped |
| 8 | Set selected camera, refresh dependency graph, verify **all** points once more and freeze camera before adding lighting | One final camera | Subject clipping |

Geometric score is a deterministic, low-cost heuristic:

\`\`\`text
candidate_score =
    projected_hull_area
    - 0.025 × projected_frame_center_offset
    - 0.00010 × (absolute_yaw_offset + absolute_elevation_offset)
\`\`\`

**Limitations:** The hull is computed from projected world-bounding-box corners, not rendered silhouette, real polygon visibility, ray-traced occlusion or artistic importance. It is NOT a visual-aesthetics score and cannot guarantee the most flattering angle. It intentionally avoids repeated 15-image Cycles rendering. User can switch to **manual camera mode** for exact angular control while still benefiting from automatic distance/scale fitting to keep the whole object in frame.

No semantic object classifier. No naming a Cube "front" or "back" based on labels. No invented front-facing feature detection.

### 2.2 Camera-safe definition

Frame-safe when:
- every tested source point lies in front of camera;
- projected left/bottom >= **0.015** and right/top <= **0.985**;
- all projected coordinates are finite;
- the selected camera passes a full-asset check, not merely sampled representative Cubes.

The preview ratio presets from \`mcp/lib/publication/contracts.ts\` are square, 16:9, 4:3, and portrait 4:5. Blender's own projected result, not a guessed sensor formula, ultimately decides whether the subject fits. Camera fit may enlarge the framing; it must **never scale or recenter the authored GLB geometry itself**.

## 3. Lighting contract — one camera-relative three-light rig

**Input:** original imported world bounds/center/radius, the already-selected camera, user-specified bounded \`look\` factors (key, fill, rim, softness, environment, exposure), background mode and optional validated local HDRI. No asset-type heuristics or model-specific effects.

**Source:** \`mcp/server/publication/worker/lighting_director.py\`. Three real Blender **Area Lights** (DISK), aimed at object world center and positioned relative to the chosen camera's right/forward and scene Z-up axes. Blender 5.2 AreaLight energy uses emitted radiant power (W): [official Python API](https://docs.blender.org/api/5.2/bpy.types.AreaLight.html).

For \`r = max(actual_source_bounding_radius, 0.05)\` in converted scene units:

| Light | Energy (Blender watts) | Relative disk size | Authored presentation color |
| --- | --- | --- | --- |
| Key | \`240 × r² × look.key\` | \`2.0 × r × look.softness\` | RGB (1.0, 0.85, 0.72) |
| Fill | \`90 × r² × look.fill\` | \`2.8 × r × look.softness\` | RGB (0.67, 0.79, 1.0) |
| Rim | \`340 × r² × look.rim\` | \`1.6 × r × look.softness\` | RGB (0.87, 0.94, 1.0) |

These are **source defaults / starting points**, not exposure benchmarks or proof of professional visual quality. The radiometric energy ratios are not the same as perceived pixel luminance after roughness, HDRI, shadowing, color management or tone mapping.

**Safety:** All light parameters, size, color and emitted energy must be finite and within bounds; 50,000,000 W per area light is a fail-closed input ceiling, not a recommended power level. Never clamp an invalid requested intensity to a visually plausible value and claim source fidelity.

**Lighting output receipt:** names, source-derived positions, distance to subject, actual energy, disk size, RGB color, world strength, HDRI presence/digest and key-to-fill **energy** ratio. When fill is effectively off (<= 1e-6 W), ratio is null rather than a fabricated infinity or real-image contrast score.

### 3.1 Environment and ground

- **Studio default:** a deterministic dark or light world and a Blender scene-only ground plane just below the asset's lowest world bound, for physically rendered contact shadow and spatial grounding.
- **Transparent background:** use Cycles film transparency and a shadow catcher when available. Imported mesh remains the same.
- **User-supplied HDRI:** optional, explicit local .hdr/.exr input, bounded by file/permission rules, copied to isolated job directory and verified again in Blender by SHA. No automatic download or environment asset search.
- **Provenance:** if HDRI is linked to world background, report the procedural base color as \`HDRI_FALLBACK_UNUSED\`, not as the actual environment color. Studio default reports \`ACTIVE_PROCEDURAL_WORLD\`.

**No generated cinematic scene, no animated lights, no new external asset dependency.**

## 4. Rendering/finishing boundary

Camera and lighting operate on the one Blender 5.2 Cycles worker. Existing preview/publication/high presets use the same engine with bounded sample counts and resolution. The requested AgX or Standard transform, conservative Fog Glow and denoising are applied by \`compositor_director.py\`, without altering the source Color/MER/Normal textures accepted by ADR-R02.

Material validity is determined BEFORE lighting; no amount of rim glow should mask a lost texture, missing normal, wrong shader or collapsed UV. Default publication appearance is not equivalent to neutral source-albedo evidence.

## 5. Actual Cycles image evidence — two distinct data regions

**Owner:** \`mcp/server/publication/worker/quality_report.py\`. After one real PNG is written, a disposable copy is downscaled to 96x96 for factual metrics. It does not render a second Cycles image.

| Evidence | Includes | Cannot prove |
| --- | --- | --- |
| Entire final image | Luminance distribution, near-white/near-black fraction, alpha fraction | Subject exposure: dark studio backdrop may dominate |
| Camera-projected frame rectangle | Luminance/near-white/near-black stats in the screen rectangle containing all Cube world bounds | Exact object-only pixels, material classification or occlusion; **NOT segmentation** |
| Finished PNG thumbnail | A bounded <=384px downsample sent only on \`render_publication.preview\` or opened in the plugin | Fine 4K pixel detail or automatic quality PASS |

The ROI is explicitly labeled \`PROJECTED_BOUNDS_RECT_NOT_SEGMENTATION\`. It can contain background inside the subject's projected rectangle. Its values are Blender-loaded image floats, **not a calibrated display-nits measurement or perceptual contrast judgment**. A pure black authored material may legitimately produce a near-black metric. Therefore source warnings say **REVIEW**, never "fix exposure automatically."

No AI analysis is claimed to have happened unless an actual Cycles thumbnail has been seen. No automatic unlimited render-review-refine loop is permitted. The AI or user may request another render with bounded camera/light changes after reviewing the genuine result.

## 6. Efficiency and token-control policy

- Compute candidate views from geometry, NOT 15 full render images.
- Only one Cycles image per render job; no duplicate viewport/camera rasterizer for beauty output.
- Max 3 whole-asset camera finalists, 6 geometric fits each; user manual setting is one angular candidate.
- No full-resolution PNG included in normal \`status\` response. The explicit \`preview\` capability contains <=384px real PNG only after finished render; file stays local.
- Measured lighting diagnostics are generated from a 96x96 disposable image buffer and do not perform network calls or repeated rendering.
- No automatic HDRI search, multiple Blender installs, second MCP, shader generator or scene library.
- The process-local job manager retains one active/latest job. Requesting an alternate light/camera setting requires an explicit new render, never an implicit AI rerender.

## 7. Error, proof and acceptance matrix

| ID | Event/fixture | Required behavior | Proof status |
| --- | --- | --- | --- |
| CAM01 | One elongated object | Whole asset fits with safe margin in portrait/landscape | SOURCE-ONLY |
| CAM02 | One nearly-flat object | Convex-hull occupancy helps rank geometric views; no claim of real occlusion | SOURCE-ONLY |
| CAM03 | Nested many-Cube object | 128 representatives for ranking; ALL world bounds required for final frame | SOURCE-ONLY |
| CAM04 | Manual yaw/elevation | Exact requested orientation retained; only fit distance/ortho scale may adjust | SOURCE-ONLY |
| CAM05 | Extreme aspect 16:9, 4:5 | Blender projection used after setting render resolution; no subject crop | SOURCE-ONLY |
| CAM06 | Unsupported/no-safe camera | Explicit clipping/projection error; never silently crop | SOURCE-ONLY |
| LGT01 | Key/fill/rim with normal-sized source asset | Three real area lights with documented power/position/color/size | SOURCE-ONLY |
| LGT02 | Fill set to zero | Real zero light energy, key/fill ratio null; no divide-by-zero | SOURCE-ONLY |
| LGT03 | Giant pathologically spread model | Light wattage exceeds budget → explicit stop, no Infinity metadata | SOURCE-ONLY |
| LGT04 | Verified user HDRI | Exact supplied digest and real environment shader; no network | SOURCE-ONLY |
| LGT05 | Transparent/opaque backgrounds | Ground/shadow catcher does not modify imported asset; PNG alpha preserved | SOURCE-ONLY |
| LGT06 | Wrong imported material/UV | ADR-R01/R02 blocks before camera/light render | SOURCE-ONLY |
| IMG01 | Dark studio background and bright subject | Global stats may be dark, projected ROI reports another area without fake PASS | SOURCE-ONLY |
| IMG02 | Authored black/white object | Image outlier triggers REVIEW only, not automatic material/exposure changes | SOURCE-ONLY |
| IMG03 | Repeated same source/settings | Deterministic camera and light plan; actual Cycles pixel determinism is NOT assumed | SOURCE-ONLY |
| VIS01 | Five user reference quality targets | Human/AI evaluates real shape readability, lighting, shadows, materials, voxel crispness, composition | NOT EXECUTED |
| ENG01 | Exact Render branch build and Blender 5.2 API | Toolchain, core module packaging, camera/dependency graph, light shader and report work | NOT EXECUTED |

**SOURCE-ONLY** means code/contracts/fixtures have been authored, not that the real result has passed. No Native-verified or Visual-accepted claim should appear in job status solely from geometry projection, wattage metadata, or image histogram.

## 8. Canonical module owners and change discipline

| Source | Sole responsibility |
| --- | --- |
| \`mcp/server/publication/worker/camera_director.py\` | Camera candidates, real projection, bounded geometric ranking, all-object final frame |
| \`mcp/server/publication/worker/lighting_director.py\` | Key/fill/rim, scaled light power, world/HDRI and ground |
| \`mcp/server/publication/worker/quality_report.py\` | Measured global + projected-frame-region PNG diagnostics and thumbnail |
| \`mcp/lib/publication/diagnostics.ts\` | Strict input and evidence receipt schema, no aesthetic-scoring claim |
| \`mcp/lib/publication/contracts.ts\` | Bounded user camera/light request and render job contract |
| \`mcp/ui/publicationRenderDialog.ts\` | Human camera/lighting controls; no separate engine logic |
| \`mcp/server/tools/inspection/publication.ts\` | Existing \`render_publication\` start/status/preview/cancel capability; no new Gateway top-level methods |

**Architecture constraint:** Do not add a second camera planner, scene generator, art-style taxonomy, render-review agent registry, new MCP server, or broad Blender modeling controls. Only modify the above canonical owners when a source- or evidence-backed defect requires it.

## 9. Completion definition and next step

- **SPECIFIED:** source data, algorithms, bounds, emitted lighting, failure behavior and acceptance semantics are written here.
- **SOURCE-AUTHORED:** camera uses actual Blender projected corners/hull + bounded refit; lighting includes finite bounded properties and factual provenance; ROI is measured from the same rendered PNG. Sources have corresponding typed fixture expectations.
- **BUILD-VERIFIED:** Bun/TypeScript build and tests pass at exact SHA — **NOT EXECUTED**.
- **BLENDER-VERIFIED:** Real Blender 5.2 runs this source, produces expected safe framing/light distribution, preserves original imported model — **NOT EXECUTED**.
- **VISUALLY ACCEPTED:** Actual Cycles PNGs are reviewed against the five reference images and judged suitable — **NOT EXECUTED**.

Next in-scope design topic is **output identity / deterministic save / job recovery under project edits**, not a new Blender rendering component. The user has deferred native tests; no schedule or assertion of live success is made.
