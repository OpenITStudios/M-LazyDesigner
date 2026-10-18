---
name: lazydesigner-skill-development
description: Skill-system meta specialist for creating, auditing, refining, evaluating, consolidating, or retiring LazyDesigner Skills and their activation/routing semantics. Do not use for normal product source changes, asset/reference authoring, or to redefine product policy inside a Skill.
---

# LazyDesigner Skill Development

## Activation Contract

```text
LANE: SKILL_SYSTEM
DOMAIN: SKILL_ENGINEERING
CLASS: META
OWNER: SKILL_ACTIVATION_QUALITY
```

Use only when the deliverable is a LazyDesigner Skill or its activation, boundary, handoff, context-loading, evaluation, consolidation, or retirement behavior.

Do not use this Skill merely because a repository task touches `.agents/skills/**` as a consequence of a real product-contract change. Durable product/system docs own semantics; this Skill aligns execution instructions to those owners.

## Objective

Optimize for **correct activation with minimum context**, not maximum instruction coverage.

```text
right lane
→ right owner
→ minimum Skill set
→ correct handoff
→ sufficient proof
→ STOP
```

A Skill is successful when it changes agent behavior where needed and stays cold where it is irrelevant.

## Required Evidence

Before editing a Skill, classify the failure:

```text
ACTIVATION_FALSE_POSITIVE
ACTIVATION_FALSE_NEGATIVE
OWNER_OVERLAP
LANE_LEAK
DELEGATION_LEAK
HANDOFF_AMBIGUITY
DUPLICATED_POLICY
CONTEXT_BLOAT
MISSING_PROCEDURE
STALE_INSTRUCTION
EVAL_GAP
UNKNOWN
```

Use the smallest evidence that can distinguish these. Do not rewrite a whole Skill because one prompt routes poorly.

## Eval-Driven Procedure

1. Name the intended lane, domain, class, and owner.
2. Inspect the taxonomy and only the affected Skill(s).
3. Establish representative evidence:
   - **positive** prompt: should activate;
   - **collision** prompt: superficially matches multiple owners but has one semantic owner;
   - **pressure** prompt: wording/user preference pushes toward the wrong owner but evidence does not justify it;
   - **no-skill** case when no LazyDesigner Skill should activate at all.
4. Identify the first wrong routing/instruction owner.
5. Change the smallest complete surface, preferring:
   - frontmatter description for discovery errors;
   - Activation Contract for lane/owner/boundary errors;
   - hot-path procedure for execution errors;
   - deep reference/docs for durable detail.
6. Recheck affected positive/collision/pressure/no-skill cases.
7. Remove duplicated policy rather than adding another parallel rule.
8. STOP when the intended behavior is covered at the available proof ceiling.

## Progressive Disclosure

```text
frontmatter name + description
→ Activation Contract
→ hot-path procedure
→ deep reference/docs only when the current decision needs them
```

The discovery description must be sufficient to reject obvious false activations without reading the entire Skill.

Do not solve context pressure by fragmenting one coherent owner into many tiny Skills. Add a Skill only when the responsibility is independently reusable and has a distinct activation boundary.

Follow the quality-first progressive disclosure budget in
`docs/04-system/ai-context-loading.md`: ~15K characters is a **review signal**
for each active Geometry/Texturing/Animation Skill, **not a pass/fail size constraint**. Keep always-required invariants in the hot path; use directly
linked conditional references for deeper, decision-specific expertise.
When the budget is exceeded, inspect duplicated policy and evaluate relevant
task outcomes before removing knowledge. Distinguish required-on-trigger from
supporting references, test both must-load and must-not-load cases, and never
claim model compliance or artistic improvement from static file assertions.

## Activation Classes

```text
ROUTER
SPECIALIST
DELEGATED
META
```

Use the canonical meanings in `docs/04-system/skill-taxonomy.md`. Do not invent new classes without a demonstrated routing problem that the existing four cannot express.

## Lane Discipline

Normal lanes:

```text
IN_USE
DEVELOPMENT
SKILL_SYSTEM
```

Reference Preparation and Asset Authoring are IN_USE domains. Product Development is DEVELOPMENT. Skill engineering is SKILL_SYSTEM.

