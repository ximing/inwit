import { describe, expect, it } from 'vitest';
import {
  docAnchorPath,
  docAnnotationPath,
  docsPath,
  documentReturnTarget,
  fromTopicOf,
  isSettingsSection,
  settingsPath,
  topicDocPath,
  topicHostId,
  topicPath,
} from './routes';

const DOC = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const TOPIC = '33333333-3333-4333-8333-333333333333';

describe('settingsPath', () => {
  it('gives each settings option its own path', () => {
    expect(settingsPath()).toBe('/settings/profile');
    expect(settingsPath('files')).toBe('/settings/files');
    expect(settingsPath('token', { pane: 'logs' })).toBe('/settings/token?pane=logs');
    expect(settingsPath('archive', { pane: 'logs' })).toBe('/settings/archive');
    expect(isSettingsSection('files')).toBe(true);
    expect(isSettingsSection('nope')).toBe(false);
    expect(isSettingsSection(undefined)).toBe(false);
  });
});

describe('docsPath fromTopic', () => {
  it('omits an empty entrance and keeps the docs list close target', () => {
    expect(docsPath(DOC)).toBe(`/docs?doc=${DOC}`);
    expect(docsPath(DOC, { fromTopic: null })).toBe(`/docs?doc=${DOC}`);
    expect(docsPath(DOC, { fromTopic: '' })).toBe(`/docs?doc=${DOC}`);
    expect(fromTopicOf(new URLSearchParams('doc=1'))).toBeNull();
    expect(fromTopicOf(new URLSearchParams('fromTopic='))).toBeNull();
  });

  it('keeps the topic entrance on the same document and on card anchors', () => {
    expect(docsPath(DOC, { fromTopic: TOPIC })).toBe(`/docs?doc=${DOC}&fromTopic=${TOPIC}`);
    expect(docAnchorPath(DOC, CARD, TOPIC)).toBe(
      `/docs?doc=${DOC}&anchor=${CARD}&fromTopic=${TOPIC}`,
    );
    expect(docAnnotationPath(DOC, CARD, TOPIC)).toBe(
      `/docs?doc=${DOC}&annotation=${CARD}&fromTopic=${TOPIC}`,
    );
    expect(topicPath(TOPIC)).toBe(`/topics?topic=${TOPIC}`);
    expect(fromTopicOf(new URLSearchParams(`fromTopic=${TOPIC}`))).toBe(TOPIC);
  });

  it('opens a topic document on the topic page and closes back there', () => {
    expect(topicDocPath(TOPIC, DOC)).toBe(`/topics?topic=${TOPIC}&doc=${DOC}`);
    expect(topicDocPath(TOPIC, DOC, { anchor: CARD })).toBe(
      `/topics?topic=${TOPIC}&doc=${DOC}&anchor=${CARD}`,
    );
    expect(topicDocPath(TOPIC, DOC, { annotation: CARD })).toBe(
      `/topics?topic=${TOPIC}&doc=${DOC}&annotation=${CARD}`,
    );
    const hosted = new URLSearchParams(`topic=${TOPIC}&doc=${DOC}`);
    expect(topicHostId('/topics', hosted)).toBe(TOPIC);
    expect(topicHostId('/topics', new URLSearchParams(`topic=${TOPIC}`))).toBeNull();
    expect(topicHostId('/docs', hosted)).toBeNull();
    expect(documentReturnTarget('/topics', hosted)).toEqual({
      path: `/topics?topic=${TOPIC}`,
      replace: true,
    });
    expect(documentReturnTarget('/docs', new URLSearchParams(`doc=${DOC}`))).toEqual({
      path: '/docs',
      replace: false,
    });
  });
});
