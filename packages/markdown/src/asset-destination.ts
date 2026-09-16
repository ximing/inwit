import type { Image } from 'mdast';
import type { Handle, State } from 'mdast-util-to-markdown';
import { safeMediaSrc } from './pmjson.js';

/**
 * remark-directive marks `:` unsafe in phrasing so `:name` is not emitted by
 * accident. That also backslash-escapes `asset:` inside image destinations
 * (`asset\:users/...`). Hide `phrasing` while writing a validated asset src.
 */
function withAssetDestination<T>(state: State, url: string, write: () => T): T {
  const hidePhrasing = url.startsWith('asset:') && safeMediaSrc(url) !== null;
  const stack = state.stack;
  if (hidePhrasing) state.stack = stack.filter((name) => name !== 'phrasing');
  try {
    return write();
  } finally {
    if (hidePhrasing) state.stack = stack;
  }
}

function quoteChar(state: State): '"' | "'" {
  return state.options.quote === "'" ? "'" : '"';
}

export const handleImage: Handle = function handleImage(node, _, state, info) {
  const image = node as Image;
  const quote = quoteChar(state);
  const suffix = quote === '"' ? 'Quote' : 'Apostrophe';
  const exit = state.enter('image');
  const tracker = state.createTracker(info);
  let subexit = state.enter('label');
  let value = tracker.move('![');
  value += tracker.move(
    state.safe(image.alt, { before: value, after: ']', ...tracker.current() }),
  );
  value += tracker.move('](');
  subexit();

  const url = image.url;
  const title = image.title;
  if ((!url && title) || /[\0- \u007F]/.test(url)) {
    subexit = state.enter('destinationLiteral');
    value += tracker.move('<');
    value += tracker.move(
      withAssetDestination(state, url, () =>
        state.safe(url, { before: value, after: '>', ...tracker.current() }),
      ),
    );
    value += tracker.move('>');
  } else {
    subexit = state.enter('destinationRaw');
    value += tracker.move(
      withAssetDestination(state, url, () =>
        state.safe(url, {
          before: value,
          after: title ? ' ' : ')',
          ...tracker.current(),
        }),
      ),
    );
  }
  subexit();

  if (title) {
    subexit = state.enter(`title${suffix}`);
    value += tracker.move(' ' + quote);
    value += tracker.move(
      state.safe(title, { before: value, after: quote, ...tracker.current() }),
    );
    value += tracker.move(quote);
    subexit();
  }

  value += tracker.move(')');
  exit();
  return value;
};

(handleImage as Handle & { peek: () => string }).peek = function imagePeek() {
  return '!';
};
