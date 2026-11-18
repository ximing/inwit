// @vitest-environment happy-dom
import { act } from "react";
import type { PdfTranslationJob } from "@inwit/dto";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  hidden: false,
  menu: false,
  target: { key: "segment", pageIndex: 0 } as {
    key: string;
    pageIndex: number;
  } | null,
  result: {
    translation: {
      id: "saved",
      translatedText: "已缓存的中文译文",
      usage: { usageStatus: "unknown" },
      model: { provider: "openai", model: "model" },
    },
    job: null as PdfTranslationJob | null,
  },
  visibility: vi.fn(),
  close: vi.fn(),
  retry: vi.fn(),
  regenerate: vi.fn(),
  open: vi.fn(),
  error: "",
  needsSettings: false,
  busy: false,
}));
vi.mock("@rabjs/react", () => ({
  observer: (fn: unknown) => fn,
  useService: () => state,
}));
vi.mock("./pdf-translation.service.js", () => ({
  PdfTranslationService: class {},
}));
import { PdfTranslationPopover } from "./pdf-translation-popover.js";
let host: HTMLDivElement, mount: HTMLDivElement, root: Root;
const render = async () =>
  act(async () => root.render(<PdfTranslationPopover />));
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.hidden = false;
  state.menu = false;
  state.result.job = null;
  state.target = { key: "segment", pageIndex: 0 };
  host = document.createElement("div");
  host.className = "pdf-doc-body";
  host.innerHTML =
    '<div class="pdf-viewport"><div class="pdf-page"><button data-pdf-segment="segment" data-translation-focus="segment"></button></div></div>';
  host.getBoundingClientRect = () =>
    ({ left: 0, right: 1000, top: 0, bottom: 800 }) as DOMRect;
  host.querySelector<HTMLElement>(".pdf-viewport")!.getBoundingClientRect =
    () => ({ left: 0, right: 1000, top: 40, bottom: 800 }) as DOMRect;
  host.querySelector<HTMLElement>(".pdf-page")!.getBoundingClientRect = () =>
    ({ left: 100, right: 800, top: 40, bottom: 1000 }) as DOMRect;
  host.querySelector<HTMLElement>("[data-pdf-segment]")!.getBoundingClientRect =
    () => ({ left: 200, right: 600, top: 200, bottom: 400 }) as DOMRect;
  mount = document.createElement("div");
  host.append(mount);
  document.body.append(host);
  root = createRoot(mount);
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(20));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("removes the complete panel while peeking and restores cached content without a request", async () => {
  const view = host.querySelector<HTMLButtonElement>("[data-view-original]")!;
  await act(async () => view.click());
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(20));
  const compact = host.querySelector<HTMLElement>(
    ".pdf-translation-popover.is-peeking",
  )!;
  expect(compact).not.toBeNull();
  expect(compact.querySelector("header")).toBeNull();
  expect(compact.querySelector("footer")).toBeNull();
  expect(compact.querySelector(".pdf-translation-text")).toBeNull();
  expect(parseFloat(compact.style.top)).toBeLessThan(40);
  const restore = compact.querySelector<HTMLButtonElement>(
    "[data-restore-translation]",
  )!;
  expect(document.activeElement).toBe(restore);
  await act(async () => restore.click());
  await render();
  expect(host.querySelector(".pdf-translation-text")?.textContent).toContain(
    "已缓存的中文译文",
  );
  expect(state.open).not.toHaveBeenCalled();
  expect(state.retry).not.toHaveBeenCalled();
  expect(state.regenerate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    host.querySelector("[data-view-original]"),
  );
});
it("allows Escape from the compact restore entry and returns focus to the original", async () => {
  state.hidden = true;
  await render();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(state.close).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(
    host.querySelector("[data-translation-focus]"),
  );
});

it("shows new partial output separately from the saved translation and never renders model HTML", async () => {
  state.result.job = {
    id: "new-job",
    state: "dispatched",
    draft: {
      streamId: "stream",
      seq: "2",
      text: "<img src=x> 新译文",
      updatedAt: "2026-11-18",
    },
  } as PdfTranslationJob;
  await render();
  const partial = host.querySelector("[data-translation-draft]")!;
  expect(partial.textContent).toContain("尚未保存");
  expect(partial.textContent).toContain("<img src=x> 新译文");
  expect(partial.querySelector("img")).toBeNull();
  expect(host.querySelector(".pdf-translation-text")?.textContent).toContain(
    "已缓存的中文译文",
  );
  state.result.job = { ...state.result.job, state: "unknown" };
  await render();
  expect(host.querySelector("[data-translation-draft]")?.textContent).toContain(
    "未完成",
  );
  expect(host.querySelector(".pdf-translation-text")?.textContent).toContain(
    "已缓存的中文译文",
  );
});

it("explains output exhaustion without blaming input length and preserves the old saved result", async () => {
  state.result.job = {
    id: "new-job",
    state: "failed",
    errorCode: "LLM_OUTPUT_TRUNCATED",
  } as PdfTranslationJob;
  await render();
  const status = host.querySelector('[role="status"]')!;
  expect(status.textContent).toContain("模型输出达到上限");
  expect(status.textContent).not.toContain("缩小选区");
  expect(host.textContent).toContain("已缓存的中文译文");
  expect(state.retry).not.toHaveBeenCalled();
  expect(state.regenerate).not.toHaveBeenCalled();
});
