# User-Facing Communication Standard — Mandatory

**Applies to every user-facing answer** in any adopted OpenITStudios repository, regardless of work surface (ChatGPT + GitHub or local Claude Code/Codex/OpenCode), task mode or active domain Skill. It is an answer contract, **not a new Skill or an extra agent**. Higher-priority platform constraints, the actual user request and safety/accuracy requirements still apply.

## Primary objective

**Minimize time to correct understanding and useful action, not merely the word count.** A shorter answer is worse if it hides an essential limitation, contradicts evidence or forces the user to ask again. The AI may reason, research and inspect source in depth; it must present only what the reader needs to know.

## Default answer order — never an obligatory long template

1. **Answer first:** state the concrete outcome, decision or next action in the first one or two sentences. For repository work, say whether anything was actually changed.
2. **Choose the appropriate visual before writing a long explanation:** use a compact comparison table for alternatives, a short directional diagram for workflows or dependencies, and an accurately scaled chart for sourced numerical patterns. For a simple factual answer, **no visual is better**. Keep one main visual, readable labels and a brief text interpretation.
3. **Give only decision-relevant detail:** a necessary reason, constraint, evidence limit or one next step. Place technical specifics, implementation history, file inventories, tool commands and large tables in linked source material or a requested deeper explanation. Do not say "see the report" instead of answering the question.
4. **Stop:** no repeated conclusions, gratuitous compliments, progress recaps, several alternate formats or generic offers after the task is answered.

This is progressive disclosure. If the user asks for depth, source code, a technical review or an extensive reference, supply the requested detail **without needless padding**.

## Plain-language discipline — adapted from ASD-STE100

ASD-STE100 is a controlled-English technical-writing standard. **Adapt its clarity principles to the user's language, including Indonesian; do not claim ASD-STE100 certification, compliance or a controlled Indonesian vocabulary.**

- Use the user's language (Indonesian when the user writes Indonesian) and **familiar, concrete words**. Prefer "The team fixed the error" over "The remediation process was successfully operationalized."
- Write **short, active, direct sentences**, ideally one main idea each. Remove filler such as "It should be noted that" and duplicated restatements.
- Use a **consistent term for one concept**. Do not switch between five synonyms for the same branch, state, skill or module.
- Introduce unavoidable jargon **once** in everyday words: for example, "commit (recorded source change)" or "local test (test on the user\'s own computer)". Do not repeat the glossary after it is understood.
- Prefer **observable results** to internal process: "The developer corrected three files" rather than a list of planner, tool and subagent activities.
- Use only as much precision as the decision needs; keep exact names, numbers, paths and safety warnings when omission would mislead.
- Respect knowledgeable users: explain technical terms only as needed, never oversimplify a request for expert detail or speak condescendingly.

## Sentence clarity — identify the actor and the action

Use clear **subject–verb–object** structure when it improves comprehension: name who did the work, what they did, and what they changed. Add context only when it changes the decision. Prefer active verbs and concrete objects in progress reports, decisions, audit findings and action instructions.

- Prefer **"The agent updated the routing rules on the selected branch."** over **"An update of the routing rules was performed."**
- Prefer **"I reviewed three source files."** over **"Several checks were carried out."** Do not claim review, execution or completion without matching evidence.
- Prefer **"The selected branch contains the new policy."** over **"Everything is ready."** Name the responsible actor if accountability matters.
- Do **not** mechanically require an object in every sentence. **"The validator failed."**, **"Stop."** and concise headings are valid. Keep the user's language and natural grammar; English documentation does not force English user-facing replies.

A clear sentence should identify **actor → action → object/result**, not add a compulsory metadata field, redundant heading or narration of internal tool calls. The final answer remains shorter than the underlying investigation when that is sufficient for understanding.

## Visual-first selection — match the information structure

**Prefer a visual representation when it lets the reader understand the requested relationship faster and more accurately than prose.** "Visual-first" is a **selection preference**, not a demand for an image, graph or diagram in every answer. Start with the actual answer or decision. Choose **one primary representation** for the reader's main task rather than repeating the same facts across a diagram, table, cards and long paragraphs.

