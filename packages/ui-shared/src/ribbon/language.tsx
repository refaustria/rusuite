// The View tab's "Language / Sprache" group (P7-11).

import type { TFunction } from "../i18n/core";
import { LanguageSelect } from "../i18n/react";
import type { RibbonGroup } from "./Ribbon";

/** A ribbon group with the language picker (English, Deutsch). */
export function languageRibbonGroup(t: TFunction): RibbonGroup {
  return { label: t("language.label"), items: <LanguageSelect compact /> };
}
