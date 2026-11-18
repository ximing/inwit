import { describe, it, expect } from "vitest";
import { paragraphsFromRuns, type TextRun } from "./paragraph-logic.js";
import {
  localToViewport,
  viewportToLocal,
  pointInQuad,
  type PageGeometry,
} from "./geometry-logic.js";
const run = (
  text: string,
  x: number,
  y: number,
  width = 200,
  height = 10,
): TextRun => ({ text, x, y, width, height, font: "body" });
describe("paragraph reconstruction", () => {
  it("keeps close two-column lines independent", () => {
    const runs = [];
    for (let i = 0; i < 5; i++) {
      runs.push(
        run(
          "Left column sentence containing several words.",
          70,
          700 - i * 12,
          230,
        ),
      );
      runs.push(
        run(
          "Right column sentence containing several words.",
          315,
          700 - i * 12,
          230,
        ),
      );
    }
    const result = paragraphsFromRuns(runs, 612, 792).filter(
      (p) => p.qualityState === "reliable",
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.sourceText).not.toContain("Right");
    expect(result[1]!.sourceText).not.toContain("Left");
  });
  it("attaches small superscript citations without splitting the paragraph", () => {
    const result = paragraphsFromRuns(
      [
        run("A long discussion introducing prior work", 70, 700),
        run("+", 272, 704, 4, 6),
        run("and explaining its scientific implications.", 70, 688),
      ],
      612,
      792,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.sourceText).toContain("+");
    expect(result[0]!.rects).toHaveLength(2);
  });
  it("does not make scanned pages into clickable paragraphs", () =>
    expect(paragraphsFromRuns([], 612, 792)).toEqual([]));
  it("degrades ambiguous complex mathematical text", () => {
    const result = paragraphsFromRuns(
      [
        run("The result uses the fraction 1√x in this equation.", 70, 700),
        run("This continuation explains the resulting value.", 70, 688),
      ],
      612,
      792,
    );
    expect(result[0]!.qualityState).toBe("unsupported");
  });
});
describe("coordinate identity", () => {
  const geometry: PageGeometry = {
    coordinateVersion: "crop-local-points-v1",
    cropBox: [30, 40, 580, 750],
    userUnit: 2,
    intrinsicRotation: 90,
    width: 1100,
    height: 1420,
  };
  it("roundtrips every viewer rotation and zoom", () => {
    for (const rotation of [0, 90, 180, 270])
      for (const scale of [0.5, 1, 3.25]) {
        const p = { x: 156, y: 1290 };
        expect(
          viewportToLocal(
            localToViewport(p, geometry, scale, rotation),
            geometry,
            scale,
            rotation,
          ),
        ).toEqual(p);
      }
  });
  it("hits line quadrilaterals but not inter-column whitespace", () => {
    const q = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: 0, y: 10 },
    ] as const;
    expect(pointInQuad({ x: 50, y: 5 }, [...q])).toBe(true);
    expect(pointInQuad({ x: 110, y: 5 }, [...q])).toBe(false);
  });
});
