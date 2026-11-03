# Data Lifecycle — LazyDesigner

This is the canonical system-level data safety contract. It is not a second
knowledge registry, authoring state machine, database, or migration service.

## Authorities and lifecycle

| Data class | Owner | Policy |
| --- | --- | --- |
| Executable capability/schema | existing mcp/ implementation + manifest | update canonical source, derive projections |
| Authored system/reference knowledge | docs/ | authored policy controls meaning; Markdown index is derived |
| Execution procedure | .agents/skills/ | supports but never overrides source, docs or native state |
| Test fixtures | mcp/tests/fixtures/ and consuming test | change with the owner; verify affected contracts |
| Current proof/continuation | docs/05-operations/ | operational context, never duplicate architecture |
| User-authored assets | native Blockbench project/files | never rewritten by data inventory or metadata tools |
| Desktop project metadata | project_navigation.rs | strict read, bounded staged replacement |

The canonical knowledge compiler remains `mcp/lib/semantic/knowledge.ts`;
capability semantics and invalidation remain under
`mcp/gateway/capabilities/` and `mcp/gateway/development/`. Do not
introduce competing metadata/state sources to aggregate them.

## Read-only inventory

Run `bun run audit:data` from `mcp/`. The script
`mcp/scripts/development/data-inventory.ts` derives JSON using only Git
tracked paths. It records SHA-256 and bytes for authored docs, Skills, JSON
fixtures and pure compatibility re-export facades at `mcp/lib/*.ts`.
It detects alias targets missing from tracked source and returns a nonzero
exit status for those aliases.

Workspace files are **counted only**; neither their contents nor untracked
user files are read. The CLI does not write a registry, cache, or generated
artifact, does not fetch the internet, and is not a backup mechanism.
Neither a filename collision nor a ranking score establishes canonical
ownership. Continue using existing source owners and scoped context loading.

The same read-only audit also reports explicit Markdown links in `docs/`
whose tracked targets are missing, missing consumer tests for JSON fixtures,
and multi-hop compatibility re-exports. Fixture consumers come directly
from the canonical `gateway/development/affectedExecution.ts` map; no
duplicate fixture registry or inferred documentation graph is added.

By default, `audit:data` fails for missing alias targets and missing fixture
consumers. `audit:data --strict` also fails for authored broken document
links and alias chains. The output never edits source or private assets.
Use existing `plan:affected` and `verify:affected` for changed-source
dependency/verification planning. There is no second test planner.

## Knowledge lifecycle and provenance

The canonical `mcp/lib/semantic/knowledge.ts` now offers source-level SHA-256
evidence and a pure section-level revision comparison. A line-number shift
does not invalidate an unchanged section. An explicitly declared external
upstream revision, URL or compatibility change invalidates that source's
sections even when Markdown content remains identical.

External evidence is caller-supplied and requires HTTPS plus an explicit
upstream revision. Compatibility claims use exact Minecraft Bedrock or
Blockbench versions; unknown/unsupported versions are not inferred. This
does not fetch external websites, assert official approval, or alter user
assets. The default knowledge selection remains unchanged; a version filter
is opt-in and fails closed for sources lacking matching evidence.

`bun run generate:knowledge-index` keeps its existing default input paths
and schema-1 output, adding hashed source evidence. Optional
`--previous <report.json>` accepts a bounded, fingerprint-checked previous
report, reuses sections from source files with identical content hashes,
and emits a deterministic revision delta. Older schema-1 reports without
source evidence remain readable but cannot be reused solely by path.
Previous-index integrity: the original identity/position fingerprint is
retained for schema-1 compatibility. New outputs also include an
`integrity_fingerprint` covering heading, section identity, search terms,
token budgets, sizes, line ranges, content hashes and source evidence.
Legacy reports without this complete checksum can be compared but cannot
be used to reuse stored sections. Invalid/duplicate section metadata fails
closed. This is consistency checking, not an authenticated source signature.
The comparison is read-only and is **not** a background watcher, a second
registry, an automatic remote updater or executable runtime proof.

## Desktop metadata safety

`apps/desktop/src-tauri/src/metadata_io.rs` is restricted to Desktop-owned
small JSON metadata. It writes to an exclusively created temporary file
in the destination directory, flushes the file and renames over the old
destination. It refuses directories and symlink destinations and never
unlinks the old file before committing a replacement.

Preference mutations first require valid schema and known fields. Corrupt,
unsupported, or malformed preferences fail closed without replacing the
original with empty defaults. Unreadable preferences may still display as
an empty read-only projection; they cannot silently become a new saved
configuration. Project identity manifests preserve their existing validation.

These guarantees cover the application metadata writer, **not** Blockbench
native assets, cross-file transactions, multi-process revision locks,
full backup/restore, or absolute power-loss durability. Do not claim native
persistence acceptance from a source-only audit.

## Guarded persistence and user-visible recovery

Desktop preferences and project identity metadata now use the existing
`metadata_io.rs` writer with an explicit previous-byte expectation. A stale
write is rejected rather than replacing a more recent file. Before replacing
existing valid metadata, the writer checkpoints the previous bytes to the
adjacent `.bak` file. For a newly created metadata file, there is no prior
version to checkpoint. These recovery copies are application-owned and are
not a backup of Blockbench models, textures or references.

When Desktop preferences become unreadable, navigation reports
`RECOVERABLE` only when the original file can be preserved and an existing
recovery copy passes schema validation. The Desktop shows an explicit
confirmation before restoring saved project pins. Recovery retains the exact
damaged original in a unique `.corrupt-*.bak` file first, then restores only
the validated prior version. Restoration never rotates the known-good
`.bak` copy, never silently restores a valid current file, and never
touches native Blockbench assets.

This safeguards the normal single-instance Desktop writer and detects stale
reads; there is **no cross-process atomic compare-and-swap**, whole-project
transaction, automatic migration, or proof of power-loss durability.
A missing, corrupt, oversized or symlinked original/backup must fail closed.
A prior `.bak` can be one successful metadata revision behind current state;
recovering it is a deliberate user decision, not lossless recreation of
the most recent preferences.

## Observability cache and retention

The Gateway L0 observer writes only small process-session aggregate snapshots
outside Workspace, in a dedicated application-local analytics cache. It
preserves counts, safe machine error codes, hashed verified native UUIDs,
bounded timestamps and phase observations, not raw prompts, MCP arguments,
project paths, native UUIDs, image bytes, model content, credentials or
Codex session output. Its source owner is
`mcp/gateway/execution/projectObservation.ts`; bounded filesystem storage
is `mcp/gateway/execution/projectObservationStore.ts` and offline reporting
is `mcp/scripts/reporting/summarize-project-observation.ts`.
Static HTML presentation is isolated in
`mcp/scripts/reporting/render-project-observation.ts`.

The cache is best-effort, source-authority **independent** and limited to
16 locally owned session snapshots (128 KiB/file). Old matching snapshots
may be pruned; data older than this rolling window is not promised.
Normal shutdown closes the session; a crash or failed storage write
leaves incomplete/unknown history. The archive is never a backup of native
models, user Workspace, Golden acceptance or complete AI usage. No
extension of this cache may silently mark a Workspace stage approved,
invoke a Runtime read for analytics, or insert monitoring data into the
normal client-visible Gateway result.

## Review / verification

Inventory tests own classification, alias resolution and the no-workspace-read
boundary. Desktop tests own create/replace and unreadable metadata refusal.
Exact-SHA source verification and installed Desktop/Blockbench verification
are separate proof layers; neither is implied by a proposed test.
