import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { compareCatalogs } from "@rusuite/ui-shared";
import { localeRenderTests } from "@rusuite/ui-shared/src/i18n/renderSuite";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import de from "./locales/de.json";
import en from "./locales/en.json";

describe("catalogs", () => {
  it("de.json has exactly the keys of en.json", () => {
    expect(compareCatalogs(en, de)).toEqual({ missing: [], extra: [] });
  });
});

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

localeRenderTests("Calc", async () => {
  render(<App backend={new FakeBackend(new FakeCalcCore())} />);
  await screen.findByTestId("grid");
});
