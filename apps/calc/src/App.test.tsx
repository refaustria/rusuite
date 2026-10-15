import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("Rusuite Calc 0.1.0"),
}));

describe("App", () => {
  it("renders the heading and shows the ping reply", async () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Rusuite Calc" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("Rusuite Calc 0.1.0")).toBeTruthy();
    cleanup();
  });
});
