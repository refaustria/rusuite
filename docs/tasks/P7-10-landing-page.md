# Task P7-10 – Root landing page listing the apps, with a professional logo set (owner request 2026-10-15)

Branch `p7/landing`, worktree `/home/bojan/rusuite-wt/p7-landing`. Scope: new `apps/portal/` (static site: `index.html`, `styles.css`, `logos/*.svg`, no framework, no build step beyond copying), `deploy/nginx/resuite.inceptum.at.conf` (root serves the portal, no 302; keep `/calc/`, `/write/`, `/show/` blocks), `scripts/deploy-web.sh` (copy the portal to `/var/www/resuite/` root, write `version.json` as today), `apps/*/src-tauri/icons/**` + each app's `index.html` favicon (regenerate from the new logos with `pnpm --filter <app> tauri icon <png>`), `README.md` (replace the screenshot-less header with the logo set if appropriate), `docs/ui.md`. Up to 3 commits.

## Logo set (vector, hand-crafted SVG – no stock art, no emoji)
- One family: a rounded square tile (radius 22 % of size) with a flat two-tone design and a simple geometric glyph per app, all sharing the same grid, stroke weight and corner radius, so they read as one suite:
  - **Calc** – green (`#1E7A46`/`#2DA866`), glyph: a 2×2 grid of cells with one highlighted cell or a minimal "Σ"-free grid mark.
  - **Write** – blue (`#1F4E9A`/`#3B7DD8`), glyph: three text lines with the first shorter, or a pen nib – keep it abstract.
  - **Show** – orange (`#C2410C`/`#F0763A`), glyph: a 16:9 slide frame with a small play triangle or a title bar.
  - **Rusuite** mark: a neutral slate tile combining three thin bars in the three colours.
- Deliver each as `logos/<app>.svg` (1024 viewBox), a monochrome variant for favicons, and a 1024 PNG export (use `rsvg-convert` from `librsvg2-bin` – install with apt if missing and document in docs/setup.md – or ImageMagick with the SVG delegate; verify the PNGs are not blank).
## Landing page (`/`)
- Header: Rusuite mark + "Rusuite" + one line: "A small office suite with a Rust core – runs in your browser and on the desktop."
- Three cards (Calc, Write, Show): logo, name, one-sentence description, "Open in browser" button → `/calc/` etc., "Desktop downloads" link → `https://github.com/refaustria/rusuite/releases` (one shared link in the footer is fine too).
- Footer: version from `/version.json` (fetch, show commit short + build date), link to the GitHub repo, "Alpha – unsigned desktop builds" note.
- Responsive (320 px → wide), light/dark via `prefers-color-scheme`, system font stack, no external requests except `/version.json`, Lighthouse-friendly (semantic HTML, alt texts, contrast ≥ 4.5:1, keyboard focus styles). Keep it under 30 KB total.
## Acceptance
- `curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://resuite.inceptum.at/` → `200 text/html` (no redirect); the three app pages still 200; `pnpm e2e` unchanged; add one e2e test for the portal (three links present, version loads). Screenshots of the portal (light + dark, mobile width) and of the three new icons in the scratchpad. Install the nginx conf per deploy/README.md and run the deploy script from your worktree.
