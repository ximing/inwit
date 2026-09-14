import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { formatDate } from '@/lib/format';
import { ROUTES, topicPath } from '@/routes';
import { TopicDetailPage } from './detail';
import { coveragePct, TopicsService, type TopicListItem } from './topics.service';

const TopicRow = observer(function TopicRow({
  item,
  busy,
  onArchive,
  onRestore,
}: {
  item: TopicListItem;
  busy: boolean;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const { topic } = item;
  const pct = coveragePct(item);
  return (
    <article className="topic-row">
      <Link to={topicPath(topic.id)} className="topic-row-main">
        <h2>{topic.title}</h2>
        <p className="lede">{topic.goal ?? '还没写学习目标'}</p>
        <p className="meta">
          {item.cardCount} 张卡 · {item.documentCount} 篇文档 · {formatDate(topic.createdAt)} 创建
        </p>
        <div
          className="coverage-track topic-coverage"
          role="progressbar"
          aria-label="覆盖率"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="coverage-bar" style={{ width: `${String(pct)}%` }} />
        </div>
      </Link>
      {topic.status === 'active' ? (
        <button type="button" className="btn-secondary" disabled={busy} onClick={onArchive}>
          {busy ? '归档中…' : '归档'}
        </button>
      ) : (
        <button type="button" className="btn-secondary" disabled={busy} onClick={onRestore}>
          {busy ? '恢复中…' : '取消归档'}
        </button>
      )}
    </article>
  );
});

const TopicsPageContent = observer(function TopicsPageContent() {
  const service = useService(TopicsService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page-plain">
      <header className="page-head">
        <h1>学习主题</h1>
        <p className="lede">主题不是文件夹。每个主题是一段持续生长的上下文。</p>
      </header>

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      {service.$model.load.loading && service.items.length === 0 ? <p className="empty">读取主题…</p> : null}

      {service.items.length === 0 && !service.$model.load.loading ? (
        <p className="empty">
          还没有主题。到<Link to={ROUTES.home}>文档页</Link>点「+ 新建主题」，给这段学习起个名字。
        </p>
      ) : null}
      {service.active.length === 0 && service.archived.length > 0 ? (
        <p className="lede">没有进行中的主题。</p>
      ) : null}

      <div className="topic-list">
        {service.active.map((item) => (
          <TopicRow
            key={item.topic.id}
            item={item}
            busy={service.busyId === item.topic.id}
            onArchive={() => void service.archive(item.topic.id)}
            onRestore={() => void service.restore(item.topic.id)}
          />
        ))}
      </div>

      {service.archived.length > 0 ? (
        <>
          <h2 className="subhead">已归档</h2>
          <div className="topic-list is-archived">
            {service.archived.map((item) => (
              <TopicRow
                key={item.topic.id}
                item={item}
                busy={service.busyId === item.topic.id}
                onArchive={() => void service.archive(item.topic.id)}
                onRestore={() => void service.restore(item.topic.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
});

export const TopicsPage = bindServices(TopicsPageContent, [TopicsService]);
export { TopicDetailPage };
