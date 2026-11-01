# Animation Research Sources — K1 reference inventory

**Snapshot**: 2026-10-30, pinned original repo `ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d`. **Evidence:** INDEX ONLY, not verified Blockbench/Minecraft execution. **145 curated records.**

Use this as an **on-demand source pointer** for the selected Animation decision, never preload all records in normal asset authoring. The normative owner is [standard.md](standard.md); exact implementation/decision status is [knowledge-coverage.md](knowledge-coverage.md). Original research evidence labels are: `INSPECTED` (file or excerpt examined), `INDEXED` (repository path located), and `WEB` (web source/excerpt found); no label establishes current version, comprehensive review, license clearance, native playback, or visual quality.

## Source registry

| ID | Tipe | Prioritas | Sumber | Pengetahuan kunci | Bukti akses |
|---|---|---|---|---|---|

### 01 Format Minecraft dan MoLang (normatif) — 15 sumber

| ANIM-001 | Official/Mirror | P0 | [Minecraft Animation Overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview) | Clip/keyframes/channel/order/relative rotation | WEB |
| ANIM-002 | Official/Mirror | P0 | [Animation Controllers Reference](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationcontroller) | States/transitions/blend/animation conditions | WEB |
| ANIM-003 | Official/Mirror | P0 | [Animations vs. Controllers](https://learn.microsoft.com/en-us/minecraft/creator/documents/animationsvscontrollers) | Clip vs controller ownership | WEB |
| ANIM-004 | Official/Mirror | P0 | [Introduction to Animation Controllers](https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontoanimationcontrollers) | Practical controller construction | WEB |
| ANIM-005 | Official/Mirror | P0 | [Entity Modeling and Animation](https://learn.microsoft.com/en-us/minecraft/creator/documents/entitymodelingandanimation) | Full entity model-to-animation workflow | WEB |
| ANIM-006 | Official/Mirror | P0 | [Molang Introduction](https://learn.microsoft.com/en-us/minecraft/creator/documents/molang/introduction) | Query and expression context | WEB |
| ANIM-007 | Official/Mirror | P0 | [Molang Syntax Guide](https://learn.microsoft.com/en-us/minecraft/creator/documents/molang/syntax-guide) | Expression types and evaluation | WEB |
| ANIM-008 | Official/Mirror | P0 | [Practical Molang](https://learn.microsoft.com/en-us/minecraft/creator/documents/molang/practical-molang) | Runtime animation drivers and travel phase | WEB |
| ANIM-009 | Official/Mirror | P0 | [Molang Query Functions](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/molangreference/examples/molangconcepts/queryfunctions) | Scope and correct meaning of queries | WEB |
| ANIM-010 | Official/Mirror | P0 | [query.modified_distance_moved](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/molangreference/examples/molangconcepts/queryfunctions/query_modified_distance_moved) | Movement-coupled locomotion phase | WEB |
| ANIM-011 | Official/Mirror | P0 | [math.sin in Molang](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/molangreference/examples/molangconcepts/mathfunctions/math_sin) | Degree-based trigonometry | WEB |
| ANIM-012 | Official/Mirror | P0 | [Bedrock Schemas List](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/schemaslist) | Version-aware format checks | WEB |
| ANIM-013 | Official/Mirror | P0 | [MicrosoftDocs animation controller source](https://github.com/MicrosoftDocs/minecraft-creator/blob/main/creator/Reference/Content/AnimationsReference/Examples/AnimationController.md) | Document provenance / compare official versions | WEB |
| ANIM-014 | Official/Mirror | P0 | [Mojang Animation Documentation](https://github.com/Mojang/bedrock-samples/blob/main/documentation/Animations.html) | Official sample technical reference | WEB |
| ANIM-015 | Official/Mirror | P0 | [bedrock.dev Animations Mirror](https://bedrock.dev/docs/stable/Animations) | Supplementary indexed Bedrock reference; check for stale sections | WEB |


### 02 Blockbench native editor dan API — 17 sumber

| ANIM-016 | Upstream/Native | P0 | [Blockbench Bedrock Modeling and Animation Guide](https://blockbench.net/wiki/guides/bedrock-modeling/) | Bedrock native clips/rig/controllers | WEB |
| ANIM-017 | Upstream/Native | P0 | [Blockbench Animation Expressions](https://blockbench.net/wiki/guides/animation-expressions/) | Blockbench-specific MoLang preview vs export | WEB |
| ANIM-018 | Upstream/Native | P0 | [Blockbench API Documentation](https://web.blockbench.net/docs/modules.html) | Native API types, public modules | WEB |
| ANIM-019 | Upstream/Native | P0 | [Blockbench Plugin Development](https://blockbench.net/wiki/docs/plugin/) | Plugin lifecycle and API compatibility | WEB |
| ANIM-020 | Upstream/Native | P0 | [Blockbench Releases](https://github.com/JannisX11/blockbench/releases) | Regression/version drift watch | WEB |
| ANIM-021 | Upstream code | P0 | [Blockbench / animation.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/animation.js) | Clip/Animator/animation model | INDEXED |
| ANIM-022 | Upstream code | P0 | [Blockbench / animation_codec.ts](https://github.com/JannisX11/blockbench/blob/master/js/animations/animation_codec.ts) | Native serialization/export | INDEXED |
| ANIM-023 | Upstream code | P0 | [Blockbench / animation_controllers.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/animation_controllers.js) | State machine/controller native implementation | INDEXED |
| ANIM-024 | Upstream code | P0 | [Blockbench / animation_mode.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/animation_mode.js) | Animation editor mode lifecycle | INDEXED |
| ANIM-025 | Upstream code | P0 | [Blockbench / animation_transform.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/animation_transform.js) | Transform/pose semantics | INDEXED |
| ANIM-026 | Upstream code | P0 | [Blockbench / fabrik.ts](https://github.com/JannisX11/blockbench/blob/master/js/animations/fabrik.ts) | Native inverse-kinematics implementation | INDEXED |
| ANIM-027 | Upstream code | P0 | [Blockbench / keyframe.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/keyframe.js) | Keyframe data and easing | INDEXED |
| ANIM-028 | Upstream code | P0 | [Blockbench / mirror_animating.ts (pinned)](https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/animations/mirror_animating.ts) | Resolves opposite animator and calls keyframe `flip(0)`; **not** proof of LazyDesigner Euler-sign parity or native animation acceptance | INSPECTED (pinned source; not executed) |
| ANIM-029 | Upstream code | P0 | [Blockbench / molang.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/molang.js) | Expression engine/parser | INDEXED |
| ANIM-030 | Upstream code | P0 | [Blockbench / molang_editor.ts](https://github.com/JannisX11/blockbench/blob/master/js/animations/molang_editor.ts) | Expression authoring/inspection | INDEXED |
| ANIM-031 | Upstream code | P0 | [Blockbench / timeline.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/timeline.js) | Timeline playback/selection | INDEXED |
| ANIM-032 | Upstream code | P0 | [Blockbench / timeline_animators.js](https://github.com/JannisX11/blockbench/blob/master/js/animations/timeline_animators.js) | Bone and other animator tracks | INDEXED |


### 03 Mojang Vanilla — gerak model — 21 sumber

| ANIM-033 | Official sample | P0 | [Vanilla allay animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/allay.animation.json) | Flying/idle/held-item/dance layered motion | INSPECTED |
| ANIM-034 | Official sample | P0 | [Vanilla armadillo animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/armadillo.animation.json) | Rolling/unrolling/transformation, age variants | INSPECTED |
| ANIM-035 | Official sample | P0 | [Vanilla camel animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/camel.animation.json) | Heavy quadruped sit/stand/dash/walk | INSPECTED |
| ANIM-036 | Official sample | P0 | [Vanilla breeze animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/breeze.animation.json) | Elemental motion, attack and particles | INSPECTED |
| ANIM-037 | Official sample | P0 | [Vanilla copper_golem animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/copper_golem.animation.json) | Item handling/spin/conditioned animation/FX | INSPECTED |
| ANIM-038 | Official sample | P0 | [Vanilla creaking animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/creaking.animation.json) | Irregular gait/head movement and time drivers | INSPECTED |
| ANIM-039 | Official sample | P0 | [Vanilla axolotl animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/axolotl.animation.json) | Aquatic locomotion and mode variation | INDEXED |
| ANIM-040 | Official sample | P0 | [Vanilla armor_stand animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/armor_stand.animation.json) | Pose channels and rigid articulation | INDEXED |
| ANIM-041 | Official sample | P0 | [Vanilla bat animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/bat.animation.json) | Wing oscillation | INDEXED |
| ANIM-042 | Official sample | P0 | [Vanilla bee animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/bee.animation.json) | Flight, wing/body timing | INDEXED |
| ANIM-043 | Official sample | P0 | [Vanilla blaze animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/blaze.animation.json) | Floating segmented-body motion | INDEXED |
| ANIM-044 | Official sample | P0 | [Vanilla bow animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/bow.animation.json) | Item action timing | INDEXED |
| ANIM-045 | Official sample | P0 | [Vanilla cat animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/cat.animation.json) | Quadruped locomotion/idle | INDEXED |
| ANIM-046 | Official sample | P0 | [Vanilla chicken animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/chicken.animation.json) | Lightweight biped cadence | INDEXED |
| ANIM-047 | Official sample | P0 | [Vanilla cow animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/cow.animation.json) | Minimal procedural gait | INDEXED |
| ANIM-048 | Official sample | P0 | [Vanilla creeper animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/creeper.animation.json) | Simple gait and constrained rig | INDEXED |
| ANIM-049 | Official sample | P0 | [Vanilla crossbow animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/crossbow.animation.json) | Held item action and transitions | INDEXED |
| ANIM-050 | Official sample | P0 | [Vanilla dolphin animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/dolphin.animation.json) | Aquatic curve propagation | INDEXED |
| ANIM-051 | Official sample | P0 | [Vanilla drowned animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/drowned.animation.json) | Humanoid swim/walk variation | INDEXED |
| ANIM-052 | Official sample | P0 | [Vanilla agent animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/agent.animation.json) | Assistant entity animation | INDEXED |
| ANIM-053 | Official sample | P0 | [Vanilla arrow animation](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animations/arrow.animation.json) | Projectile rotation/simple motion | INDEXED |


### 04 Mojang Vanilla — controller dan wiring — 18 sumber

| ANIM-054 | Official sample | P0 | [Vanilla allay animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/allay.animation_controllers.json) | Idle/fly/controller composition | INDEXED |
| ANIM-055 | Official sample | P0 | [Vanilla armadillo animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/armadillo.animation_controllers.json) | Roll/peek unroll state | INDEXED |
| ANIM-056 | Official sample | P0 | [Vanilla breeze animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/breeze.animation_controllers.json) | Idle/attack/sliding event timing | INDEXED |
| ANIM-057 | Official sample | P0 | [Vanilla camel animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/camel.animation_controllers.json) | Movement and sit/dash states | INDEXED |
| ANIM-058 | Official sample | P0 | [Vanilla copper_golem animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/copper_golem.animation_controllers.json) | Idle/item/spin state, variants | INDEXED |
| ANIM-059 | Official sample | P0 | [Vanilla creaking animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/creaking.animation_controllers.json) | Locomotion/state behavior | INDEXED |
| ANIM-060 | Official sample | P0 | [Vanilla fox animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/fox.animation_controllers.json) | Seven motion states | INSPECTED |
| ANIM-061 | Official sample | P0 | [Vanilla humanoid animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/humanoid.animation_controllers.json) | General human state composition | INDEXED |
| ANIM-062 | Official sample | P0 | [Vanilla player animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/player.animation_controllers.json) | Many player action states and triggering | INSPECTED |
| ANIM-063 | Official sample | P0 | [Vanilla sniffer animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/sniffer.animation_controllers.json) | Large creature multi-state movement | INDEXED |
| ANIM-064 | Official sample | P0 | [Vanilla panda animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/panda.animation_controllers.json) | Behaviorally diverse action states | INDEXED |
| ANIM-065 | Official sample | P0 | [Vanilla frog animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/frog.animation_controllers.json) | Land/aquatic state composition | INDEXED |
| ANIM-066 | Official sample | P0 | [Vanilla armor_stand animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/armor_stand.animation_controllers.json) | Pose selection/state examples | INDEXED |
| ANIM-067 | Official sample | P0 | [Vanilla axolotl animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/axolotl.animation_controllers.json) | Amphibious motion controller | INDEXED |
| ANIM-068 | Official sample | P0 | [Vanilla bee animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/bee.animation_controllers.json) | Flight and behavior phase | INDEXED |
| ANIM-069 | Official sample | P0 | [Vanilla spider animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/spider.animation_controllers.json) | Simple multi-limb motion controller | INDEXED |
| ANIM-070 | Official sample | P0 | [Vanilla spear animation controller](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/animation_controllers/spear.animation_controllers.json) | Item action controller | INDEXED |
| ANIM-071 | Official sample | P0 | [Vanilla Copper Golem client entity wiring](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/entity/copper_golem.entity.json) | Cross-reference clip/controller/effect and resource wiring | WEB |


### 05 Prinsip artistik, blocking, timing, acting — 3 sumber

| ANIM-072 | Craft | P0 | [Disney Animation Process](https://www.disneyanimation.com/process/animation/) | Timing, silhouette, staging, weight, acting, follow-through | WEB |
| ANIM-073 | Craft | P0 | [Pixar in a Box — Animation](https://www.khanacademy.org/pixar/animate) | Blocking, timing, Bézier interpolation, squash/stretch | WEB |
| ANIM-074 | Craft | P0 | [Pixar in a Box — Rigging](https://www.khanacademy.org/computing/pixar/pixar-rigging) | Animation-ready structural model design | WEB |


### 06 Engine & DCC: composition, rig dan retarget — 10 sumber

| ANIM-075 | Engine concept | P1 | [Blender Constraint Overview](https://docs.blender.org/manual/en/latest/animation/armatures/posing/bone_constraints/introduction.html) | Mechanical limits and IK constraints | WEB |
| ANIM-076 | Engine concept | P1 | [Blender IK Overview](https://docs.blender.org/manual/en/5.0/animation/armatures/posing/bone_constraints/inverse_kinematics/introduction.html) | Inverse-kinematics intuition | WEB |
| ANIM-077 | Engine concept | P1 | [Blender Animation Developer Architecture](https://developer.blender.org/docs/features/animation/) | How animation data and evaluation interact | WEB |
| ANIM-078 | Engine concept | P1 | [Houdini KineFX Overview](https://www.sidefx.com/docs/houdini/character/kinefx/overview.html) | Procedural rig/animation architecture | WEB |
| ANIM-079 | Engine concept | P1 | [Houdini KineFX Retargeting](https://www.sidefx.com/docs/houdini/character/kinefx/retargeting.html) | Rest-pose alignment, differing morphologies, joint mapping | WEB |
| ANIM-080 | Engine concept | P1 | [Houdini Posing and Layering](https://www.sidefx.com/docs/houdini/character/kinefx/posing) | FK/IK corrections layered before/after retarget | WEB |
| ANIM-081 | Engine concept | P1 | [Godot AnimationTree](https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html) | State machine, layering, blend and phase sync | WEB |
| ANIM-082 | Engine concept | P1 | [Godot Animation Overview](https://docs.godotengine.org/en/stable/tutorials/animation/index.html) | Track and editor taxonomy | WEB |
| ANIM-083 | Engine concept | P1 | [Unreal Animation Sync Groups](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-sync-groups-in-unreal-engine) | Sync gait phases & contact markers | WEB |
| ANIM-084 | Engine concept | P1 | [Unreal Animation Mirroring](https://dev.epicgames.com/documentation/unreal-engine/mirroring-animation-in-unreal-engine) | Mirroring transform/curve/marker correspondence | WEB |


### 07 Interpolasi, format, ruang transform — 6 sumber

| ANIM-085 | Math/interchange | P1 | [Khronos glTF 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) | SLERP, cubicspline, linear, STEP sampling math | WEB |
| ANIM-086 | Math/interchange | P1 | [glTF Animation Sampler JSON Schema](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/schema/animation.sampler.schema.json) | Sampler input/time ordering/interpolation contract | WEB |
| ANIM-087 | Math/interchange | P1 | [Khronos Animation Tutorial](https://github.com/KhronosGroup/glTF-Tutorials/blob/main/gltfTutorial/gltfTutorial_007_Animations.md) | Interpolation explained with pseudo code | WEB |
| ANIM-088 | Math/interchange | P1 | [BVH Hierarchy Format](https://research.cs.wisc.edu/graphics/Courses/cs-838-1999/Jeff/BVH.html) | Coordinate spaces, joint hierarchy, Euler rotation order | WEB |
| ANIM-089 | Math/interchange | P1 | [glTF Fox Animated Example](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Fox/README.md) | Three cycles on shared skeleton | WEB |
| ANIM-090 | Math/interchange | P1 | [glTF Core Model Catalog](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Models-core.md) | Interpolation test and license-per-asset metadata | WEB |


### 08 Open-source animation libraries — 7 sumber

| ANIM-091 | Open-source implementation | P1 | [BedrockMotion](https://github.com/EaseCation/BedrockMotion) | Bedrock animation/blend evaluation independent of game | WEB |
| ANIM-092 | Open-source implementation | P1 | [ozz-animation](https://github.com/guillaumeblanc/ozz-animation) | Sampling, blending, memory-efficient runtime | WEB |
| ANIM-093 | Open-source implementation | P1 | [ozz Blend Sample](https://github.com/guillaumeblanc/ozz-animation/blob/master/samples/blend/README.md) | Layer weights, rest fallback, synchronized gait | WEB |
| ANIM-094 | Open-source implementation | P1 | [ozz Release Notes](https://github.com/guillaumeblanc/ozz-animation/releases) | Versioned lessons on IK, compaction and root motion | WEB |
| ANIM-095 | Open-source implementation | P1 | [Animation Compression Library](https://github.com/nfrechette/acl) | Transform compression and bounded error | WEB |
| ANIM-096 | Open-source implementation | P1 | [ACL Documentation](https://github.com/nfrechette/acl/blob/develop/docs/README.md) | Hierarchical error metrics and optimization | WEB |
| ANIM-097 | Open-source implementation | P1 | [Motion Matching reference implementation](https://github.com/orangeduck/Motion-Matching/blob/main/controller.cpp) | Contact processing and inertialization concepts | WEB |


### 09 Motion engineering, IK, contact dan fidelity — 14 sumber

| ANIM-098 | Technical research | P1 | [Inverse Kinematics and Foot Locking (2026)](https://www.theorangeduck.com/page/inverse-kinematics-foot-locking) | Leg solve, foot plant, offline slip correction | WEB |
| ANIM-099 | Technical research | P1 | [Inertial Easing (2026)](https://www.theorangeduck.com/page/inertial-easing) | Velocity-preserving state handoffs | WEB |
| ANIM-100 | Technical research | P1 | [Joint Error Propagation (2025)](https://theorangeduck.com/page/joint-error-propagation) | Root joint error vs world-space end-effector error | WEB |
| ANIM-101 | Technical research | P1 | [Animation Quality (2024)](https://www.theorangeduck.com/page/animation-quality) | Pose and perceptual error vs data reduction | WEB |
| ANIM-102 | Technical research | P1 | [Unrolling Rotations (2024)](https://theorangeduck.com/page/unrolling-rotations) | Angle continuity and rotation wrapping | WEB |
| ANIM-103 | Technical research | P1 | [Spring Roll Call](https://theorangeduck.com/page/spring-roll-call) | Various spring responses and safe damping | WEB |
| ANIM-104 | Technical research | P1 | [Code vs Data Driven Displacement](https://www.theorangeduck.com/page/code-vs-data-driven-displacement) | Locomotion pose/contact ownership | WEB |
| ANIM-105 | Technical research | P1 | [Propagating Velocities Through Animation Systems](https://theorangeduck.com/page/propagating-velocities-through-animation-systems) | Velocity continuity across animation layers | WEB |
| ANIM-106 | Technical research | P1 | [Animation Blend Spaces Without Triangulation](https://www.theorangeduck.com/page/animation-blend-spaces-without-triangulation) | Advanced blend-space math for conceptual study | WEB |
| ANIM-107 | Technical research | P1 | [Fitting Code Driven Displacement Revisited (2026)](https://www.theorangeduck.com/page/fitting-code-driven-displacement-revisited) | Fitting authored motion to displacement | WEB |
| ANIM-108 | Technical research | P1 | [The Orange Duck Research Archive](https://www.theorangeduck.com/page/all) | Broad archive and dated research | WEB |
| ANIM-109 | Technical research | P1 | [FABRIK paper, 2011](https://www.sciencedirect.com/science/article/pii/S1524070311000178) | Iterative inverse-kinematics position solver | WEB |
| ANIM-110 | Technical research | P1 | [GDC Biomechanical Foot Placement](https://gdcvault.com/play/1023009/Fitting-the-World-A-Biomechanical) | Foot placement and biomechanical constraints | WEB |
| ANIM-111 | Technical research | P1 | [GDC Animation Driven Locomotion](https://gdcvault.com/play/1015387/Animation-Driven-Locomotion-for-Smoother) | Game-character displacement/cadence | WEB |


### 10 Open datasets dan animated test assets — 6 sumber

| ANIM-112 | Dataset/test asset | P2 | [Ubisoft La Forge / LaFAN1](https://github.com/ubisoft/ubisoft-laforge-animation-dataset) | Inbetweening, foot-contact, locomotion benchmark | WEB |
| ANIM-113 | Dataset/test asset | P2 | [AMASS motion archive](https://amass.is.tue.mpg.de/) | Mocap coverage; high-fidelity reference | WEB |
| ANIM-114 | Dataset/test asset | P2 | [AMASS code and data references](https://github.com/nghorbani/amass) | Mocap processing workflow | WEB |
| ANIM-115 | Dataset/test asset | P2 | [AMASS ICCV paper](https://openaccess.thecvf.com/content_ICCV_2019/html/Mahmood_AMASS_Archive_of_Motion_Capture_As_Surface_Shapes_ICCV_2019_paper.html) | Mocap corpus structure | WEB |
| ANIM-116 | Dataset/test asset | P2 | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | Rig animation and format tests | WEB |
| ANIM-117 | Dataset/test asset | P2 | [Mojang Bedrock Samples Main](https://github.com/Mojang/bedrock-samples) | Bedrock native corpus | WEB |


### 11 Advanced ML / motion-matching (exploratory) — 4 sumber

| ANIM-118 | ML research | P2 | [Ubisoft Learned Motion Matching](https://www.ubisoft.com/en-us/studio/laforge/news/3NWqwcMU9lMfumgfPAEfka/learned-motion-matching) | Motion search/state coverage and transitions | WEB |
| ANIM-119 | ML research | P2 | [Ubisoft Introducing Learned Motion Matching](https://www.ubisoft.com/en-us/studio/laforge/news/6xXL85Q3bF2vEj76xmnmIu/introducing-learned-motion-matching) | Explain data and runtime costs of motion matching | WEB |
| ANIM-120 | ML research | P2 | [Ubisoft La Forge Publications](https://www.ubisoft.com/en-us/studio/laforge/publications) | Discover research on retarget and animation generation | WEB |
| ANIM-121 | ML research | P2 | [Motion Diffusion Model](https://github.com/guytevet/motion-diffusion-model) | Text-to-motion research, not directly a Bedrock exporter | WEB |


### 12 Komunitas Blockbench / marketplace: sample profesional — 6 sumber

| ANIM-122 | Community/reference | P2 | [Blockbench Workshop — animated models](https://blockbenchworkshop.com/models/animation) | Rigged community model with clip examples | WEB |
| ANIM-123 | Community/reference | P2 | [Blockbench Workshop — Minecraft models](https://blockbenchworkshop.com/models/minecraft) | Minecraft-style models, some with animations | WEB |
| ANIM-124 | Community/reference | P2 | [MCModels — products marketplace](https://mcmodels.net/products) | Professional product previews and production complexity references | WEB |
| ANIM-125 | Community/reference | P2 | [Blockbench plugins catalog](https://github.com/JannisX11/blockbench-plugins/blob/master/plugins.json) | Animation baking/sliders and export plugin landscape | WEB |
| ANIM-126 | Community/reference | P2 | [Blockbench curated plugins repo](https://github.com/JannisX11/blockbench-plugins) | Extension/release/maintenance patterns | WEB |
| ANIM-127 | Community/reference | P2 | [Animated Java plugin documentation](https://github.com/JannisX11/blockbench-plugins/blob/master/plugins/animated_java/about.md) | Java-specific animation pipeline as a contrast study | WEB |


### 13 Canonical source M-LazyDesigner (pinned Local) — 18 sumber

| ANIM-128 | Internal | P0 | [.agents/skills/lazydesigner-animation/SKILL.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/.agents/skills/lazydesigner-animation/SKILL.md) | Animation specialist and routing | INSPECTED |
| ANIM-129 | Internal | P0 | [.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md) | Live visual correction rules | INDEXED |
| ANIM-130 | Internal | P0 | [docs/03-authoring/animation/standard.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/docs/03-authoring/animation/standard.md) | Animation normative policy inside repo | INSPECTED |
| ANIM-131 | Internal | P0 | [docs/02-reference/package/animation.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/docs/02-reference/package/animation.md) | Motion reference contract | INDEXED |
| ANIM-132 | Internal | P0 | [mcp/docs/MOTION_RECIPE_ENGINE.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/docs/MOTION_RECIPE_ENGINE.md) | Source motion recipe architecture | INDEXED |
| ANIM-133 | Internal | P0 | [mcp/docs/SEMANTIC_RIG_ENGINE.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/docs/SEMANTIC_RIG_ENGINE.md) | Source rig/pivot IK architecture | INDEXED |
| ANIM-134 | Internal | P0 | [mcp/lib/animation/quality.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/animation/quality.ts) | Strict numeric key reduction and loop diagnostics | INSPECTED |
| ANIM-135 | Internal | P0 | [mcp/lib/animation/motionDynamics.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/animation/motionDynamics.ts) | Velocity/acceleration review | INDEXED |
| ANIM-136 | Internal | P0 | [mcp/lib/animation/contactEvidence.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/animation/contactEvidence.ts) | Contact marker geometric evidence | INDEXED |
| ANIM-137 | Internal | P0 | [mcp/lib/animation/ikBakeReadiness.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/animation/ikBakeReadiness.ts) | Source-only IK bake readiness | INSPECTED |
| ANIM-138 | Internal | P0 | [mcp/lib/animation/rootMotionAnalysis.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/animation/rootMotionAnalysis.ts) | Root-motion measurement | INDEXED |
| ANIM-139 | Internal | P0 | [mcp/lib/animation/nativeRestorationContract.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/animation/nativeRestorationContract.ts) | Native playback restoration strict gates | INSPECTED |
| ANIM-140 | Internal | P0 | [mcp/lib/animation/molangSemantics.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/animation/molangSemantics.ts) | Molang value/driver semantics | INDEXED |
| ANIM-141 | Internal | P0 | [mcp/lib/rig/fabrik.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/lib/rig/fabrik.ts) | Rig FABRIK source | INDEXED |
| ANIM-142 | Internal | P0 | [mcp/scripts/verify/verify-animation-live.ts](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/scripts/verify/verify-animation-live.ts) | Live smoke proof script; not run | INSPECTED |
| ANIM-143 | Internal | P0 | [mcp/docs/QUALITY_BENCHMARK.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/docs/QUALITY_BENCHMARK.md) | Quality-first benchmark contract | INDEXED |
| ANIM-144 | Internal | P0 | [mcp/tests/fixtures/quality-benchmark-cases.json](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/mcp/tests/fixtures/quality-benchmark-cases.json) | Synthetic examples only | INDEXED |
| ANIM-145 | Internal | P0 | [docs/05-operations/next-action.md](https://github.com/OpenITStudios/M-LazyDesigner/blob/ada279dab3e064dbc17e15cf7bdbab1ee79f1f1d/docs/05-operations/next-action.md) | Current continuation status (Texture/UV notes) | INDEXED |

## Safe use

- Minecraft/Mojang sample assets are governed by Minecraft EULA: study patterns without cloning or redistributing models.
- Blockbench/BedrockMotion GPL-3.0 implementations must not be copied into an incompatible proprietary codebase; concept-only study is distinct from reusing code.
- MIT animation libraries still require retaining attribution when actual code is reused; check every dataset/model/marketplace item license independently. Public access is not commercial training permission.
- Official current Bedrock schema and native Blockbench/target-version evidence outrank external game engines, old mirrors, and speculative research.
- Only a concrete version-sensitive defect or reference-bound decision justifies adding a regression or changing an existing owner. No second source manager or always-loaded AI corpus.

## 2026-11-01 curated professional motion examples (research-only; separate from 145 original source pointers)

Evidence is PAGE only: indexed named clips, durations and descriptions were examined. **No original GIF frames decoded, interactive 3D animation played, source .bbmodel inspected, installed Blockbench playback or motion-quality verdict.**

| Case | Source-page fact | Targeted research; what is not proven |
| --- | --- | --- |
| AV-01 | [Bepoo Animation Showcase](https://bepoo.netlify.app/animations): labels for walk/run, cobra and spider walk, hurt/death, action and environmental animations | Compare separate biped, quadruped/creature, one-shot and mechanical motion grammar *after actual playback*. Index labels do not establish quality, foot contact or timing |
| AV-02 | [Nérysia Ice Dragon](https://models.nerysia.net/en/modeles/dragon-de-glace): publisher lists 26 clips with idle 4s, walk 1.6s, fly 1.15s, takeoff 1.6s, land 1.4s; 53 bones and 2048×2048 texture | Evaluate distinct fly/walk/takeoff/land/breath/rest poses and transitions when an actual clip is accessible. Clip counts, durations and texture dimensions are NOT quality targets or Bedrock proof |
| AV-03 | [Amonde Goblin Boss](https://mcmodels.net/products/13290/goblin-boss): listing names idle, walk, fastwalk, attack1–5, death; describes combo, stomp, leap and shout | Review contact, anticipation, impact and recovery for each action; marketing text is NOT evidence of a good animation |
| AV-04 | [Official Blockbench Animation guide](https://blockbench.net/wiki/guides/bedrock-modeling/) and [Microsoft Creator Guide](https://learn.microsoft.com/en-us/minecraft/creator/documents/entitymodelingandanimation?view=minecraft-bedrock-stable) | Supported bone/timeline/keyframe/export mechanics; technical validity does not guarantee motion weight or artistic quality |

Research question (not a request for generation, benchmarking or native testing): compare accessible *original artists' animation examples* when their motion can genuinely be viewed, including readable start, impact/contact, recovery, loop and attachment semantics. If source motion is inaccessible record UNKNOWN, do not invent timing/keyframes. Keep current A01–A16 Animation ownership unchanged. **No Golden Assets, generator test, or new engine/case-reader during research.**

Source models, animation data and thumbnails remain third-party property; no asset-use/training license is inferred. ModelEngine/MythicMobs support does not imply Bedrock-native playback.

## 2026-11-01 second cohort: narrative motion research and format boundaries (RESEARCH ONLY)

**Evidence status:** Individual publisher/listing pages read, original previews/thumbnail image looked at where available, but **no interactive clips, GIF frames, 3D model files, Blockbench timeline or animation keys were opened**. A listed animation name, count, duration or even a publisher's description of a good performance is not first-hand motion observation. This section expands research without requesting any model-generation test, Golden Asset or Runtime mutation.

### B. Character-specific clip semantics and why mere clip counts mislead

| Case/source | Page-confirmed clip vocabulary or source fact | Distinct artistic question to investigate from actual motion later |
| --- | --- | --- |
| AV-05 [Logan Kant, Raccoon Trader](https://blockbenchworkshop.com/model/logan_kant/raccoon-trader) | 13 listed clips including idle, sit/beg, eat, backpack on/off/open/close, happy, sneeze, walk/run, wash; publisher lists 19 bones and 64x64 texture | Small creature's emotional actions, repeated hand-to-mouth contact, and changing accessory states need coherent story beats. Counts, no matter how high, do not prove personality or temporal flow |
| AV-06 [Logan Kant, Crab Sailor](https://blockbenchworkshop.com/model/logan_kant/crab-sailor) | Eight clips named dance, idle, walk, drink, salute, snap, tipsy, hat toss; 54 bones claimed | Crab limb/claw arcs, cap/bottle attachment and small-scale comic timing are different research questions from humanoid walking. No footage inspected |
| AV-07 [Logan Kant, Ender Whale](https://blockbenchworkshop.com/model/logan_kant/ender-whale) | Six clips: drift, swim, sing, roll, rift dive, emerge; 37 bones claimed; 55 elements listed | Separate hovering/drifting from propulsive swim; large creature and tail/flipper hierarchy might need distinct phase continuity. The creator's description "almost without effort" is concept intent, not demonstrated motion quality |
| AV-08 [Polyjo, Dead Traveler](https://blockbenchworkshop.com/model/polyjo/dead-traveler-skeleton) | Eight clips: idle, walk, charge, begin block, block, block destroy, block stop and slash; 14 bones listed | Blocking consists of entering a guarded stance, maintaining pose, and leaving/recovering, rather than simply one looping clip. Do not infer action timing, hand/shield collisions or combat correctness from names |
| AV-09 [Polyjo, Redstone Golem](https://blockbenchworkshop.com/model/polyjo/redstone-golem-minecraft-dungeons) | Two clips: idle and walk. Uploader calls model a near-1:1 reconstruction of Minecraft Dungeons | Contrast lower animation count of a heavy brute with a 13-action comic pet. Clip count not a craft score; this is derivative franchise art, so no source extraction without separate rights |
| AV-10 [Bepoo Motion Showcase](https://bepoo.netlify.app/animations) | Original portfolio labels walking/running, cobra walk, cyborg spider walk, desert worm, squid idle, water fill, door, chainsaw, combat hits, death and emotes | Motion taxonomy across biped, many-legged, undulating, floating, held-item/door and one-shot effects. Source GIF retrieval/playback was unavailable; avoid claiming these clips are smooth or have contact correctness |
| AV-11 [Nérysia](https://models.nerysia.net/en), [Ice Dragon](https://models.nerysia.net/en/modeles/dragon-de-glace) | Catalog currently advertises 42 models/403 animations; Ice Dragon lists 26 clips and durations for walk/fly/takeoff/land; targeted to ModelEngine/MythicMobs | Categorize multi-mode locomotion, attacks, breathing, rest, death; timings are examples of that author, not default for Bedrock or all dragons. Viewer playback not performed |
| AV-12 [Amonde, Goblin Boss](https://mcmodels.net/products/13290/goblin-boss) | Marketing names idle, walk, fastwalk, 5 attacks and death; describes swing/thrust, stomp, leap, shout and phase changes | Actions require different anticipation-to-impact readings and recovery, but marketing is not observed pose/spacing evidence. ModelEngine and MythicMobs content is not Bedrock |
| AV-13 [ArtsByKev, Frost Lord](https://www.artsbykevstudio.com/webstore/p/frost-lord) | Publisher lists Blockbench model, texture and animation files in paid pack, and describes possible export to other formats | Creative work is a plausible candidate for future true clip study; paid inclusion does not grant broad copying, training, metadata reuse or prove quality/Bedrock correctness |

### C. Independent animator/technical sources: what to learn, what not to transplant

| Primary source | Specific published claim | Bounded insight / negative boundary |
| --- | --- | --- |
| [Animation Mentor, Don Kim (2025) 12 Principles](https://www.animationmentor.com/blog/tutorial-12-principles-of-animation/) | Anticipation, staging, pose-to-pose, follow-through, slow-in/out, arcs, timing, exaggeration, secondary action and posing contribute to acting clarity | A useful vocabulary for analyzing **real** posed/video performance. Do not require all 12 in every clip, exaggerate every creature equally or promise a particular FPS/key count |
| [Animation Mentor, Chris Hurtt on anticipation](https://www.animationmentor.com/blog/anticipation-the-12-basic-principles-of-animation/) | Game actions can use small anticipation cues for readability; anticipation amplitude and timing must match action force, while an early reaction can imply a collision happened before impact | Research questions: Is the tell legible? Does reaction begin after contact? A static sprite or clip name cannot prove timing |
| [Animation Mentor, Dave Burgess on timing](https://www.animationmentor.com/blog/timing-the-12-basic-principles-of-animation/) | Hold and transition durations communicate weight and intent; large/heavy versus small/quick characters may need different holds | Reject universal clip length, fixed hold count or global speed. Do not copy film-example frame values as Minecraft presets |
| [Daniel Holden, Inverse Kinematics and Foot Locking (2026)](https://www.theorangeduck.com/page/inverse-kinematics-foot-locking) | Toe/heel world-space contact can drift from character motion; article treats contact detection, leg solve and stabilization as separate aspects | The *visible failure mode* of foot sliding is transferable; the published IK code/runtime systems are not automatically appropriate for simple Bedrock rigs. No new procedural engine |
| [Blockbench, Animation Expressions](https://blockbench.net/wiki/guides/animation-expressions/) | Editor supports expressions and sine, time update/blend and variable-driven expressions; traditional glTF/FBX expressions may be baked while Bedrock handles supported expressions | Mathematical movement is a tool, not evidence of compelling timing; sine-only walk may look robotic and dynamic variables are format-dependent. Distinguish editor preview from target export semantics |

**Artistic contrast to retain:** A small timid animal can use expressive face/accessory micro-actions; a giant whale might rely on long body/flipper phases; heavy undead can hold a defensive pose; a mechanical gate should obey hinges rather than quadruped movement. They cannot share one fixed animation amplitude or pacing prescription. Source naming alone gives **intent**, not evidence that the performance succeeded.

**Research knowledge to seek, not a request to test any generator:** reliable original playback clips showing beginning, clear action extreme, meaningful contact, settle, loop handoff and changing attachments, with creator/clip provenance and reuse rights. When absent, state UNKNOWN and continue comparing publications. Do not confuse workshop model format "generic", GeckoLib "modded", Java ModelEngine/GeckoLib and native Bedrock visual export. Keep one current Animation standard and case-coverage owner; do not introduce a new case reader or benchmark.

**Licensing/visual certainty:** Third-party creator previews are link/citation research only; public CC0 or CC BY claims must be reviewed per item and against underlying character/design IP. No assets or animation curves downloaded into the repo, no model training use, no real clip-quality judgments and no artist/runtime approvals.

## 2026-11-01 third motion research cohort: direct media pointers versus name-only catalogs (RESEARCH ONLY)

Publisher pages and clip *names* were inspected; Bepoo provides direct GIF URLs, but actual GIF frames were not decoded or played. No source timeline, model file, interactive 3D playback or native Blockbench motion has been reviewed. Therefore all motion-quality claims (weight, foot plant, anticipation, transition smoothness) remain UNOBSERVED, not silently inferred.

| ID and source | Public source fact | Targeted artistic question; missing proof |
| --- | --- | --- |
| AV-14 [Bepoo Animation Showcase](https://bepoo.netlify.app/animations) | Creator lists Looping/Hold, and direct GIFs for [walk](https://bepoo.netlify.app/assets/animations/walk.gif), [cyborg spider](https://bepoo.netlify.app/assets/animations/cyborg_mutant_spider_walk.gif), [bendy walk](https://bepoo.netlify.app/assets/animations/bendy_walk.gif), [chainsaw](https://bepoo.netlify.app/assets/animations/chainsaw.gif). | More actionable original media links than marketing labels; no GIF playback occurred. Compare biped, many-leg, flexible and prop motion only when original frames can genuinely be viewed. |
| AV-15 [Eann Kintsugi](https://blockbenchworkshop.com/model/eanncrod/kintsugi) | Bedrock; publisher lists 28 clips and 24 bones. Labels include idle, hover/fly, turning, bite, flame, tail sweep, flinch, knockdown/get-up, rage, exhaustion, limp and death. | State/mode differentiation and pose continuity are questions; 28 clips do not prove excellent motion. |
| AV-16 [Eann Visage Of War](https://blockbenchworkshop.com/model/eanncrod/visage-of-war) | Bedrock; 16 clips, 20 bones; aerial hovering, banking, halberd sweep/thrust, descent, recovery. | Aerial orientation and weapon reach are different from walking; no actual trajectory or timing inspected. |
| AV-17 [Eann Minotaur](https://blockbenchworkshop.com/model/eanncrod/minotaur) | Bedrock; 8 clips/20 bones, calm vs hostile idle, walk/run and hammer attacks. | Heavy weapon inertia and emotional stance need original observed poses. Clip list is intent only. |
| AV-18 [Eann Werebear](https://blockbenchworkshop.com/model/eanncrod/werebear) | GeckoLib; 7 clips/25 bones, attacks and transformations. | Transforming form/rig differs from locomotion; GeckoLib is not proven Bedrock-compatible. |
| AV-19 [fukuda1320 Moist Golem New Version](https://blockbenchworkshop.com/model/fukuda1320/moist-golem-new-version) | Generic model, 4 elements, 4 bones, 2 clips: swimming and attack. | Minimal structure may support expressive movement; fluidity and attachment unknown. |
| AV-20 [Volya Ruin Sentinel](https://mcmodels.net/products/17484/the-ruin-sentinel) | Java ModelEngine/MythicMobs boss advertises six clips plus VFX, weapon, intro and combat systems. | Separate artist motion from gameplay hitbox/state scripting, which lies outside LazyDesigner asset scope. |
| AV-21 [Ginko Monkey King](https://mcmodels.net/products/16932/boss-forge-of-kingdoms-ginkos-monkey-king) | Vendor says 28 animations including staff combos and timing-synchronized hit detection. | Advertisement is not first-hand temporal proof; do not import Java combat logic. |
| AV-22 [DepartmentQDE Slime Boss](https://mcmodels.net/products/15960/slime-bosss) | Product lists grabs, slams, burrowing/flying minion roles with static artwork. | Soft-body motion and rigid Cube rotations require different interpretation. No observed deforming animation. |
| AV-23 [1CAMOU Dungeon Starter](https://1camou.itch.io/dungeon-starter-blockimagine) (HOLD) | Vendor offers rigged and animated model packages and reports AI assistance. | File availability is not proof of compelling animation or source permission for reuse/training. |

Study families should remain separate: flying, swimming, many-legged stepping, heavy weapon attacks, emotional stance and transformations. An animation name is a *question to research*, not an observed performance. Generic, GeckoLib, Bedrock, GLB and Java ModelEngine formats do not share automatic animation guarantees. More original artist motion sources and lawful access are needed before any conclusive qualitative judgments.

**No Golden Assets, generator tests, newly required playback tests, new Animation engine, casebook promotion, or production rule changes.** Third-party animation curves and model files are link-only, not acquired training data.


## Working Art-Craft Knowledge v0.1 — Animation (2026-11-01; RESEARCH SYNTHESIS)

**Purpose:** Convert published animation principles and curated creator clip *intent* into reusable artistic questions, preserving honest proof status. The 145-source reference inventory and existing A01–A16 research cases retain their current identities. This is **not** a new motion engine, runtime clip recipe, validated playback, Golden Asset, or recommendation to test the generator.

**Evidence vocabulary:** PRIMARY_TEACHING = actual professional animator/article consulted; CLIP_LABEL = source creator/publisher lists named motion but frames not played; SOURCE_MEDIA_LOCATED = original clip URL exists, frames not analyzed; INFERENCE = plausible application rather than verified creator technique; UNOBSERVED = no view of actual performance.

### AK-01 — Motion causality: intention, preparation, action, response

**Primary teaching:** [Animation Mentor / Chris Hurtt, Anticipation](https://www.animationmentor.com/blog/anticipation-the-12-basic-principles-of-animation/) explains that an anticipation may be subtle or broad, and must be causally aligned with the following action. Starting a hit reaction before contact can accidentally communicate a false impact order (PRIMARY_TEACHING).

**Creator-study leads:** [Minotaur by eanncrod](https://blockbenchworkshop.com/model/eanncrod/minotaur) lists calm/hostile idle and hammer actions; [Goblin Boss by Amonde](https://mcmodels.net/products/13290/goblin-boss) describes attacks/stomps/leaps. These establish *intended types*, not observed animation quality (CLIP_LABEL).

**Working interpretation (INFERENCE):** Read a staged action as intent or cue → motion commitment → meaningful impact/transition → recovery/hold when applicable. The particular pose sequence depends on the reference and action; no fixed number of stages or keyframes is appropriate.

**Apply:** A current animated character must communicate a distinct high-impact action, reaction or emotional change.

**Reject/defer:** Artificial pre-motion before every idle twitch, impossible reaction order, forced extravagant winding-up for quiet actions, or declaring excellent contact merely from a vendor clip list. No original keyframes or actual weapon contact were observed. Existing owner: Animation standard / existing action-weight research.

### AK-02 — Weight comes from readable timing relationships, not “slow = heavy”

**Primary teaching:** [Animation Mentor / Dave Burgess, Timing](https://www.animationmentor.com/blog/timing-the-12-basic-principles-of-animation/) discusses exposure/hold duration and transition spacing as tools for giving poses clarity and perceived weight; large characters and small quick characters can need different rhythms (PRIMARY_TEACHING). His historical film-frame examples are **not** numerical presets for Minecraft.

**Working interpretation (INFERENCE):** Perceived mass can come from anticipation and acceleration, delayed secondary parts, the timing of a main pose, and recovery—rather than uniformly scaling the clip's speed. “Slow every keyframe by a fixed factor” can undermine impact or make a heavy action feel weak.

**Use:** Artist reference implies a weight difference, for example a large hammer-bearing golem compared with a tiny expressive mascot.

**Reject/defer:** One fixed FPS, clip duration, hold count or easing curve; assuming smooth interpolation always improves acting. Exact rig motion and keyframe timing remain UNOBSERVED.

### AK-03 — Locomotion depends on how the body is supported and propelled

**Evidence:** [Bepoo Animation Showcase](https://bepoo.netlify.app/animations) separates walking, running, many-legged cyborg-spider movement, cobra/worm motion and floating creature actions (CLIP_LABEL); [Ender Whale](https://blockbenchworkshop.com/model/logan_kant/ender-whale) lists drift/swim/roll/dive/emerge; [Kintsugi](https://blockbenchworkshop.com/model/eanncrod/kintsugi) lists hover/fly/turn/land-related actions (CLIP_LABEL).

**Working interpretation (INFERENCE):** Legged walking, ground-crawling/undulation, hovering, swimming and flying present *different body-axis, contact and propulsion questions*. Some contact modes need stable grounded support; others need a convincing suspended body phase or fin/tail timing. A simple shared sine oscillator is not sufficient evidence of equivalent character movement.

**Apply:** Only after the asset's actual rig, movement intent and approved original motion reference identify its mode.

**Reject/defer:** Prescribing planted feet to a hovering creature, one global limb phase to spider and biped, or transferring listed 1.6-second walking durations from a dragon seller to every model. Actual clips were not played.

### AK-04 — Expressive props, secondary parts and attachment continuity

**Evidence:** [Raccoon Trader](https://blockbenchworkshop.com/model/logan_kant/raccoon-trader) lists backpack open/close/eat and expressive actions; [Crab Sailor](https://blockbenchworkshop.com/model/logan_kant/crab-sailor) lists drink/hat toss; [Minotaur](https://blockbenchworkshop.com/model/eanncrod/minotaur) lists hammer attacks; [Bepoo](https://bepoo.netlify.app/animations) lists chainsaw and door/environment interactions (CLIP_LABEL).

**Working interpretation:** An accessory can carry part of the animation's story, but its motion depends on the *attachment relationship*: carried object, hinged prop, throwable item and fixed environmental mechanism are not equivalent. Distinguish action intent, movement pivot, contact and release/reattach events.

**Use:** A source action visibly or explicitly involves a particular attached or independently moving part.

**Reject/defer:** Arbitrary reparenting/locator invention from names alone, claiming a throw has correctly timed release without viewing it, or imposing humanoid hand-contact on a quadruped. Bone, pivot and timed contact are UNKNOWN here.

### AK-05 — State vocabulary is not measured motion quality

**Source facts:** [Kintsugi](https://blockbenchworkshop.com/model/eanncrod/kintsugi) lists 28 named clips and 24 bones, [Minotaur](https://blockbenchworkshop.com/model/eanncrod/minotaur) lists 8 and 20, and [Soggy Sanctuary Moist Golem](https://blockbenchworkshop.com/model/fukuda1320/moist-golem-new-version) lists a small set of movements (CLIP_LABEL). [Blockbench Animation Expressions](https://blockbench.net/wiki/guides/animation-expressions/) documents technical expression handling with format-specific behavior, not artist quality.

**Working interpretation:** Categorizing idle, attack, injured, transition, recovery and locomotion is a useful way to *describe what an animation set needs to communicate*. Number of clips, bones, proprietary engine integrations or available expression syntax cannot prove readable poses, correct deformation or smooth transition.

**Use:** Recording creator intent and unresolved research questions, not selecting a fixed “professional” clip-count target.

**Reject/defer:** Treating a marketing list as observed performance, conflating Bedrock/GeckoLib/ModelEngine/Generic file formats, or prescribing mandatory clips to every static object.

### AK-06 — Motion source observability is part of honest Knowledge

**Source distinction:** The [Bepoo showcase](https://bepoo.netlify.app/animations) exposes original GIF URLs (SOURCE_MEDIA_LOCATED), whereas Blockbench Workshop pages may provide embedded interactive previews and clip names (CLIP_LABEL). In this research session those GIF frames/interactive clips were **not played or analyzed**.

**Working interpretation:** Knowledge can confidently record the existence and intended category of a clip, but may not record its actual foot sliding, secondary overlap, smoothness, weight, latency, contact pose, frame count or artistic merit without genuine original-motion observation.

**Use:** Any time a research note turns a source URL/title into a claim about *how the animation moves*.

**Reject/defer:** Silently inventing source poses, rig keyframe contents or human acceptance from advertised descriptions, static posters, clip URLs, or a tool/model count.

### Animation synthesis — hypotheses to retain for further reading

For any original animation study, ask (without running the LazyDesigner generator): what action is communicated; what change precedes it; where does its meaning/weight sit in time; what actually touches, follows, hangs or releases; what movement family is it; and which observations were genuinely watched rather than advertised? Do not turn this into a mandatory new authoring flow, timing preset, Motion Recipe engine, or a request for Golden or incremental testing. Every original-clip performance claim above remains UNOBSERVED.

## Working Art-Craft Knowledge v0.2 — Artist process and original motion mechanics (2026-11-01; RESEARCH SYNTHESIS)

Adds four research distinctions beyond AK-01–AK-06. This is **not** motion generation, Golden benchmarking, instrumented playback, a new rig/IK engine or a required work plan for asset authoring. Source types: ORIGINAL_ARTIST_TUTORIAL = the creator's own described personal method; FIRST_PARTY_EDITOR = Blockbench documentation; ENGINEERING_ARTICLE = published animation/IK research concept, not executed Bedrock code; CLIP_UNOBSERVED = creator clip files/images were not successfully played or decoded.

### AK-07 — Block a meaningful motion with major masses before secondary details

**Source studied.** [sylvain_35 / Creature Animation Workflow: Jumping Horse](https://blockbenchworkshop.com/tutorial/sylvain_35/animating-a-jumping-horse), published July 28, 2026 (ORIGINAL_ARTIST_TUTORIAL), describes an explicit progression: positioning/root travel, main body/bone poses for takeoff and air time, in-betweens/legs, then secondary movement. The artist intentionally ignores tail/eyes/ears at first and calls this *personal practice*, not an industry standard; their simple example **omits anticipation** even though the article discusses when it may help.

**Research distinction:** A meaningful start/end/extreme pose can be readable before small part animations are added. If the core action is wrong, abundant secondary keys cannot repair it. Artists may use pose-to-pose or straight-ahead work depending on context; the first is not mandatory for every hand-authored act.

**APPLY:** Investigating an action with clear semantic phases (jump, strike, recoil, landing, collapse) and genuine source motion evidence.

**REJECT / UNKNOWN:** Making every idle/door-open a four- or six-stage pose template; adding mandatory crouch/anticipation to every jump; claiming the author's example proves reference-specific weight or Bedrock export success. No original clip frames were played during this research.

**Ownership:** AK-01 causality and existing Animation action/weight standard; process literacy only, not a Runtime planner.

### AK-08 — A foot-contact phase is not merely a low foot height

**Artist source.** The same [jumping horse tutorial](https://blockbenchworkshop.com/tutorial/sylvain_35/animating-a-jumping-horse) breaks walking feet into first contact, ground/passing-under-body, last contact and airborne passing, with different airborne phases for running. It warns that mirrored early limb poses can initially look mechanical and discusses slide/ground clipping.

**Engineering concept source.** [Daniel Holden, Inverse Kinematics and Foot Locking](https://www.theorangeduck.com/page/inverse-kinematics-foot-locking), July 2026, explicitly distinguishes the *world-space velocity* of the toe from merely its height during a contact interval, explains contact annotation, an IK target and alternative offline correction. This paper/blog is NOT a simple Minecraft keyframe recipe and its code/rig assumptions are not verified for Bedrock.

**Research interpretation:** Stance means support/relative world contact over a period, and swing means recovery for the next step; artist timing and root/body translation affect visible slipping. A pose where a foot only touches the plane in one frame does not prove grounded motion through that stance interval. No automatic numerical threshold should be inferred.

**APPLY:** Original reference actually shows supported legged locomotion, with a meaningful floor and identifiable contact/release periods.

**REJECT / UNKNOWN:** Treating hovering, swimming, flying, dangling limbs or deliberately sliding movement as defective planted feet; mechanically installing IK and assuming all target rigs expose toe joints; claiming toe-velocity measurements without frame data. No engine or collision code is authorized. 

**Ownership:** Existing Animation locomotion/contact knowledge and AK-03 movement-family distinction.

### AK-09 — Secondary motion is a time relationship, not amplitude applied everywhere

**Primary authored process.** [sylvain_35's jumping horse tutorial](https://blockbenchworkshop.com/tutorial/sylvain_35/animating-a-jumping-horse) describes offsetting mirrored limb phases and manually delaying ear and chained-tail response relative to parent motion. It distinguishes an anchored heavier tail base from a lighter trailing tip and notes that same-phase mirrored motion first looked stiff. These are *self-reported artist decisions*, not independently reconstructed keyframe curves.

**Research interpretation:** A loose horn tassel, cloak hem, tail tip, antenna or ear can make a character feel alive because its motion follows a cause and has a different phase, not because every child rotates farther than its parent. Some symmetric mechanical operations legitimately synchronize paired elements, and some rigid armor should not lag at all.

**APPLY:** Approved original character/material suggests genuinely flexible secondary appendages with supported attachment/pivot hierarchy.

**REJECT / UNKNOWN:** Universal phase offsets, noisy random oscillation of all bones, rotating heavy horns or armor like cloth, or always making the second limb lag. No exact delay, amplitude, bend count or keyframe timing was observed from source files.

**Ownership:** Existing AK-02 weight, AK-04 attachments and Animation secondary-chain guidance, not a new motion library.

### AK-10 — Interpolation and rig format are not interchangeable artistic mechanisms

**First-party references.** [Blockbench Animation Expressions](https://blockbench.net/wiki/guides/animation-expressions/) documents editor expressions, preview variables, dynamic animation time updates and baking limits for glTF/FBX; Minecraft Bedrock supports its applicable MoLang expression subset. [Blockbench format comparison](https://blockbench.net/wiki/blockbench/formats/) distinguishes Bedrock and GeckoLib/Generic model features. [legoego19, Armature Basics Part 1](https://blockbenchworkshop.com/tutorial/legoego19/armatures-1o1-tips-and-tricks) uses Generic-only armatures and weight painting, **not** the native Bedrock Cube-bone representation. [sylvain_35](https://blockbenchworkshop.com/tutorial/sylvain_35/animating-a-jumping-horse) reports smoothing chosen for their own horse/floaty action after blocking poses, not a mandatory interpolation for all motion.

**Research interpretation:** The presence of sine functions, blend weights, smooth interpolation, many bones or face deformation is a technical possibility, not proof that a specific character's acting reads well. A deliberately sharp hit, impact or mechanical stop may require a different temporal curve from a drifting whale. A Generic deformable armature example cannot be copied as a Bedrock animation feature.

**APPLY:** Comparing native technical affordances for *exact target format* separately from a source clip's artistic intent.

**REJECT / UNKNOWN:** Claiming all smooth keys are aesthetically superior; automatically translating Generic armature weight paint to Bedrock; treating offline expression baking as equivalent to dynamic runtime behavior; importing Java ModelEngine combat scripting into visual-asset authoring. Actual clip curves and exported native behavior remain UNOBSERVED.

**Ownership:** Existing Animation standard and compatibility authority. Cross-reference GK-06 for Geometry/bone ownership; no parallel technical contract.

### Dated access boundary and next research evidence

As of this research pass, the [Bepoo animation index](https://bepoo.netlify.app/animations) exposes individual GIF links but attempting to read GIF media through the available web viewer returned unsupported-content responses. A [Raccoon Trader](https://blockbenchworkshop.com/model/logan_kant/raccoon-trader) download request returned HTTP 401 through the public browser; the page's uploader-declared CC0 license was read, **not** the actual file contents. We therefore have no authority to describe observed GIF poses, measured timing, exact attachment bones, imported material or actual model topology. Continue original primary-source learning while keeping motion-level observations honestly UNOBSERVED; no internal generator tests or Golden Assets are involved.

## Working Art-Craft Knowledge v0.3 — Readability over time, gear and loop continuity (2026-11-01; RESEARCH SYNTHESIS)

This is research on artist decisions, NOT direct observation of commercial Blockbench animation frames or native 3D testing. Primary sources include a first-person pixel-art animator's article (2D, not Bedrock) and Mojang/Blockbench authored text (3D). 2D-to-3D art transfer is a hypothesis, never copied keyframes or a numeric preset.

### AK-11 — Per-frame visual detail can compete with readable continuous action

**Direct artist teaching:** [Raymond Schlitter / SLYNYRD — Pixelblog 58](https://www.slynyrd.com/blog/2025/10/2/pixelblog-58-top-down-character-animation-part-3) reports animating a simplified movement template before detailed character art, preserving sword/shield side in multiple viewing directions, and then simplifying clusters/colors where visual flicker made motion difficult to read. This is his own 2D sprite experience; his original animated frames were not independently played here.

**Distinct artistic hypothesis:** A voxel character's head, accessories, armor and painted marks may be readable in a still hero render but visually noisy in fast rotation. Texture/shape fidelity in *each individual frame* does not automatically guarantee an intelligible motion sequence.

**APPLY:** Original motion actually has changing angles, fast movement or moving overlays and source or authored frames are available for direct research observation.

**REJECT/UNKNOWN:** Delete all micro-details, force artificial symmetry, or assert a 3D model flickers based solely on clip metadata. This concept extends Animation readability and cross-references static pixel craft TK-01/TK-12; no automatic denoiser or test introduced.

### AK-12 — Equipped gear can change the body's motion language

**Primary art accounts:** In [SLYNYRD Pixelblog 58](https://www.slynyrd.com/blog/2025/10/2/pixelblog-58-top-down-character-animation-part-3), sword/shield equipment remains in the intended hands and changes arm-swing extent compared with unequipped motion. [Mojang — Creating a Goblin Chef](https://learn.microsoft.com/en-us/minecraft/creator/documents/makerseriesmakingthegoblinchef?view=minecraft-bedrock-stable) describes choosing arm/head/leg rotation range and speed to express personality, then refining easing and overlapping movements. Neither source provides reusable exact Bedrock curves here.

**New question versus AK-04:** Attaching a shield/hammer/fishing rod to the correct bone is *structural correctness*. A stance or gait that visually implies carrying its apparent size/weight is *artistic performance*. An item can alter arm swing, balance, pose intention and recovery without requiring a new physical simulation.

**APPLY:** Approved animation reference clearly shows equipped tools and a specific supported bodily response.

**REJECT/UNKNOWN:** Slow down every held item by the same factor, assume exact physical kilograms or universal inertia based on screenshots, copy 2D frame timings into Bedrock, or introduce item gameplay damage logic. Existing AK-02 weight, AK-04 attachment and GK-06 hierarchy retain their owners.

### AK-13 — A Looping/Once label says little about the perceived transition

**Source evidence:** [sylvain_35 — Creature Animation Workflow](https://blockbenchworkshop.com/tutorial/sylvain_35/animating-a-jumping-horse) describes aligning start and end pose in the artist's own looping horse animation, while offsetting paired limbs and tails. [Bepoo Animation Showcase](https://bepoo.netlify.app/animations) labels clips Looping, Hold or Once, but its GIF content was unavailable to our reader. [Blockbench Overview & Tips](https://blockbench.net/wiki/guides/blockbench-overview-tips/) explains timeline/frame controls; they do not certify a visually smooth loop.

**Distinct hypothesis:** A loop can match start/end pose yet look discontinuous if body travel, motion direction, velocity or secondary tail phase is inconsistent. A one-shot hit/death intentionally ends differently. The type flag and the artistic seam are separate claims.

**APPLY:** Real source playback or poses are observable for a continuously repeating motion.

**REJECT/UNKNOWN:** Force every clip to loop, blindly mirror asymmetric motion, prescribe fixed durations, or claim successful loop blending from metadata alone. No third-party GIF frames were decoded, no native Bedrock playback observed, and no new Runtime curve handling is proposed.

**Research limits:** Source statements and creator clip labels are documented, not copied animation data. Gameplay state logic, physics, native quality and permission to reproduce/training remain outside these notes. No Golden Assets, generator testing or implementation.

## Working Art-Craft Knowledge v0.4 — Source-grounded motion responsibilities within one entity (2026-11-01; RESEARCH SYNTHESIS)

Original Mojang animation JSON was inspected at bedrock-samples SHA 15701fa9c13923f12662984c32c124327e40e3d3. Unlike the previous animated-marketplace clips where only names were accessible, the bone channels and authored key times are **SOURCE INSPECTED**. However no original clip was played in installed Blockbench or Minecraft, so expressive success, interpolation appearance, motion contact and human artistic approval remain UNVERIFIED. These are research examples, not default duration, interpolation or key-count targets.

### AK-14 — One character uses different motion poses for the same activity under different modes

**Direct source:** [Allay geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/allay.geo.json) includes independently animated left/right wing bones plus an empty rightItem attachment bone. [Allay animation source](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/animations/allay.animation.json) contains distinct looping idle and fly clips, alongside hold_item and hold_item_fly. These two held-item actions affect both arm bones and the same rightItem anchor, but have different arm rotations at the authored initial position (approximately -40 degrees vs -67.5 degrees in source). On the 2-second idle wing channel, key times are 0/0.5/1/1.5/2, while the fly wing channel adds quarter-second intervals 0/0.25/…/2. [Allay client resource mapping](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/entity/allay.entity.json) ties the named clips to the one authored entity and named controller links. These exact SOURCE facts were inspected, not reconstructed from a video.

**Distinct artistic question:** Keeping an item attached at the correct point is not sufficient: the same identity and equipment may demand a *different pose relationship* when hovering, resting or actively flying. The number of key times is a source-specific response to those modes, not a quality score. Source names/values show intended differences, but whether the actual transitions feel graceful requires separate playback evidence.

**APPLY:** Current approved character has genuinely different movement/interaction modes with a visual reference that supports a pose change and known rig/attachment ownership.

**REJECT/UNKNOWN:** Cloning one idle/flight arm stance across all states; inventing a universal -40-degree angle, doubling every wing key count for professional quality, assuming an Allay-specific trident variable should exist in other formats, or claiming measured wing smoothness from JSON alone. This is research, not a request for native playback or a new StateMachine/Controller API. Existing AK-12 equipment performance and AK-05 clip vocabulary are extended by *source-verified mode interaction*.

### AK-15 — Signature feature geometry may animate only for its own narrative action

**Direct source:** [Warden geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/warden.geo.json) names separate zero-thickness ribcage plates parented to body and tendril planes parented to head. [Warden animation JSON](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/animations/warden.animation.json) distinguishes:
- shiver: a looping tendril rotation expressed by variables, with a clicking sound key;
- sonic_boom: a 3-second authored action in which left/right ribcage planes are rotated in opposite Y directions (in this revision reaching negative/positive 125 degrees at 1.875s, held to 2.5s, then returning by 2.6667s), while head/body/arms also animate;
- roar: a separate 4.2-second action involving head/arms/tendrils and a roar sound key at 1.25s;
- attack: a shorter 0.33333-second body/head/arm action;
- emerge: a longer source action that includes authored particle and sound keys.
The exact file content, named bones, key times and event presence were inspected; particle/rendered appearance and audio synchrony were NOT actually played or evaluated.

**Independent design-intent source:** [Minecraft — Meet the Warden](https://www.minecraft.net/en-us/article/meet-warden) quotes designer Brandon Pearce describing its evolution from a blind, sound-responsive stalking idea into a stealth/fear entity, rather than a conventional defeat-the-boss combat pattern. This is first-party *gameplay/creative concept*, not a transcript of the animators' actual decisions. The presence of tendrils and differentiated shiver/sonic/roar channels is confirmed separately by the source files.

**Research interpretation:** A feature can be a recognizable static silhouette element yet also become a focused visual action carrier for one particular event. This is more precise than universally animating every accessory or assigning the same idle phase to every appendage. The motion of broad torso/arms and special ribs/tendrils may serve different storytelling roles. It does not demonstrate how the live Warden actually looks, only source-design intent and authored data.

**APPLY:** An approved asset has a distinctive body/weapon/armor part whose particular movement communicates a named action and correct source-supported attachment.

**REJECT/UNKNOWN:** Automatically animate decorative horns, armor straps or every plate with global sine, reuse Warden sonic-rib angles or duration in unrelated bosses, infer exact gameplay triggers or collision from animation assets, or call a sound/particle key proof of successfully synchronized audiovisual playback. No behavior-pack/gameplay code belongs in normal LazyDesigner asset Knowledge.

**Ownership:** Existing Animation motion-intent, secondary chain, action timing and visual effect cues; GK-11 identifies the geometric carrier and TK-15 the separate UV relation. No new animation reader, engine, Golden or validation workflow.

### v0.4 qualitative research evidence boundary

Source-inspected JSON supports specific rig, UV and authoring facts; artist-process articles support human craft descriptions; marketing images and nonplayed GIF labels support neither original keyframes nor definitive performance quality. Keep the evidence levels separate, preserve the upstream revision and rights, and continue first-party creator research. These source examples do not establish a visual quality ranking between Vanilla Allay/Warden and the user's premium voxel reference styles.

## Working Art-Craft Knowledge v0.5 — Source-inspected locomotion architecture (2026-11-01; RESEARCH SYNTHESIS)

The original [Desert Dog bbmodel example](https://github.com/Hoodgail/three-blockbench/blob/9f7bfa2152c5496ee879b53fa65badefb14e9a61/examples/models/desert_dog.bbmodel) was parsed at this exact revision. The source contains 23 distinct named animation records, 16 looping and 7 once clips, with 5,859 keyframe records in total across the set. This is actual data inspection, **not playback**; the file identifies Generic/Free format, not Bedrock. The clip count, large authored keyframe volume and distinct loop types are not artistic quality rankings. Original model ownership and applicable use rights were not verified for reuse beyond observation.

### AK-16 — Sustained movement and transitional actions have different time obligations

**New distinction:** A continuous locomotion mode and the action that *enters or exits it* can occupy separate authoring clips, even on the same skeleton. This is not fully captured by AK-13's question of whether a single loop's boundary is perceptually smooth.

**Actual original source facts:** Desert Dog declares walk_forward (loop, 1.0s), run_forward (loop, 0.6s), jump_start (once, 0.4s), airborne_loop (loop, 0.8s), fall (once, 0.45s), land (once, 0.32s) and recover (once, 0.45s), plus sprint_start and sprint_stop as once. These numbers describe *this project's authoring*, not ideal durations for creatures. The source does not prove the clips have been joined coherently or performed well.

**Artist reasoning:** A cyclic state can maintain a stable repeating cadence, while a transition can show a unique preparation, impact or settle pose. The intended *entry/exit pose and motion direction* is a distinct concept from the repeated motion's internal keyframe distribution; a slow fade alone does not guarantee an expressive transition.

**APPLY:** Current approved source actually includes different continuous movement modes and meaningful starts/stops, landing or recovery as independent actions; original motion/reference supports their distinction.

**REJECT / UNKNOWN:** Mandatory jump_start/fall/land/recover clips for every project, importing the exact timing above into Bedrock, or asserting one publisher's long animation list proves professional motion. Source shows only named records/keys, not visually verified smoothness or runtime state-machine correctness.

**Owner:** Existing Animation standard's clip intent, looping, timing and controller *visual composition* boundaries, cross-referenced to AK-05 (names alone) and AK-13 (within-clip seam). No new state engine or gameplay implementation.

### AK-17 — Direction-sensitive motion can be authored deliberately instead of inferred from one gait

**Direct project facts:** In addition to walk_forward/run_forward, Desert Dog contains walk_backward, run_backward, walk_left/right, run_left/right, four diagonal strafe clips, and turn_left/right. All are authored as separate looping records in one Generic model. The model's 27 groups include front/back leg and paw segments, ears and tail bones, so multiple direction-specific clips can refer to a shared anatomy without creating a different geometry asset.

**Research interpretation:** A moving creature's facing direction, travel direction and turn action may be aesthetically different. Distinct authored directional animation can make sense if a body has weight transfer, gait and head/body orientation that are intentionally asymmetric; other artworks can reuse or mirror a gait successfully. This is not proof that the Desert Dog's directions actually look distinct or good, since original playback was NOT observed.

**APPLY:** User-approved game/visual brief genuinely needs distinct strafing, retreat, sidestepping or turning with supported reference and compatible target rig.

**REJECT / UNKNOWN:** Always synthesize 13 directional gaits, require matching source durations, assume mirrored clips are automatically wrong, use Generic animation controls as Bedrock gameplay state logic, or infer foot contact correctness from animation names/key counts.

**Owner:** Existing AK-03 locomotion family and AK-14 context-specific pose relationships; AK-17 adds the direction-specific authorship decision, not a universal directional clip preset.

### Original-source credibility versus visible motion

An external [Eann Rodriguez — Phoenix Guardian](https://blockbenchworkshop.com/model/eanncrod/phoenix-guardian) lists ten clips including dash, charge, melee and idle/moving, whereas [Visage Of Malice](https://blockbenchworkshop.com/model/eanncrod/visage-of-malice) lists thirteen names including crouch, stalk, pounce and horn rush. Their workshop model downloads returned HTTP 401 to the research reader, so actual keyframe/source data and playback are **UNOBSERVED**. The fact that files are advertised as downloadable, animated or Bedrock-format is not sufficient to claim SOURCE_INSPECTED. [Swuei's creator portfolio](https://swuei.github.io/Portfolio/index.html) likewise mentions animated Fish Tank and Scribing Table but provides no examined original frames here.

Original-source motion readability and temporal art quality remain UNKNOWN across these external sources. Do not promote the Desert Dog or any marketplace listing as a universal animation master or infer train/redistribution rights from public accessibility. Research only, no internal generator test, Golden Assets or engine changes.

