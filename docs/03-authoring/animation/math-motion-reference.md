# Animation Math & Motion Engineering Reference

**Scope:** On-demand mathematical reasoning for LazyDesigner Minecraft Bedrock *asset-only* Animation. The [Animation Standard](standard.md) owns policy and the in-use specialist owns execution. This reference supplies derivations, selection constraints, bounded examples, and fail-closed checks. It is **not** an IK/physics renderer, a universal animation preset, an alternate stage, or proof of native gameplay motion.

**Evidence classes:** OFFICIAL BEDROCK (linked specification/query semantics), SOURCE_IMPLEMENTED (named LazyDesigner owner, still subject to actual execution), MATHEMATICAL DERIVATION (general identities), and HEURISTIC (art direction or numeric budgets). Never promote another engine's interpolation or a static diagnostic into proven Bedrock/Blockbench behavior. All example parameters are *illustrative*, not global defaults.

## 0. Select the cause before the equation

| Motion cause | Preferred driver / representation | Required invariants | Refuse or defer |
| --- | --- | --- | --- |
| Identity-critical pose, attack, pickup, contact | Explicit key poses and native clip | Pivot, hierarchy, silhouette, event/contact time | Random mathematical smoothing of the important pose |
| Breath, hover, small idle oscillation | Authored cycle or time-owned MoLang | Correct animation-time context, loop seam | Idle math that runs on an unapproved bone |
| Footsteps, wheel, locomotion | Travel-linked phase when travel must stop the cycle | Actual travel/stride scale, support state | Time-only gait that continues while stationary |
| Hinge, piston, rigid mechanical motion | Pivot+axis and monotone angle/distance | Clearance, mechanical limits, trigger timing | Extra decorative keys hiding wrong pivot |
| Tail, ears, cloth-like follower | Driver → lagged response or sampled spring | Stable input, causal lag, bounded settle, loop seam | Secondary motion overwriting an authored target |
| Impact/charge/discharge with VFX | Explicit action phase + referenced particle/animation event | Single event-clock owner and exact effect identity | Treating an active particle count as visible impact |
| Foot/hand end-effector targeting | Contact constraint or explicit IK bake eligibility | Verified parent frames, lengths, targets, pole, planted window | Assuming a static pose confirms world-space contact |

For a known numeric keyframe, use the normal timeline capability; do not load this guide merely to insert a value. For an unresolved math design, select one row and load only the relevant section below.

## 1. Units, reference frames, dimensions

- Animation clip time: **seconds**; selected FPS is a sampling/snapping grid, not a universal artistic constant. Tick step `dt = 1 / fps`; require finite positive FPS, finite clip duration and strictly increasing authored times.
- MoLang trigonometric arguments and animation Euler channels: **degrees**. JavaScript `Math.sin/cos/atan2` use **radians**. Convert `radians = degrees * pi / 180` and `degrees = radians * 180 / pi`. Keep a single convention through one expression.
- Native Blockbench transform positions are model-space coordinates, often 16 model units per block. Particle world motion is in blocks/second; **never copy an animation translation into particle velocity without explicit coordinate conversion**. Scale is unitless.
- Bone rotation is relative to its parent unless an explicitly supported relative-space mode is authored; exact parent/pivot world transforms require a current hierarchy and actual native semantics.
- Position velocity = position unit/s; acceleration = unit/s²; jerk = unit/s³. Rotation derivatives are deg/s, deg/s² and deg/s³ only when angular winding is known. **Do not aggregate translation speed with angular speed into one dimensionless quality score.**

Pivot and hierarchical transform reasoning (conceptual; not a Bedrock JSON expression):

~~~text
p_rotated = pivot + R * (p_local - pivot)
p_world   = T_parent * T_bone * p_local
~~~

If a hand, held item or locator follows an incorrect parent, correct Geometry ownership first; no amount of animation math repairs that parentage.

## 2. Time, period, phase and frequency

Normalized action progress with duration `T > 0`:

~~~text
u = clamp((t - t_start) / T, 0, 1)
theta_deg(t) = 360 * f_hz * t + phase_deg
period_seconds = 1 / f_hz  (f_hz > 0)
~~~

For a loop lasting `T` and containing `N` cycles, `f = N / T`. Left/right strict anti-phase can be written `L = A*sin(theta)`, `R = A*sin(theta + 180)`; this is a **starting relationship**, not a validated gait. For follower `i` in a chain, `theta_i = theta - 360*f*lag_i` and `A_i = A_0*attenuation_i`; each lag needs reference/physical justification.

Travel-driven phase (requires a known stride length `L > 0`, in the same units as travel `d`):

