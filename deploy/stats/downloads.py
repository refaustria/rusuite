#!/usr/bin/env python3
"""Write downloads.html from the GitHub release download counters, with a daily history.

GitHub only keeps a running total per release asset, so every run appends today's totals to a JSON-lines
history file (one line per day, the last run of the day wins) and the page shows the daily increase from
it. If the API cannot be reached the page is built from the last saved snapshot. Public API, no token: one
request per hour is far below the 60/hour limit for unauthenticated clients. Standard library only.

Usage: downloads.py [--repo owner/name] [--history PATH] [--out downloads.html] [--releases-json FILE]
                    [--today YYYY-MM-DD] [--generated TEXT]
--releases-json reads a saved API response instead of the network (tests).
See deploy/README.md "Traffic and download stats".
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict

APPS = ("Calc", "Write", "Show", "Notes")
PLATFORMS = (
    (re.compile(r"-setup\.exe$|\.msi$", re.I), "Windows"),
    (re.compile(r"\.dmg$|\.app\.tar\.gz$", re.I), "macOS"),
    (re.compile(r"\.AppImage$|\.deb$|\.rpm$", re.I), "Linux"),
    (re.compile(r"\.apk$|\.aab$", re.I), "Android"),
    (re.compile(r"\.ipa$", re.I), "iOS"),
)
# Updater bundles and signatures are fetched by the apps, not by people.
SKIP_RE = re.compile(r"\.sig$|\.asc$|latest\.json$|\.sha256$", re.I)


def platform(name: str) -> str:
    for rx, p in PLATFORMS:
        if rx.search(name):
            return p
    return "other"


def app(name: str) -> str:
    for a in APPS:
        if a.lower() in name.lower():
            return a
    return "other"


def fetch(repo: str) -> list:
    out, page = [], 1
    while page <= 10:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "rusuite-stats"})
        with urllib.request.urlopen(req, timeout=20) as r:
            batch = json.load(r)
        out += batch
        if len(batch) < 100:
            break
        page += 1
    return out


def snapshot(releases: list) -> dict:
    """{tag: {asset_name: count}} of the downloadable installers."""
    snap = {}
    for rel in releases:
        if rel.get("draft"):
            continue
        assets = {a["name"]: int(a.get("download_count", 0)) for a in rel.get("assets", [])
                  if not SKIP_RE.search(a["name"])}
        if assets:
            snap[rel["tag_name"]] = assets
    return snap


def load_history(path: str) -> list[dict]:
    hist = []
    try:
        with open(path, encoding="utf-8") as fh:
            for ln in fh:
                ln = ln.strip()
                if ln:
                    try:
                        hist.append(json.loads(ln))
                    except ValueError:
                        pass
    except OSError:
        pass
    return hist


def save_history(path: str, hist: list[dict]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for h in hist:
            fh.write(json.dumps(h, sort_keys=True) + "\n")
    os.replace(tmp, path)


def total(snap: dict) -> int:
    return sum(sum(a.values()) for a in snap.values())


def flat(snap: dict) -> Counter:
    c = Counter()
    for tag, assets in snap.items():
        for name, n in assets.items():
            c[(tag, name)] = n
    return c


def table(head, rows):
    h = "".join(f"<th>{html.escape(str(c))}</th>" for c in head)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><thead><tr>{h}</tr></thead><tbody>{body}</tbody></table>"


def render(hist: list[dict], releases_meta: dict, stale: str | None, generated: str) -> str:
    e = html.escape
    snap = hist[-1]["assets"] if hist else {}
    grand = total(snap)
    by_app, by_plat = Counter(), Counter()
    by_app_plat = defaultdict(Counter)
    for tag, assets in snap.items():
        for name, n in assets.items():
            by_app[app(name)] += n
            by_plat[platform(name)] += n
            by_app_plat[app(name)][platform(name)] += n
    plats = [p for _, p in PLATFORMS] + ["other"]
    plats = [p for p in plats if by_plat[p]] or ["Windows", "macOS", "Linux"]

    def since(days):
        if not hist:
            return 0
        cutoff = (dt.date.fromisoformat(hist[-1]["date"]) - dt.timedelta(days=days)).isoformat()
        base = [h for h in hist if h["date"] <= cutoff]
        return grand - total(base[-1]["assets"]) if base else None

    cards = []
    for label, n in (("downloads in total", grand), ("last 24 h", since(1)), ("last 7 days", since(7)),
                     ("last 30 days", since(30))):
        cards.append(f'<div class="card"><div class="n">{"–" if n is None else n}</div><div>{e(label)}</div></div>')

    app_rows = [[e(a)] + [str(by_app_plat[a][p]) for p in plats] + [f"<b>{by_app[a]}</b>"]
                for a in list(APPS) + ["other"] if by_app[a]]
    app_rows.append(["<b>All</b>"] + [f"<b>{by_plat[p]}</b>" for p in plats] + [f"<b>{grand}</b>"])
    app_table = table(["App"] + plats + ["Total"], app_rows)

    rel_rows = []
    for tag, assets in sorted(snap.items(), key=lambda kv: releases_meta.get(kv[0], {}).get("published", ""),
                              reverse=True):
        meta = releases_meta.get(tag, {})
        rel_rows.append([e(tag), e(meta.get("published", "")[:10]), str(sum(assets.values()))])
    rel_table = table(["Release", "Published", "Downloads"], rel_rows)

    # Daily increase per file between consecutive snapshots.
    day_rows = []
    for prev, cur in zip(hist, hist[1:]):
        d = flat(cur["assets"]) - flat(prev["assets"])
        if not d:
            day_rows.append([e(cur["date"]), "0", ""])
            continue
        detail = ", ".join(f"{e(name)} {n}" for (_, name), n in d.most_common())
        day_rows.append([e(cur["date"]), str(sum(d.values())), detail])
    day_rows.reverse()
    day_table = table(["Day", "New downloads", "Files"], day_rows) if day_rows else \
        "<p class=note>The history starts with the first run; daily numbers appear from the second day on.</p>"

    file_rows = []
    for tag, assets in snap.items():
        for name, n in sorted(assets.items(), key=lambda kv: -kv[1]):
            file_rows.append([e(tag), e(name), e(app(name)), e(platform(name)), str(n)])
    file_table = table(["Release", "File", "App", "Platform", "Downloads"], file_rows)

    stale_note = f'<p class="warn">GitHub was not reachable ({e(stale)}); showing the snapshot of {e(hist[-1]["date"] if hist else "-")}.</p>' if stale else ""
    since_txt = e(hist[0]["date"]) if hist else "-"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Rusuite stats - downloads</title>
<style>
body{{font:15px/1.45 system-ui,sans-serif;max-width:64rem;margin:2rem auto;padding:0 1rem;color:#1d232a}}
h2{{margin-top:2rem}} table{{border-collapse:collapse;width:100%;margin:.5rem 0}}
th,td{{text-align:left;padding:.25rem .5rem;border-bottom:1px solid #e3e6ea;vertical-align:top;font-variant-numeric:tabular-nums}}
th{{font-weight:600;background:#f5f7f9}} .cards{{display:flex;gap:1rem;flex-wrap:wrap}}
.card{{border:1px solid #e3e6ea;border-radius:8px;padding:.75rem 1rem;min-width:9rem}} .card .n{{font-size:1.8rem;font-weight:650}}
.note{{color:#5c6670}} .warn{{background:#fff3cd;padding:.5rem .75rem;border-radius:6px;color:#5c4400}}
@media (prefers-color-scheme:dark){{body{{background:#15191d;color:#e4e7ea}} th{{background:#1f252b}} th,td,.card{{border-color:#2c333a}} .note{{color:#9aa4ad}}}}
</style></head><body>
<p><a href="./">&larr; Rusuite stats</a></p>
<h1>Downloads</h1>
<p class="note">Desktop installers on GitHub Releases (GitHub's counters: every completed download, bots and
repeat downloads included; app-update bundles and signatures are left out). History since {since_txt}.
Generated {e(generated)}.</p>
{stale_note}
<div class="cards">{"".join(cards)}</div>
<h2>Per app and platform</h2>{app_table}
<h2>Per day</h2>{day_table}
<h2>Releases</h2>{rel_table}
<h2>Files</h2>{file_table}
</body></html>
"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default="refaustria/rusuite")
    ap.add_argument("--history", default="/var/lib/rusuite-stats/downloads.jsonl")
    ap.add_argument("--out", default="downloads.html")
    ap.add_argument("--releases-json")
    ap.add_argument("--today")
    ap.add_argument("--generated", default="")
    args = ap.parse_args(argv)

    today = args.today or dt.date.today().isoformat()
    hist = load_history(args.history)
    stale, meta = None, {}
    try:
        if args.releases_json:
            with open(args.releases_json, encoding="utf-8") as fh:
                releases = json.load(fh)
        else:
            releases = fetch(args.repo)
        meta = {r["tag_name"]: {"published": r.get("published_at") or ""} for r in releases}
        entry = {"date": today, "assets": snapshot(releases), "published": meta}
        hist = [h for h in hist if h.get("date") != today] + [entry]
        save_history(args.history, hist)
    except Exception as ex:  # network / API trouble: keep going with the saved history
        stale = f"{type(ex).__name__}: {ex}"
        print(f"downloads.py: {stale}", file=sys.stderr)
        if not hist:
            return 1
        meta = hist[-1].get("published", {})
    hist.sort(key=lambda h: h["date"])
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(render(hist, meta, stale, args.generated or today))
    return 0


if __name__ == "__main__":
    sys.exit(main())
