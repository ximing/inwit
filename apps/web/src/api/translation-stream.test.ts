import { afterEach, describe, expect, it, vi } from "vitest";
import { streamTranslationJob } from "./translation.js";
import { setUnauthorizedHandler } from "./client.js";
afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});
const frame = (text: string, seq: string) =>
  `:heartbeat\r\nevent: snapshot\r\ndata: ${JSON.stringify({ id: "job", state: "dispatched", draft: { streamId: "stream", seq, text, updatedAt: "" } })}\r\n\r\n`;
describe("translation SSE transport", () => {
  it("decodes UTF-8 across byte boundaries and preserves complete snapshots", async () => {
    const bytes = new TextEncoder().encode(
      frame("中文🙂", "9007199254740993") +
        frame("中文🙂完成", "9007199254740994"),
    );
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
            c.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const seen: string[] = [];
    await streamTranslationJob(
      "doc",
      "job",
      new AbortController().signal,
      (j) => seen.push(j.draft!.text),
    );
    expect(seen).toEqual(["中文🙂", "中文🙂完成"]);
    expect(fetch.mock.calls[0]![1].credentials).toBe("include");
    expect(fetch.mock.calls[0]![1].method).toBeUndefined();
  });
  it("rejects a different job instead of routing it into the current paragraph", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(frame("wrong", "1").replace('"job"', '"other"'), {
            headers: { "Content-Type": "text/event-stream" },
          }),
        ),
    );
    await expect(
      streamTranslationJob("doc", "job", new AbortController().signal, vi.fn()),
    ).rejects.toThrow("Invalid translation snapshot");
  });
  it("expires auth without retrying a request", async () => {
    const clear = vi.fn();
    setUnauthorizedHandler(clear);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('event: error\ndata: {"code":"AUTH_EXPIRED"}\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      streamTranslationJob("doc", "job", new AbortController().signal, vi.fn()),
    ).rejects.toMatchObject({ status: 401 });
    expect(clear).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