~~~text
theta_travel_deg = theta0_deg + 360 * d / L
wheel_angle_deg  = theta0_deg + 360 * d / (2*pi*r)  (r > 0)
~~~

The sign and interpretation of `query.modified_distance_moved` must be checked for the target context; do not presume reverse travel is represented exactly like a signed mechanical odometer. For periodic wings, use time or a verified motion driver; for planted feet, **phase alone cannot lock world-space contact**.

MoLang illustration, degree-aware, not a universal expression template:

~~~molang
math.sin(query.anim_time * 360 * 0.8) * 5.0
~~~

Official Bedrock Practical MoLang documents `anim_time_update` and travel-synchronized examples. Confirm exact query availability in animation/controller context; a Blockbench variable placeholder is a preview substitution, not proof of a value in Minecraft.

## 3. Interpolation and timing curves

Use the simplest behavior that preserves intent. All input spans must have finite values, `T > 0` and known native interoperability.

~~~text
lerp(a,b,u) = a + (b-a)*u
smoothstep(u) = 3*u^2 - 2*u^3
smootherstep(u) = 6*u^5 - 15*u^4 + 10*u^3
x(t) = lerp(a,b,ease(clamp((t-t0)/T,0,1)))
~~~

- Linear yields constant slope between keys and discontinuous velocity at a sharp join; it is often appropriate for deliberate mechanics.
- Smoothstep has zero first derivative at both ends; smootherstep also has zero second derivative at the endpoints. This may be appropriate for gentle start/stop but not for an instantaneous weapon impact.
- Cubic Hermite for `u in [0,1]`: `p(u)=h00*p0+h10*T*m0+h01*p1+h11*T*m1`, with `h00=2u³-3u²+1`, `h10=u³-2u²+u`, `h01=-2u³+3u²`, `h11=u³-u²`; **m0/m1 are velocities per second**, hence `T*m`. Do not confuse normalized tangents with time-derivative tangents.
- Cubic Bezier: `B(u)=(1-u)³P0+3(1-u)²uP1+3(1-u)u²P2+u³P3`. Spatial control points do not establish native Bedrock curve export; editor-only Bezier may need explicit baking.
- Catmull-Rom can overshoot positional boundaries. For monotone shape preservation, the existing `motionRecipe.ts` PCHIP path uses signed secant/tangent constraints and **bounded sampled numeric evidence**. It does not establish native C1 continuity or artist approval.
- Step and pre/post keys encode possible discontinuities; a linear numeric tool must never bridge them.

Do **not** choose easing because a curve looks sophisticated. For `anticipation → action → impact → recovery`, put the impact/contact timestamp first, then design acceleration and deceleration without moving that event.

## 4. Finite differences, velocity, acceleration, jerk

For strictly increasing numeric sample times `t_i` and source positions `p_i`:

~~~text
v_(i+1/2) = (p_(i+1) - p_i) / (t_(i+1) - t_i)
a_i = (v_(i+1/2) - v_(i-1/2)) / (midtime_(i+1/2)-midtime_(i-1/2))
j = (a_next - a_prev) / delta_midtime
path_length = sum(length(p_(i+1)-p_i))
displacement = length(p_last-p_first)
~~~

A sampled velocity peak is **not** maximum instantaneous native velocity. A lower sampled jerk or smoother key count does **not** prove smooth continuous playback, reference fidelity, or that a contact/impact is improved.

Implemented source owners: `mcp/lib/animation/motionDynamics.ts` (authored-track statistics), `rootMotionAnalysis.ts` (root-track evidence), `quality.ts` (candidate-only key reduction and loop endpoints), `motionRecipe.ts` (PCHIP baking), and `temporalEvidenceSampling.ts` (optional evidence times). Read their own result status. Refuse duplicate same-time keys, non-single native data points, nonnumeric expressions and unsupported interpolation rather than smoothing across an unknown interval.

## 5. Euler winding, circular angles and 3D orientation

A mathematically shortest circular delta is:

~~~text
delta_shortest = ((to - from + 180) mod 360 + 360) mod 360 - 180
~~~

This is **only correct when shortest-path intent and runtime interpolation are established**. Euler angles contain winding information relevant to authored turns: `0→360` could be a full revolution, not stillness; `170→-170` could be a 20-degree circular crossing OR a -340-degree authored turn. Exactly `180` has two equal shortest choices.

**Operational gate:** adjacent authored rotation endpoints with absolute per-axis change **>= 180 degrees** cannot be assigned a single angular velocity/path from endpoints alone. The existing `motionDynamics.ts` now returns `ambiguous_euler_rotation_path`; `quality.ts` flags unresolved loop seams and never deletes keys across an unproved >=180-degree interval. This is source-only diagnostic integrity, not a reconstruction of the target engine's trajectory.

