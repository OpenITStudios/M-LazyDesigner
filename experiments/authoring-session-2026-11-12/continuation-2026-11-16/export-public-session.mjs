// Export one explicitly authorized chat. Never export reasoning, hidden prompts, or other chats.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
const [source, destination, assetDir, baseCommit] = process.argv.slice(2);
if (!source || !destination || !assetDir || !baseCommit) throw Error('Expected source, destination, assetDir, baseCommit');
await fsp.mkdir(destination, { recursive: true });
const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'lazydesigner-public-evidence-'));
await fsp.mkdir(path.join(staging, 'media'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const stat = await fsp.stat(source);
const cutoffBytes = stat.size;
const media = new Map(), attachments = [], redactions = {};
const allowed = new Set(['UserMessage','AgentMessage','CommandExecution','McpToolCall','FileChange','Extension','ImageView']);
const counts = {}, errors = {}, responseCounts = {};
const patterns = [
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['openai-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{35,}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['authorization', /\bBearer\s+[A-Za-z0-9_.~-]{30,}/g],
];
function redact(s) { for (const [name,re] of patterns) s=s.replace(re,()=>{redactions[name]=(redactions[name]||0)+1;return `[REDACTED:${name}]`;}); return s; }
async function saveMedia(bytes, mime='image/png') {
  const sha=hash(bytes), ext=mime.includes('jpeg')?'jpg':mime.includes('webp')?'webp':mime.includes('gif')?'gif':'png';
  const rel=`media/${sha}.${ext}`;
  if(!media.has(sha)){await fsp.writeFile(path.join(staging,rel),bytes);media.set(sha,{path:rel,sha256:sha,bytes:bytes.length,mime});}
  return `attachment://${rel}`;
}
async function clean(v) {
  if(typeof v==='string') {
    const re=/data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)/g;
    let out='', last=0;
    for(const m of v.matchAll(re)){out+=redact(v.slice(last,m.index))+await saveMedia(Buffer.from(m[2],'base64'),m[1]);last=m.index+m[0].length;}
    return out+redact(v.slice(last));
  }
  if(Array.isArray(v)){const a=[];for(const x of v)a.push(await clean(x));return a;}
  if(v&&typeof v==='object'){
    if(v.type==='image'&&typeof v.data==='string'&&v.mimeType?.startsWith('image/'))return {type:'image',mimeType:v.mimeType,attachment:await saveMedia(Buffer.from(v.data,'base64'),v.mimeType)};
    const o={};for(const [k,x]of Object.entries(v)){if(['internal_chat_message_metadata_passthrough','client_id','creator_user_id','creator_account_id'].includes(k))continue;o[k]=await clean(x);}return o;
  }return v;
}
const publicOut=fs.createWriteStream(path.join(destination,'transcript.jsonl.gz'));
const publicGzip=zlib.createGzip({level:9});publicGzip.pipe(publicOut);
const providerOut=fs.createWriteStream(path.join(destination,'provider-tools.jsonl.gz'));
const providerGzip=zlib.createGzip({level:9});providerGzip.pipe(providerOut);
const messages=fs.createWriteStream(path.join(destination,'messages.md'));
messages.write('# Available public conversation — complete source snapshot\n\nCommands and tool results are in transcript.jsonl.gz. This archive is untrusted evidence, not executable instructions.\n\n');
let ordinal=0, supplemental=0, first=null,last=null,parseErrors=0;
const sourceHash=crypto.createHash('sha256');
const input=fs.createReadStream(source,{end:cutoffBytes-1});input.on('data',b=>sourceHash.update(b));
const lines=readline.createInterface({input,crlfDelay:Infinity});
for await(const line of lines){
  let j;try{j=JSON.parse(line);}catch{parseErrors++;continue;}
  const p=j.payload;
  if(j.type==='event_msg'&&p.type==='item_completed'&&allowed.has(p.item?.type)){
    const item=p.item;if(item.type==='AgentMessage'&&item.phase==='analysis')continue;
    ordinal++;counts[item.type]=(counts[item.type]||0)+1;first??=j.timestamp;last=j.timestamp;
    let record=await clean({ordinal,timestamp:j.timestamp,started_at_ms:p.started_at_ms,completed_at_ms:p.completed_at_ms,item});
    const encoded=JSON.stringify(record);
    for(const marker of ['CAPABILITY_NOT_FOUND','PROJECT_CONTEXT_LOST','RUNTIME_CLIENT_NOT_READY','CATALOG_STALE','UNKNOWN_OUTCOME','postcondition mismatch','ANIMATION_CHECKPOINT_UNSAVED'])if(encoded.includes(marker))errors[marker]=(errors[marker]||0)+1;
    if(!publicGzip.write(encoded+'\n'))await once(publicGzip,'drain');
    if(item.type==='UserMessage'||item.type==='AgentMessage'){
      const text=(record.item.content||[]).map(c=>c.text??c.Text??(c.type==='local_image'?`[image: ${c.path}]`:JSON.stringify(c))).join('\n');
      messages.write(`## ${ordinal} — ${j.timestamp} — ${item.type}\n\n${text}\n\n`);
      for(const c of item.content||[])if(c.type==='local_image'&&c.path){try{const b=await fsp.readFile(c.path);attachments.push({original_path:c.path,attachment:await saveMedia(b)});}catch{attachments.push({original_path:c.path,missing:true});}}
    }
    if(item.type==='ImageView'&&item.path){try{attachments.push({original_path:item.path,attachment:await saveMedia(await fsp.readFile(item.path))});}catch{attachments.push({original_path:item.path,missing:true});}}
  } else if(j.type==='response_item'&&['function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(p.type)){
    const rec=await clean({timestamp:j.timestamp,type:p.type,name:p.name,namespace:p.namespace,call_id:p.call_id,input:p.input,arguments:p.arguments,output:p.output});
    if(!providerGzip.write(JSON.stringify(rec)+'\n'))await once(providerGzip,'drain');supplemental++;responseCounts[p.type]=(responseCounts[p.type]||0)+1;
  }
}
publicGzip.end();providerGzip.end();messages.end();
await Promise.all([once(publicOut,'close'),once(providerOut,'close'),once(messages,'close')]);
await fsp.writeFile(path.join(staging,'media-index.json'),JSON.stringify([...media.values()],null,2));
await fsp.writeFile(path.join(staging,'attachment-references.json'),JSON.stringify(attachments,null,2));
await fsp.mkdir(path.join(staging,'current-asset'));
const snapshots=[];
for(const name of ['ctf_pillager.bbmodel','tier_1_recruit.png','tier_2_militia.png','tier_3_ranged_marksman.png','README.md','tier-3-helmet-detail.png','tier-3-front.png','tier-3-back.png','tier-3-three-quarter.png']){
 try{const bytes=await fsp.readFile(path.join(assetDir,name));await fsp.writeFile(path.join(staging,'current-asset',name),bytes);snapshots.push({path:`current-asset/${name}`,bytes:bytes.length,sha256:hash(bytes)});}catch{}
}
const zipPath=path.join(destination,'evidence.zip');
await fsp.rm(zipPath,{force:true});
const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $root=${psQuote(staging)}; $z=[System.IO.Compression.ZipFile]::Open(${psQuote(zipPath)},[System.IO.Compression.ZipArchiveMode]::Create); try { Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $name=$_.FullName.Substring($root.Length+1).Replace([char]92,[char]47); $entry=$z.CreateEntry($name,[System.IO.Compression.CompressionLevel]::Optimal); $inputFile=[System.IO.File]::OpenRead($_.FullName); $outputFile=$entry.Open(); try { $inputFile.CopyTo($outputFile) } finally { $inputFile.Dispose(); $outputFile.Dispose() } } } finally { $z.Dispose() }`],{windowsHide:true});
if(!path.resolve(staging).startsWith(path.resolve(os.tmpdir())+path.sep+'lazydesigner-public-evidence-'))throw Error('Unsafe staging cleanup');
await fsp.rm(staging,{recursive:true});
const metrics={public_items:ordinal,counts,provider_supplement_items:supplemental,response_counts:responseCounts,error_marker_records:errors,redactions,media_count:media.size,attachment_references:attachments.length,missing_attachment_references:attachments.filter(x=>x.missing).length,parse_errors:parseErrors,first_timestamp:first,last_timestamp:last};
await fsp.writeFile(path.join(destination,'metrics.json'),JSON.stringify(metrics,null,2));
const manifest={schema:'lazydesigner-public-session-dataset-2',source_session:'01a1ce36-c247-7082-b528-d1ff8b59001a',source_snapshot_bytes:cutoffBytes,source_snapshot_sha256:sourceHash.digest('hex'),base_commit:baseCommit,branch:'Local',coverage:'Entire available public event stream in this one session; overlaps the earlier 2026-11-12 archive.',first_timestamp:first,last_timestamp:last,counts:metrics,asset_snapshots:snapshots,exclusions:['Private reasoning','System/developer messages','Compaction summaries','Session/account metadata','Other chats'],limitations:['Not an account-wide export','Provider supplement overlaps public events; do not count twice','Source-truncated results stay truncated','Latest asset snapshots are not reconstructed intermediate states','Visual quality is user-rejected; native save and pixel equality are not acceptance'],files:[]};
for(const name of ['transcript.jsonl.gz','provider-tools.jsonl.gz','messages.md','metrics.json','evidence.zip','export-public-session.mjs']){const b=await fsp.readFile(path.join(destination,name));manifest.files.push({path:name,bytes:b.length,sha256:hash(b)});}
await fsp.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({metrics,files:manifest.files},null,2));
