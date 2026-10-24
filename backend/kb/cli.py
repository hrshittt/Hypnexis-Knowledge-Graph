"""
Knowledge-base CLI (same pipeline as the API, no server needed).

  python -m backend.kb.cli load-samples              ingest samples/*.txt|pdf
  python -m backend.kb.cli ingest path/a.pdf dir/    ingest files / folders
  python -m backend.kb.cli ask "Who founded Voltaic Systems?"
  python -m backend.kb.cli status
  python -m backend.kb.cli reset --yes               wipe data/kb (uploads, graph, index)
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from backend.kb.documents import ALLOWED_TYPES


def _files(paths):
    out = []
    for p in map(Path, paths):
        if p.is_dir():
            out.extend(sorted(x for x in p.rglob("*") if x.suffix.lower() in ALLOWED_TYPES))
        elif p.exists():
            out.append(p)
        else:
            print(f"! not found: {p}", file=sys.stderr)
    return out


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m backend.kb.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("load-samples")
    ing = sub.add_parser("ingest")
    ing.add_argument("paths", nargs="+")
    ask = sub.add_parser("ask")
    ask.add_argument("question")
    ask.add_argument("--json", action="store_true", help="print the full answer payload")
    sub.add_parser("status")
    rs = sub.add_parser("reset")
    rs.add_argument("--yes", action="store_true")
    args = ap.parse_args(argv)

    from backend.kb.service import get_kb
    kb = get_kb()
    if args.cmd != "reset":
        job = await kb.resync_graph_and_wait()
        if job:
            print(f"graph resync ({kb.store.graph_backend}): {len(job['done'])} re-extracted, {len(job['failed'])} failed")

    if args.cmd in ("load-samples", "ingest"):
        paths = kb.sample_files() if args.cmd == "load-samples" else _files(args.paths)
        if not paths:
            print("No PDF/TXT files to ingest.")
            return 1
        reg = await kb.ingest_files_and_wait([(p.name, p.read_bytes()) for p in paths])
        for r in reg["results"]:
            print(f"  {r['status']:<9} {r['filename']}" + (f"  — {r['error']}" if r.get("error") else ""))
        if reg["job"]:
            job = reg["job"]
            print(f"job {job['status']}: {len(job['done'])} ingested, {len(job['failed'])} failed; topics: {job['topics']}")
            for f in job["failed"]:
                print(f"  failed {f['doc_id']}: {f['error']}")
        print(json.dumps(kb.store.stats()))
        return 0
    if args.cmd == "ask":
        ans = await kb.answer(args.question)
        if args.json:
            print(json.dumps(ans, indent=2, default=str))
        else:
            print(f"[{ans['route']} · {'grounded' if ans['sufficient'] else 'insufficient evidence'} · {ans['mode']}]\n")
            print(ans["answer"])
            cited = [s for s in ans["sources"] if s["cited"]] or ans["sources"][:3]
            if cited:
                print("\nSources:")
                for s in cited:
                    print(f"  [{s['id']}] {s['filename']} p.{s['page']}")
        return 0
    if args.cmd == "status":
        print(json.dumps(kb.status(), indent=2, default=str))
        return 0
    if args.cmd == "reset":
        if not args.yes:
            print("Refusing to wipe the knowledge base without --yes")
            return 1
        print(await kb.reset())
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
