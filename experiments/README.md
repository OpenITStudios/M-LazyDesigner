# Experimental

Isolated workspace for bounded research and historical proposals that are **not** part of the active LazyDesigner production boundary.

## Current state

There is no active production authority under `experiments/`.

[Asset motion](asset-motion/README.md) retains recovered simulation inputs/outputs and GIF references for the 2026-10-21 handoff. These historical experiments were not executed or promoted during transfer.

- Historical Navigator design context is retained in Git history only; there is no Navigator working-tree owner.
- Particle Reference Authoring has been fully promoted out of `experiments/` and now lives under `docs/02-reference/particle/` with its ChatGPT-side specialist at `.agents/skills/lazydesigner-particle-reference-authoring/`.
- Historical particle research remains available through Git history rather than a parallel working-tree owner.
- The former active `mcp/gateway/navigator/` production path has been removed.
- Canonical product context/routing projection lives under `mcp/gateway/control/`; repository-development diagnosis/source ownership lives under `mcp/gateway/development/`; shared Stage classification lives in `mcp/lib/capabilities/authoringStage.ts`.

## Retired work

Earlier Experimental work is retired from active authority. Git history owns historical evidence; do not recreate parallel routing, state, authoring, proof, or continuation systems from experimental material.

## Production boundary

Production LazyDesigner implementation remains under `mcp/`, current authoring/reference policy under `.agents/` and `docs/`, and active asset continuity under `workspace/`. Experimental evidence may inform future work, but it does not remain an active owner after promotion.