Quaternions (`q` and `-q` represent one orientation) and spherical interpolation are appropriate *mathematical planning tools* but are not automatically a Bedrock-authorable quaternion channel. Quaternion shortest-arc interpolation also loses intentional multi-turn winding without a separate revolution count. Explicit winding/key samples and native export evidence are required for spinning wheels, flipping weapons and mirrored near-180-degree actions. Parent-space orientation, handedness, axis order and rest pivots must be fixed before deriving mirrored motion.

## 6. Contact, stance, support and IK geometry

For a two-segment limb with lengths `a,b>0` and a target distance `d` from the shoulder/hip:

~~~text
reachable distance: abs(a-b) <= d <= a+b
cos(interior_joint_angle) = clamp((a*a+b*b-d*d)/(2*a*b), -1, 1)
interior_joint_angle = acos(cos_value)
~~~

The model's actual hinge convention, pole direction, bend side, joint limits and parent transform determine the usable pose; the scalar cosine does not select them. At near-singular straight/folded poses, do not infer a stable bend direction. Clamp only when handling validated numerical roundoff; do **not** mask physically unreachable targets by snapping limbs without reporting the loss.

For planted foot during `[t_stance_start,t_stance_end]`: keep the *world-space* foot marker near one support point while the root/body moves. Measuring local bone translation is insufficient. A held tool uses a moving hand-to-tool pair constraint rather than a world-fixed foot constraint. Use actual marker/bone UUIDs, support plane and time-window samples; if unavailable return REVIEW/UNVERIFIED. Existing `ikBakeReadiness.ts`, `ikBakeKeyframePlan.ts`, `contactConstraints.ts` and `contactEvidence.ts` are the owners, not a new IK solver.

## 7. Secondary motion: springs and causal followers

A unit-mass damped spring driven toward a target `g(t)` follows:

~~~text
x'' + c*x' + k*(x-g(t)) = 0
omega_n = sqrt(k)                  (k > 0)
damping_ratio = c / (2*sqrt(k))   (c >= 0)
a = k*(g-x) - c*v
v_next = v + a*dt
x_next = x + v_next*dt            (semi-implicit Euler)
~~~

- Damping ratio < 1 allows underdamped oscillation; =1 is critically damped; >1 is overdamped in the ideal continuous-time model. Do not translate these labels into a guaranteed visual feel without sampling.
- Larger stiffness/low damping requires a higher sample rate. The existing `springMotion.ts` source guard restricts `dt*sqrt(k) <= 0.5` and `dt*c <= 1`. These are **repo engineering bounds**, not a proof that every feasible source is numerically stable or visually correct.
- Example **only**, at `omega_n = 2*pi` and damping ratio 1: `k ≈ 39.48`, `c ≈ 12.57`. First check the actual sample policy before applying; do not turn these into universal defaults.
- `drive_mode=parent_delta` avoids copying an absolute parent's rest orientation when a follower should react to change. Periodic loops need steady-state convergence and an end/start seam check, not a silently reset spring state.
- A follower must never overwrite independently authored contact/action keys. `secondaryMotion.ts` handles simple delayed followers; `springMotion.ts` owns sampled spring response; both remain bounded source transformations.

## 8. Procedural MoLang vs authored keys

Correct ownership is more important than the number of math functions:

| Need | Guidance |
| --- | --- |
| Oscillation tied to animation clock | `q.anim_time` with degree-based frequency |
| Travel-linked motion that stops when stationary | `q.modified_distance_moved` as phase driver, after target-context validation |
| Speed-dependent amplitude | `q.modified_move_speed` or an explicit available driver |
| Conditional attack/blend | Controller state and blend value, not invented gameplay logic |
| Complex pose/contact | Author keyframes; use MoLang only on proven supporting channels |
| Bounded value | `clamp` / `inverse_lerp` with nonzero denominator |
| Smooth angular blend | `lerprotate` only when shortest-path rotation is intended and supported |

The MoLang parser's acceptance is not proof of in-game query availability. Use the official Math/Query documents for target-version support. Never rewrite author-owned complex expressions into an unverified numeric slider. If a dynamic value is absent in Blockbench, a Variable Placeholder supplies a *preview approximation* only. Avoid `math.random` re-evaluated every frame for stable identity; define randomness at a deliberate creation or action boundary if the target context allows it.

## 9. Motion combined with particles and visual effects

Animation and Particle have separate clocks/owners. A keyframed strike or contact determines the causal event time; the particle emitter owns spawn/lifetime and each living particle owns its age-dependent fade/trajectory. One frame after an authored impact is not universally a good delay.

