import type { MemoryCollection, MemoryEntry, MemoryRevision } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { PageHead } from '@/components/page-head';
import { formatDateTime } from '@/lib/format';
import { jobsPath } from '@/routes';
import { MemoryService, revisionCountLabel } from './memory.service';

function CollectionCard({
  collection,
  entries,
  retired,
}: {
  collection: MemoryCollection;
  entries: MemoryEntry[];
  retired?: boolean;
}) {
  return (
    <article className={retired ? 'mem-card is-retired' : 'mem-card'}>
      <div className="mem-card-head">
        <h3 className="mem-title">{collection.title}</h3>
        <p className="mem-meta">
          {`${String(collection.entryCount)} 条 · 更新于 ${formatDateTime(collection.updatedAt)}`}
        </p>
      </div>
      {collection.description ? <p className="mem-desc">{collection.description}</p> : null}
      {entries.length > 0 ? (
        <ul className="mem-entries">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={entry.status === 'retired' ? 'mem-entry is-retired' : 'mem-entry'}
            >
              {entry.status === 'retired' ? <span className="mem-flag">已停用</span> : null}
              {entry.body}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function RevisionRow({ revision }: { revision: MemoryRevision }) {
  return (
    <article className="mem-rev">
      <div className="mem-rev-top">
        <time dateTime={revision.createdAt}>{formatDateTime(revision.createdAt)}</time>
        {revision.jobId ? (
          <Link className="mem-job" to={jobsPath({ job: revision.jobId })}>
            查看任务
          </Link>
        ) : null}
      </div>
      <p className="mem-summary">{revision.summary}</p>
      <p className="mem-counts">{revisionCountLabel(revision.diff)}</p>
    </article>
  );
}

const MemoryPageContent = observer(function MemoryPageContent() {
  const service = useService(MemoryService);

  useEffect(() => {
    void service.load();
  }, [service]);

  const active = service.activeCollections;
  const retired = service.retiredCollections;
  const more = service.revisions.length < service.revisionTotal;

  return (
    <div className="mem-col">
      <PageHead title="记忆" lede="整理任务记下的讲法偏好。只供查看。" />
      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}{' '}
          <button type="button" className="btn btn-ghost" onClick={() => void service.load()}>
            重试
          </button>
        </p>
      ) : null}
      {!service.ready ? (
        <p className="hint" role="status">
          正在读取…
        </p>
      ) : null}

      {service.ready ? (
        <>
          <h2 className="mem-sec">
            集合
            <span className="line" />
          </h2>
          {active.length === 0 && !service.error ? (
            <p className="empty compact">
              {retired.length === 0
                ? '还没有记忆集合。整理任务会在处理卡片反馈后写到这里。'
                : '没有启用中的集合。'}
            </p>
          ) : active.length === 0 ? null : (
            active.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                entries={service.entriesFor(collection.id)}
              />
            ))
          )}

          {retired.length > 0 ? (
            <section aria-label="已停用">
              <h2 className="mem-sec is-quiet">
                已停用
                <span className="line" />
              </h2>
              {retired.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  entries={service.entriesFor(collection.id)}
                  retired
                />
              ))}
            </section>
          ) : null}

          <h2 className="mem-sec">
            整理历史
            <span className="line" />
          </h2>
          {service.revisions.length === 0 && !service.error ? (
            <p className="empty compact">还没有整理记录。</p>
          ) : service.revisions.length === 0 ? null : (
            service.revisions.map((revision) => <RevisionRow key={revision.id} revision={revision} />)
          )}
          {more ? (
            <button
              type="button"
              className="btn btn-ghost mem-more"
              disabled={service.$model.loadMoreRevisions.loading}
              onClick={() => void service.loadMoreRevisions()}
            >
              {service.$model.loadMoreRevisions.loading ? '读取中…' : '更早的记录'}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
});

export const MemoryPage = bindServices(MemoryPageContent, [MemoryService]);
