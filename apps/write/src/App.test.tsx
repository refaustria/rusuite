import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import App from "./App";
import { pingCore } from "./backend";
import { FakeBackend } from "./fakeBackend";

afterEach(cleanup);

describe("Write", () => {
  it("mounts the editor with the placeholder document and a status bar", async () => {
    const backend = new FakeBackend();
    render(<App backend={backend} />);
    const editor = await screen.findByTestId("editor");
    expect(editor.querySelector("h1")?.textContent).toBe("Welcome to Rusuite Write");
    expect(editor.querySelectorAll("ul li").length).toBe(2);
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByTestId("backend-kind").textContent).toBe("wasm");
    await waitFor(() => expect(screen.getByTestId("ping").textContent).toBe("Rusuite Write fake"));
  });

  it("pingCore sends {type:ping} and recognises pong", async () => {
    const backend = new FakeBackend();
    expect(await pingCore(backend)).toBe(true);
    expect(backend.log).toEqual([{ type: "ping" }]);
  });
});
