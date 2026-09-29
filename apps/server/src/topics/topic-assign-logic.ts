/**
 * Pick a topic for a digested document the user did not file by hand.
 * Rerank scores are only comparable inside one request, so the candidate list
 * always includes an abstain dossier. A topic wins when it leads that list by
 * a clear margin, not because its absolute score looks high.
 */

export const TOPIC_ASSIGN_MARGIN = 0.12;
/** Floor on the winner. Scores are relative, but a low winner is still a weak match. */
export const TOPIC_ASSIGN_MIN_RELEVANCE = 0.5;
export const TOPIC_ASSIGN_ABSTAIN_ID = '__abstain__';
export const TOPIC_ASSIGN_ABSTAIN_TEXT =
  '留在未归属。这份材料讲的不是任何一门已有的课，和现有主题都对不上。';
export const TOPIC_ASSIGN_MAX_TOPICS = 30;
export const TOPIC_ASSIGN_MAX_HITS_PER_SOURCE = 3;

const QUERY_CHARS = 800;
const CONCEPTS_IN_QUERY = 8;
const CONCEPT_CHARS = 80;
const DOSSIER_CHARS = 480;
const NODE_TITLES = 12;
const DOSSIER_CONCEPTS = 6;
const MIN_QUERY_CHARS = 4;
const HIT_TIE_MIN = 3;

export interface TopicHit {
  topicId: string;
  hitCount: number;
  hitScore: number;
}

export interface ScoredTopicHit {
  topicId: string | null;
  /** Document that produced the hit, so one source cannot flood the vote. */
  sourceId: string;
  score: number | null;
}

export interface TopicRelevance {
  topicId: string;
  relevance: number | null;
}

export type TopicAssignReason = 'rerank' | 'rerank_hits' | 'hits';

export interface TopicChoice {
  topicId: string;
  reason: TopicAssignReason;
  relevance: number | null;
  abstain: number | null;
  runnerUp: number | null;
  hitCount: number;
}

function clip(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, Math.max(0, max)).join('');
}

