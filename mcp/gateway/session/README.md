# Gateway Session State

Owns process-local Gateway session state that must survive individual tool calls but must not become durable authored truth.

```text
state.ts
  capability fact state
  current project binding
  Control execution continuation state
  Runtime-generation/project change coordination

orchestrationRecoveryState.ts
  process-session identity
  project-affinity epoch
  verification evidence registry
  correction-loop recovery state
```

Dependency direction:

```text
execution -> session
session   -> control types + capability facts + lib orchestration registries

session -X-> execution
session -X-> runtime transport implementation
```

Session state is process-local. Durable authored truth remains in Runtime/Blockbench, Workspace, and Reference Package sources.


## Project-affinity isolation

```text
same project UUID
→ keep process-local orchestration state

Project A → Project B / unbound
→ increment project-affinity epoch
→ clear VerificationEvidenceRegistry
→ clear CorrectionLoopRegistry
→ reset Control execution continuation
→ reset capability facts for the new binding
```

Evidence and correction handles are scoped by process identity plus project-affinity epoch. Returning to a previously used project creates a new epoch; handles from the earlier visit do not become valid again.

Runtime-generation reconnect within the same project enters recovery and requires fresh evidence. Each generation invalidation also rotates the **evidence handle namespace**, so an identical capture in a new Runtime cannot resurrect a retired handle. Existing correction loops stay available as recovery-required history, but cannot reuse old visual evidence implicitly. Repeated offline notifications may be skipped only while graph facts, pending execution **and** the evidence registry remain empty/unknown. Project-affinity change hard-resets project-scoped session state instead of transferring it between projects.

## Gateway process restart

Session registries are intentionally process-local. A Gateway process restart does not restore verification evidence, correction loops, continuation groups, or their handles.

Durable/reconstructible truth remains in Runtime/Blockbench, Workspace, Reference Package, and fresh Control/status inspection. Continuation checkpoints are compaction metadata only and do not resurrect process-local registries.
