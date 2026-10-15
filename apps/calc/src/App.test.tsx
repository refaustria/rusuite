import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Backend } from "@rusuite/ui-shared";
import App from "./App";

const backend: Backend = {
  kind: "wasm",
  ping: async () => "Rusuite Calc 0.1.0",
  dispatch: async <T,>() => undefined as T,
};

describe("App", () => {
  it("renders the heading and shows the ping reply and backend kind", async () => {
    render(<App backend={backend} />);
    expect(
      screen.getByRole("heading", { name: "Rusuite Calc" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Rusuite Calc 0\.1\.0/)).toBeTruthy();
    expect(screen.getByTestId("backend-kind").textContent).toBe("(wasm)");
    cleanup();
  });
});
