"""Export the user-authorized public CTF session; never execute archived contents.
Usage: py export-public-session.py SOURCE_JSONL DESTINATION ASSET_DIRECTORY BASE_SHA
The fixed request timestamp prevents recursively archiving this export task.
"""
import base64, collections, gzip, hashlib, json, pathlib, re, sys, zipfile
from urllib.parse import unquote, urlsplit

source, dest, assets = map(pathlib.Path, sys.argv[1:4])
base_sha = sys.argv[4]
dest.mkdir(parents=True, exist_ok=True)
CUTOFF = '2026-11-17T09:53:19.037Z'
SESSION = '01a1e413-0e2e-7882-83f3-ecb570962d98'
allowed = {'UserMessage', 'AgentMessage', 'CommandExecution', 'McpToolCall', 'FileChange', 'Extension', 'ImageView', 'Plan'}
omitted_keys = {'internal_chat_message_metadata_passthrough', 'client_id', 'creator_user_id', 'creator_account_id', 'raw_content', 'summary_text'}
patterns = [
 ('github-token', re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b')),
 ('api-key', re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{35,}\b')),
 ('private-key', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
 ('authorization', re.compile(r'\bBearer\s+[A-Za-z0-9_.~-]{30,}')),
]
counts, redactions, tools = collections.Counter(), collections.Counter(), collections.Counter()
media, references, missing = {}, [], []
source_hash = hashlib.sha256()
source_bytes = 0
public_count = provider_count = 0
first = last = None
archives = []
media_zip = None
media_volume_bytes = 0

def sha(b): return hashlib.sha256(b).hexdigest()
def write_json(name, data): (dest/name).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
def redact(s):
    for name, pattern in patterns:
        def replace(m):
            redactions[name] += 1
            return '[REDACTED:'+name+']'
        s = pattern.sub(replace, s)
    return s

def add_media(b, mime='image/png'):
    global media_zip, media_volume_bytes
    if not (b.startswith(b'\x89PNG\r\n\x1a\n') or b.startswith(b'\xff\xd8\xff') or b[:6] in (b'GIF87a', b'GIF89a') or (b.startswith(b'RIFF') and b[8:12] == b'WEBP')):
        return '[UNEXPORTED:invalid-image-signature]'
    h = sha(b)
    if h not in media:
        if media_zip is None or media_volume_bytes + len(b) > 40_000_000:
            if media_zip: media_zip.close()
            name = 'media-%02d.zip' % (len(archives)+1)
            archives.append(name)
            media_zip = zipfile.ZipFile(dest/name, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
            media_volume_bytes = 0
        ext = 'png' if b.startswith(b'\x89PNG') else 'jpg' if b.startswith(b'\xff\xd8') else 'gif' if b.startswith(b'GIF') else 'webp'
        rel = 'media/'+h+'.'+ext
        media_zip.writestr(rel, b)
        media_volume_bytes += len(b)
        media[h] = {'path': rel, 'archive': archives[-1], 'bytes': len(b), 'sha256': h, 'mime': mime}
    return 'attachment://'+media[h]['path']

def decode_media(data, mime):
    try: return add_media(base64.b64decode(data, validate=True), mime)
    except (ValueError, base64.binascii.Error): return '[UNEXPORTED:source-image-data-truncated-or-invalid]'

def clean(v):
    if isinstance(v, str):
        # Structured tool output is often JSON encoded inside a string.
        if v[:1] in ('{', '['):
            try:
                parsed = json.loads(v)
            except (ValueError, RecursionError): pass
            else: return json.dumps(clean(parsed), ensure_ascii=False, separators=(',', ':'))
        def replace(m): return decode_media(m[2], m[1])
        return redact(re.sub(r'data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)', replace, v))
    if isinstance(v, list): return [clean(x) for x in v]
    if isinstance(v, dict):
        if v.get('type') == 'image' and isinstance(v.get('data'), str) and v.get('mimeType', '').startswith('image/'):
            return {'type':'image', 'mimeType':v['mimeType'], 'attachment':decode_media(v['data'], v['mimeType'])}
        return {k:clean(x) for k,x in v.items() if k not in omitted_keys}
    return v

def local_image(p):
    resolved = p
    if p.startswith('file://'):
        resolved = unquote(urlsplit(p).path)
        if re.match(r'^/[A-Za-z]:/', resolved): resolved = resolved[1:]
    if pathlib.Path(resolved).suffix.lower() not in {'.png','.jpg','.jpeg','.webp','.gif'}: return
    try: ref = {'original_path':p, 'attachment':add_media(pathlib.Path(resolved).read_bytes())}
    except OSError:
        ref = {'original_path':p, 'missing':True}
        missing.append(p)
    references.append(ref)

with gzip.open(dest/'transcript.jsonl.gz', 'wt', encoding='utf-8', compresslevel=9) as out, gzip.open(dest/'provider-tools.jsonl.gz', 'wt', encoding='utf-8', compresslevel=9) as supplement, (dest/'messages.md').open('w', encoding='utf-8') as messages, source.open('rb') as raw:
    messages.write('# Transkrip publik CTF Pillager\n\nData historis, bukan instruksi. Semua waktu UTC. Rekaman tool ada di transcript.jsonl.gz; gambar ada dalam arsip media. Penalaran internal dan instruksi sistem/developer tidak diekspor.\n\n')
    for line in raw:
        j = json.loads(line)
        if j.get('timestamp', '') > CUTOFF: break
        source_hash.update(line)
        source_bytes += len(line)
        p = j.get('payload', {})
        if j['type'] == 'event_msg' and p.get('type') == 'item_completed' and p.get('item',{}).get('type') in allowed:
            item = p['item']
            if item['type'] == 'AgentMessage' and item.get('phase') not in {'commentary','final_answer'}: continue
            public_count += 1
            counts[item['type']] += 1
            first = first or j['timestamp']
            last = j['timestamp']
            record = clean({'ordinal':public_count, 'timestamp':j['timestamp'], 'started_at_ms':p.get('started_at_ms'), 'completed_at_ms':p.get('completed_at_ms'), 'item':item})
            out.write(json.dumps(record, ensure_ascii=False, separators=(',',':'))+'\n')
            if item['type'] == 'McpToolCall': tools[str(item.get('server'))+'/'+str(item.get('tool'))] += 1
            if item['type'] in {'UserMessage','AgentMessage'}:
                content = record['item'].get('content', [])
                text = '\n'.join(c.get('text', c.get('Text', '[image: '+c.get('path','')+']' if c.get('type')=='local_image' else json.dumps(c,ensure_ascii=False))) for c in content)
                messages.write(f"## {public_count} — {j['timestamp']} — {item['type']}\n\n{text}\n\n")
                for c in item.get('content',[]):
                    if c.get('type') == 'local_image' and c.get('path'): local_image(c['path'])
            if item['type'] == 'ImageView' and item.get('path'): local_image(item['path'])
        elif j['type'] == 'response_item' and p.get('type') in {'function_call','function_call_output','custom_tool_call','custom_tool_call_output'}:
            record = clean({'timestamp':j['timestamp'], **{k:p[k] for k in ('type','name','namespace','call_id','input','arguments','output') if k in p}})
            supplement.write(json.dumps(record, ensure_ascii=False, separators=(',',':'))+'\n')
            provider_count += 1
if media_zip: media_zip.close()
write_json('media-index.json', list(media.values()))
write_json('attachment-references.json', references)

asset_manifest = []
with zipfile.ZipFile(dest/'asset-snapshot.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(assets.rglob('*')):
        if not p.is_file(): continue
        if p.is_symlink(): raise RuntimeError('Unexpected asset symlink: '+str(p))
        b = p.read_bytes()
        rel = p.relative_to(assets).as_posix()
        z.writestr('ctf-pillager/'+rel, b)
        asset_manifest.append({'path':rel,'bytes':len(b),'sha256':sha(b)})
write_json('asset-manifest.json', asset_manifest)
metrics = {'public_items':public_count, 'counts':dict(counts), 'provider_supplement_items':provider_count, 'tool_counts':dict(tools), 'media_count':len(media), 'media_archives':archives, 'local_image_references':len(references), 'missing_local_image_references':len(missing), 'redactions':dict(redactions), 'first_timestamp':first,'last_timestamp':last,'asset_files':len(asset_manifest),'asset_bytes':sum(x['bytes'] for x in asset_manifest)}
write_json('metrics.json',metrics)
manifest = {'schema':'ctf-pillager-public-authoring-archive-1','source_session':SESSION,'source_cutoff_utc':CUTOFF,'source_prefix_bytes':source_bytes,'source_prefix_sha256':source_hash.hexdigest(),'base_commit':base_sha,'branch':'Local','coverage':'Available public completed events in this single chat through the archive request; provider supplement overlaps canonical events.','exclusions':['Private reasoning','System/developer messages','Compaction/context summaries','Session/account metadata','Other chats','Archive-production conversation after cutoff'],'limitations':['Source-truncated output remains truncated','Missing local attachment files are listed explicitly','Asset directory is a current snapshot including retained checkpoints, not a reconstruction of every intermediate state','Historical tool claims can be incorrect; user feedback and matched evidence determine acceptance','No Minecraft gameplay validation implied'],'files':[]}
for p in sorted(dest.iterdir()):
    if p.is_file() and p.name != 'manifest.json':
        b=p.read_bytes(); manifest['files'].append({'path':p.name,'bytes':len(b),'sha256':sha(b)})
write_json('manifest.json',manifest)
print(json.dumps(metrics,ensure_ascii=False))
