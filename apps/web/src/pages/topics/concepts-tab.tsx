import { observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { bindServices } from '@rabjs/react';
import { ConceptsPanel } from '@/features/concepts/concepts-panel';
import { ConceptsService } from '@/features/concepts/concepts.service';
import { StudyLinkService } from '@/features/study-workspace/study-link.service';
import { StudyWorkspaceService } from '@/features/study-workspace/study-workspace.service';

/** 主题页「概念」标签：跨文章汇总的概念图/索引（与文章概念区共用组件）。 */
const TopicConceptsTabContent = observer(function TopicConceptsTabContent({ topicId }: { topicId: string }) {
  const concepts = useService(ConceptsService);
  useEffect(() => {
    void concepts.boot(topicId, null);
  }, [topicId, concepts]);
  if (concepts.probed && !concepts.enabled) return null;
  return (
    <div className="topic-concepts-tab">
      <ConceptsPanel />
    </div>
  );
});

export const TopicConceptsTab = bindServices(TopicConceptsTabContent, [
  ConceptsService,
  StudyWorkspaceService,
  StudyLinkService,
]);