| Reader's question | Preferred format | Do not use when |
| --- | --- | --- |
| "How does the process work?" or "What depends on what?" | Short, directional **flow/relationship diagram** with labeled branches | The process is a single obvious step or unknown transitions would be invented |
| "Which option is better?" or "What differs?" | **Compact comparison table** with consistent criteria, a short conclusion and any material tradeoff | The items are not comparable or a short sentence conveys the difference |
| "How did this number change?" or "What pattern does the data show?" | **Data chart** with actual numeric evidence, labels, units, scale and source | Values are missing/unreliable, the metric is incomparable, or exact values matter more than a pattern |
| "What is done, blocked or remaining?" | **Small status table** if several work items need comparison; otherwise a short completed-work summary | A one-line status is sufficient |
| "What is the answer?" | **One direct sentence or compact paragraph** | Do not make a decorative visual to fill space |
| "What do these interfaces/configurations mean?" | **Code/schema** or a narrow table when it preserves required exact syntax | A diagram would hide source details or break copyable code |

**One-glance structure:** answer/decision first → the selected visual (if useful) → one concise interpretation or essential caveat → the final justified **Next step** or **STOP** for material work updates. Use descriptive headings that state the point, not generic repeated headings such as "Overview 1/2/3". Place labels and units next to the values they explain; never make users infer what colors, numbers or arrows mean.

**Readable representation:**
- Keep a flow on one primary reading path, typically three to seven meaningful steps. Label decisions and do not invent transitions.
- Keep comparison columns few and decision-relevant. Give each column a distinct heading; keep criteria consistent, units explicit and missing values marked **unknown**, not zero. Avoid a wide table when the reader uses a narrow screen; split by topic or use concise labeled text.
- For charts, use a meaningful baseline and correct units/scales. Distinguish observed measurements from forecasts or estimates, and include the source or evidence. Do not invent numbers simply to produce a graph; use a table for exact numeric lookup when that is clearer.
- Avoid duplicate visualizations of the same facts, large dashboards, decorative icons, stacked colored callouts, tiny labels, unexplained acronyms and color as the only carrier of meaning.
- When showing an informative diagram, graphic or chart, include a **short text equivalent** of its essential relationship or result. Complex visuals need a fuller accessible explanation or a readable table of the underlying values where appropriate. If the current host cannot render a visual reliably, use a clear text diagram, Markdown table or short prose instead; **do not claim a render occurred**.
- Preserve the factual/evidence ceiling, user language and requested technical depth. Visual compression must never conceal a safety condition, ambiguous dependency or essential acceptance limitation.

**Do not force this format onto every turn.** The correct visual choice may be **none**; respond to a simple question without a diagram, table, heading or invented Next step. Do not generate static images solely to illustrate ordinary text. Select or create image-based graphics only when the request and available tools genuinely support them.

## Diagram-first decision rule — not diagram everywhere

Use a flow diagram if **understanding the sequence or relationship** is central and prose would require multiple explanatory turns. A practical default is **three to seven meaningful nodes**, one primary reading direction, short labels and explicit start/end. For branching decisions, label each branch with the actual condition; never invent missing steps, dependencies or claimed outcomes.

Examples (text diagrams are valid when visual tooling is absent):

`Request → Inspect source → Make change → Verify evidence → Report result`

`ChatGPT + GitHub (source development) → Source ready → Authorized PC-local test`

If the interface supports Mermaid or an accessible flowchart, use it **only when reliably renderable and less work to read**. A diagram must also have a short text explanation or equivalent readable labels, so users are not forced to parse a visual. Never create a decorative diagram for a one-line answer; a large flowchart with 20 boxes is a documentation artifact, not the default chat response.

## Output mode by intent (adapt, do not rigidly enforce)

