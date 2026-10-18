// The AI assistant (P8-37): provider adapters, settings, prompts, structured results, the controller and its UI.
export * from "./types";
export * from "./settings";
export * from "./prompts";
export * from "./schemas";
export * from "./controller";
export * from "./adapter";
export * from "./images";
export * from "./export";
export * from "./overrides";
export * from "./providers";
export { AssistantPane, useAssistantShortcut } from "./ui/AssistantPane";
export { AiStatus } from "./ui/AiStatus";
export { AiRibbonButton, aiRibbonGroup } from "./ui/ribbon";
export { AiOverlay } from "./ui/AiOverlay";
export { useAssistant } from "./ui/hooks";
export * from "../settings";
