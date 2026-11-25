#!/usr/bin/env python3
"""Write usage.html: people per day on rusuit.es, which apps they open, countries, devices, referrers.

Input: the rusuit.es nginx access log(s) in the default "combined" format. Python 3 standard library plus
(optional) python3-maxminddb for countries; without it every country is "??". Everything from the log
(paths, referrers, user agents) is attacker-controlled, so every such string goes through html.escape().

Who counts as a person: an IP whose user agent is a browser (Mozilla/... with an engine, no bot marker) and
that ran our JavaScript at least once in the log window (requested /version.json or a /<app>/assets/*.js),
which crawlers and scanners almost never do. Opening an app = a 200/304 for /<app>/ or /<app>/index.html
(index.html is no-cache, so a returning browser still shows up; the hashed assets are cached for a year and
would not). People are IPs: shared or changing addresses skew the numbers.

Usage: usage.py --log FILE [--log FILE ...] [--out usage.html] [--mmdb PATH] [--exclude-file PATH]
                [--exclude-ip IP ...] [--now ISO] [--generated TEXT]
See deploy/README.md "Traffic and download stats".
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import html
import re
import sys
from collections import Counter, defaultdict

APPS = ("calc", "write", "show", "notes")
PAGES = {"/": "portal", "/index.html": "portal", "/downloads.html": "downloads", "/privacy.html": "privacy"}
OWN_HOSTS = ("rusuit.es", "www.rusuit.es", "resuite.inceptum.at")
OK = {"200", "206", "304"}
MAX_IP_ROWS = 300

LINE_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] "(?P<method>[A-Z]+) (?P<path>\S+)[^"]*" '
    r'(?P<status>\d{3}) (?P<bytes>\d+|-) "(?P<ref>(?:[^"\\]|\\.)*)" "(?P<ua>(?:[^"\\]|\\.)*)"')
BOT_RE = re.compile(
    r'bot\b|bot/|bots\b|crawl|spider|slurp|fetch|scrapy|scanner|monitor|preview|censys|netcraft|expanse|'
    r'internet-measurement|paloalto|headlesschrome|phantomjs|lighthouse|python|curl|wget|go-http|okhttp|'
    r'java/|libwww|axios|node-fetch|undici|zgrab|masscan|nuclei|nmap|nikto|facebookexternalhit|whatsapp|'
    r'telegram|discord|slack|twitter|linkedin|pinterest|yandex|baidu|bytespider|amazonbot|gptbot|claude|'
    r'perplexity|ccbot|semrush|ahrefs|mj12|dotbot|petal|dataforseo|archive', re.I)
BROWSER_RE = re.compile(r'^Mozilla/\d.*(chrome|safari|firefox|gecko|applewebkit|edg/|opr/)', re.I)
JS_RE = re.compile(r'^/(?:version\.json|(?:calc|write|show|notes)/assets/[^/]+\.js)$')
APP_RE = re.compile(r'^/(calc|write|show|notes)/(?:index\.html)?$')
REF_RE = re.compile(r'^https?://([^/?#:]+)', re.I)
REF_ALIASES = (
    (re.compile(r'(^|\.)google\.'), "Google"), (re.compile(r'(^|\.)bing\.com$'), "Bing"),
    (re.compile(r'(^|\.)duckduckgo\.com$'), "DuckDuckGo"), (re.compile(r'(^|\.)ecosia\.org$'), "Ecosia"),
    (re.compile(r'(^|\.)reddit\.com$'), "Reddit"), (re.compile(r'(^|\.)(t\.co|x\.com|twitter\.com)$'), "X"),
    (re.compile(r'(^|\.)github\.com$'), "GitHub"), (re.compile(r'(^|\.)ycombinator\.com$'), "Hacker News"),
    (re.compile(r'(^|\.)(facebook\.com|fb\.com)$'), "Facebook"), (re.compile(r'(^|\.)linkedin\.com$'), "LinkedIn"),
    (re.compile(r'(^|\.)(chatgpt\.com|openai\.com)$'), "ChatGPT"), (re.compile(r'(^|\.)claude\.ai$'), "Claude"),
    (re.compile(r'(^|\.)perplexity\.ai$'), "Perplexity"), (re.compile(r'(^|\.)daisychess\.org$'), "DaisyChess"),
)
MONTHS = {m: i for i, m in enumerate(
    ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}


def parse_time(s: str) -> dt.datetime | None:
    # 25/Nov/2026:02:22:26 +0100
    try:
        d, mon, rest = s.split("/", 2)
        y, hh, mm, ss_tz = rest.split(":", 3)
        ss, tz = ss_tz.split(" ")
        off = (1 if tz[0] == "+" else -1) * (int(tz[1:3]) * 60 + int(tz[3:5]))
        return dt.datetime(int(y), MONTHS[mon], int(d), int(hh), int(mm), int(ss),
                           tzinfo=dt.timezone(dt.timedelta(minutes=off)))
    except (ValueError, KeyError, IndexError):
        return None


def device(ua: str) -> str:
    u = ua.lower()
    if "iphone" in u or "ipad" in u or "ios" in u:
        return "iOS"
    if "android" in u:
        return "Android"
    if "windows" in u:
        return "Windows"
    if "mac os x" in u or "macintosh" in u:
        return "macOS"
    if "cros" in u:
        return "ChromeOS"
    if "linux" in u or "x11" in u:
        return "Linux"
    return "other"


def ref_source(ref: str) -> str | None:
    """Referrer grouped to a source name; None for our own pages or no referrer."""
    m = REF_RE.match(ref or "")
    if not m:
        return None
    host = m.group(1).lower()
    if host in OWN_HOSTS:
        return None
    for rx, name in REF_ALIASES:
        if rx.search(host):
            return name
    return host[4:] if host.startswith("www.") else host


def open_lines(paths):
    for p in paths:
        opener = gzip.open if p.endswith(".gz") else open
        try:
            with opener(p, "rt", encoding="utf-8", errors="replace") as fh:
                yield from fh
        except OSError as e:
            print(f"usage.py: cannot read {p}: {e}", file=sys.stderr)


class Country:
    def __init__(self, mmdb: str | None):
        self.reader = None
        self.cache: dict[str, str] = {}
        if mmdb:
            try:
                import maxminddb  # type: ignore
                self.reader = maxminddb.open_database(mmdb)
            except Exception:  # missing module or file: countries stay "??"
                self.reader = None

    def __call__(self, ip: str) -> str:
        if ip not in self.cache:
            code = "??"
            if self.reader:
                try:
                    rec = self.reader.get(ip) or {}
                    code = (rec.get("country") or {}).get("iso_code") or "??"
                except Exception:
                    pass
            self.cache[ip] = code
        return self.cache[ip]


def analyse(lines, excluded: set[str], now: dt.datetime):
    reqs = []          # (ip, time, path, status, ref, ua) of browser-like requests
    js_ips: set[str] = set()
    all_ips: set[str] = set()
    total = 0
    for line in lines:
        m = LINE_RE.match(line)
        if not m:
            continue
        total += 1
        ip = m["ip"]
        all_ips.add(ip)
        if ip in excluded:
            continue
        ua = m["ua"]
        if not BROWSER_RE.search(ua) or BOT_RE.search(ua):
            continue
        if m["method"] not in ("GET", "HEAD") or m["status"] not in OK:
            continue
        t = parse_time(m["time"])
        if t is None:
            continue
        path = m["path"].split("?", 1)[0]
        if JS_RE.match(path):
            js_ips.add(ip)
        reqs.append((ip, t, path, m["ref"], ua))

    people = js_ips
    day_ips: dict[dt.date, set[str]] = defaultdict(set)
    day_app: dict[dt.date, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    ip_info: dict[str, dict] = {}
    first_ref_seen: set[tuple[str, dt.date]] = set()
    refs: dict[str, Counter] = {"24h": Counter(), "7d": Counter(), "14d": Counter()}
    for ip, t, path, ref, ua in sorted(reqs, key=lambda r: r[1]):
        if ip not in people:
            continue
        day = t.astimezone(now.tzinfo).date()
        day_ips[day].add(ip)
        info = ip_info.setdefault(ip, {"first": t, "last": t, "days": set(), "apps": Counter(), "ua": Counter()})
        info["last"] = t
        info["days"].add(day)
        info["ua"][device(ua)] += 1
        am = APP_RE.match(path)
        page = am.group(1) if am else PAGES.get(path)
        if page:
            day_app[day][page].add(ip)
            info["apps"][page] += 1
        if (ip, day) not in first_ref_seen:
            first_ref_seen.add((ip, day))
            src = ref_source(ref) or "Direct / unknown"
            age = now - t
            for key, limit in (("24h", 1), ("7d", 7), ("14d", 14)):
                if age <= dt.timedelta(days=limit):
                    refs[key][src] += 1
    return {
        "total_requests": total, "all_ips": len(all_ips), "people": people, "day_ips": day_ips,
        "day_app": day_app, "ip_info": ip_info, "refs": refs,
    }


def window_ips(ip_info, now, days):
    return {ip for ip, i in ip_info.items() if now - i["last"] <= dt.timedelta(days=days)}


def table(head, rows, cls=""):
    h = "".join(f"<th>{html.escape(str(c))}</th>" for c in head)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<table class="{cls}"><thead><tr>{h}</tr></thead><tbody>{body}</tbody></table>'


def bar(n, top):
    w = 0 if not top else round(100 * n / top)
    return f'<span class="bar" style="width:{w}%"></span>{n}'


def render(a, country: Country, now: dt.datetime, generated: str) -> str:
    ip_info = a["ip_info"]
    w1, w7, w14 = (window_ips(ip_info, now, d) for d in (1, 7, 14))
    returning = sum(1 for i in ip_info.values() if len(i["days"]) >= 2)
    e = html.escape

    cards = "".join(
        f'<div class="card"><div class="n">{n}</div><div>{e(label)}</div></div>'
        for n, label in ((len(w1), "people, last 24 h"), (len(w7), "people, last 7 days"),
                         (len(w14), "people, last 14 days"), (returning, "came back on 2+ days")))

    days = sorted(a["day_ips"], reverse=True)
    seen_before: set[str] = set()
    new_per_day = {}
    for d in sorted(a["day_ips"]):
        ips = a["day_ips"][d]
        new_per_day[d] = len(ips - seen_before)
        seen_before |= ips
    cols = ("portal",) + APPS + ("downloads",)
    top = max([len(v) for v in a["day_ips"].values()] or [0])
    day_rows = []
    for d in days:
        apps = a["day_app"][d]
        day_rows.append([d.isoformat() + " " + d.strftime("%a"), bar(len(a["day_ips"][d]), top),
                         str(new_per_day[d]), str(len(a["day_ips"][d]) - new_per_day[d])]
                        + [str(len(apps.get(c, ()))) for c in cols])
    day_table = table(["Day", "People", "New", "Returning", "Portal", "Calc", "Write", "Show", "Notes",
                       "Downloads page"], day_rows, "num")

    def app_window(days_back):
        c = Counter()
        for ip in window_ips(ip_info, now, days_back):
            for p in ip_info[ip]["apps"]:
                c[p] += 1
        return c
    aw = {k: app_window(d) for k, d in (("24h", 1), ("7d", 7), ("14d", 14))}
    app_rows = [[e(c.capitalize()), str(aw["24h"][c]), str(aw["7d"][c]), str(aw["14d"][c])] for c in cols]
    app_table = table(["Page / app", "24 h", "7 days", "14 days"], app_rows, "num")

    cc = Counter(country(ip) for ip in w14)
    ctop = max(cc.values() or [0])
    country_table = table(["Country", "People (14 days)"],
                          [[e(k), bar(v, ctop)] for k, v in cc.most_common()], "num")

    dev = Counter(i["ua"].most_common(1)[0][0] for ip, i in ip_info.items() if ip in w14)
    dtop = max(dev.values() or [0])
    dev_table = table(["Device", "People (14 days)"], [[e(k), bar(v, dtop)] for k, v in dev.most_common()], "num")

    srcs = sorted(set(a["refs"]["14d"]), key=lambda s: -a["refs"]["14d"][s])
    ref_table = table(["Source", "24 h", "7 days", "14 days"],
                      [[e(s), str(a["refs"]["24h"][s]), str(a["refs"]["7d"][s]), str(a["refs"]["14d"][s])]
                       for s in srcs], "num")

    ip_rows = []
    for ip, i in sorted(ip_info.items(), key=lambda kv: kv[1]["last"], reverse=True)[:MAX_IP_ROWS]:
        ip_rows.append([e(ip), e(country(ip)), i["first"].strftime("%m-%d %H:%M"), i["last"].strftime("%m-%d %H:%M"),
                        str(len(i["days"])), e(i["ua"].most_common(1)[0][0]),
                        e(", ".join(f"{p} {n}" for p, n in i["apps"].most_common()))])
    ip_table = table(["IP", "Country", "First seen", "Last seen", "Days", "Device", "Opened (times)"], ip_rows)

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Rusuite stats - visitors and apps</title>
<style>
body{{font:15px/1.45 system-ui,sans-serif;max-width:64rem;margin:2rem auto;padding:0 1rem;color:#1d232a}}
h2{{margin-top:2rem}} table{{border-collapse:collapse;width:100%;margin:.5rem 0}}
th,td{{text-align:left;padding:.25rem .5rem;border-bottom:1px solid #e3e6ea;vertical-align:top}}
th{{font-weight:600;background:#f5f7f9}} table.num td+td{{font-variant-numeric:tabular-nums}}
.cards{{display:flex;gap:1rem;flex-wrap:wrap}} .card{{border:1px solid #e3e6ea;border-radius:8px;padding:.75rem 1rem;min-width:9rem}}
.card .n{{font-size:1.8rem;font-weight:650}} .bar{{display:inline-block;height:.7em;background:#5b8def;margin-right:.4rem;border-radius:2px;max-width:12rem}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1.5rem}} small,.note{{color:#5c6670}}
@media (prefers-color-scheme:dark){{body{{background:#15191d;color:#e4e7ea}} th{{background:#1f252b}} th,td{{border-color:#2c333a}} .card{{border-color:#2c333a}} small,.note{{color:#9aa4ad}}}}
</style></head><body>
<p><a href="./">&larr; Rusuite stats</a></p>
<h1>Visitors and apps</h1>
<p class="note">People = IPs with a browser that ran our JavaScript; crawlers, scanners and the owner's IPs are left
out. Generated {e(generated)}.</p>
<div class="cards">{cards}</div>
<h2>Per day</h2>{day_table}
<p class="note">App columns: people who opened that app (or page) on that day.</p>
<div class="grid"><div><h2>Apps</h2>{app_table}</div><div><h2>Where people come from</h2>{ref_table}
<p class="note">Referring site of each person's first request per day, counted in person-days.</p></div></div>
<div class="grid"><div><h2>Countries</h2>{country_table}</div><div><h2>Devices</h2>{dev_table}</div></div>
<h2>People</h2>{ip_table}
<p class="note">All requests (including bots): {a["total_requests"]} from {a["all_ips"]} IPs; see the GoAccess report.</p>
</body></html>
"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", action="append", required=True)
    ap.add_argument("--out", default="usage.html")
    ap.add_argument("--mmdb")
    ap.add_argument("--exclude-file")
    ap.add_argument("--exclude-ip", action="append", default=[])
    ap.add_argument("--now", help="ISO timestamp (tests)")
    ap.add_argument("--generated", default="")
    args = ap.parse_args(argv)

    excluded = set(args.exclude_ip)
    if args.exclude_file:
        try:
            with open(args.exclude_file, encoding="utf-8") as fh:
                excluded |= {ln.split("#", 1)[0].strip() for ln in fh} - {""}
        except OSError:
            pass
    now = dt.datetime.fromisoformat(args.now) if args.now else dt.datetime.now().astimezone()
    a = analyse(open_lines(args.log), excluded, now)
    page = render(a, Country(args.mmdb), now, args.generated or now.strftime("%Y-%m-%d %H:%M"))
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(page)
    return 0


if __name__ == "__main__":
    sys.exit(main())
