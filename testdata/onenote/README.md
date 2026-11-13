# OneNote sample files (fmt-onenote tests)

Used by `crates/fmt-onenote/tests/` (see `docs/onenote-subset.md`). Committed unmodified; the `.onepkg` packages
are built from these files at test time.

| Files | Source | Licence |
| --- | --- | --- |
| `notebook/**` (a OneDrive-format notebook: `Open Notebook.onetoc2`, `New Section 1.one`, `New Section Group/…`), `handwriting_recognition.one` | [`msiemens/onenote.rs`](https://github.com/msiemens/onenote.rs) `crates/parser/tests/samples/` at commit `de3a64e8159c684b137ded89c3fef3c17272ec1d` | Mozilla Public License 2.0 (the repository's licence, <https://mozilla.org/MPL/2.0/>); unmodified |
| `onenote-2016/OneWithFileData.one` | same repository, `samples/onenote-2016/`, vendored there from [OfficeDev/Interop-TestSuites](https://github.com/OfficeDev/Interop-TestSuites) | MIT, (c) 2015 Office – see `onenote-2016/LICENSE` |

Not committed: the repository's `samples/joplin/` files (more notebooks with section groups, sub-pages, math,
check boxes) are AGPL-3.0-or-later (from Joplin) and its "Large *.one" files are Git LFS objects. To test against
them, download them yourself and run
`ONENOTE_EXTRA=/path/a.one,/path/b.onepkg cargo test -p fmt-onenote --test corpus extra -- --nocapture`.
