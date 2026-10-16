import type { Assistant } from "../controller";
import { SettingsDialog } from "../../settings/SettingsDialog";

/** What the assistant shows outside the panel: File › Options… (rendered by the backstage, also while closed). */
export function AiOverlay({ ai }: { ai: Assistant }) {
  return <SettingsDialog ai={ai} />;
}
