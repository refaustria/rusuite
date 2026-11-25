"""Tests for usage.py and downloads.py: python3 -m unittest discover -s deploy/stats"""
import datetime as dt
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import downloads  # noqa: E402
import usage  # noqa: E402

FF = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"
BOT = "Mozilla/5.0 (compatible; CensysInspect/1.1; +https://about.censys.io/)"


def line(ip, t, path, status=200, ref="-", ua=FF):
    return f'{ip} - - [{t} +0100] "GET {path} HTTP/1.1" {status} 100 "{ref}" "{ua}"\n'


class UsageTest(unittest.TestCase):
    now = dt.datetime(2026, 11, 25, 12, 0, tzinfo=dt.timezone(dt.timedelta(hours=1)))

    def run_lines(self, lines, excluded=()):
        return usage.analyse(lines, set(excluded), self.now)

    def test_person_needs_javascript_and_browser(self):
        a = self.run_lines([
            line("1.1.1.1", "25/Nov/2026:10:00:00", "/"),
            line("1.1.1.1", "25/Nov/2026:10:00:01", "/version.json"),
            line("2.2.2.2", "25/Nov/2026:10:00:00", "/"),                       # no JS: not a person
            line("3.3.3.3", "25/Nov/2026:10:00:00", "/version.json", ua=BOT),    # bot
            line("4.4.4.4", "25/Nov/2026:10:00:00", "/calc/assets/index-abc.js"),
        ], excluded=["4.4.4.4"])
        self.assertEqual(a["people"], {"1.1.1.1"})

    def test_app_opens_and_referrer(self):
        a = self.run_lines([
            line("1.1.1.1", "24/Nov/2026:09:00:00", "/calc/", ref="https://www.google.com/"),
            line("1.1.1.1", "24/Nov/2026:09:00:01", "/calc/assets/index-abc.js", ref="https://rusuit.es/calc/"),
            line("1.1.1.1", "25/Nov/2026:09:00:00", "/write/index.html", status=304),
            line("1.1.1.1", "25/Nov/2026:09:00:00", "/show/", status=404),
        ])
        info = a["ip_info"]["1.1.1.1"]
        self.assertEqual(dict(info["apps"]), {"calc": 1, "write": 1})
        self.assertEqual(len(info["days"]), 2)
        self.assertEqual(a["refs"]["14d"]["Google"], 1)
        self.assertEqual(a["refs"]["14d"]["Direct / unknown"], 1)
        html = usage.render(a, usage.Country(None), self.now, "x")
        self.assertIn("Calc", html)

    def test_untrusted_strings_escaped(self):
        a = self.run_lines([line("1.1.1.1", "25/Nov/2026:10:00:00", "/version.json",
                                 ref="https://<script>.example/")])
        self.assertNotIn("<script>", usage.render(a, usage.Country(None), self.now, "x"))


class DownloadsTest(unittest.TestCase):
    def releases(self, n):
        return [{"tag_name": "v1", "published_at": "2026-10-18T00:00:00Z", "assets": [
            {"name": "Rusuite.Calc_1_x64-setup.exe", "download_count": n},
            {"name": "Rusuite.Write_1_aarch64.dmg", "download_count": 2},
            {"name": "latest.json", "download_count": 99},
        ]}]

    def test_history_and_daily_increase(self):
        with tempfile.TemporaryDirectory() as d:
            hist, out, rel = (os.path.join(d, x) for x in ("h.jsonl", "o.html", "r.json"))
            for day, n in (("2026-11-24", 3), ("2026-11-25", 1), ("2026-11-25", 5)):
                with open(rel, "w") as fh:
                    json.dump(self.releases(n), fh)
                self.assertEqual(downloads.main(["--history", hist, "--out", out, "--releases-json", rel,
                                                 "--today", day]), 0)
            lines = open(hist).read().splitlines()
            self.assertEqual(len(lines), 2)  # one line per day, last run wins
            page = open(out).read()
            self.assertIn("Rusuite.Calc_1_x64-setup.exe 2", page)  # 3 -> 5 on 2026-11-25
            self.assertNotIn("latest.json", page)

    def test_platform_and_app(self):
        self.assertEqual(downloads.platform("Rusuite.Show_3.141.0_amd64.AppImage"), "Linux")
        self.assertEqual(downloads.platform("Rusuite.Calc_3.141.0_x64_en-US.msi"), "Windows")
        self.assertEqual(downloads.app("Rusuite.Notes_1_x64.dmg"), "Notes")


if __name__ == "__main__":
    unittest.main()
