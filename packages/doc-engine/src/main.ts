import { createDocEngine } from './engine';
import { mountHarness } from './harness';
import './styles.css';

const native = Boolean(window.ReactNativeWebView);
if (native) {
  document.body.classList.add('is-native');
} else {
  mountHarness();
}

const root = document.getElementById('doc-root');
if (!root) throw new Error('missing #doc-root');
createDocEngine({ element: root });
