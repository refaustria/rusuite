import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession } from "../recent/session";
import { MemoryDocStorage } from "../recent/storage";
import { FakeCore, fakeBackend } from "../recent/testing";
import { useShortcuts } from "../shortcuts/useShortcuts";
import { RibbonButton, RibbonDivider, RibbonMenuButton, RibbonSplitButton, ribbonTooltip } from "./controls";
import { RibbonGallery, RibbonTableSizePicker } from "./gallery";
import { CONTEXT_COLORS, contextualTabs, openBackstage, Ribbon, tabRuns, visibleTabs, type RibbonProps, type RibbonTab } from "./Ribbon";
import { comboEventInit, triggerShortcut } from "./triggerShortcut";

afterEach(cleanup);

function tabs(onBold = vi.fn(), onSheet = vi.fn()): RibbonTab[] {
  return [
    {
      id: "home",
      label: "Home",
      toolbarLabel: "Formatting",
      groups: [
        { label: "Font", items: <RibbonButton label="Bold" icon="cut" pressed={false} onClick={onBold} /> },
        { label: "Empty", items: null },
      ],
    },
    { id: "insert", label: "Insert", groups: [{ label: "Sheets", items: <RibbonButton label="Sheet" size="large" icon="sheet" onClick={onSheet} /> }] },
    { id: "view", label: "View", groups: [{ label: "Zoom", items: <RibbonButton label="Zoom" icon="zoom" onClick={() => {}} /> }] },
    { id: "nothing", label: "Nothing", groups: [{ label: "None", items: [] }] },
  ];
}

function setup(props: Partial<RibbonProps> = {}) {
  const onBold = vi.fn();
  const onSheet = vi.fn();
  const user = userEvent.setup();
  render(
    <div>
      <input aria-label="Document" />
      <Ribbon tabs={tabs(onBold, onSheet)} appName="Rusuite Calc" documentTitle="Book1.xlsx" {...props} />
    </div>,
  );
  return { onBold, onSheet, user };
}

const tab = (name: string) => screen.getByRole("tab", { name });
const altTap = () => {
  fireEvent.keyDown(window, { key: "Alt", altKey: true });
  fireEvent.keyUp(window, { key: "Alt" });
};

