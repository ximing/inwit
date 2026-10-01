import type { CardLinksResponse } from '@inwit/dto';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { getCardLinks } from '@/api/cards';
import { docAnchorPath, fromTopicOf, topicDocPath, topicHostId } from '@/routes';
import { groupedCardLinks, LINK_META } from './card-links-logic';

/**
 * 展开卡片后懒加载知识关联。从主题打开时，关联仍留在主题页。
 */
export function CardLinks({
  cardId,
  documentId,
}: {
  cardId: string;
  documentId: string | null;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  const hostTopic = topicHostId(location.pathname, params);
  const fromTopic = fromTopicOf(params);
  const [links, setLinks] = useState<CardLinksResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLinks(null);
    setFailed(false);
    void getCardLinks(cardId).then(
      (data) => {
        if (!cancelled) setLinks(data);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const groups = links ? groupedCardLinks(links) : [];

  return (
    <div className="card-links">
      <p className="card-links-title">脉络 · 来自知识关联</p>
      {links === null && !failed ? <p className="hint">脉络加载中…</p> : null}
      {failed ? <p className="hint">脉络没加载出来。</p> : null}
      {links && groups.length === 0 ? <p className="hint">还没有关联卡片。</p> : null}
      {groups.map((group) => (
        <div key={group.type} className="card-link-group">
          {group.items.map((item) => {
            const meta = LINK_META[item.type];
            const cross = item.card.documentId != null && item.card.documentId !== documentId;
            const reason = item.reason?.trim() ?? '';
            const agentMark = item.origin === 'agent';
            const href = item.card.documentId
              ? hostTopic
                ? topicDocPath(hostTopic, item.card.documentId, { anchor: item.card.id })
                : docAnchorPath(item.card.documentId, item.card.id, fromTopic)
              : null;
            const body = (
              <>
                <span className="card-link-top">
                  <span className={`card-link-rel is-${meta.rel}`}>
                    {meta.mark} {meta.label}
                  </span>
                  {cross ? <span className="card-link-ext">跨文档</span> : null}
                </span>
                <b>{item.card.concept}</b>
                {reason || agentMark ? (
                  <span className="card-link-reason">
                    {reason}
                    {agentMark ? `${reason ? ' — ' : ''}AI 标注` : ''}
                  </span>
                ) : null}
              </>
            );
            if (!href) {
              return (
                <div key={item.id} className="card-link is-static">
                  {body}
                </div>
              );
            }
            return (
              <Link key={item.id} className="card-link" to={href}>
                {body}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
