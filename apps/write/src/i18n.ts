// This app's UI catalogs on top of the shared ones (docs/i18n.md). Import
// `t` / `useT` from here so the catalogs are registered before use.

import { addMessages } from "@rusuite/ui-shared";
import de from "./locales/de.json";
import en from "./locales/en.json";

addMessages({ en, de });

export { t, useT } from "@rusuite/ui-shared";
