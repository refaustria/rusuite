// The dialog: the "I understand" gate, the diagnostics preview, success / 429 / 502 rendering, screenshots.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportController, reportAvailable } from "../controller";
import { TopBar } from "../../compact/TopBar";
import type { ReportScreenshot } from "../types";
import { ReportOverlay } from "./ReportDialog";
import { HelpMenu, ReportBackstageItem } from "./ribbon";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PNG_B64 = btoa("\x89PNG\r\n\x1a\n0000");

function setup(responses: Response[], capture: () => Promise<ReportScreenshot | null> = async () => ({ name: "window.png", mime: "image/png", dataBase64: PNG_B64 })) {
  const sent: Record<string, unknown>[] = [];
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
  const c = new ReportController({
    storage,
    env: () => ({ userAgent: "UA", platform: "Linux", width: 1024, height: 768 }),
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return responses.shift() ?? json(500, {});
    },
    capture,
  });
  render(<ReportOverlay host={{ kind: "wasm", ping: async () => "Rusuite Write 0.1.0" }} controller={c} />);
  c.setDocStats(() => ({ blocks: 5 }));
  act(() => c.open());
  return { c, sent };
}

function fill() {
  fireEvent.change(screen.getByTestId("report-title"), { target: { value: "Borders vanish" } });
  fireEvent.change(screen.getByTestId("report-description"), { target: { value: "Table borders are gone after saving the file." } });
}

