import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { compareCatalogs } from "@rusuite/ui-shared";
import { localeRenderTests } from "@rusuite/ui-shared/src/i18n/renderSuite";
import App from "./App";
import { FakeWriteBackend } from "./test/fakeWriteBackend";
import de from "./locales/de.json";
import en from "./locales/en.json";

describe("catalogs", () => {
  it("de.json has exactly the keys of en.json", () => {
    expect(compareCatalogs(en, de)).toEqual({ missing: [], extra: [] });
  });
});

localeRenderTests("Write", async () => {
  render(<App backend={new FakeWriteBackend()} />);
  await screen.findByTestId("editor");
});
