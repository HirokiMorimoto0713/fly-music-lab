"""公開済みの圧縮MaleCNS配列を版固定・ハッシュ検証して取得する。"""
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REV = '776d115ee5aa934578a87fd6d260d138084f59c1'
BASE = f'https://huggingface.co/spaces/Xenova/fruit-fly-simulation/resolve/{REV}/'

def fetch(path):
    with urllib.request.urlopen(BASE + path, timeout=90) as response:
        return response.read()

def main():
    destination = ROOT / 'public/data'
    destination.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(fetch('public/data/manifest.json'))
    provenance = {'revision': REV, 'upstream': BASE, 'files': {}}
    parts = [part for array in manifest['arrays'] for part in array['parts']]
    parts.append({'file': manifest['metadata']})
    for i, part in enumerate(parts):
        name = part['file']
        target = destination / name
        data = target.read_bytes() if target.exists() else fetch('public/data/' + name)
        digest = hashlib.sha256(data).hexdigest()
        if part.get('sha256') and digest != part['sha256']:
            raise ValueError(f'Checksum mismatch: {name}')
        gzip.decompress(data)
        if not target.exists():
            tmp = target.with_suffix('.part')
            tmp.write_bytes(data)
            tmp.replace(target)
        provenance['files'][name] = {'sha256': digest, 'bytes': len(data)}
        print(f'{i+1}/{len(parts)} verified {name}', flush=True)
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (destination / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print('Data ready', flush=True)

if __name__ == '__main__':
    main()