describe("ReportDialog", () => {
  it("submit stays disabled until 'I understand' is ticked", () => {
    setup([]);
    fill();
    const submit = screen.getByTestId("report-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("report-public")).textContent).toContain("posted publicly at github.com/refaustria/rusuite/issues");
    fireEvent.click(screen.getByTestId("report-understood"));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows field errors instead of sending an incomplete report", async () => {
    const { sent } = setup([]);
    fireEvent.click(screen.getByTestId("report-understood"));
    fireEvent.click(screen.getByTestId("report-submit"));
    expect(await screen.findByText("Enter a title (up to 120 characters).")).toBeTruthy();
    expect(screen.getByText("Describe it in at least 20 characters (up to 4000).")).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("the diagnostics preview is exactly what is sent", async () => {
    const { sent } = setup([json(201, { number: 3, url: "https://github.com/o/r/issues/3" })]);
    fill();
    const preview = JSON.parse(screen.getByTestId("report-diagnostics-preview").textContent ?? "");
    expect(preview).toEqual({ userAgent: "UA", viewport: { width: 1024, height: 768 }, docStats: { blocks: 5 } });
    fireEvent.click(screen.getByTestId("report-understood"));
    fireEvent.click(screen.getByTestId("report-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.diagnostics).toEqual(preview);
    expect(sent[0]).toMatchObject({ app: "write", kind: "bug", title: "Borders vanish" });
  });

  it("no diagnostics when unticked", async () => {
    const { sent } = setup([json(201, { number: 3, url: "https://github.com/o/r/issues/3" })]);
    fill();
    fireEvent.click(screen.getByTestId("report-diagnostics"));
    expect(screen.queryByTestId("report-diagnostics-preview")).toBeNull();
    fireEvent.click(screen.getByTestId("report-understood"));
    fireEvent.click(screen.getByTestId("report-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect("diagnostics" in sent[0]!).toBe(false);
  });

  it("success card with the issue link (an anchor) and the wait time", async () => {
    setup([json(201, { number: 42, url: "https://github.com/o/r/issues/42", warnings: ["screenshots not attached"] })]);
    fill();
    fireEvent.click(screen.getByTestId("report-understood"));
    fireEvent.click(screen.getByTestId("report-submit"));
    expect(await screen.findByText("Thank you! Your report is issue #42.")).toBeTruthy();
    const link = screen.getByTestId("report-issue-link");
    expect(link.tagName).toBe("A");
    expect((link).getAttribute("href")).toBe("https://github.com/o/r/issues/42");
    expect((link).getAttribute("rel")).toBe("noopener noreferrer");
    expect((screen.getByTestId("report-warning")).textContent).toContain("The screenshots could not be attached.");
    expect((screen.getByTestId("report-wait")).textContent).toContain("You can send another report in 60 min.");
  });

  it("429 shows the retry time and disables submit", async () => {
    setup([json(429, { retryAfterSeconds: 43 * 60 })]);
    fill();
    fireEvent.click(screen.getByTestId("report-understood"));
    fireEvent.click(screen.getByTestId("report-submit"));
    expect((await screen.findByTestId("report-error")).textContent).toContain("Too many reports – you can send another report in 43 min.");
    expect((screen.getByTestId("report-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("502 says GitHub did not accept it and keeps the text", async () => {
    setup([json(502, { error: "GitHub did not accept the report" })]);
    fill();
    fireEvent.click(screen.getByTestId("report-understood"));
    fireEvent.click(screen.getByTestId("report-submit"));
    expect((await screen.findByTestId("report-error")).textContent).toContain("GitHub did not accept the report – try again later.");
    expect((screen.getByTestId("report-title") as HTMLInputElement).value).toBe("Borders vanish");
    expect((screen.getByTestId("report-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("captures the window, previews and removes a screenshot", async () => {
    const { sent } = setup([json(201, { number: 1, url: "https://github.com/o/r/issues/1" })]);
    fireEvent.click(screen.getByTestId("report-capture"));
    const img = await screen.findByRole("img", { name: "window.png" });
    expect(img.getAttribute("src")).toBe(`data:image/png;base64,${PNG_B64}`);
    fireEvent.click(screen.getByRole("button", { name: "Remove window.png" }));
    expect(screen.queryByRole("img", { name: "window.png" })).toBeNull();
    fireEvent.click(screen.getByTestId("report-capture"));
    await screen.findByRole("img", { name: "window.png" });
    fill();
    fireEvent.click(screen.getByTestId("report-understood"));
    fireEvent.click(screen.getByTestId("report-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.screenshots).toEqual([{ name: "window.png", mime: "image/png", dataBase64: PNG_B64 }]);
  });

  it("refuses a picked file that is not PNG or JPEG", async () => {
    setup([]);
    const file = new File(["GIF89a"], "anim.gif", { type: "image/gif" });
    fireEvent.change(screen.getByTestId("report-file"), { target: { files: [file] } });
    expect((await screen.findByTestId("report-shot-error")).textContent).toContain("anim.gif: only PNG or JPEG images can be added.");
  });

  it("steps only for bugs", () => {
    setup([]);
    expect(screen.getByTestId("report-steps")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Question"));
    expect(screen.queryByTestId("report-steps")).toBeNull();
  });

  it("the ? Help menu opens the dialog", () => {
    const c = new ReportController({ storage: null, env: () => ({ userAgent: "UA", platform: "", width: 1, height: 1 }) });
    render(
      <>
        <HelpMenu controller={c} docStats={() => ({ cells: 9 })} />
        <ReportOverlay controller={c} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Report a problem…/ }));
    expect(screen.getByTestId("report-dialog")).toBeTruthy();
    expect(c.getState().diagnostics?.docStats).toEqual({ cells: 9 });
  });

  it("the mobile shells offer no Report a problem (Help menu, File, the ⋯ sheet); open() does nothing there", () => {
    const c = new ReportController({ storage: null, env: () => ({ userAgent: "UA", platform: "", width: 1, height: 1 }) });
    expect(reportAvailable()).toBe(true);
    vi.stubGlobal("__RUSUITE_MOBILE__", "android");
    expect(reportAvailable()).toBe(false);
    const pick = vi.fn();
    render(
      <>
        <HelpMenu controller={c} />
        <ul data-testid="file-items">
          <ReportBackstageItem pick={pick} controller={c} />
        </ul>
        <TopBar accent="#000" />
        <ReportOverlay controller={c} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByRole("menuitem", { name: /Report a problem/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeTruthy();
    expect(screen.getByTestId("file-items").childElementCount).toBe(0);
    fireEvent.click(screen.getByTestId("compact-more"));
    expect(screen.getByTestId("compact-more-sheet").textContent).not.toContain("Report a problem");
    act(() => c.open());
    expect(screen.queryByTestId("report-dialog")).toBeNull();
  });
});
