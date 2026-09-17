import type { CardDetail } from '@inwit/dto';
import { mapAppHref, type MappedHref } from './internal-links';

export async function resolveReportLink(
  href: string,
  getCard: (id: string) => Promise<CardDetail>,
): Promise<MappedHref> {
  const match = /^\/cards\/([^/?#]+)$/.exec(href);
  if (!match) return mapAppHref(href);
  const card = await getCard(match[1]!);
  return card.documentId
    ? { kind: 'internal', pathname: '/docs/[id]', params: { id: card.documentId, anchor: card.id } }
    : { kind: 'internal', pathname: '/review' };
}
