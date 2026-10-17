import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("./test/konvaMock"));

import { compareCatalogs } from "@rusuite/ui-shared";
import { localeRenderTests } from "@rusuite/ui-shared/src/i18n/renderSuite";
import App from "./App";
import { ShowApi } from "./api";
import { ShowStore } from "./state/store";
import { FakeBackend } from "./test/fakeBackend";
import de from "./locales/de.json";
import en from "./locales/en.json";

describe("catalogs", () => {
  it("de.json has exactly the keys of en.json", () => {
    expect(compareCatalogs(en, de)).toEqual({ missing: [], extra: [] });
  });
});

// jsdom has no layout: give the canvas area a size so the editor stage renders.
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

localeRenderTests("Show", async () => {
  const backend = new FakeBackend();
  render(<App backend={backend} store={new ShowStore(new ShowApi(backend))} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
});
