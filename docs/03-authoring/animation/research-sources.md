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
| ANIM-028 | Upstream code | P0 | [Blockbench / mirror_animating.ts](https://github.com/JannisX11/blockbench/blob/master/js/animations/mirror_animating.ts) | Mirroring transforms and handedness | INDEXED |
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
