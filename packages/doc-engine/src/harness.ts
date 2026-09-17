import {
  DEMO_ANNOTATIONS,
  DEMO_ASSET_SRC,
  DEMO_CARD_ID,
  DEMO_CARDS,
  DEMO_DOC,
  DEMO_NOTE_ID,
  DEMO_PICSUM_URL,
} from './demo-doc';
import { PROTOCOL_VERSION, type DocEngineEvent, type ThemeName } from './protocol';

function envelope(type: string, payload?: unknown): unknown {
  return payload === undefined ? { v: PROTOCOL_VERSION, type } : { v: PROTOCOL_VERSION, type, payload };
}

function dispatch(msg: unknown): void {
  window.__docEngine?.dispatch(msg);
}

function appendLog(evt: DocEngineEvent): void {
  const list = document.getElementById('event-log');
  if (!list) return;
  const item = document.createElement('li');
  const type = document.createElement('span');
  type.className = 'evt-type';
  type.textContent = evt.type;
  const body = document.createElement('span');
  body.textContent = JSON.stringify(evt, null, 2);
  item.append(type, body);
  list.prepend(item);
}

export function mountHarness(): void {
  let theme: ThemeName = 'light';
  let bootstrapped = false;

  window.__onDocEngineEvent = (evt) => {
    appendLog(evt);
    if (evt.type === 'ready' && !bootstrapped) {
      bootstrapped = true;
      dispatch(envelope('init', { theme, platform: 'ios' }));
      dispatch(envelope('setContent', { doc: DEMO_DOC }));
      dispatch(envelope('setEntities', { cards: DEMO_CARDS, annotations: DEMO_ANNOTATIONS }));
    }
  };

  document.getElementById('harness-cmds')?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const cmd = target.dataset.cmd;
    if (!cmd) return;
    switch (cmd) {
      case 'active-card':
        dispatch(envelope('setActiveEntity', { kind: 'card', id: DEMO_CARD_ID }));
        return;
      case 'clear-card':
        dispatch(envelope('setActiveEntity', { kind: 'card', id: null }));
        return;
      case 'active-note':
        dispatch(envelope('setActiveEntity', { kind: 'annotation', id: DEMO_NOTE_ID }));
        return;
      case 'clear-note':
        dispatch(envelope('setActiveEntity', { kind: 'annotation', id: null }));
        return;
      case 'focus-card':
        dispatch(envelope('focusCard', { cardId: DEMO_CARD_ID }));
        return;
      case 'inject-asset':
        dispatch(envelope('injectAssetUrls', { urls: { [DEMO_ASSET_SRC]: DEMO_PICSUM_URL } }));
        return;
      case 'theme-light':
        theme = 'light';
        dispatch(envelope('setTheme', { theme }));
        return;
      case 'theme-dark':
        theme = 'dark';
        dispatch(envelope('setTheme', { theme }));
        return;
      default:
        return;
    }
  });
}
