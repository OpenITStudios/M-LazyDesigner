import { describe, expect, test } from "bun:test";

async function read(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("material development and repository authority", () => {
  test("root and context router select one canonical development discipline", async () => {
    const [root, context, system, discipline] = await Promise.all([
      read("../AGENTS.md"),
      read("../docs/04-system/ai-context-loading.md"),
      read("../docs/04-system/README.md"),
      read("../docs/04-system/development-operating-standard.md"),
    ]);
    for (const owner of [root, context, system]) {
      expect(owner).toContain("development-operating-standard.md"); 
    }
    expect(root).toContain("INSPECT | PLAN | DIAGNOSE | DEVELOP | REPAIR | VALIDATE | RELEASE");
    expect(discipline).toContain("NORMALIZE intent");
    expect(discipline).toContain("earliest incorrect canonical owner");
    expect(discipline).toContain("STOP");
    expect(discipline).toContain("no change required?");
    expect(discipline).toContain("producer/consumer");
  });

  test("permissions deny privilege escalation or accidental release and scope changes", async () => {
    const [root, rules, standard] = await Promise.all([
      read("../AGENTS.md"), read("../GITHUB_RULES.md"),
      read("../docs/04-system/development-operating-standard.md"),
    ]);
    expect(root).toContain("permission preflight");
    for (const decision of ["ALLOW", "ASK", "DENY"]) expect(standard).toContain(decision);
    for (const boundary of ["main", "signing secrets", "private files", "force rewrite history"]) expect(standard).toContain(boundary);
    expect(standard).toContain("not a claim of machine-enforced Runtime permissions");
    expect(rules).toContain("Default branch dispatch boundary");
    expect(rules).toContain("Commit-based work continuity");
  });

  test("focused CI and manual Full CI retain separate native authority", async () => {
    const [rules, contribution, next, validation] = await Promise.all([
      read("../GITHUB_RULES.md"), read("../CONTRIBUTING.md"),
      read("../docs/05-operations/next-action.md"), read("../docs/05-operations/current-validation.md"),
    ]);
    expect(rules).toContain("Routine `Local` pushes use");
    expect(rules).toContain("manual milestone gates");
    expect(rules).toContain("workflow_dispatch");
    expect(contribution).toContain("focused path-filtered");
    expect(next).toContain("Full CI — explicit milestone only");
    expect(validation).toContain("Routine `Local` CI is now focused");
    expect(validation).toContain("source-equivalence evidence");
  });
});