~~~text
Animation phase -> explicit event time/locator
Particle trigger -> emission + initial velocity + collision/event chain
Particle age -> size/opacity/gradient/flipbook progression
~~~

Example sequence: Golem charge (anticipation), release (impact event), radial flash, delayed motes, falloff; only create layers required by the reference. A visually attractive standalone emitter does not establish correctly timed animation integration or in-game visibility. Particle math ownership remains at `docs/02-reference/particle/math-physics-reference.md`; reuse `manage_particle` plus `manage_animation_effects` rather than spawning another VFX engine.

## 10. Sampling, numerical and authoring failure gates

| Potential failure | Required response |
| --- | --- |
| Nonfinite/time-zero denominator or zero vector normalization | Reject before authoring; do not divide or normalize |
| Per-axis Euler change >=180 degrees | Preserve explicit winding; withhold shortest-path numeric metrics |
| Two keys within native time-collision tolerance | Reject/merge only with semantic authorization |
| Non-single data points, unknown interpolation, MoLang track | Report unevaluated; no fabricated finite-difference path |
| Sampling frequency aliases oscillation | Increase justified sample density; Nyquist >2*f is minimum mathematical condition, not a sufficient visual-quality guarantee |
| Spring step violates existing guard/budget | Reject rather than silently integrate a divergent motion |
| Contact target/marker/parent missing | Geometry/identity handoff, not speculative foot locking |
| Loop end value differs or velocity snaps | Explicit seam review; closed positions alone do not prove C1 motion |
| Native renderer differs from mathematically derived curve | Preserve authored evidence and classify as target-specific until verified |
| Particle file renders but has no visible pixels | Distinguish emitter state, texture readiness, viewport evidence and game proof |

Prioritize *semantic accuracy → finite arithmetic → valid native representation → observable timing → reference-matched visual acceptance*. Keyframe count, math complexity, smoothness scores and source tests must never substitute for actual accepted motion. The normal in-use path has no forced local/Blockbench test while the user hold applies.

## 11. Bounded worked decisions

1. **Walk with 1.2-unit stride:** derive one cycle per 1.2 units of actual travel, not an invented clock speed; alternate limb phases only as a starting geometry, then validate stance, foot support and root motion before acceptance.
2. **Full wheel revolution:** for a radius of 0.5 blocks and true traveled distance of pi blocks, the geometric wheel turn is 360 degrees. Never compress its `0→360` authored channel as zero travel merely because the circular endpoint orientation matches.
3. **Heavy impact:** pin the contact time and support poses first. Use one short high-acceleration drive for the primary swing followed by restrained settle only if the reference demands it; never make impact disappear under symmetric smoothstep.
4. **Tail spring:** select parent delta and child channel only if the child track is unowned, verify sample stability, and require periodic convergence for a seamless loop; avoid changing user-authored chain contacts.
5. **Animated attack VFX:** derive the effect start from the animation impact event, then let independent particle lifetime/age govern fade; inspect locator and pack references separately.

## 12. Authoritative sources and implementation owners

- **Official Bedrock:** [Animations Overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview?view=minecraft-bedrock-stable), [Practical MoLang](https://learn.microsoft.com/en-us/minecraft/creator/documents/molang/practical-molang?view=minecraft-bedrock-stable), [MoLang Syntax](https://learn.microsoft.com/en-us/minecraft/creator/documents/molang/syntax-guide?view=minecraft-bedrock-stable), [query.modified_distance_moved](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/molangreference/examples/molangconcepts/queryfunctions/query_modified_distance_moved).
- **Community (non-normative):** [Bedrock Wiki Math-Based Animations](https://wiki.bedrock.dev/visuals/math-based-animations.html), including context-specific variable-placeholder caveats.
- **Cross-engine mathematical reference only:** [Godot Interpolation](https://docs.godotengine.org/en/stable/tutorials/math/interpolation.html), [Unity Rotation Interpolation](https://docs.unity.com/en-us/engine/6000.7/manual/animation-section/animation-mecanim/animation-clips/animation-editor-guide/animation-rotate). Their runtime contracts must **not** be imported into Bedrock.
- **Repository source owners:** `mcp/lib/animation/{motionRecipe,motionDynamics,quality,springMotion,secondaryMotion,contactEvidence,ikBakeReadiness,ikBakeKeyframePlan}.ts`; research inventory [research-sources.md](research-sources.md); conditional [knowledge-coverage.md](knowledge-coverage.md).

**Proof status:** Mathematical derivations and source-level guidance only. Source regressions are AUTHORED_NOT_RUN, executable Bun/Blockbench native and artistic visual verdicts NOT_EXECUTED/UNVERIFIED under the current user hold.
