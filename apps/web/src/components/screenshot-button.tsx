import { observer, useService } from '@rabjs/react';
import { Camera } from 'lucide-react';
import { Tip } from '@/components/tip';
import { ScreenshotService } from '@/services/screenshot.service';

export const ScreenshotButton = observer(function ScreenshotButton({
  topicId,
}: {
  topicId?: string | null;
}) {
  const shot = useService(ScreenshotService);
  if (!shot.available) return null;
  return (
    <Tip content="截图捕捉 ⌘⇧2">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={shot.capturing}
        onClick={() => void shot.capture(topicId)}
      >
        <Camera width={14} height={14} strokeWidth={1.8} />
        {shot.capturing ? '截图中…' : '截图'}
      </button>
    </Tip>
  );
});