describe("Ribbon tabs", () => {
  it("shows the app name, document title and the first tab's groups", () => {
    setup();
    expect(screen.getByTestId("ribbon-app-name").textContent).toBe("Rusuite Calc");
    expect(screen.getByTestId("ribbon-doc-title").textContent).toBe("Book1.xlsx");
    expect(tab("Home").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Font" })).toBeTruthy();
  });

  it("omits empty groups and tabs without groups", () => {
    setup();
    expect(screen.queryByRole("group", { name: "Empty" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Nothing" })).toBeNull();
    expect(visibleTabs(tabs()).map((t) => t.id)).toEqual(["home", "insert", "view"]);
  });

  it("switches tabs on click and reports the change", async () => {
    const onTabChange = vi.fn();
    const { user, onSheet } = setup({ onTabChange });
    await user.click(tab("Insert"));
    expect(tab("Insert").getAttribute("aria-selected")).toBe("true");
    expect(tab("Home").getAttribute("aria-selected")).toBe("false");
    expect(onTabChange).toHaveBeenCalledWith("insert");
    await user.click(screen.getByRole("button", { name: "Sheet" }));
    expect(onSheet).toHaveBeenCalledTimes(1);
  });

  it("supports a controlled active tab", async () => {
    function Controlled() {
      const [t, setT] = useState("view");
      return <Ribbon tabs={tabs()} appName="A" activeTab={t} onTabChange={setT} />;
    }
    render(<Controlled />);
    expect(tab("View").getAttribute("aria-selected")).toBe("true");
    await userEvent.click(tab("Home"));
    expect(tab("Home").getAttribute("aria-selected")).toBe("true");
  });

  it("links the tab panel to its tab", () => {
    setup();
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("Home").id);
    expect(tab("Home").getAttribute("aria-controls")).toBe(panel.id);
  });

  it("renders the right slot", () => {
    setup({ rightSlot: <button type="button">Present</button> });
    expect(screen.getByRole("button", { name: "Present" })).toBeTruthy();
  });
});

describe("Ribbon keyboard", () => {
  it("Alt focuses the active tab; Alt again returns to the document", () => {
    setup();
    const doc = screen.getByLabelText("Document");
    doc.focus();
    altTap();
    expect(document.activeElement).toBe(tab("Home"));
    altTap();
    expect(document.activeElement).toBe(doc);
  });

  it("Alt with another key does not focus the strip", () => {
    setup();
    const doc = screen.getByLabelText("Document");
    doc.focus();
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    fireEvent.keyDown(window, { key: "Enter", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    expect(document.activeElement).toBe(doc);
  });

  it("arrows move between tabs (wrapping, File included), Enter and Space activate", () => {
    setup({ backstage: { onOpen: () => {} } });
    tab("Home").focus();
    fireEvent.keyDown(tab("Home"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Insert"));
    expect(tab("Home").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Insert"), { key: "Enter" });
    expect(tab("Insert").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Insert"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("View"), { key: " " });
    expect(tab("View").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("View"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("File"));
    fireEvent.keyDown(tab("File"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("View"));
    fireEvent.keyDown(tab("View"), { key: "Home" });
    expect(document.activeElement).toBe(tab("File"));
    fireEvent.keyDown(tab("File"), { key: "End" });
    expect(document.activeElement).toBe(tab("View"));
  });

  it("ArrowDown enters the tab's controls; Esc leaves the strip", async () => {
    setup();
    const doc = screen.getByLabelText("Document");
    doc.focus();
    altTap();
    fireEvent.keyDown(tab("Home"), { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" })));
    altTap();
    fireEvent.keyDown(tab("Home"), { key: "Escape" });
    expect(document.activeElement).toBe(doc);
  });

  it("only the active tab is in the Tab order (roving tabindex)", async () => {
    const { user } = setup();
    expect(tab("Home").tabIndex).toBe(0);
    expect(tab("Insert").tabIndex).toBe(-1);
    await user.click(tab("Insert"));
    expect(tab("Insert").tabIndex).toBe(0);
    expect(tab("Home").tabIndex).toBe(-1);
  });
});

describe("Ribbon collapse", () => {
  it("Ctrl+F1 collapses to the tab strip and expands again", () => {
    const onCollapsedChange = vi.fn();
    setup({ onCollapsedChange });
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.getByTestId("ribbon").dataset.collapsed).toBe("true");
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("the toggle button collapses and expands", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Collapse the ribbon" }));
    expect(screen.queryByRole("tabpanel")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand the ribbon" }));
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("when collapsed, clicking a tab shows it temporarily until a command runs", async () => {
    const { user, onSheet } = setup({ defaultCollapsed: true });
    expect(screen.queryByRole("tabpanel")).toBeNull();
    await user.click(tab("Insert"));
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sheet" }));
    expect(onSheet).toHaveBeenCalled();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("a temporarily shown tab closes on a click outside and on Esc", async () => {
    const { user } = setup({ defaultCollapsed: true });
    await user.click(tab("Home"));
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    await user.click(screen.getByLabelText("Document"));
    expect(screen.queryByRole("tabpanel")).toBeNull();
    await user.click(tab("Home"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Bold" }), { key: "Escape" });
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("double-clicking a tab toggles the collapse", async () => {
    const { user } = setup();
    await user.dblClick(tab("View"));
    expect(screen.getByTestId("ribbon").dataset.collapsed).toBe("true");
  });
});

describe("Backstage", () => {
  async function session() {
    const storage = new MemoryDocStorage();
    await storage.rememberRecent("old.xlsx", '{"text":"old"}');
    const s = new DocumentSession(fakeBackend(new FakeCore(), storage), { docId: "me", target: null, locks: null });
    const restore = vi.fn(async () => true);
    s.attach({ restore, openFile: vi.fn(async () => true) });
    await act(() => s.start());
    return { s, restore };
  }

  it("File opens the full-pane view; Esc and Back return", async () => {
    const { user } = setup({ backstage: { onOpen: () => {} } });
    await user.click(tab("File"));
    const view = screen.getByRole("dialog", { name: "File" });
    expect(view.textContent).toContain("Book1.xlsx");
    expect(view.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
    await user.click(tab("File"));
    await user.click(screen.getByRole("button", { name: "Back to the document" }));
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
  });

  it("commands close the view and run; missing ones are not offered", async () => {
    const actions = { onNew: vi.fn(), onOpen: vi.fn(), onSave: vi.fn(), onSaveAs: vi.fn(), onExportPdf: vi.fn() };
    const { user } = setup({ backstage: actions });
    for (const [name, fn] of [
      ["New", actions.onNew],
      ["Open…", actions.onOpen],
      ["Save", actions.onSave],
      ["Save As…", actions.onSaveAs],
      ["Export PDF…", actions.onExportPdf],
    ] as const) {
      await user.click(tab("File"));
      await user.click(within(screen.getByRole("dialog", { name: "File" })).getByRole("button", { name }));
      expect(fn).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
    }
    await user.click(tab("File"));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("Print page: the File › Print entry and openBackstage(\"print\") show it; Home goes back", async () => {
    const { user } = setup({ backstage: { onExportPdf: vi.fn(), print: <div data-testid="print-panel"><button type="button">Print it</button></div> } });
    await user.click(tab("File"));
    const view = screen.getByRole("dialog", { name: "File" });
    expect(within(view).queryByTestId("print-panel")).toBeNull();
    await user.click(within(view).getByRole("button", { name: "Print" }));
    expect(within(view).getByTestId("print-panel")).toBeTruthy();
    expect(within(view).getByRole("button", { name: "Print" }).getAttribute("aria-current")).toBe("page");
    expect(document.activeElement?.textContent).toBe("Print it");
    await user.click(within(view).getByRole("button", { name: "Home" }));
    expect(within(view).queryByTestId("print-panel")).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
    act(() => void expect(openBackstage("print")).toBe(true));
    expect(within(screen.getByRole("dialog", { name: "File" })).getByTestId("print-panel")).toBeTruthy();
  });

  it("without a ribbon openBackstage reports that nobody took it; a disabled print falls back to Home", () => {
    expect(openBackstage("print")).toBe(false);
    setup({ backstage: { exportDisabled: true, print: <div data-testid="print-panel" /> } });
    act(() => void openBackstage("print"));
    expect(screen.queryByTestId("print-panel")).toBeNull();
    expect(screen.getByRole("dialog", { name: "File" })).toBeTruthy();
  });

  it("lists the recent files of the session and re-opens one", async () => {
    const { s, restore } = await session();
    const { user } = setup({ backstage: { session: s, onOpen: () => {} } });
    await user.click(tab("File"));
    const entries = await screen.findAllByTestId("recent-entry");
    expect(entries.map((e) => e.textContent)).toEqual([expect.stringContaining("old.xlsx")]);
    expect(screen.getByTestId("recent-web-note")).toBeTruthy();
    await user.click(entries[0]!);
    await waitFor(() => expect(restore).toHaveBeenCalledWith('{"text":"old"}', "old.xlsx"));
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
  });

  it("disables the file commands with a reason", async () => {
    const { user } = setup({ backstage: { onOpen: vi.fn(), onSave: vi.fn(), onNew: vi.fn(), fileDisabledReason: "No file access" } });
    await user.click(tab("File"));
    expect((screen.getByRole("button", { name: "Open…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "New" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("file-disabled").textContent).toBe("No file access");
  });

  it("Enter on the File tab opens it from the keyboard", () => {
    setup({ backstage: { onCloseDocument: vi.fn() } });
    tab("File").focus();
    fireEvent.keyDown(tab("File"), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "File" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("Ribbon controls", () => {
  it("RibbonButton: label, tooltip with shortcut, toggle state, disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<RibbonButton label="Copy" icon="copy" shortcut="Mod+C" pressed onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Copy" });
    expect(b.title).toBe("Copy (Ctrl+C)");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<RibbonButton label="Copy" icon="copy" disabled onClick={onClick} />);
    expect(b.getAttribute("aria-pressed")).toBeNull();
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(ribbonTooltip("Find", "Mod+F", "Find text")).toBe("Find text (Ctrl+F)");
  });

  it("large buttons show their label", () => {
    render(<RibbonButton label="Insert sheet" size="large" icon="sheet" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Insert sheet" }).textContent).toBe("Insert sheet");
  });

  it("RibbonSplitButton: main action and a keyboard-navigable menu", async () => {
    const main = vi.fn();
    const a = vi.fn();
    const b = vi.fn();
    const user = userEvent.setup();
    render(
      <RibbonSplitButton
        label="Paste"
        icon="paste"
        size="large"
        onClick={main}
        menu={[
          { id: "a", label: "Paste values", onSelect: a },
          { separator: true },
          { id: "b", label: "Paste formats", onSelect: b },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(main).toHaveBeenCalled();
    const arrow = screen.getByRole("button", { name: "Paste options" });
    await user.click(arrow);
    expect(arrow.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Paste values" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Paste formats" }));
    await user.keyboard("{Enter}");
    expect(b).toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(arrow);
  });

  it("RibbonMenuButton opens on click and ArrowDown, closes on Esc", async () => {
    const pick = vi.fn();
    const user = userEvent.setup();
    render(<RibbonMenuButton label="Arrange" icon="arrange" size="large" menu={[{ id: "front", label: "Bring to front", onSelect: pick }]} />);
    const btn = screen.getByRole("button", { name: "Arrange" });
    btn.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu", { name: "Arrange" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(btn);
    await user.click(btn);
    await user.click(screen.getByRole("menuitem", { name: "Bring to front" }));
    expect(pick).toHaveBeenCalled();
  });

  it("RibbonDivider is a vertical separator", () => {
    render(<RibbonDivider />);
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("vertical");
  });
});

describe("Galleries", () => {
  const items = ["Normal", "Title", "Heading 1", "Heading 2"].map((l) => ({ id: l, label: l, preview: <span>{l}</span> }));

  it("inline gallery: selection state, pick, arrow keys", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RibbonGallery label="Styles" items={items} selected="Title" onSelect={onSelect} columns={2} />);
    const g = screen.getByRole("group", { name: "Styles" });
    expect(within(g).getByRole("button", { name: "Title" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(g).getByRole("button", { name: "Heading 1" }));
    expect(onSelect).toHaveBeenCalledWith("Heading 1");
    within(g).getByRole("button", { name: "Normal" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(g).getByRole("button", { name: "Heading 1" }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(within(g).getByRole("button", { name: "Heading 2" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(within(g).getByRole("button", { name: "Normal" }));
  });

  it("dropdown gallery: opens, focuses the selected item, picks and closes", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RibbonGallery label="New slide" variant="dropdown" icon="newSlide" items={items} selected="Heading 1" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "New slide" }));
    const dlg = screen.getByRole("dialog", { name: "New slide" });
    expect(document.activeElement).toBe(within(dlg).getByRole("button", { name: "Heading 1" }));
    await user.click(within(dlg).getByRole("button", { name: "Title" }));
    expect(onSelect).toHaveBeenCalledWith("Title");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("table size picker highlights the hovered size and picks rows × cols", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<RibbonTableSizePicker maxRows={4} maxCols={5} onPick={onPick} />);
    await user.hover(screen.getByRole("button", { name: "3 × 4 table" }));
    expect(screen.getByTestId("table-size").textContent).toBe("3 × 4 table");
    await user.click(screen.getByRole("button", { name: "3 × 4 table" }));
    expect(onPick).toHaveBeenCalledWith(3, 4);
    screen.getByRole("button", { name: "1 × 1 table" }).focus();
    await user.keyboard("{ArrowDown}{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2 × 2 table" }));
  });
});

describe("triggerShortcut", () => {
  it("builds key events for combos", () => {
    expect(comboEventInit("Mod+Shift+S")).toMatchObject({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true, altKey: false });
    expect(comboEventInit("Mod+/")).toMatchObject({ key: "/", code: "Slash", ctrlKey: true });
    expect(comboEventInit("Shift+F5")).toMatchObject({ key: "F5", shiftKey: true, ctrlKey: false });
    expect(comboEventInit("Mod+Plus")).toMatchObject({ key: "+", ctrlKey: true });
  });

  it("runs the app's shortcut map entry", () => {
    const run = vi.fn();
    function App() {
      useShortcuts({ "Mod+Shift+S": { label: "Save as", inField: true, run }, "Mod+/": { label: "Help", run } });
      return null;
    }
    render(<App />);
    expect(triggerShortcut("Mod+Shift+S")).toBe(true);
    expect(triggerShortcut("Mod+/")).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(triggerShortcut("Mod+K")).toBe(false);
  });
});

describe("contextual tabs (P8-28)", () => {
  const ctxTabs = (): RibbonTab[] => [
    ...contextualTabs(
      [
        { id: "tableDesign", label: "Table Design", groups: [{ label: "Styles", items: <RibbonButton label="Style" icon="cut" onClick={() => {}} /> }] },
        { id: "tableLayout", label: "Layout", groups: [{ label: "Rows", items: <RibbonButton label="Row" icon="cut" onClick={() => {}} /> }] },
      ],
      "Table Tools",
      CONTEXT_COLORS.table,
    ),
    ...tabs(),
  ];

  it("puts contextual tabs after the standard ones and groups them under one header", () => {
    const shown = visibleTabs(ctxTabs());
    expect(shown.map((t) => t.id)).toEqual(["home", "insert", "view", "tableDesign", "tableLayout"]);
    const runs = tabRuns(shown);
    expect(runs.map((r) => r.context?.group ?? null)).toEqual([null, null, null, "Table Tools"]);
    expect(runs[3]!.tabs).toHaveLength(2);
  });

  it("separate groups get separate headers", () => {
    const t = [
      ...contextualTabs([{ id: "a", label: "A", groups: [] }], "Drawing Tools", CONTEXT_COLORS.drawing),
      ...contextualTabs([{ id: "b", label: "B", groups: [] }], "Picture Tools", CONTEXT_COLORS.picture),
    ];
    expect(tabRuns(t).map((r) => r.context?.group)).toEqual(["Drawing Tools", "Picture Tools"]);
  });

  it("renders the coloured header, tint and the context in the title", () => {
    render(<Ribbon tabs={ctxTabs()} appName="Rusuite Show" activeTab="tableLayout" />);
    const group = screen.getByTestId("ribbon-context");
    expect(group.getAttribute("data-context")).toBe("Table Tools");
    expect(within(group).getByTestId("ribbon-context-header").textContent).toBe("Table Tools");
    const layout = within(group).getByRole("tab", { name: "Layout" });
    expect(layout.getAttribute("aria-selected")).toBe("true");
    expect(layout.getAttribute("title")).toBe("Table Tools: Layout");
    expect(within(group).getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId("ribbon-panel").getAttribute("data-context")).toBe("Table Tools");
    // standard tabs have no context
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("data-context")).toBeNull();
  });
});
