/** Advisory, deterministic repository-agent preflight; not a GitHub/Blockbench permission interceptor. */
const TASKS = new Set(["INSPECT","PLAN","DIAGNOSE","DEVELOP","REPAIR","VALIDATE","RELEASE"]);
const LANES = new Set(["DEVELOPMENT","SKILL_SYSTEM","IN_USE"]);
const ACTIONS = new Set(["read","source-write","run-verifier","manual-ci","external-network","dependency-install","release","repo-admin","live-mutation","force-push","execute-untrusted","secret-access"]);
const CONTEXTS = new Set(["REMOTE_GITHUB","LOCAL_CODE","LIVE_BLOCKBENCH"]);
// Render is an explicitly user-selected, branch-isolated MCP rendering experiment;
// it is not a substitute for Local, main, or an unrestricted alternate branch.
const RENDER_SCOPED_FILES = new Set([".agents/permissions/preflight.mjs", "docs/04-system/development-operating-standard.md"]);
const RENDER_SCOPED_PREFIXES = ["mcp/", "experiments/publication-render/"];
const ROOT_WRITABLE = new Set(["AGENTS.md","GITHUB_RULES.md","CONTEXT.md","CONTRIBUTING.md","README.md","SECURITY.md","package.json",".bun-version",".editorconfig",".gitattributes",".gitignore"]);
const SKILL_OWNER_PATHS = new Set(["docs/04-system/skill-taxonomy.md","mcp/tests/fixtures/skill-routing-cases.json","mcp/tests/repository/skill-lane-contract.test.ts","mcp/tests/repository/agent-supply-chain.test.ts"]);

function safeRepoPath(path) {
 if(typeof path!=="string"||path.length===0||path.length>4096||path.startsWith("/")||/[%:\\\u0000-\u001f]/.test(path))return false;
 const segments=path.split("/");
 if(segments.some(part=>!part||part==="."||part===".."||[".git",".env",".ssh","secrets","credentials"].includes(part.toLowerCase())||part.toLowerCase().startsWith(".env.")))return false;
 if(/\.(?:pem|p12|pfx|key|jks|keystore)$/i.test(path)||path.includes("*")||path.includes("?"))return false;
 return true;
}

