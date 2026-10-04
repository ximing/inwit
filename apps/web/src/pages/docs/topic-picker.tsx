import type { Topic } from '@inwit/dto';
import { ChevronDown } from 'lucide-react';
import { Tip } from '@/components/tip';

export function TopicPicker({
  topics,
  topicId,
  open,
  compact = false,
  kicker = false,
  onToggle,
  onSelect,
  onNew,
}: {
  topics: Topic[];
  topicId: string | null;
  open: boolean;
  compact?: boolean;
  kicker?: boolean;
  onToggle: () => void;
  onSelect: (id: string | null) => void;
  onNew: () => void;
}) {
  const current = topics.find((topic) => topic.id === topicId);
  const label = current?.title ?? '不指定主题';
  return (
    <div className="topic-pick-wrap">
      <button
        type="button"
        className={`topic-pick${kicker ? ' is-kicker' : ''}`}
        style={compact ? { padding: '0 8px', height: 24, fontSize: 12.5 } : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={topicId ? 'dot' : 'dot is-off'} />
        <span className="topic-pick-label">{label}</span>
        <ChevronDown width={10} height={10} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="topic-menu" role="listbox" aria-label="选择主题">
          <button
            type="button"
            role="option"
            aria-selected={topicId === null}
            className={topicId === null ? 'is-on' : undefined}
            onClick={() => onSelect(null)}
          >
            不指定主题
          </button>
          {topics.map((topic) => (
            <Tip key={topic.id} content={topic.goal ?? topic.title}>
              <button
                type="button"
                role="option"
                aria-selected={topicId === topic.id}
                className={topicId === topic.id ? 'is-on' : undefined}
                onClick={() => onSelect(topic.id)}
              >
                {topic.title}
              </button>
            </Tip>
          ))}
          <div className="topic-menu-sep" />
          <button type="button" className="topic-menu-new" onClick={onNew}>
            新建主题
          </button>
        </div>
      ) : null}
    </div>
  );
}
