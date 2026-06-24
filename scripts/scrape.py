#!/usr/bin/env python3
"""
Re-runnable scraper for RePoE-fork PoE 2 data.

The upstream site (https://repoe-fork.github.io/) regenerates its data every
time the game patches, so this script is built to be run repeatedly to
re-mirror the current state.

What it does:
  * Walks the `tree -H` HTML directory indexes recursively.
  * Downloads only the human-readable `.json` files (skips the `.min.json`
    minified twins -- identical data) plus the small rendered `.html` views.
  * Skips the `Art/` tree entirely: that is PNG/WebP image assets, not data.
    Images are referenced at runtime via ggpk-exposed instead -- see
    docs/image-assets.md.
  * Mirrors into a staging dir first, then atomically swaps it into place so a
    failed/partial run never corrupts the good copy (previous copy kept as
    <name>.bak until the run succeeds).
  * Writes a _manifest.json per source and a SCRAPE_INFO.json run summary.

Idempotent: same upstream state in -> same tree out. Re-run any time.

Usage:
  ./scrape.py                      # mirror everything
  ./scrape.py --only repoe-poe2    # one source
  ./scrape.py --dry-run            # discover + count, download nothing
  ./scrape.py --workers 32         # tune concurrency
  ./scrape.py --include-min        # also keep .min.json twins
  ./scrape.py --no-html            # skip rendered .html views

Stdlib only -- no pip install required (handy for an offline laptop).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import html.parser
import json
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import unquote, urljoin, urlparse

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
SOURCES = [
    {
        # Full RePoE PoE 2 game-data export (base items, mods, skills, stat
        # translations, passive trees, per-item Metadata, ...).
        "name": "repoe-poe2",
        "base": "https://repoe-fork.github.io/poe2/",
        # Art/ is image assets (.png/.webp/.dds), not data -> reference via
        # ggpk-exposed instead of mirroring hundreds of MB.
        "exclude_dirs": ["Art"],
    },
    {
        # Path of Building's hand-maintained PoE 2 Uniques (NOT in game files).
        "name": "pob-uniques",
        "base": "https://repoe-fork.github.io/pob-data/poe2/Uniques/",
        "exclude_dirs": [],
    },
]

# Scraped data lives in-repo under data/source/ (gitignored). This script sits in
# scripts/, so the default target is ../data/source relative to it.
DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "source")
USER_AGENT = "poe2data-scraper/1.0 (+offline wiki data mirror; stdlib urllib)"
TIMEOUT = 30
RETRIES = 4

_print_lock = threading.Lock()


def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def fetch(url: str) -> bytes:
    """GET with retries + exponential backoff."""
    last = None
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            last = e
            if attempt < RETRIES:
                time.sleep(min(2 ** attempt, 10))
    raise RuntimeError(f"failed after {RETRIES} attempts: {url} ({last})")


# --------------------------------------------------------------------------- #
# tree -H index parsing
# --------------------------------------------------------------------------- #
class _LinkParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v:
                    self.hrefs.append(v)


def list_dir(url: str) -> tuple[list[str], list[str]]:
    """Return (subdir_urls, file_urls) for a tree -H index page."""
    parser = _LinkParser()
    parser.feed(fetch(url).decode("utf-8", "replace"))
    subdirs, files = [], []
    for href in parser.hrefs:
        # tree -H emits relative links like "./foo/" (dir) or "./foo.json".
        if not href.startswith("./") or href == "./":
            continue
        child = urljoin(url, href)
        (subdirs if href.endswith("/") else files).append(child)
    return subdirs, files


# --------------------------------------------------------------------------- #
# Selection helpers
# --------------------------------------------------------------------------- #
def relpath_for(base: str, url: str) -> str:
    base_path = urlparse(base).path
    path = urlparse(url).path
    return unquote(path[len(base_path):].lstrip("/"))


def first_segment(rel: str) -> str:
    return rel.split("/", 1)[0] if rel else ""


def want_file(rel: str, include_min: bool, include_html: bool) -> bool:
    low = rel.lower()
    if low.endswith(".min.json"):
        return include_min
    if low.endswith(".json"):
        return True
    if low.endswith(".html"):
        return include_html
    return False


# --------------------------------------------------------------------------- #
# Discovery (parallel BFS over the index tree)
# --------------------------------------------------------------------------- #
def discover(base: str, exclude_dirs: set[str], workers: int) -> list[tuple[str, str]]:
    """Crawl the index tree -> list of (file_url, relpath)."""
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        pending = {ex.submit(list_dir, base)}
        while pending:
            done, pending = cf.wait(pending, return_when=cf.FIRST_COMPLETED)
            for fut in done:
                try:
                    subdirs, files = fut.result()
                except Exception as e:  # noqa: BLE001 - report and continue
                    log(f"  ! crawl error: {e}")
                    continue
                for furl in files:
                    found.append((furl, relpath_for(base, furl)))
                for surl in subdirs:
                    if surl in seen:
                        continue
                    seen.add(surl)
                    rel = relpath_for(base, surl)
                    if first_segment(rel) in exclude_dirs:
                        continue
                    pending.add(ex.submit(list_dir, surl))
    return found


# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #
def download_one(url: str, dest: str) -> int:
    data = fetch(url)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, dest)
    return len(data)


def scrape_source(src: dict, data_dir: str, workers: int, include_min: bool,
                  include_html: bool, dry_run: bool, keep_staging: bool) -> dict:
    name, base = src["name"], src["base"]
    exclude = set(src.get("exclude_dirs", []))
    log(f"\n=== {name}  <-  {base}")
    if exclude:
        log(f"    excluding dirs: {', '.join(sorted(exclude))}")

    t0 = time.time()
    all_files = discover(base, exclude, workers)
    wanted = [(u, r) for u, r in all_files
              if want_file(r, include_min, include_html)]
    skipped = len(all_files) - len(wanted)
    log(f"    discovered {len(all_files)} files; selected {len(wanted)} "
        f"(skipped {skipped} min/other) in {time.time() - t0:.1f}s")

    if dry_run:
        return {"name": name, "base": base, "discovered": len(all_files),
                "selected": len(wanted), "downloaded": 0, "bytes": 0,
                "dry_run": True}

    staging = os.path.join(data_dir, f".staging-{name}")
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)

    total_bytes = 0
    errors: list[str] = []
    done_n = 0
    n = len(wanted)
    t1 = time.time()
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(download_one, u, os.path.join(staging, r)): r
                for u, r in wanted}
        for fut in cf.as_completed(futs):
            rel = futs[fut]
            done_n += 1
            try:
                total_bytes += fut.result()
            except Exception as e:  # noqa: BLE001
                errors.append(f"{rel}: {e}")
                log(f"  ! download error: {rel}: {e}")
            if done_n % 250 == 0 or done_n == n:
                log(f"    {done_n}/{n} ({total_bytes / 1e6:.1f} MB)")

    if errors:
        log(f"    {len(errors)} errors -- NOT swapping staging into place "
            f"(left at {staging})")
        return {"name": name, "base": base, "discovered": len(all_files),
                "selected": n, "downloaded": done_n - len(errors),
                "bytes": total_bytes, "errors": errors}

    # Write per-source manifest into staging before the swap.
    manifest = {
        "source": name,
        "base_url": base,
        "fetched_at": dt.datetime.now().astimezone().isoformat(),
        "file_count": n,
        "total_bytes": total_bytes,
        "excluded_dirs": sorted(exclude),
        "include_min_json": include_min,
        "include_html": include_html,
        "files": sorted(r for _, r in wanted),
    }
    with open(os.path.join(staging, "_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    # Atomic-ish swap: <name> -> <name>.bak, staging -> <name>, drop .bak.
    final = os.path.join(data_dir, name)
    bak = os.path.join(data_dir, f"{name}.bak")
    shutil.rmtree(bak, ignore_errors=True)
    if os.path.exists(final):
        os.replace(final, bak)
    os.replace(staging, final)
    if not keep_staging:
        shutil.rmtree(bak, ignore_errors=True)

    log(f"    OK {n} files, {total_bytes / 1e6:.1f} MB in "
        f"{time.time() - t1:.1f}s -> {final}")
    return {"name": name, "base": base, "discovered": len(all_files),
            "selected": n, "downloaded": n, "bytes": total_bytes, "errors": []}


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description="Mirror RePoE-fork PoE2 JSON data.")
    ap.add_argument("--only", action="append", metavar="NAME",
                    help="limit to source(s): " +
                         ", ".join(s["name"] for s in SOURCES))
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--include-min", action="store_true",
                    help="also keep .min.json twins (default: skip)")
    ap.add_argument("--no-html", action="store_true",
                    help="skip rendered .html views (default: keep)")
    ap.add_argument("--dry-run", action="store_true",
                    help="discover + count only, download nothing")
    ap.add_argument("--keep-staging", action="store_true",
                    help="keep <name>.bak previous copy after swap")
    args = ap.parse_args()

    sources = SOURCES
    if args.only:
        sources = [s for s in SOURCES if s["name"] in set(args.only)]
        if not sources:
            log(f"no matching source in {args.only}")
            return 2

    os.makedirs(args.data_dir, exist_ok=True)
    summaries = []
    for src in sources:
        summaries.append(scrape_source(
            src, args.data_dir, args.workers, args.include_min,
            not args.no_html, args.dry_run, args.keep_staging))

    if not args.dry_run:
        info = {
            "run_at": dt.datetime.now().astimezone().isoformat(),
            "data_dir": os.path.abspath(args.data_dir),
            "sources": summaries,
        }
        with open(os.path.join(args.data_dir, "SCRAPE_INFO.json"), "w") as fh:
            json.dump(info, fh, indent=2)

    log("\n=== summary")
    any_err = False
    for s in summaries:
        errs = len(s.get("errors", []))
        any_err = any_err or bool(errs)
        tag = "DRY" if s.get("dry_run") else f"{s['downloaded']} files, {s['bytes']/1e6:.1f} MB"
        log(f"  {s['name']:<14} {tag}" + (f"  ({errs} ERRORS)" if errs else ""))
    return 1 if any_err else 0


if __name__ == "__main__":
    sys.exit(main())
