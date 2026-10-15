import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListButtons } from "./ListButtons";
import { ParagraphStyleSelect } from "./ParagraphStyleSelect";
import { Toolbar } from "./Toolbar";

afterEach(cleanup);

const STYLES = [
  { id: "Normal", label: "Normal" },
  { id: "Heading1", label: "Heading 1" },
];

describe("Write toolbar controls", () => {
  it("ParagraphStyleSelect reports the chosen style id", async () => {
    const onChange = vi.fn();
    render(<ParagraphStyleSelect value="Normal" styles={STYLES} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Paragraph style" }), "Heading1");
    expect(onChange).toHaveBeenCalledWith("Heading1");
  });

  it("ParagraphStyleSelect shows an unknown style as its own option", () => {
    render(<ParagraphStyleSelect value="Quote" styles={STYLES} onChange={() => {}} />);
    expect((screen.getByRole("combobox", { name: "Paragraph style" }) as HTMLSelectElement).value).toBe("Quote");
  });

  it("ListButtons toggle lists and indent", async () => {
    const onToggle = vi.fn();
    const onIndent = vi.fn();
    const user = userEvent.setup();
    render(<ListButtons bullet ordered={false} onToggle={onToggle} onIndent={onIndent} />);
    expect(screen.getByRole("button", { name: "Bulleted list" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Numbered list" }));
    await user.click(screen.getByRole("button", { name: "Increase indent" }));
    await user.click(screen.getByRole("button", { name: "Decrease indent" }));
    expect(onToggle).toHaveBeenCalledWith("decimal");
    expect(onIndent.mock.calls).toEqual([[1], [-1]]);
  });

  it("Toolbar can show a subset of groups and extra children", () => {
    render(
      <Toolbar value={{}} onChange={() => {}} groups={["style", "colors"]} fillLabel="Highlight color">
        <span data-testid="extra" />
      </Toolbar>,
    );
    expect(screen.queryByRole("group", { name: "Number" })).toBeNull();
    expect(screen.getByRole("group", { name: "Style" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Highlight color/ })).toBeTruthy();
    expect(screen.getByTestId("extra")).toBeTruthy();
  });
});
