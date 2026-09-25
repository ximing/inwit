import type { PmDocJson } from '@inwit/dto';

export const PROTOCOL_VERSION = 1 as const;

/** 与 vendor/entity-marks.ts 的 TextSelectionAnchor 同形。 */
export type TextSelectionAnchor = {
  text: string;
  blockIndex: number;
  from: number;
  to: number;
};

export type CardAnchorInput = {
  id: string;
  anchorText?: string | null;
  anchorBlockIndex?: number | null;
  hasImage?: boolean;
};

export type AnnotationAnchorInput = {
  id: string;
  kind?: string;
  quote: string;
  anchorBlockIndex?: number | null;
  imageKey?: string | null;
};

export type ThemeName = 'light' | 'dark';
export type PlatformName = 'ios' | 'android';
export type EntityKind = 'card' | 'annotation';
export type SelectionAction = 'annotate' | 'card' | 'digest';

export type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 信封。`id` 仍保留，但入桥解析会丢掉；请求关联放在 payload（如 getDoc.requestId）。 */
export type ProtocolEnvelope<T extends string = string, P = unknown> = {
  v: typeof PROTOCOL_VERSION;
  type: T;
  payload?: P;
  id?: string;
};

export type InitCmd = {
  type: 'init';
  payload: { theme: ThemeName; platform: PlatformName };
};

export type SetContentCmd = {
  type: 'setContent';
  payload: { doc: PmDocJson };
};

export type SetEntitiesCmd = {
  type: 'setEntities';
  payload: {
    cards: CardAnchorInput[];
    annotations: AnnotationAnchorInput[];
  };
};

export type SetActiveEntityCmd = {
  type: 'setActiveEntity';
  payload: {
    kind: EntityKind;
    id: string | null;
  };
};

export type FocusCardCmd = {
  type: 'focusCard';
  payload: { cardId: string };
};

export type InjectAssetUrlsCmd = {
  type: 'injectAssetUrls';
  payload: {
    urls: Record<string, string | null>;
  };
};

export type SetThemeCmd = {
  type: 'setTheme';
  payload: { theme: ThemeName };
};

export const FORMAT_NAMES = [
  'bold',
  'italic',
  'strike',
  'heading1',
  'heading2',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'link',
  'unsetLink',
  'image',
  'horizontalRule',
  'table',
  'undo',
  'redo',
] as const;

export type FormatName = (typeof FORMAT_NAMES)[number];

export type SetEditableCmd = {
  type: 'setEditable';
  payload: { editable: boolean };
};

export type GetDocCmd = {
  type: 'getDoc';
  payload: { requestId: string };
};

export type FormatCmd = {
  type: 'format';
  payload: { name: FormatName; href?: string; src?: string };
};

export type DocEngineCommand =
  | InitCmd
  | SetContentCmd
  | SetEntitiesCmd
  | SetActiveEntityCmd
  | FocusCardCmd
  | InjectAssetUrlsCmd
  | SetThemeCmd
  | SetEditableCmd
  | GetDocCmd
  | FormatCmd;

export type ReadyEvt = { type: 'ready' };

export type ErrorEvt = { type: 'error'; payload: { message: string; stack?: string } };

export type AnchorClickEvt = { type: 'anchorClick'; payload: { cardIds: string[] } };

export type AnnotationClickEvt = { type: 'annotationClick'; payload: { annotationIds: string[] } };

export type SelectionChangeEvt = {
  type: 'selectionChange';
  payload: {
    anchor: TextSelectionAnchor | null;
    rect: ViewportRect | null;
  };
};

export type SelectionActionEvt = {
  type: 'selectionAction';
  payload: {
    action: SelectionAction;
    anchor: TextSelectionAnchor;
  };
};

export type AssetNeededEvt = { type: 'assetNeeded'; payload: { srcs: string[] } };

export type LinkClickEvt = { type: 'linkClick'; payload: { href: string } };

