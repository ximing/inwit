import { useEffect, useRef } from 'react';

/** Load a presigned image when the live URL is missing/stale. `load` may change each render. */
export function usePresignedImage(
  id: string,
  url: string | null,
  load: (id: string) => void | Promise<unknown>,
): void {
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!id || url) return;
    void loadRef.current(id);
  }, [id, url]);
}

export function PresignedThumb({
  url,
  className,
  onError,
}: {
  url: string | null;
  className: string;
  onError?: () => void;
}) {
  if (!url) return null;
  return <img className={className} src={url} alt="" onError={onError} />;
}
