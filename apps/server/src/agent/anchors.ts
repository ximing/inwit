export function buildAssociationHint(concepts: string[]): string | null {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of concepts) {
    const concept = raw.replace(/\s+/g, ' ').trim();
    if (!concept || seen.has(concept)) continue;
    seen.add(concept);
    unique.push(concept);
  }
  if (unique.length === 0) return null;
  const shown = unique.slice(0, 3);
  if (shown.length === 1) {
    return `这和你学过的「${shown[0]}」是一回事的两种说法。`;
  }
  return `这和你学过的${shown.map((item) => `「${item}」`).join('、')}是一回事的两种说法。`;
}
