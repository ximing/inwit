import { describe, it, expect } from "vitest";
import {
  anchorIdentity,
  sameSelection,
  identityHash,
  normalizedTranslationText,
  selectionWithinPage,
  translationContentKey,
} from "./translation-logic.js";
describe("translation identities", () => {
  it("preserves mathematical signs, hyphens and case while folding whitespace", () => {
    expect(normalizedTranslationText(" A-b\n  ≠ a-B ")).toBe("A-b ≠ a-B");
  });
  it("structured identities have no concatenation collision", () => {
    expect(identityHash(["ab", "c"])).not.toBe(identityHash(["a", "bc"]));
  });
  it("user/document/version are isolated, title and model are not content identity", () => {
    const v = {
      userId: "u",
      documentId: "d",
      fileRevision: "f",
      pageIndex: 0,
      sourceId: "s",
      text: "A",
    };
    expect(translationContentKey(v)).not.toBe(
      translationContentKey({ ...v, userId: "v" }),
    );
    expect(translationContentKey(v)).not.toBe(
      translationContentKey({ ...v, fileRevision: "g" }),
    );
  });
  it("anchors use stable PDF precision and reject cross-page/outside coordinates", () => {
    const q: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    expect(anchorIdentity([q])).toBe(
      anchorIdentity([q.map((p) => ({ ...p, x: p.x + 0.001 })) as typeof q]),
    );
    expect(selectionWithinPage([q], 10, 10)).toBe(true);
    expect(selectionWithinPage([q], 1, 1)).toBe(false);
  });
});

it("recognizes equivalent PDFium line boxes regardless of corner order/ascent; rejects another line", () => {
  const a: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ] = [
    { x: 10, y: 10 },
    { x: 100, y: 10 },
    { x: 100, y: 20 },
    { x: 10, y: 20 },
  ];
  const b = [...a]
    .reverse()
    .map((p) => ({ x: p.x + 0.5, y: p.y + 2 })) as typeof a;
  expect(sameSelection([a], [b])).toBe(true);
  expect(
    sameSelection([a], [b.map((p) => ({ ...p, y: p.y + 50 })) as typeof a]),
  ).toBe(false);
});
