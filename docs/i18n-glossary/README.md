# UI glossaries (one file per language)

Every translation task (P9-L1 … L11) adds `docs/i18n-glossary/<lang>.md` (`fr.md`, `pl.md` …) **before** translating:
copy the template below, fill the "Office term" column from the Microsoft Office localisation of that language
(Microsoft's terminology search / language portal, the localised Office UI itself), then translate the catalogs with
these terms. The reviewer checks a sample of ~200 strings against this file. Terms not in the template that recur in the
catalogs (for example Calc's "Pivot table", Show's "Slide master") go into "More terms".

Rules (docs/i18n.md): the user is addressed **informally** in every language (the German "du": French "tu", Spanish
"tú", Polish "ty" …), imperatives in the familiar form; terminology still follows Office. Placeholders (`{name}`),
plural keys and shortcut combos stay untouched. Note the decisions you made in "Register" (the pronoun, the imperative
form, how a button reads), so later strings follow them.

---

## Template (`<lang>.md`)

```markdown
# Glossary: <Language> (`<lang>`)

Source: <where the Office terms come from>. Translator: <task id>. Reviewer: <task id>.

## Register
- Address: <informal pronoun and its forms, e.g. "tu / te / ton">; never <formal forms>.
- Buttons and menu commands: <infinitive / imperative / noun, as Office does>.
- Ellipsis "…" for commands that open a dialog, as in English.
- Keyboard key names in shortcut texts (packages/ui-shared/src/i18n/keyNames.ts): Ctrl = <…>, Shift = <…>, Delete = <…>, Enter = <…>.

## Ribbon tabs
| English | Office term | Note |
| --- | --- | --- |
| File | | |
| Home | | |
| Insert | | |
| Draw | | |
| Design | | |
| Layout (Write: Layout, Calc: Page Layout) | | |
| References | | Write |
| Mailings | | Write |
| Review | | |
| View | | |
| Formulas | | Calc |
| Data | | Calc |
| Transitions | | Show |
| Animations | | Show |
| Slide Show | | Show |
| Help | | |
| Picture / Table / Chart / Drawing Tools (contextual) | | |

## Ribbon groups
| English | Office term | Note |
| --- | --- | --- |
| Clipboard | | |
| Font | | |
| Paragraph | | |
| Styles | | |
| Editing | | |
| Number | | Calc |
| Alignment | | Calc |
| Cells | | Calc |
| Slides | | Show |
| Drawing | | Show |
| Zoom | | |
| Show (View › Show) | | |
| Language | | the picker; label "<Language> / Language" |

## Common commands
| English | Office term | Note |
| --- | --- | --- |
| New | | |
| Open… | | |
| Save | | |
| Save As… | | |
| Print | | |
| Export PDF… | | |
| Close | | |
| Options… | | |
| Undo / Redo | | |
| Cut / Copy / Paste | | |
| Paste Special… | | |
| Format Painter | | |
| Find / Replace… / Go To… | | |
| Select All | | |
| Bold / Italic / Underline / Strikethrough | | |
| Font Color / Highlight / Fill Color | | |
| Insert Picture / Table / Chart / Shape / Text Box | | |
| Bring to Front / Send to Back | | |
| Group / Ungroup | | |
| Sort / Filter | | Calc |
| Insert Function | | Calc |
| New Slide | | Show |
| From Beginning / From Current Slide | | Show |
| Track Changes / Comments | | Write |

## Dialog buttons and messages
| English | Office term | Note |
| --- | --- | --- |
| OK | | |
| Cancel | | |
| Apply | | |
| Close | | |
| Yes / No | | |
| Don't Save | | the unsaved-changes prompt |
| Browse… | | |
| Reset | | |
| Insert / Delete | | |
| Back / Next / Finish | | wizards |
| Recent | | backstage |
| Untitled | | default document name |
| Saved / Saving… / Unsaved changes | | status bar |

## File types
| English | Office term | Note |
| --- | --- | --- |
| Excel Workbook | | `.xlsx`, the desktop dialog filter name |
| Word Document | | `.docx` |
| PowerPoint Presentation | | `.pptx` |
| Excel Template / Word Template / PowerPoint Template | | `.xltx` / `.dotx` / `.potx` |
| CSV (Comma delimited) | | Calc |
| Text Files | | |
| PDF | | |
| Office Theme | | `.thmx` |
| All Files | | |

## More terms
| English | Office term | Note |
| --- | --- | --- |
| | | |
```
