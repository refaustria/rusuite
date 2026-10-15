import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../Dialog";
import { applyTint } from "./color";
import { ToolbarDemo } from "./demo";
import { Toolbar } from "./Toolbar";
import type { CellStyleView } from "./types";

afterEach(cleanup);

function setup(value: CellStyleView = {}, disabled = false) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Toolbar value={value} onChange={onChange} disabled={disabled} />);
  return { onChange, user };
}

describe("Toolbar", () => {
  it("bold toggle negates the current value", async () => {
    const a = setup({ font: { bold: false } });
    await a.user.click(screen.getByRole("button", { name: "Bold" }));
    expect(a.onChange).toHaveBeenCalledWith({ font: { bold: true } });
    cleanup();
    const b = setup({ font: { bold: true } });
    const btn = screen.getByRole("button", { name: "Bold" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    await b.user.click(btn);
    expect(b.onChange).toHaveBeenCalledWith({ font: { bold: false } });
  });

  it("underline toggles between single and none", async () => {
    const a = setup({});
    await a.user.click(screen.getByRole("button", { name: "Underline" }));
    expect(a.onChange).toHaveBeenCalledWith({ font: { underline: "single" } });
    cleanup();
    const b = setup({ font: { underline: "single" } });
    await b.user.click(screen.getByRole("button", { name: "Underline" }));
    expect(b.onChange).toHaveBeenCalledWith({ font: { underline: "none" } });
  });

  it("number format select emits the code", async () => {
    const { onChange, user } = setup();
    await user.selectOptions(screen.getByLabelText("Number format"), "0.00");
    expect(onChange).toHaveBeenCalledWith({ numberFormat: "0.00" });
  });

  it("font family emits a named face and keeps unknown current value", async () => {
    const { onChange, user } = setup({ font: { font: { kind: "named", value: "Comic Sans" } } });
    const sel = screen.getByLabelText("Font family") as HTMLSelectElement;
    expect(sel.value).toBe("Comic Sans");
    await user.selectOptions(sel, "Arial");
    expect(onChange).toHaveBeenCalledWith({ font: { font: { kind: "named", value: "Arial" } } });
  });

  it("font size is editable and emits hundredths of a point", async () => {
    const { onChange, user } = setup({ font: { size: 1100 } });
    const input = screen.getByLabelText("Font size");
    expect((input as HTMLInputElement).value).toBe("11");
    await user.clear(input);
    await user.type(input, "12.5{Enter}");
    expect(onChange).toHaveBeenCalledWith({ font: { size: 1250 } });
  });

  it("theme tint cell emits a theme color", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: "Text color" }));
    await user.click(screen.getByRole("button", { name: "accent1 tint 0.6" }));
    expect(onChange).toHaveBeenCalledWith({
      font: { color: { kind: "theme", value: { slot: "accent1", tint: 0.6 } } },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("standard cell emits rgb; fill emits solid fill; no fill emits none", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: "Fill color" }));
    await user.click(screen.getByRole("button", { name: "Standard color FF0000" }));
    expect(onChange).toHaveBeenLastCalledWith({
      fill: { kind: "solid", color: { kind: "rgb", value: "FF0000" } },
    });
    await user.click(screen.getByRole("button", { name: "Fill color" }));
    await user.click(screen.getByRole("button", { name: "No fill" }));
    expect(onChange).toHaveBeenLastCalledWith({ fill: { kind: "none" } });
    await user.click(screen.getByRole("button", { name: "Text color" }));
    await user.click(screen.getByRole("button", { name: "Standard color FF0000" }));
    expect(onChange).toHaveBeenLastCalledWith({ font: { color: { kind: "rgb", value: "FF0000" } } });
  });

  it("hex input emits uppercase rgb and rejects invalid", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: "Text color" }));
    const hex = screen.getByLabelText("Hex color");
    await user.type(hex, "12zz{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(hex);
    await user.type(hex, "#0a1b2c{Enter}");
    expect(onChange).toHaveBeenCalledWith({ font: { color: { kind: "rgb", value: "0A1B2C" } } });
  });

  it("color grid supports arrow keys", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Text color" }));
    screen.getByRole("button", { name: "light1 tint 0" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "dark1 tint 0" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "dark1 tint 0.8" }));
  });

  it("alignment and wrap emit alignment patches", async () => {
    const { onChange, user } = setup({ alignment: { wrapText: true } });
    await user.click(screen.getByRole("button", { name: "Align center" }));
    expect(onChange).toHaveBeenLastCalledWith({ alignment: { horizontal: "center" } });
    await user.click(screen.getByRole("button", { name: "Align middle" }));
    expect(onChange).toHaveBeenLastCalledWith({ alignment: { vertical: "center" } });
    await user.click(screen.getByRole("button", { name: "Wrap text" }));
    expect(onChange).toHaveBeenLastCalledWith({ alignment: { wrapText: false } });
  });

  it("borders dropdown emits thin black sides", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: "Borders" }));
    await user.click(screen.getByRole("menuitem", { name: "Bottom border" }));
    expect(onChange).toHaveBeenCalledWith({
      borders: { bottom: { style: "thin", color: { kind: "rgb", value: "000000" } } },
    });
    await user.click(screen.getByRole("button", { name: "Borders" }));
    await user.click(screen.getByRole("menuitem", { name: "Outside borders" }));
    const patch = onChange.mock.calls[1]![0];
    expect(Object.keys(patch.borders).sort()).toEqual(["bottom", "left", "right", "top"]);
  });

  it("disabled renders every control disabled", () => {
    setup({}, true);
    const toolbar = screen.getByRole("toolbar");
    const controls = Array.from(toolbar.querySelectorAll("button, select, input"));
    expect(controls.length).toBeGreaterThanOrEqual(15);
    for (const c of controls) expect((c as HTMLButtonElement).disabled).toBe(true);
  });

  it("demo applies patches locally", async () => {
    const user = userEvent.setup();
    render(<ToolbarDemo />);
    await user.click(screen.getByRole("button", { name: "Italic" }));
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("applyTint", () => {
  it("matches Excel for white/black and accent1", () => {
    expect(applyTint("FFFFFF", -0.5)).toBe("808080");
    expect(applyTint("000000", 0.5)).toBe("808080");
    expect(applyTint("4472C4", 0)).toBe("4472C4");
  });
});

describe("Dialog", () => {
  function Host({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button>outside</button>
        <Dialog open={open} title="Test" onClose={() => { onClose(); setOpen(false); }}>
          <button>first</button>
          <button>last</button>
        </Dialog>
      </>
    );
  }

  it("traps focus and closes on Esc", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Host onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByText("first"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("last"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("first"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
