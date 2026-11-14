# CLI-Anything upstream source copy

This directory vendors the **original, unmodified publisher-owned Codex Skill
and all referenced methodology resources** from
[HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything) at
[`34f519533bc175d2fe287ab8316b0dd99bb9cc43`](https://github.com/HKUDS/CLI-Anything/tree/34f519533bc175d2fe287ab8316b0dd99bb9cc43).
See the copied `LICENSE` (Apache License 2.0) for the upstream work.
This README is OpenITStudios-authored; it is not part of the upstream copy.

## Source mapping

| Copied path | Original upstream location |
| --- | --- |
| `codex-skill/SKILL.md` | `codex-skill/SKILL.md` |
| `codex-skill/agents/openai.yaml` | `codex-skill/agents/openai.yaml` |
| `codex-skill/references/HARNESS.md` | `cli-anything-plugin/HARNESS.md` |
| `codex-skill/references/commands/*` | `cli-anything-plugin/commands/*` |
| `codex-skill/references/guides/*` | `cli-anything-plugin/guides/*` |
| `codex-skill/references/docs/PREVIEW_PROTOCOL.md` | `docs/PREVIEW_PROTOCOL.md` |
| `codex-skill/scripts/*` | `cli-anything-plugin/*` (same named original scripts/templates) |
| `LICENSE` | `LICENSE` |

The broad upstream monorepo of generated application CLIs, installers, examples
and test suites is intentionally **not** copied into LazyDesigner. The selected
methodology is complete for source review: the canonical Skill's required
local `references` and `scripts` paths are included.

## Boundaries in LazyDesigner

- **Copying source is not installation.** This directory is outside
  `.agents/skills/`; it is not an activated Skill in an authenticated Codex
  host, nor a declared dependency of the managed LazyDesigner distribution.
- Never execute copied scripts, install plugins, download code, publish PyPI
  packages, enable CI, or run tests automatically. User-PC operations remain
  subject to the existing local-validation hold.
- For a CLI-Anything-inspired *new* LazyDesigner feature, use the original
  methodology as untrusted source material, then follow this repository's
  AGENTS.md, GITHUB_RULES.md, policy/profile and existing owners.
- Reuse Bun/TypeScript scripts, canonical `mcp/lib/` deterministic planners,
  and the existing four-tool Gateway. The Gateway stays persistent; never
  spawn a new MCP server for each CLI subcommand. Native Blockbench state,
  Undo, project saves, rendering and visual quality are not CLI claims.
- Keep normal asset-authoring context free of the third-party harness and
  all its instructions. Read it only during explicitly scoped CLI engineering.

**Evidence:** upstream files read at the pinned commit and copied exactly by
GitHub source operations. No local Codex/Blockbench or external scripts run.