A visual/reference/asset failure does not become DEVELOPMENT because the user suspects MCP/runtime. A runtime/public-contract failure does not become IN_USE because it occurred during authoring. Skill wording/routing failure does not become Product Development merely because Skills are stored in Git.

## Handoff Discipline

For a real system defect discovered during IN_USE work, preserve only:

```text
source_lane
source_owner
target_owner
observed
expected
minimum_reproduction_or_evidence
resume_stage
```

Then stop the IN_USE owner. Development returns control after the defect is fixed; it does not continue the asset automatically.

## Anti-Overdevelopment

Do not create a Skill registry service, graph engine, dynamic loader, database, parallel router, or new framework when `AGENTS.md`, Control, taxonomy, Skill metadata, and tests can express the boundary.

Do not rename canonical Skills solely to encode lane prefixes. Prefer explicit activation metadata unless a real collision remains.

Do not create separate author/evaluator/maintainer Skills until one combined Skill-development owner is proven insufficient.

## Maintaining and Evolving Specialist Modules

A Skill or reference update stays within its original Geometry/Texturing/Animation
owner. Treat this as a small change transaction, **not** an automatic rewrite:

1. Classify the change: a new authoring technique, obsolete instruction,
   revised Blockbench capability, reference rename/removal, or a safety defect.
   Identify the **current canonical policy or Runtime owner** first. Do not
   copy a new API assumption from an external article into the Skill as fact.
2. Change the *smallest* affected surface: a mandatory operational invariant
   in the existing SKILL.md; domain-specific depth in one directly linked
   `references/*.md`; native schema/contract in the exact Runtime owner.
   Split or merge modules only when distinct decisions and retrieval evidence
   justify it, not because character count increased.
3. For any new/renamed/retired reference, update its direct SKILL.md trigger
   and the affected `skill-reference-loading-cases.json` must-load case.
   Keep a no-deep-reference case for routine work. Before removing a file,
   reconcile all references and dependent evaluations. Git history retains
   retired guidance; do not keep parallel old/new authority by default.
4. Validate existing owner/lane, link integrity (including **orphan files**),
   positive/negative/sequential activation cases, and safety invariants.
   For packaged Geometry/Texturing/Animation reference modules, reconcile
   `distribution/managed-install.ts` `PACKAGE_SOURCE_PATHS` before release.
   The `managed-skill-package-references.test.ts` contract checks exact
   on-disk module versus package inventory; runtime installers intentionally
   do **not** discover untrusted/unavailable source directories.
   Compare the previous quality baseline against the changed behavior with
   equivalent knowledge when feasible. No increase in test-count, token
   savings, or file modularity can substitute for an accepted-quality outcome.
5. Changed document bytes invalidate their content identity. A cached
   `known_context_ids` handle is **not** proof the client retains the
   updated text; reload only affected source content. Leave unaffected modules,
   stage state, user-approved work and native files unchanged.
6. Commit the owner and its direct consumers/tests together. Report source
   validation separately from AI behavior, native Blockbench and visual proof.
   Keep external-version compatibility and rollback separately verified; do
   not auto-upgrade the installed plugin or fabricate native acceptance.

This is the maintenance procedure for existing modules, not a registry,
new Router/Control layer, background updater or second source of policy.

## Evaluation Corpus

Use `mcp/tests/fixtures/skill-routing-cases.json` as a compact regression corpus for intended routing semantics. It is development/evaluation evidence, not runtime routing code and not a substitute for behavioral model evaluation.

Use `mcp/tests/fixtures/skill-reference-loading-cases.json` to distinguish
**required-on-trigger** from **no-deep-reference** decisions for Geometry,
Texturing and Animation. The repository test validates fixture structure and
direct reference integrity; a real model/tool trace must separately establish
that the intended content was loaded only when required.

When adding a case, prefer one that closes a real ambiguity over many near-duplicates. `expected_skill: NONE` is valid when the correct behavior is to keep all LazyDesigner Skills cold.

## Completion

Report separately:

```text
routing/Skill change implemented
static contract/eval integrity proved
behavioral model evaluation performed | not performed
higher-context evidence still required | none
```

Static string tests prove repository consistency, not actual model behavior.
