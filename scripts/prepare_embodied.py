"""Fetch the pinned, hashed NeuroMechFly browser assets without installing packages."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / "public" / "embodied"


def prepare(item):
    relative = Path(item["file"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Invalid asset path")
    target = ROOT / relative
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == item["sha256"]:
        return
    with urllib.request.urlopen(item["url"], timeout=60) as response:
        data = response.read()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise ValueError(f"Asset verification failed: {relative}")
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = target.with_suffix(target.suffix + ".part")
    pending.write_bytes(data)
    pending.replace(target)


if __name__ == "__main__":
    manifest = json.loads((ROOT / "manifest.json").read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(prepare, manifest["files"]))
    print(f'Verified {len(manifest["files"])} embodied assets, '
          f'{sum(item["bytes"] for item in manifest["files"]):,} bytes')