function uniqueTrimmed(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function buildAssignmentQuery(input: {
  title: string | null;
  description: string | null;
  concepts: readonly string[];
}): string {
  const title = (input.title ?? '').trim();
  const description = (input.description ?? '').trim();
  const concepts = input.concepts
    .map((concept) => clip(concept.trim(), CONCEPT_CHARS))
    .filter((concept) => concept.length > 0)
    .slice(0, CONCEPTS_IN_QUERY);
  const parts = [title, description];
  if (concepts.length > 0) parts.push(concepts.join('；'));
  return clip(
    parts.filter((part) => part.length > 0).join('\n'),
    QUERY_CHARS,
  );
}

export function assignmentQueryUsable(query: string): boolean {
  return [...query.trim()].length >= MIN_QUERY_CHARS;
}

export function buildTopicDossier(input: {
  title: string;
  goal: string | null;
  nodeTitles: readonly string[];
  concepts: readonly string[];
}): string {
  const lines = [input.title.trim()];
  const goal = (input.goal ?? '').trim();
  if (goal) lines.push(clip(goal, 200));
  const nodes = uniqueTrimmed(input.nodeTitles, NODE_TITLES);
  if (nodes.length > 0) lines.push(nodes.join('、'));
  const concepts = uniqueTrimmed(input.concepts, DOSSIER_CONCEPTS);
  if (concepts.length > 0) lines.push(concepts.join('；'));
  return clip(
    lines.filter((line) => line.length > 0).join('\n'),
    DOSSIER_CHARS,
  );
}

/** At most a few hits per source document, so one note cannot outvote a topic. */
export function accumulateTopicHits(hits: readonly ScoredTopicHit[]): TopicHit[] {
  const perSource = new Map<string, number>();
  const totals = new Map<string, TopicHit>();
  for (const hit of hits) {
    if (!hit.topicId) continue;
    const seen = perSource.get(hit.sourceId) ?? 0;
    if (seen >= TOPIC_ASSIGN_MAX_HITS_PER_SOURCE) continue;
    perSource.set(hit.sourceId, seen + 1);
    const prev = totals.get(hit.topicId) ?? { topicId: hit.topicId, hitCount: 0, hitScore: 0 };
    const weight = finite(hit.score) && hit.score > 0 ? hit.score : 0.01;
    prev.hitCount += 1;
    prev.hitScore += weight;
    totals.set(hit.topicId, prev);
  }
  return [...totals.values()];
}

/** Hits only discriminate when at least two topics actually showed up. */
export function hitsAreInformative(hits: readonly TopicHit[]): boolean {
  return hits.filter((hit) => hit.hitCount > 0).length >= 2;
}

export function shortlistTopics<T extends { id: string; title: string }>(
  topics: readonly T[],
  hitScore: ReadonlyMap<string, number>,
  query: string,
  limit = TOPIC_ASSIGN_MAX_TOPICS,
): T[] {
  if (topics.length <= limit) return [...topics];
  const folded = query.toLowerCase();
  const decorated = topics.map((topic, index) => {
    const title = topic.title.trim().toLowerCase();
    const named = title.length >= 2 && folded.includes(title) ? 1 : 0;
    return { topic, index, named, hits: hitScore.get(topic.id) ?? 0 };
  });
  decorated.sort((a, b) => b.named - a.named || b.hits - a.hits || a.index - b.index);
  return decorated.slice(0, limit).map((row) => row.topic);
}

function byRelevance(rows: readonly { topicId: string; relevance: number }[]) {
  return [...rows].sort((a, b) => b.relevance - a.relevance || a.topicId.localeCompare(b.topicId));
}

function choice(input: {
  topicId: string;
  reason: TopicAssignReason;
  relevance: number | null;
  abstain: number | null;
  runnerUp: number | null;
  hitCount: number;
}): TopicChoice {
  return input;
}

export function chooseTopicAssignment(input: {
  relevance: readonly TopicRelevance[];
  hits: readonly TopicHit[];
}): TopicChoice | null {
  const hitById = new Map(input.hits.map((hit) => [hit.topicId, hit]));
  const abstainRaw = input.relevance.find((row) => row.topicId === TOPIC_ASSIGN_ABSTAIN_ID)?.relevance;
  const abstain = finite(abstainRaw) ? abstainRaw : null;
  const scored = byRelevance(
    input.relevance
      .filter((row) => row.topicId !== TOPIC_ASSIGN_ABSTAIN_ID && finite(row.relevance))
      .map((row) => ({ topicId: row.topicId, relevance: row.relevance as number })),
  );
  const best = scored[0];
  const second = scored[1];

  if (best) {
    const beatsAbstain =
      abstain != null ? best.relevance - abstain >= TOPIC_ASSIGN_MARGIN : second != null;
    const beatsSecond = second == null || best.relevance - second.relevance >= TOPIC_ASSIGN_MARGIN;
    const strongEnough = best.relevance >= TOPIC_ASSIGN_MIN_RELEVANCE;
    if (beatsAbstain && beatsSecond && strongEnough) {
      return choice({
        topicId: best.topicId,
        reason: 'rerank',
        relevance: best.relevance,
        abstain,
        runnerUp: second?.relevance ?? null,
        hitCount: hitById.get(best.topicId)?.hitCount ?? 0,
      });
    }

    if (beatsAbstain && second && hitsAreInformative(input.hits)) {
      const nearIds = new Set(
        scored.filter((row) => best.relevance - row.relevance < TOPIC_ASSIGN_MARGIN).map((row) => row.topicId),
      );
      const rankedHits = input.hits
        .filter((hit) => nearIds.has(hit.topicId) && hit.hitCount > 0)
        .sort((a, b) => b.hitCount - a.hitCount || b.hitScore - a.hitScore || a.topicId.localeCompare(b.topicId));
      const leader = rankedHits[0];
      const follower = rankedHits[1];
      const leaderScore = leader ? (scored.find((row) => row.topicId === leader.topicId)?.relevance ?? null) : null;
      const leaderBeatsAbstain =
        leaderScore != null &&
        leaderScore >= TOPIC_ASSIGN_MIN_RELEVANCE &&
        (abstain == null || leaderScore - abstain >= TOPIC_ASSIGN_MARGIN);
      if (
        leader &&
        leaderBeatsAbstain &&
        leader.hitCount >= HIT_TIE_MIN &&
        (follower == null || (leader.hitCount >= follower.hitCount * 2 && leader.hitScore > follower.hitScore))
      ) {
        return choice({
          topicId: leader.topicId,
          reason: 'rerank_hits',
          relevance: leaderScore,
          abstain,
          runnerUp: second.relevance,
          hitCount: leader.hitCount,
        });
      }
    }
    return null;
  }

  if (!hitsAreInformative(input.hits)) return null;
  const byHits = [...input.hits].sort(
    (a, b) => b.hitCount - a.hitCount || b.hitScore - a.hitScore || a.topicId.localeCompare(b.topicId),
  );
  const top = byHits[0];
  const next = byHits[1];
  if (
    top &&
    next &&
    top.hitCount >= HIT_TIE_MIN &&
    top.hitCount >= next.hitCount * 2 &&
    top.hitScore > next.hitScore
  ) {
    return choice({
      topicId: top.topicId,
      reason: 'hits',
      relevance: null,
      abstain: null,
      runnerUp: null,
      hitCount: top.hitCount,
    });
  }
  return null;
}