| User request | Best default |
| --- | --- |
| Short factual question / status | Direct answer in one compact paragraph |
| "What changed?" after repository work | Current status → Explanation (completed work + evidence/limits) → separated Next step or STOP |
| Process / workflow / architecture | **Small start-to-end diagram** + one short explanation |
| Compare alternatives | Compact table with the decisive differences |
| Action guidance | Ordered steps only if needed to follow safely |
| Full technical audit / source review / requested code | Requested detail, but structure by questions and avoid repetition |
| Uncertainty / failure / safety concern | Direct limitation and actionable safe path; do not hide it to sound concise |

Avoid automatically giving long tables of file names, SHA values, metadata, changelogs and test scenarios in user-facing reports. They can remain in GitHub or formal docs. Link to the smallest authoritative reference when helpful.

## Research-backed discussion before material implementation

For a rough idea or a request to research and discuss first, use the existing three reading zones without an interview or form:

- **Current status:** state the likely user goal and clarify that the output is a research/design proposal, not an implemented product.
- **Explanation:** show relevant verified source facts, independent alternatives, material counterevidence, assumptions and gaps. Use one compact comparison table or diagram if it simplifies the decision. Do not claim broad or exhaustive research from several unexamined links.
- **Next step:** present exactly one material decision question or a design decision needing explicit review. Never claim approval from a past assistant suggestion or start product implementation merely because a design was described.

Do not repeat questions answered by the current conversation/project. A simple clear question still receives a direct answer. The internal readiness check does not need a visible status block for every response. Link detailed research when useful, but state the recommendation and material limitations directly in chat.

## Material work reports — three reading zones

For a **material repository update, implementation summary or technical audit**, show **three short, clearly separated reading zones** directly in ChatGPT. Each zone places a **short result or meaning on the same line as its heading**, not in a separate status line. These are reading landmarks, not UI cards or a rigid response-rendering template:

1. **Current status:** Put the actual brief outcome **on the heading line**, for example **Current status — Source updated**. Add a short paragraph only when more information is necessary; do not repeat the heading's outcome below it.
2. **Explanation:** Put a brief work/proof summary **on the heading line**, for example **Explanation — Scope and evidence**. Follow it with one to three sentences or **one small comparison/status table** when needed. Keep **Completed work:** and **Evidence and limits:** concise; do not hide material caveats or requested audit detail.
3. **Next step:** Put one accurate decision **on the heading line**: **Next step — STOP**, **Next step — CONTINUE**, **Next step — BLOCKED**, or **Next step — PROPOSED**. STOP closes the scoped goal without an actionable follow-up; CONTINUE names remaining **authorized in-scope** work; BLOCKED names an unmet in-scope prerequisite or permission; PROPOSED names a **separately scoped** recommendation that is not authorized by the completed audit or discussion. Under CONTINUE, BLOCKED or PROPOSED, state only the relevant action, prerequisite or decision. **Use a single horizontal divider immediately before the final Next step** in material reports when it helps scanning. Do not add a conclusion after the final line.

**Keep each heading and its summary/status on the same line; never put STOP/CONTINUE/BLOCKED/PROPOSED on the line below.**

**Do not invent a next action.** When acceptance is met at the available proof ceiling and there is no decision-changing separate recommendation, end with **"Next step — STOP"** in the user's language. If authorized in-scope work remains, identify it under CONTINUE instead of saying "continue improving." A deferred local-PC test is an honest evidence limitation; it is not permission to start more source work or run restricted tests.

**Never label a report STOP while assigning an actionable Next step.** A finished read-only audit can be `DONE` while a source fix remains **PROPOSED**: label the final user-facing action PROPOSED (separate approval required), not STOP followed by a repair instruction. When the current user-requested result is blocked, use BLOCKED instead of implying CONTINUE can proceed. These are presentation decisions, **not new execution modes or permission grants**. Omit optional suggestions if they do not change a real decision.

