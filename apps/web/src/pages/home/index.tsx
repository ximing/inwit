import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { DocRow } from '@/components/doc-row';
import { isSubmitHotkey } from '@/lib/format';
import { topicPath } from '@/routes';
import { HomeService } from './home.service';

const HomePageContent = observer(function HomePageContent() {
  const service = useService(HomeService);
  const navigate = useNavigate();

  useEffect(() => {
    void service.load();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && service.newTopicOpen) service.closeNewTopic();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      service.stopPolling();
      window.removeEventListener('keydown', onKey);
    };
  }, [service]);

  return (
    <section className="page-home">
      {service.suggestion ? (
        <div className="topic-suggest" role="status">
          <p>
            💡 你最近 {service.suggestion.documentCount} 条资料都关于「{service.suggestion.title}」。
          </p>
          <div className="topic-suggest-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={service.$model.acceptSuggestion.loading || service.$model.dismissSuggestion.loading}
              onClick={() => {
                void service.acceptSuggestion().then((topic) => {
                  if (topic) navigate(topicPath(topic.id));
                });
              }}
            >
              {service.$model.acceptSuggestion.loading ? '开题中…' : '开个主题'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={service.$model.acceptSuggestion.loading || service.$model.dismissSuggestion.loading}
              onClick={() => void service.dismissSuggestion()}
            >
              {service.$model.dismissSuggestion.loading ? '忽略中…' : '忽略'}
            </button>
          </div>
        </div>
      ) : null}

      <form
        className="capture-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void service.send('auto');
        }}
      >
        <input
          name="capture"
          type="text"
          autoComplete="off"
          placeholder="扔一句话进来，或以问号结尾问 AI"
          value={service.draft}
          onChange={(event) => service.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isSubmitHotkey(event)) {
              event.preventDefault();
              void service.send('auto');
            }
          }}
        />
        <button
          type="button"
          className={service.draftLooksLikeQuestion ? 'btn-ghost is-accent' : 'btn-ghost'}
          disabled={!service.canSend}
          onClick={() => void service.send('chat')}
        >
          {service.$model.send.loading ? '提问中…' : '问 AI'}
        </button>
        <button
          type={service.canSend ? 'submit' : 'button'}
          className={service.canSend ? 'btn-primary' : 'btn-ghost'}
          disabled={!service.canSend}
        >
          {service.$model.send.loading ? '投入中…' : '扔进去'}
        </button>
      </form>

      <div className="home-toolbar">
        <Link to={service.editorHref} className="btn-secondary">
          写文档
        </Link>
        <div className="topic-bar">
          <button
            type="button"
            className={service.topicId === null ? 'chip is-on' : 'chip'}
            onClick={() => service.selectTopic(null)}
          >
            全部
          </button>
          {service.topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              className={service.topicId === topic.id ? 'chip is-on' : 'chip'}
              onClick={() => service.selectTopic(topic.id)}
              title={topic.goal ?? topic.title}
            >
              {topic.title}
            </button>
          ))}
          <button type="button" className="chip chip-new" onClick={() => service.openNewTopic()}>
            + 新建主题
          </button>
        </div>
      </div>

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      <h2 className="home-kicker">最近文档</h2>

      {service.$model.load.loading && service.documents.length === 0 ? (
        <p className="empty">正在取回文档…</p>
      ) : null}

      {service.documents.length === 0 && !service.$model.load.loading ? (
        <p className="empty">
          {service.currentTopic
            ? `「${service.currentTopic.title}」这张纸还是空的。扔一句话进来，或点「写文档」。`
            : '这张纸还是空的。扔一句话进来，或点「写文档」铺开写。'}
        </p>
      ) : null}

      {service.documents.length > 0 ? (
        <div className="doc-list">
          {service.documents.map((doc) => (
            <DocRow key={doc.id} doc={doc} />
          ))}
        </div>
      ) : null}

      {service.hasMore ? (
        <button
          type="button"
          className="btn-secondary load-more"
          disabled={service.$model.loadMore.loading}
          onClick={() => void service.loadMore()}
        >
          {service.$model.loadMore.loading ? '载入中…' : '更早的文档'}
        </button>
      ) : null}

      {service.toast ? (
        <p className="toast" role="status">
          {service.toast}
        </p>
      ) : null}

      {service.newTopicOpen ? (
        <div
          className="dialog-backdrop"
          onClick={() => service.closeNewTopic()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') service.closeNewTopic();
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="new-topic-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="new-topic-title">新建主题</h2>
            <p className="lede">一句话标题，可选学习目标。目标会锚定这个专题里的消化方式。</p>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void service.createNewTopic();
              }}
            >
              <label>
                标题
                <input
                  autoFocus
                  name="title"
                  value={service.newTitle}
                  onChange={(event) => service.setNewTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                目标（可选）
                <textarea
                  name="goal"
                  rows={3}
                  value={service.newGoal}
                  onChange={(event) => service.setNewGoal(event.target.value)}
                  maxLength={4000}
                  placeholder="例如：把 PPO 从直觉讲到能自己推 KL 项"
                />
              </label>
              {service.newTopicError ? (
                <p className="banner-error" role="alert">
                  {service.newTopicError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button type="button" className="btn-ghost" onClick={() => service.closeNewTopic()}>
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={service.$model.createNewTopic.loading}
                >
                  {service.$model.createNewTopic.loading ? '创建中…' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
});

export const HomePage = bindServices(HomePageContent, [HomeService]);
