import { observer, useService } from '@rabjs/react';
import { User } from 'lucide-react';
import { AuthService } from '@/services/auth.service';

export const UserAvatar = observer(function UserAvatar({
  fallback = 'initial',
  className,
}: {
  fallback?: 'initial' | 'icon';
  className?: string;
}) {
  const auth = useService(AuthService);
  const url = auth.visibleAvatarUrl;
  const classes = ['avatar', className].filter(Boolean).join(' ');

  if (url) {
    return (
      <img
        className={classes}
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => auth.onAvatarError()}
      />
    );
  }

  if (fallback === 'icon') {
    return (
      <span className={`${classes} avatar-fallback`} aria-hidden>
        <User strokeWidth={1.8} />
      </span>
    );
  }

  return <span className={classes}>{auth.displayInitial}</span>;
});
