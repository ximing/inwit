import type { Quad } from "./geometry-logic.js";
export type TextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
};
export type Paragraph = {
  sourceText: string;
  rects: Quad[];
  qualityState: "reliable" | "unsupported";
};
type Line = {
  text: string;
  x: number;
  right: number;
  y: number;
  height: number;
  fonts: Set<string>;
};
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
export function paragraphsFromRuns(
  runs: TextRun[],
  width: number,
  height: number,
): Paragraph[] {
  const useful = runs.filter(
    (r) => r.text.trim() && r.width > 0 && r.height > 0,
  );
  if (!useful.length) return [];
  const fontSize =
    median(useful.filter((r) => r.text.length > 10).map((r) => r.height)) ||
    median(useful.map((r) => r.height));
  const longRuns = useful.filter((r) => r.text.length > 30);
  const leftRuns = longRuns.filter((r) => r.x < width * 0.45);
  const rightRuns = longRuns.filter(
    (r) => r.x > width * 0.45 && r.x < width * 0.65,
  );
  const rawSplit =
    leftRuns.length >= 4 &&
    rightRuns.length >= 4 &&
    median(leftRuns.map((r) => r.x + r.width)) <
      median(rightRuns.map((r) => r.x))
      ? (median(leftRuns.map((r) => r.x + r.width)) +
          median(rightRuns.map((r) => r.x))) /
        2
      : null;
  const rows: TextRun[][] = [];
  const primary = useful.filter((r) => r.height >= fontSize * 0.85);
  for (const run of [...primary].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0]!.y - run.y) < fontSize * 0.3);
    if (row) row.push(run);
    else rows.push([run]);
  }
  for (const run of useful.filter((r) => r.height < fontSize * 0.85)) {
    const nearest = [...rows].sort(
      (a, b) => Math.abs(a[0]!.y - run.y) - Math.abs(b[0]!.y - run.y),
    )[0];
    if (nearest && Math.abs(nearest[0]!.y - run.y) < fontSize * 0.8)
      nearest.push(run);
    else rows.push([run]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    const baseline = row[0]!.y;
    let line: Line | undefined;
    for (const r of row.sort((a, b) => a.x - b.x)) {
      const gap = line ? r.x - line.right : 0;
      if (
        !line ||
        gap > fontSize * 1.5 ||
        (rawSplit !== null && line.right < rawSplit && r.x > rawSplit)
      ) {
        line = {
          text: r.text,
          x: r.x,
          right: r.x + r.width,
          y: baseline,
          height: r.height,
          fonts: new Set([r.font]),
        };
        lines.push(line);
      } else {
        line.text +=
          (gap > fontSize * 0.13 &&
          !line.text.endsWith(" ") &&
          !r.text.startsWith(" ")
            ? " "
            : "") + r.text;
        line.right = Math.max(line.right, r.x + r.width);
        line.height = Math.max(line.height, r.height);
        line.fonts.add(r.font);
      }
    }
  }
  const proseLines = lines.filter(
    (l) =>
      l.text.length > 25 &&
      l.height >= fontSize * 0.94 &&
      l.height <= fontSize * 1.15,
  );
  const anchors: number[] = [];
  for (const line of [...proseLines].sort((a, b) => a.x - b.x)) {
    if (!anchors.some((x) => Math.abs(x - line.x) < fontSize * 2.5))
      anchors.push(line.x);
  }
  const columns = anchors.map((x) =>
    lines.filter((l) => {
      const nearest = [...anchors].sort(
        (a, b) => Math.abs(a - l.x) - Math.abs(b - l.x),
      )[0];
      return nearest === x && Math.abs(l.x - x) < fontSize * 2.5;
    }),
  );
  const abstractY = lines.find((l) => /^abstract$/i.test(l.text.trim()))?.y;
  const result: Paragraph[] = [];
  for (const column of columns) {
    const ordered = column.sort((a, b) => b.y - a.y || a.x - b.x);
    const main = ordered.filter(
      (l) =>
        l.text.length > 35 && Math.abs(l.height - fontSize) < fontSize * 0.15,
    );
    const left = median(main.map((l) => l.x)),
      right = median(main.map((l) => l.right));
    const gaps = main
      .slice(1)
      .map((l, i) => main[i]!.y - l.y)
      .filter((g) => g > fontSize * 0.8 && g < fontSize * 1.8);
    const leading = median(gaps) || fontSize * 1.2;
    let group: Line[] = [];
    let references = false;
    const flush = () => {
      if (!group.length) return;
      const text = group.map((l) => l.text.trim()).join("\n");
      const good =
        !/[∫\u0000-\u001f]|1√|√1/.test(text.replace(/\n/g, " ")) &&
        !references &&
        ((group.length >= 2 && text.length > 60) ||
          (group.length === 1 && text.length > 25 && /[.!?:]$/.test(text))) &&
        group.every(
          (l) => l.height >= fontSize * 0.94 && l.height <= fontSize * 1.15,
        ) &&
        !/^(Figure|Fig\.|Table|Algorithm|References|Bibliography)\b/i.test(
          text,
        ) &&
        (text.match(/[a-zA-Z]/g)?.length ?? 0) / text.length > 0.55;
      result.push({
        sourceText: text,
        rects: group.map((l) => [
          { x: l.x, y: l.y - l.height * 0.22 },
          { x: l.right, y: l.y - l.height * 0.22 },
          { x: l.right, y: l.y + l.height * 0.83 },
          { x: l.x, y: l.y + l.height * 0.83 },
        ]),
        qualityState: good ? "reliable" : "unsupported",
      });
      group = [];
    };
    for (const line of ordered) {
      if (/^(References|Bibliography)\s*$/.test(line.text.trim())) {
        flush();
        references = true;
      }
      if (
        /^\d+(?:\.\d+)*\s+[A-Z]/.test(line.text) &&
        line.text.length < 120 &&
        !/[.!?]$/.test(line.text)
      ) {
        flush();
        group.push(line);
        flush();
        continue;
      }
      const prev = group.at(-1);
      if (
        prev &&
        (prev.y - line.y > leading * 1.28 ||
          Math.abs(prev.height - line.height) > fontSize * 0.15 ||
          (line.x > left + fontSize * 0.65 &&
            line.x > prev.x + fontSize * 0.65 &&
            !/^[•●]/.test(prev.text)))
      )
        flush();
      if (
        line.y < height * 0.045 ||
        line.y > height * 0.965 ||
        (abstractY !== undefined && line.y > abstractY)
      ) {
        flush();
        continue;
      }
      group.push(line);
    }
    flush();
  }
  result.sort(
    (a, b) =>
      Number(a.rects[0]![0].x > width * 0.45) -
        Number(b.rects[0]![0].x > width * 0.45) ||
      b.rects[0]![0].y - a.rects[0]![0].y,
  );
  for (let i = 0; i < result.length; i++) {
    const a = result[i]!;
    const last = a.rects.at(-1)!;
    if (
      a.qualityState !== "reliable" ||
      last[0].y >= height * 0.2 ||
      /[.!?:][”"’)]?\s*$/.test(a.sourceText)
    )
      continue;
    const candidates = result
      .map((p, index) => ({ p, index }))
      .filter(
        ({ p, index }) =>
          index > i &&
          p.rects[0]![0].x > last[0].x + width * 0.2 &&
          p.rects[0]![0].y > last[0].y + height * 0.3 &&
          (p.qualityState === "reliable" ||
            (p.rects.length === 1 &&
              p.sourceText.length > 25 &&
              /[.!?]$/.test(p.sourceText))) &&
          !/^(Figure|Table|Fig\.)/.test(p.sourceText),
      );
    candidates.sort((a, b) => b.p.rects[0]![0].y - a.p.rects[0]![0].y);
    const match = candidates[0];
    if (match) {
      a.sourceText += "\n" + match.p.sourceText;
      a.rects.push(...match.p.rects);
      result.splice(match.index, 1);
    }
  }
  for (let i = 0; i < result.length - 1; i++) {
    const a = result[i]!,
      b = result[i + 1]!;
    const last = a.rects.at(-1)!,
      first = b.rects[0]!;
    const close =
      Math.abs(last[2].y - last[0].y - (first[2].y - first[0].y)) <
        fontSize * 0.06 &&
      last[0].y - first[0].y < fontSize * 1.8 &&
      last[0].y >= first[0].y &&
      Math.abs(last[0].x - first[0].x) < width * 0.3;
    if (
      close &&
      !/[.!?:][”"’)]?\s*$/.test(a.sourceText) &&
      /^[a-z0-9(]/.test(b.sourceText.trim())
    ) {
      a.qualityState = "unsupported";
      b.qualityState = "unsupported";
    }
  }
  return result;
}
