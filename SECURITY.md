# Security Policy

## Supported state

LazyDesigner is under active development on the `Local` branch. Security reports for development behavior should be checked against the current `Local` HEAD. No public stable release line is currently maintained; when stable releases are published, support will follow the latest supported release unless stated otherwise.

Compatibility-bound `BlockIT` identifiers remain in some package/plugin/protocol/environment names. They do not imply a separate security boundary.

## Reporting a vulnerability

Do not publish security-sensitive details, credentials, exploit steps, or private user data in a public issue.

Report suspected vulnerabilities privately to the Halo Karya Media maintainers through the established private project channel. If GitHub offers a private vulnerability-reporting option for this repository, that is also appropriate.

Include only the information needed to reproduce and assess the issue:

- affected LazyDesigner commit or version;
- Blockbench and operating-system versions when relevant;
- affected Gateway/Runtime endpoint, tool, import/export path, or setting;
- minimal reproduction steps;
- expected versus observed behavior;
- security impact and whether user interaction is required.

## Trust boundaries

The normal execution chain is:

```text
AI client
→ persistent LazyDesigner Gateway
→ loopback LazyDesigner Runtime
→ Blockbench
→ local project/filesystem
```

The Gateway is the normal AI-client boundary. Direct Runtime access exists for Inspector/conformance/focused debugging and must not be treated as an Internet-facing service.

Runtime and Gateway network connections are intentionally loopback-only. The Runtime currently relies on loopback isolation plus HTTP Host/Origin validation; it does **not** currently provide cryptographic authentication against another process running as the same local user. This is a documented residual risk and must be reconsidered before any network exposure beyond loopback or before treating untrusted same-user processes as part of the threat model.

## Security invariants

- Gateway and Runtime remain loopback-only unless a separately reviewed authentication design is introduced.
- HTTP/1.1 requests fail closed on missing/ambiguous Host routing data, duplicate Host/Origin headers, malformed headers, unsupported Transfer-Encoding, and oversized headers/bodies.
- A present browser Origin must resolve to loopback.
- Runtime mutations remain serialized where Blockbench global state requires it.
- An interrupted mutation with an uncertain result is never automatically replayed.
- Project affinity fails closed instead of silently moving destructive work to another Blockbench tab.
- `risky_eval` and `from_geo_json` remain disabled in the normal surface.
- Secrets, access tokens, credentials, and private user data must not be committed to the repository or emitted in normal structured results/logging.
- Generated documentation is not an authority for security behavior; executable source and regression tests are.

## Filesystem / artifact threat surface

Import, export, Reference Package, workspace, persistence, and generated-artifact paths are security-sensitive. Changes affecting path handling must explicitly consider:

- `..` traversal and path normalization;
- absolute-path policy;
- Windows drive/UNC behavior where applicable;
- symlink/junction escape;
- unintended overwrite or destructive replacement;
- temporary-file races and partial writes;
- untrusted file contents and oversized inputs;
- whether a path originated from the user, AI client, repository, or Blockbench.

Passing a functional export/import test is not by itself proof that these cases are safe.

## Network / protocol threat surface

The local Runtime transport is security-sensitive because it can expose mutation-capable MCP tools. Relevant risks include:

- DNS rebinding/browser-origin abuse;
- malformed or ambiguous HTTP framing;
- request smuggling/parser disagreement;
- oversized payload/resource exhaustion;
- stale Runtime/Gateway identity;
- local-process access to the loopback endpoint;
- protocol-version drift and compatibility fallbacks.

Custom transport code should shrink over time rather than gain unrelated features. Prefer supported MCP SDK/HTTP boundaries when they can replace custom protocol ownership without capability loss or breaking required Blockbench behavior.

## Proof boundary

Repository/static tests can prove source invariants and parser/recovery contracts. They cannot prove:

- the installed Runtime is the current source build;
- live Blockbench mutation safety;
- operating-system-specific path behavior;
- resistance to malicious same-user local processes;
- native import/export behavior across all supported platforms.

Those require matching local/live security verification.

## Dependency advisory policy

The existing \`Dependency Security\` workflow runs both MCP Bun's high-severity audit and a RustSec \`cargo-audit\` scan of \`apps/desktop/src-tauri/Cargo.lock\`. The scanner is pinned to version \`0.22.2\` and installed under Rust \`1.98.1\`. It fetches a current RustSec advisory database on each run; unavailable or stale data is not treated as a successful scan.

Vulnerability advisories of any severity are blocking. The \`unmaintained\`, \`unsound\` and \`yanked\` informational categories are also blocking, but do not themselves establish an exploitable LazyDesigner path. These categories are reviewed separately by affected version, Cargo feature set, operating system and actual source reachability. No blanket ignore list or automatic security waiver is permitted. Any strictly bounded exception requires an identified advisory, affected package/feature/platform, evidence of non-reachability or mitigations, an expiry/review condition, and explicit maintainer authorization.

An advisory-clean Cargo.lock is not evidence of native Blockbench correctness, installed build identity, visual acceptance, or Windows update/rollback. Run the relevant locked Rust tests and Windows CI checks independently.

## Scope

Security-relevant areas include the local MCP transport, Gateway/Runtime trust boundary, network permission and loopback exposure, filesystem import/export behavior, plugin settings, tool/resource/prompt exposure, project affinity, recovery after interrupted mutations, and handling of untrusted input.

Ordinary functional bugs, visual-quality issues, and feature requests should use the normal issue workflow instead.


## Desktop release keys and signing

Desktop distribution has two separate signing boundaries and they must not share keys:

- **Windows Authenticode certificate/private key** identifies the Windows publisher of the executable/installer.
- **Tauri updater private key** signs update artifacts that a future installed Desktop may verify with its embedded public key.

Private signing material must exist only in an approved release secret store or signing service. It must never be committed, written into build provenance, echoed to logs, included in artifacts, or copied into the managed BlockIT package.

A trusted Desktop release must fail closed when either required signature cannot be produced or verified. The release workflow verifies Authenticode after bundling; Tauri produces updater signatures only when its private updater key is supplied through the release environment. Development drafts without these trust proofs must be labeled non-publishable.

Self-update remains disabled until the repository intentionally pins the corresponding Tauri public key and HTTPS update-channel policy. Public-key rotation is a compatibility/security migration: an already-installed application cannot safely accept a replacement key merely because a new release supplies one.
