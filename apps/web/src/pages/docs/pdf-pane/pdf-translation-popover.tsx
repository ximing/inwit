import { observer, useService } from "@rabjs/react";
import { MoreHorizontal, X, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { settingsPath } from "@/routes.js";
import { PdfTranslationService } from "./pdf-translation.service.js";
import { floatingPosition } from "./translation-geometry-logic.js";
const errorMessages: Record<string, string> = {
  LLM_OUTPUT_TRUNCATED:
    "模型输出达到上限，未生成完整译文。可手动重试或更换翻译模型。",
  PDF_TRANSLATION_CREDENTIAL_OR_DOCUMENT_UNAVAILABLE:
    "翻译模型凭据或原文件已不可用，请检查设置后重新开始。",
  PDF_TRANSLATION_CONTEXT_TOO_LARGE: "原文超出模型上下文，请缩小选区。",
  LLM_AUTH_FAILED: "翻译模型身份验证失败，请检查设置。",
};
const messages: Record<string, string> = {
  queued: "等待翻译…",
  preparing: "准备翻译…",
  dispatched: "正在翻译…",
  failed: "翻译未完成，可手动重试",
  unknown: "供应商是否完成尚不确定，重新翻译可能重复计费",
  cancelled: "翻译已停止，可重新开始",
};
export const PdfTranslationPopover = observer(function PdfTranslationPopover() {
  const s = useService(PdfTranslationService);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    docked: boolean;
    maxHeight: number;
    restoreLeft: number;
    restoreTop: number;
  } | null>(null);
  const focusSource = () => {
    const key = s.target?.key;
    if (key)
      document
        .querySelector<HTMLElement>(
          `[data-translation-focus="${CSS.escape(key)}"]`,
        )
        ?.focus({ preventScroll: true });
  };
  const close = () => {
    focusSource();
    s.close();
  };
  useEffect(() => {
    const onVisibility = () => s.visibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [s]);
  useEffect(() => {
    if (!s.target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (s.menu) s.menu = false;
        else close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    let frame = 0;
    let hadAnchor = false;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const pop = ref.current,
          reader = pop?.closest(".pdf-doc-body");
        if (!pop || !reader || !s.target) return;
        const r = reader.getBoundingClientRect();
        const viewport =
          reader.querySelector(".pdf-viewport")?.getBoundingClientRect() ?? r;
        const anchors = [
          ...reader.querySelectorAll<HTMLElement>(
            `[data-pdf-segment="${CSS.escape(s.target.key)}"]`,
          ),
        ];
        const rects = anchors.map((el) => el.getBoundingClientRect());
        const first = rects[0];
        if (first) hadAnchor = true;
        else if (hadAnchor) {
          s.close();
          return;
        }
        if (
          first &&
          rects.every(
            (a) =>
              a.bottom < viewport.top ||
              a.top > viewport.bottom ||
              a.right < viewport.left ||
              a.left > viewport.right,
          )
        ) {
          s.close();
          return;
        }
        const pageBox = anchors[0]
          ?.closest(".pdf-page")
          ?.getBoundingClientRect();
        const anchor = first
          ? {
              left: Math.min(...rects.map((a) => a.left)),
              right: Math.max(...rects.map((a) => a.right)),
              top: Math.max(viewport.top, Math.min(...rects.map((a) => a.top))),
              bottom: Math.min(
                viewport.bottom,
                Math.max(...rects.map((a) => a.bottom)),
              ),
            }
          : {
              left: r.left,
              right: r.right,
              top: r.top + 60,
              bottom: r.top + 80,
            };
        const contentHeight =
          s.hidden ||
          (s.result?.job &&
            ["queued", "preparing", "dispatched"].includes(s.result.job.state))
            ? 420
            : Math.min(
                480,
                Array.from(pop.children).reduce(
                  (sum, child) => sum + (child as HTMLElement).scrollHeight,
                  0,
                ) + 8,
              );
        const next = floatingPosition(
          anchor,
          {
            left: Math.max(r.left, 0),
            right: Math.min(r.right, window.innerWidth),
            top: Math.max(viewport.top, r.top + 40, 0),
            bottom: Math.min(viewport.bottom, r.bottom, window.innerHeight),
          },
          { page: pageBox, height: Math.max(180, contentHeight) },
        );
        setPosition({
          ...next,
          restoreLeft: Math.max(
            r.left + 8,
            Math.min(r.right, window.innerWidth) - 158,
          ),
          restoreTop: Math.max(r.top + 4, 4),
        });
      });
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    const observer = new ResizeObserver(update);
    if (ref.current?.parentElement) observer.observe(ref.current.parentElement);
    if (ref.current) observer.observe(ref.current);
    const mutations = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            !(r.target instanceof Element) ||
            !r.target.closest(".pdf-translation-popover"),
        )
      )
        update();
    });
    if (ref.current?.parentElement)
      mutations.observe(ref.current.parentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: ["style"],
      });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [s, s.target?.key, s.menu, s.hidden, s.result?.translation?.id]);
  useEffect(() => {
    if (s.target)
      ref.current
        ?.querySelector<HTMLButtonElement>(
          s.hidden ? "[data-restore-translation]" : "[data-view-original]",
        )
        ?.focus({ preventScroll: true });
  }, [s.hidden]);
  if (!s.target) return null;
  const translation = s.result?.translation;
  const job = s.result?.job;
  const running =
    job && ["queued", "preparing", "dispatched"].includes(job.state);
  const usage = translation?.usage;
  return (
    <div
      ref={ref}
      className={`pdf-translation-popover${s.hidden ? " is-peeking" : ""}${position?.docked ? " is-docked" : ""}`}
      role="region"
      aria-label="段落中文译文"
      style={
        position
          ? {
              left: s.hidden ? position.restoreLeft : position.left,
              top: s.hidden ? position.restoreTop : position.top,
              width: s.hidden ? 150 : position.width,
              maxHeight: s.hidden ? 36 : position.maxHeight,
            }
          : undefined
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {s.hidden ? (
        <>
          <button
            type="button"
            data-restore-translation
            className="btn btn-secondary"
            onClick={() => {
              s.hidden = false;
            }}
          >
            恢复译文
          </button>
          <button
            type="button"
            className="pdf-tool"
            aria-label="收起中文"
            onClick={close}
          >
            <X size={16} />
          </button>
        </>
      ) : (
        <>
          <header>
            <span>
              第 {s.target.pageIndex + 1} 页
              {translation ? (running ? " · 原译文已保存" : " · 已保存") : ""}
            </span>
            <button className="pdf-tool" aria-label="收起中文" onClick={close}>
              <X size={16} />
            </button>
          </header>
          <div className="pdf-translation-actions">
            <button
              className="btn btn-ghost"
              data-view-original
              onClick={() => {
                s.menu = false;
                s.hidden = true;
              }}
            >
              <Eye size={14} />
              查看原文
            </button>
            <button
              className="pdf-tool"
              aria-label="译文详情与重新翻译"
              aria-expanded={s.menu}
              onClick={() => {
                s.menu = !s.menu;
              }}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
          {!s.hidden && (
            <div className="pdf-translation-text" tabIndex={0}>
              {translation ? (
                <>
                  {running || job?.draft?.text ? (
                    <p className="meta">原译文</p>
                  ) : null}
                  <p>{translation.translatedText}</p>
                </>
              ) : null}
              {job?.draft?.text && job.state !== "succeeded" ? (
                <div
                  data-translation-draft
                  style={{ minHeight: running ? 120 : undefined }}
                >
                  <p className="meta">
                    {running
                      ? translation
                        ? "新译文生成中，尚未保存"
                        : "翻译中，尚未保存"
                      : "以下为未完成内容，未保存为译文"}
                  </p>
                  <p style={{ whiteSpace: "pre-wrap" }}>{job.draft.text}</p>
                </div>
              ) : null}
              {running && s.streamStatus === "polling" ? (
                <p className="meta">正在同步翻译进度…</p>
              ) : null}
              <p role="status">
                {s.error ||
                  (!translation ||
                  running ||
                  (job &&
                    ["failed", "unknown", "cancelled"].includes(job.state))
                    ? ((job?.errorCode ? errorMessages[job.errorCode] : null) ??
                      messages[job?.state ?? "preparing"] ??
                      "")
                    : s.busy
                      ? "正在提交…"
                      : "")}
              </p>
              {s.needsSettings ? (
                <Link
                  to={settingsPath("translation")}
                  state={{ fromPdfDocumentId: s.documentId }}
                >
                  设置翻译模型
                </Link>
              ) : null}
              {!s.needsSettings &&
              (s.error ||
                (!running &&
                  job &&
                  ["failed", "unknown", "cancelled"].includes(job.state))) ? (
                <button
                  className="btn"
                  disabled={s.busy}
                  onClick={() => void s.retry()}
                >
                  {running
                    ? "刷新状态"
                    : job?.state === "unknown"
                      ? "重新翻译（可能重复计费）"
                      : job?.state === "cancelled"
                        ? "重新开始"
                        : "重试"}
                </button>
              ) : null}
            </div>
          )}
          {s.menu && (
            <div className="pdf-translation-details">
              <p>
                {translation
                  ? `${translation.model.provider} · ${translation.model.model}`
                  : "尚无已保存译文"}
              </p>
              {usage ? (
                <p>
                  {usage.usageStatus === "unknown"
                    ? "生成用量未知"
                    : `输入 ${usage.inputTokens ?? "未知"} / 输出 ${usage.outputTokens ?? "未知"} token`}
                  {s.result?.cacheHit ? " · 本次查看用量 0" : ""}
                </p>
              ) : null}
              <p>
                重新翻译会调用当前翻译模型，产生新的用量。成功后替换当前译文。
              </p>
              <button
                className="btn"
                disabled={!translation || !!running || s.busy}
                onClick={() => void s.regenerate()}
              >
                重新翻译
              </button>
            </div>
          )}
          <footer>
            <button className="btn btn-ghost" onClick={close}>
              收起
            </button>
          </footer>
        </>
      )}
    </div>
  );
});
