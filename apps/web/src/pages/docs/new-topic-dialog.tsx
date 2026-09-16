import { observer, useService } from '@rabjs/react';
import { DocsService } from './docs.service';

export const NewTopicDialog = observer(function NewTopicDialog() {
  const service = useService(DocsService);
  return (
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
        aria-labelledby="ws-new-topic-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="ws-new-topic-title">新建主题</h2>
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
            <button type="button" className="btn btn-ghost" onClick={() => service.closeNewTopic()}>
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={service.$model.createNewTopic.loading}
            >
              {service.$model.createNewTopic.loading ? '创建中…' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});