export type DocChangedEvt = { type: 'docChanged' };

export type DocJsonEvt = {
  type: 'docJson';
  payload: { requestId: string; doc: PmDocJson };
};

export type FormatState = {
  editable: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading1: boolean;
  heading2: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  link: boolean;
  table: boolean;
  textAlign: 'left' | 'center' | 'right';
  canUndo: boolean;
  canRedo: boolean;
};

export type FormatStateEvt = { type: 'formatState'; payload: FormatState };

export type DocEngineEvent =
  | ReadyEvt
  | ErrorEvt
  | AnchorClickEvt
  | AnnotationClickEvt
  | SelectionChangeEvt
  | SelectionActionEvt
  | AssetNeededEvt
  | LinkClickEvt
  | DocChangedEvt
  | DocJsonEvt
  | FormatStateEvt;

export type DocEngineOutgoing = ProtocolEnvelope & DocEngineEvent;

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; message: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

const COMMAND_TYPES = new Set<DocEngineCommand['type']>([
  'init',
  'setContent',
  'setEntities',
  'setActiveEntity',
  'focusCard',
  'injectAssetUrls',
  'setTheme',
  'setEditable',
  'getDoc',
  'format',
]);

const FORMAT_NAME_SET: ReadonlySet<string> = new Set(FORMAT_NAMES);

function isFormatName(value: unknown): value is FormatName {
  return typeof value === 'string' && FORMAT_NAME_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTheme(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark';
}

function isPlatform(value: unknown): value is PlatformName {
  return value === 'ios' || value === 'android';
}

function isEntityKind(value: unknown): value is EntityKind {
  return value === 'card' || value === 'annotation';
}

function parseCards(value: unknown): CardAnchorInput[] | null {
  if (!Array.isArray(value)) return null;
  const out: CardAnchorInput[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) return null;
    const card: CardAnchorInput = { id: item.id };
    if ('anchorText' in item) {
      card.anchorText = typeof item.anchorText === 'string' ? item.anchorText : null;
    }
    if ('anchorBlockIndex' in item) {
      card.anchorBlockIndex = typeof item.anchorBlockIndex === 'number' ? item.anchorBlockIndex : null;
    }
    if ('hasImage' in item) {
      card.hasImage = item.hasImage === true;
    }
    out.push(card);
  }
  return out;
}

function parseAnnotations(value: unknown): AnnotationAnchorInput[] | null {
  if (!Array.isArray(value)) return null;
  const out: AnnotationAnchorInput[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) return null;
    if (typeof item.quote !== 'string') return null;
    const note: AnnotationAnchorInput = { id: item.id, quote: item.quote };
    if (typeof item.kind === 'string') note.kind = item.kind;
    if ('anchorBlockIndex' in item) {
      note.anchorBlockIndex = typeof item.anchorBlockIndex === 'number' ? item.anchorBlockIndex : null;
    }
    if ('imageKey' in item) {
      note.imageKey = typeof item.imageKey === 'string' ? item.imageKey : null;
    }
    out.push(note);
  }
  return out;
}

function parseUrlMap(value: unknown): Record<string, string | null> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string | null> = {};
  for (const [key, url] of Object.entries(value)) {
    if (url === null) {
      out[key] = null;
      continue;
    }
    if (typeof url !== 'string') return null;
    out[key] = url;
  }
  return out;
}