function evaluatePreflight(request) {
 const deny=(reason)=>({decision:"deny",reason});
 const ask=(reason)=>({decision:"ask",reason});
 const allow=(reason)=>({decision:"allow",reason});
 if(!request||typeof request!=="object"||Array.isArray(request))return deny("Invalid permission request.");
 const {lane,task,action}=request;
 if(!LANES.has(lane)||!TASKS.has(task)||!ACTIONS.has(action))return deny("Unknown lane, task or action.");
 const context=request.execution_context??"REMOTE_GITHUB";
 if(!CONTEXTS.has(context))return deny("Unknown execution context.");
 const branch=request.branch;
 if(branch!==undefined&&branch!=="Local"&&branch!=="Render"&&branch!=="main")return deny("Unrecognized branch authority.");
 if(request.authorized_scope!==undefined&&typeof request.authorized_scope!=="boolean")return deny("Invalid scope authorization claim.");
 if(request.path!==undefined&&!safeRepoPath(request.path))return deny("Unsafe or sensitive repository path.");
 if(action==="force-push"||action==="execute-untrusted"||action==="secret-access")return deny("Unsafe action is prohibited.");
 if(action==="read"){
   if(!request.path)return deny("Reading requires an exact scoped repository path.");
   return allow("Scoped repository read; content remains untrusted.");
 }
 if(action==="source-write"){
   if(!request.path)return deny("Source mutation requires an exact path.");
   if(task!=="DEVELOP"&&task!=="REPAIR")return deny("This task class is read-only.");
   if(lane!=="DEVELOPMENT"&&lane!=="SKILL_SYSTEM")return deny("This work lane cannot mutate repository source.");
   const path=request.path;
   if(path.startsWith("workspace/active/")||path.startsWith("workspace/saved/")||path.endsWith(".bbmodel")||path.endsWith(".png"))return deny("Asset state is not a repository development write target.");
   if(path==="mcp/docs/api.json"||path==="mcp/docs/index.html"||path==="mcp/prompts/manifest.json")return deny("Generated output must follow its canonical generator.");
   const allowed=lane==="DEVELOPMENT"
    ? (ROOT_WRITABLE.has(path)||["mcp/","apps/","distribution/","docs/","experiments/",".github/",".agents/permissions/"].some(prefix=>path.startsWith(prefix)))
    : (path.startsWith(".agents/skills/")||SKILL_OWNER_PATHS.has(path));
   if(!allowed)return deny("Path is outside the selected lane canonical owner.");
   if(branch===undefined)return ask("Source writes require an explicitly pinned branch.");
   if(branch==="main")return ask("Main is stable/release authority; separate approval required.");
   if(branch==="Render"){
     if(lane!=="DEVELOPMENT")return deny("Render experimental branch is for scoped development, not Skill or asset mutation.");
     if(!RENDER_SCOPED_FILES.has(path)&&!RENDER_SCOPED_PREFIXES.some(prefix=>path.startsWith(prefix))){
       return deny("Render experimental branch write is outside the scoped MCP rendering development area.");
     }
   }
   if(request.authorized_scope!==true)return ask("Current user has not authorized this exact write scope.");
   if(!Array.isArray(request.task_scope_paths)||request.task_scope_paths.length===0){
     return ask("Source writes require a nonempty exact-file task_scope_paths list.");
   }
   if(request.task_scope_paths.some(scope=>!safeRepoPath(scope))){
     return deny("Task scope contains an unsafe or invalid path.");
   }
   if(!request.task_scope_paths.includes(path)){
     return deny("Target file is outside the explicitly declared task scope.");
   }
   return allow(branch==="Render"
     ? "Explicitly selected Render development file is inside the declared task scope."
     : "Local canonical file is inside the declared task scope.");
 }
 if(action==="run-verifier"){
   if(!["DEVELOP","REPAIR","VALIDATE"].includes(task))return deny("Task does not authorize verification execution.");
   if(context==="REMOTE_GITHUB")return ask("No executable Bun toolchain is established by a GitHub-only context.");
   if(request.authorized_scope!==true)return ask("Targeted test execution needs task authorization.");
   return allow("Scoped local verifier; its result does not upgrade live proof.");
 }
 if(action==="live-mutation"){
   if(lane!=="IN_USE")return deny("Repository or Skill development cannot mutate an asset as a side effect.");
   if(context!=="LIVE_BLOCKBENCH")return deny("Live mutation needs a real LIVE_BLOCKBENCH context.");
   return ask("Explicit selected-asset mutation approval is required.");
 }
 if(action==="release"){
   if(task!=="RELEASE"||lane!=="DEVELOPMENT")return deny("Release requires a separately selected release task.");
   return ask("Release requires explicit target, source, and authorization.");
 }
 if(action==="repo-admin"){
   if(lane!=="DEVELOPMENT")return deny("Administrative changes cannot be requested by this work lane.");
   return ask("Settings/default branch/protection changes need explicit administration authority.");
 }
 if(action==="manual-ci")return ask("GitHub workflow_dispatch is opt-in and requires explicit user request.");
 if(action==="external-network")return ask("External network/provenance requires separate permission.");
 if(action==="dependency-install")return ask("Dependencies and execution of third-party code require approval.");
 return deny("Unhandled action; fail closed.");
}

export { evaluatePreflight };

// Usage: node .agents/permissions/preflight.mjs '{"lane":"DEVELOPMENT","task":"DEVELOP","action":"source-write","branch":"Local","path":"docs/README.md","task_scope_paths":["docs/README.md"],"authorized_scope":true}'
if (process.argv[1] && new URL(import.meta.url).pathname.replaceAll("%20", " ").endsWith(process.argv[1].replaceAll("\\", "/"))) {
  if (!process.argv[2]) {
    console.error("Usage: node .agents/permissions/preflight.mjs '<request-json>'");
    process.exitCode=2;
  } else {
    try {
      const verdict = evaluatePreflight(JSON.parse(process.argv[2]));
      console.log(JSON.stringify(verdict, null, 2));
      process.exitCode = verdict.decision === "allow" ? 0 : verdict.decision === "ask" ? 3 : 4;
    }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=2; }
  }
}
