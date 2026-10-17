// This app's UI catalogs on top of the shared ones (docs/i18n.md). Import
// `t` / `useT` from here so the catalogs are registered before use.
// English and German are bundled; every other `locales/<lang>.json` is a
// chunk of its own, loaded when that language is chosen.

import { addCatalogs, catalogLoaders } from "@rusuite/ui-shared";
import de from "./locales/de.json";
import en from "./locales/en.json";

addCatalogs({ en, de }, catalogLoaders(import.meta.glob(["./locales/*.json", "!./locales/en.json", "!./locales/de.json"])));

export { t, useT } from "@rusuite/ui-shared";