function parsePayload(type: DocEngineCommand['type'], payload: unknown): ParseResult<DocEngineCommand> {
  if (!isRecord(payload)) return { ok: false, message: `command ${type} is missing payload` };

  switch (type) {
    case 'init': {
      if (!isTheme(payload.theme) || !isPlatform(payload.platform)) {
        return { ok: false, message: 'init payload requires theme and platform' };
      }
      return { ok: true, value: { type, payload: { theme: payload.theme, platform: payload.platform } } };
    }
    case 'setContent': {
      if (!isRecord(payload.doc) || payload.doc.type !== 'doc') {
        return { ok: false, message: 'setContent payload.doc must be a PM doc' };
      }
      return { ok: true, value: { type, payload: { doc: payload.doc as PmDocJson } } };
    }
    case 'setEntities': {
      const cards = parseCards(payload.cards);
      const annotations = parseAnnotations(payload.annotations);
      if (!cards || !annotations) {
        return { ok: false, message: 'setEntities payload requires cards and annotations arrays' };
      }
      return { ok: true, value: { type, payload: { cards, annotations } } };
    }
    case 'setActiveEntity': {
      if (!isEntityKind(payload.kind) || !(typeof payload.id === 'string' || payload.id === null)) {
        return { ok: false, message: 'setActiveEntity payload requires kind and id' };
      }
      return { ok: true, value: { type, payload: { kind: payload.kind, id: payload.id } } };
    }
    case 'focusCard': {
      if (typeof payload.cardId !== 'string' || payload.cardId.length === 0) {
        return { ok: false, message: 'focusCard payload requires cardId' };
      }
      return { ok: true, value: { type, payload: { cardId: payload.cardId } } };
    }
    case 'injectAssetUrls': {
      const urls = parseUrlMap(payload.urls);
      if (!urls) return { ok: false, message: 'injectAssetUrls payload.urls must be a string map' };
      return { ok: true, value: { type, payload: { urls } } };
    }
    case 'setTheme': {
      if (!isTheme(payload.theme)) {
        return { ok: false, message: 'setTheme payload requires theme' };
      }
      return { ok: true, value: { type, payload: { theme: payload.theme } } };
    }
    case 'setEditable': {
      if (typeof payload.editable !== 'boolean') {
        return { ok: false, message: 'setEditable payload requires editable' };
      }
      return { ok: true, value: { type, payload: { editable: payload.editable } } };
    }
    case 'getDoc': {
      if (typeof payload.requestId !== 'string' || payload.requestId.length === 0) {
        return { ok: false, message: 'getDoc payload requires requestId' };
      }
      return { ok: true, value: { type, payload: { requestId: payload.requestId } } };
    }
    case 'format': {
      if (!isFormatName(payload.name)) {
        return { ok: false, message: 'format payload requires a known name' };
      }
      const next: FormatCmd['payload'] = { name: payload.name };
      if (payload.name === 'link' && 'href' in payload) {
        if (typeof payload.href !== 'string') {
          return { ok: false, message: 'format link href must be a string' };
        }
        next.href = payload.href;
      }
      if (payload.name === 'image' && 'src' in payload) {
        if (typeof payload.src !== 'string') {
          return { ok: false, message: 'format image src must be a string' };
        }
        next.src = payload.src;
      }
      return { ok: true, value: { type, payload: next } };
    }
    default: {
      const _never: never = type;
      return { ok: false, message: `unknown command: ${String(_never)}` };
    }
  }
}

export function parseIncomingMessage(raw: unknown): ParseResult<DocEngineCommand> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, message: 'invalid json' };
    }
  }
  if (!isRecord(value)) return { ok: false, message: 'message must be an object' };
  if (value.v !== PROTOCOL_VERSION) {
    return { ok: false, message: `unsupported protocol version: ${String(value.v)}` };
  }
  if (typeof value.type !== 'string' || !COMMAND_TYPES.has(value.type as DocEngineCommand['type'])) {
    return { ok: false, message: `unknown command: ${String(value.type)}` };
  }
  return parsePayload(value.type as DocEngineCommand['type'], value.payload);
}

export function errorPayloadFromUnknown(err: unknown): ErrorEvt['payload'] {
  if (err instanceof Error) {
    const payload: ErrorEvt['payload'] = { message: err.message || 'error' };
    if (err.stack) payload.stack = err.stack;
    return payload;
  }
  return { message: String(err) };
}