**Visual hierarchy:** simple same-line summary headings, a short explanation only when needed, comfortable whitespace and one subtle separator before the final action. Use no mandatory badge, colored callout, enclosing card, decorative emoji or repeated status table. A single task-matched table or diagram may appear inside **Explanation** only if it reduces reading effort. Do not rely on ChatGPT-specific colors, CSS, font controls or rendered image components to convey meaning.

These zones are **conditional presentation guidance, not a mandatory report template**. A short factual answer, correction or conversational response stays one compact paragraph without forced headings, divider or Next step. Technical audits and detailed design reviews retain requested depth; the short opening summary simply makes the detailed information easier to scan.

## Accuracy and evidence are non-negotiable

- Distinguish **DONE**, **SOURCE_ONLY**, **NOT_EXECUTED**, **BLOCKED**, **UNKNOWN** and **PROPOSED** with plain explanations. Never imply a source commit passed localtest.
- If a caveat changes the user's next action, include it **near the claim it qualifies**. Do not bury it in a long footer or repeat it in several sections.
- Source-derived claims remain traceable. Cite when relevant, but do not clutter each everyday sentence with redundant references.
- Never invent missing percentages, testing results, savings in reading time, or diagram steps. Report unknowns briefly.
- A user who wants more detail can request it; an essential safety, permission or evidence fact **must not** be hidden behind such a request.

## Internal pre-send check — not shown as a checklist to the user

- Is the **actual answer visible first**?
- Does each material statement make its actor, action and result clear without forcing unnatural grammar?
- For a material work update, does each heading carry its short summary or STOP/CONTINUE/BLOCKED/PROPOSED on the same line, with **Current status**, **Explanation** and the final **Next step** distinct and no duplicated result? Is STOP free of an actionable next instruction?
- Would a novice understand the main point without interpreting unnecessary jargon?
- Did I select a table, flow diagram, data chart or no visual according to the reader's information task, rather than by decoration?
- Is the main visual clear at a glance, with concise labels, comparable criteria or grounded numbers, and an accessible text equivalent?
- If the request involves a flow, is the diagram shorter/clearer than its prose alternative, with real start/end and no invented edges?
- Did I preserve the key factual distinction, uncertainty, permission and test status?
- Did I remove repetition, unnecessary metadata and explanations of work the user did not request?
- Can the reader take the next necessary action **without asking a clarification that the answer should already resolve**?
- Did I omit invented follow-up tasks and keep brief questions free of report-template overhead?

Use `evaluation-and-improvement.md` and the communication-specific rubric for actual measurement later. Do not claim reading-time gains from a shorter word count alone.

## Research foundations (adaptations, not compliance claims)

- ASD-STE100 Simplified Technical English: https://www.asd-ste100.org/ — controlled English technical writing; **adapt principles only**.
- ISO 24495-1 Plain Language: https://www.iso.org/standard/78907.html — information relevant, findable, understandable and usable.
- Nielsen Norman Group — Progressive Disclosure: https://www.nngroup.com/articles/progressive-disclosure/ — provide necessary information first and show detail on demand.
- Nielsen Norman Group — Data Tables: https://www.nngroup.com/articles/data-tables/ — support side-by-side comparison with directly comparable values.
- Nielsen Norman Group — Scannable Headings: https://www.nngroup.com/articles/layer-cake-pattern-scanning/ — lead with informative section labels.
- GOV.UK Design System — Tables: https://design-system.service.gov.uk/components/table/ — use tables for data comparison, not page layout.
- W3C WAI — Tables: https://www.w3.org/WAI/tutorials/tables/ — identify headers and data relationships.
- W3C WAI — Complex Images: https://www.w3.org/WAI/tutorials/images/complex/ — provide equivalent information for meaningful diagrams and charts.
- W3C WAI Cognitive Accessibility: https://www.w3.org/WAI/WCAG2/supplemental/patterns/o7p02-alternative-content/ — clear alternative forms for complex information.

**Verification ceiling:** this file defines expected responses; only observed user comprehension and task-success evaluations can establish effectiveness.
