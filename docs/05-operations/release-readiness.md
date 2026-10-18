# LazyDesigner Release Readiness — Preparation Only

State: PREPARATION; no package or installer is produced by these checks. No release tag, download, signature, publication or cleanup is authorized.

## Ownership

The only production owners remain the existing Tauri Desktop configuration, distribution/package.ts, distribution/managed-install.ts and Desktop Draft Release workflow. Do not create a second packager.

Developer files are preserved. This includes mcp/.cache/local-acceptance (which holds historical Windows native acceptance receipts and disposable profiles), Rust target/debug and target/release compilation intermediates, node_modules and all test fixtures. They must not enter an end-user installer. Size of the development checkout is not size of an installer.

## Available during ongoing development

From the repository root, using Node 24:

    node --test distribution/release-readiness.test.mjs
    node distribution/release-readiness.mjs --mode source
    node distribution/release-readiness.mjs --mode source --json

These operations are read-only apart from synthetic test fixtures created under the OS temporary directory. They do NOT run Bun builds, Cargo builds, cleanup, signing, installer creation or publication. A source PASS proves static configuration checks only.

During temporary user-authorized Full CI, GitHub workflow "Release Readiness / Source Only" runs a read-only source preflight on every push to `Local` and remains manually dispatchable (`workflow_dispatch`). It never creates/uploads packages or publishes releases. The manual Run workflow control may still require default-branch registration; automatic Local push verification does not require changing `main`.

## For a separately authorized future build only

When existing staged production files have been created by the canonical build owners:

    node distribution/release-readiness.mjs --mode artifacts --json

It inventories and hashes the managed Tauri resource, compares the source SHA to the exact checkout, refuses unexpected/developer files, measures payload bytes, and measures/hashes the preexisting NSIS installer. Missing artifacts FAIL rather than being built automatically.

The optional argument --max-installer-mib takes an explicitly approved numeric size ceiling in MiB. No arbitrary Desktop installer ceiling is set today. Managed package's canonical limit remains 250,000,000 bytes. This inspection is supplemental; it does not replace Bun verifyPackage or prove the actual internal contents of the NSIS file.

## Future publication requirements (not executed yet)

1. Select a clean, exact-SHA Windows x64 candidate; run existing source, security and regression gates.
2. Explicitly build on an isolated runner using existing pinned Bun, Node, Rust and Tauri owners; never copy development directories.
3. Execute canonical managed integrity checks, staging inventory, a real installed NSIS file inventory and measured installer-size regression review. Verify signing/provenance where required.
4. Prove clean Windows install, first-run setup, Gateway/Runtime, Blockbench integration, rollback/update, source identity and native acceptance. Static PASS is not native PASS.
5. Record compact source SHA, package manifest/checksums, installer bytes/SHA256, signatures, native proof and unresolved failures. Publish only after a separate explicit decision.

No cleanup or retention automation until the owner and evidence-retention contract is approved. Never upload TLS keys, credentials, private test profiles or user models.
