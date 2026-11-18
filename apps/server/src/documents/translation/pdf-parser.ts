import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { paragraphsFromRuns, type TextRun } from "./paragraph-logic.js";
import { pdfToLocal, type PageGeometry } from "./geometry-logic.js";
export const PDF_PARSER_VERSION = "paragraph-v1";
export async function parsePdfPage(data: Uint8Array, pageIndex: number) {
  const task = getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= doc.numPages
    )
      throw new Error("PDF_PAGE_OUT_OF_RANGE");
    const page = await doc.getPage(pageIndex + 1);
    const cropBox = page.view as [number, number, number, number];
    const geometry: PageGeometry = {
      coordinateVersion: "crop-local-points-v1",
      cropBox,
      effectiveCropBox: cropBox,
      rawCropBox: null,
      userUnit: page.userUnit,
      intrinsicRotation: page.rotate as PageGeometry["intrinsicRotation"],
      width: (cropBox[2] - cropBox[0]) * page.userUnit,
      height: (cropBox[3] - cropBox[1]) * page.userUnit,
    };
    const content = await page.getTextContent();
    const runs: TextRun[] = [];
    let rotatedText = false;
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      if (
        Math.abs(item.transform[1]!) > 0.01 ||
        Math.abs(item.transform[2]!) > 0.01
      ) {
        rotatedText = true;
        continue;
      }
      const point = pdfToLocal(
        { x: item.transform[4]!, y: item.transform[5]! },
        geometry,
      );
      runs.push({
        text: item.str,
        ...point,
        width: item.width * page.userUnit,
        height: item.height * page.userUnit,
        font: item.fontName,
      });
    }
    // TeX extensible operators are positioned by their top rather than the prose baseline.
    // Anchor them to an immediate neighbouring full-size text run; never discard the glyph.
    for (const run of runs.filter((r) => /^[√∏∑]$/.test(r.text))) {
      const neighbours = runs.filter(
        (r) =>
          r !== run &&
          r.height >= run.height * 0.85 &&
          !/^[√∏∑]$/.test(r.text) &&
          Math.abs(r.y - run.y) < run.height &&
          (Math.abs(r.x + r.width - run.x) < run.height * 2 ||
            Math.abs(run.x + run.width - r.x) < run.height * 2),
      );
      neighbours.sort(
        (a, b) =>
          Math.min(
            Math.abs(a.x + a.width - run.x),
            Math.abs(run.x + run.width - a.x),
          ) -
          Math.min(
            Math.abs(b.x + b.width - run.x),
            Math.abs(run.x + run.width - b.x),
          ),
      );
      if (neighbours[0]) run.y = neighbours[0].y;
    }
    const paragraphs = paragraphsFromRuns(
      runs,
      geometry.width,
      geometry.height,
    );
    const segments = paragraphs.map((p, ordinal) => ({
      ...p,
      pageIndex,
      ordinal,
      textHash: createHash("sha256")
        .update(p.sourceText.replace(/\s+/g, " ").trim())
        .digest("hex"),
      id: createHash("sha256")
        .update(
          JSON.stringify([
            PDF_PARSER_VERSION,
            pageIndex,
            ordinal,
            p.sourceText,
            p.rects,
          ]),
        )
        .digest("hex"),
    }));
    return {
      pageIndex,
      geometry,
      segments,
      state: runs.length
        ? ("ready" as const)
        : rotatedText
          ? ("unsupported" as const)
          : ("no_text" as const),
      diagnostics: rotatedText ? ["ROTATED_TEXT_UNSUPPORTED"] : [],
    };
  } finally {
    await task.destroy();
  }
}

/** Metadata-only fallback: selection remains possible if paragraph reconstruction fails. */
export async function readPdfPageGeometry(
  data: Uint8Array,
  pageIndex: number,
): Promise<PageGeometry> {
  const task = getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= doc.numPages
    )
      throw new Error("PDF_PAGE_OUT_OF_RANGE");
    const page = await doc.getPage(pageIndex + 1);
    const cropBox = page.view as [number, number, number, number];
    return {
      coordinateVersion: "crop-local-points-v1",
      cropBox,
      effectiveCropBox: cropBox,
      rawCropBox: null,
      userUnit: page.userUnit,
      intrinsicRotation: page.rotate as PageGeometry["intrinsicRotation"],
      width: (cropBox[2] - cropBox[0]) * page.userUnit,
      height: (cropBox[3] - cropBox[1]) * page.userUnit,
    };
  } finally {
    await task.destroy();
  }
}
