"""Verify this evidence package only; does not run product tests or archived commands."""
import collections, gzip, hashlib, json, pathlib, sys, zipfile
from PIL import Image
from io import BytesIO

root = pathlib.Path(sys.argv[1])
sha = lambda b: hashlib.sha256(b).hexdigest()
manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for f in manifest['files']:
    b = (root/f['path']).read_bytes()
    assert len(b) == f['bytes'] and sha(b) == f['sha256'], f['path']
counts = collections.Counter()
messages = []
for name in ('transcript.jsonl.gz','provider-tools.jsonl.gz'):
    with gzip.open(root/name, 'rt', encoding='utf-8') as stream:
        for line in stream:
            r = json.loads(line)
            assert r['timestamp'] <= manifest['source_cutoff_utc']
            if 'item' in r:
                item = r['item']
                assert item['type'] in {'UserMessage','AgentMessage','CommandExecution','McpToolCall','FileChange','Extension','ImageView','Plan'}
                if item['type'] == 'AgentMessage': assert item['phase'] in {'commentary','final_answer'}
                counts[item['type']] += 1
                if item['type'] == 'UserMessage': messages.append(str(item['content']))
            else: assert r['type'] in {'function_call','function_call_output','custom_tool_call','custom_tool_call_output'}
assert 'transcript dan semmua data pengembangan' in messages[-1]
assets = json.loads((root/'asset-manifest.json').read_text(encoding='utf-8'))
with zipfile.ZipFile(root/'asset-snapshot.zip') as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(assets)
    for f in assets:
        b = z.read('ctf-pillager/'+f['path'])
        assert len(b)==f['bytes'] and sha(b)==f['sha256'], f['path']
media = json.loads((root/'media-index.json').read_text(encoding='utf-8'))
invalid = []
for name in sorted({f['archive'] for f in media}):
    with zipfile.ZipFile(root/name) as z:
        assert z.testzip() is None
        for f in (x for x in media if x['archive'] == name):
            b=z.read(f['path'])
            assert len(b)==f['bytes'] and sha(b)==f['sha256']
            try:
                with Image.open(BytesIO(b)) as im: im.verify()
            except Exception as e: invalid.append({'path':f['path'],'error':str(e)})
report = {'scope':'Archive integrity only; not product/CI/native/gameplay validation','manifest_checksums':'PASS','gzip_jsonl_and_public_type_allowlist':'PASS','last_user_request_cutoff':'PASS','asset_zip_crc_and_sha256':'PASS','media_zip_crc_and_sha256':'PASS','public_counts':dict(counts),'asset_files':len(assets),'media_files':len(media),'source_media_decode_failures':invalid}
(root/'archive-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
