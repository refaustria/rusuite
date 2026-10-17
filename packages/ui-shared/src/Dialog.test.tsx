import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "./Dialog";

afterEach(cleanup);

/** An opener button, a dialog with OK, and a "target" field the close handler may focus instead. */
function Host({ focusTargetOnClose = false }: { focusTargetOnClose?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    if (focusTargetOnClose) document.getElementById("target")?.focus();
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <input id="target" aria-label="Target" />
      <Dialog open={open} title="Settings" onClose={close}>
        <button type="button" onClick={close}>
          OK
        </button>
      </Dialog>
    </>
  );
}

describe("Dialog focus (P9-Q1)", () => {
  it("focuses the first control and returns the focus to the opener synchronously on OK", () => {
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    // No act/flush beyond the click's own commit: the focus is back before the close resolves.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns the focus on Esc", () => {
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("keeps the focus where the close handler put it (e.g. the editor) instead of stealing it back", () => {
    render(<Host focusTargetOnClose />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    act(() => fireEvent.click(screen.getByRole("button", { name: "OK" })));
    expect(document.activeElement).toBe(screen.getByLabelText("Target"));
  });
});
