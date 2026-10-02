import { docDisplayTitle, type DocumentListItem } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listDocuments } from '@/api/documents';
import { searchQuery } from '@/api/search';
import { BottomSheet } from '@/components/bottom-sheet';
import { StackHeader } from '@/components/stack-header';
import { confirmAction } from '@/lib/confirm';
import { formatRelativeTime } from '@/lib/format';
import { docPath } from '@/routes';
import { EditorPresenceService } from '@/services/editor-presence.service';
import { useTheme, type ThemeTokens } from '@/theme';
import { conversationActionLine, messageBodyKind, pendingStatusLine } from './chat-logic';
import { ChatService } from './chat.service';
import { ChatMarkdown } from './markdown-view';

function mentionTitle(item: DocumentListItem): string {
  const title = item.title?.trim();
  if (title) return docDisplayTitle(item);
  return item.preview?.trim() || '未命名文档';
}

const ChatContent = observer(function ChatContent() {
  const service = useService(ChatService);
  const presence = useService(EditorPresenceService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [modelOpen, setModelOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionHits, setMentionHits] = useState<DocumentListItem[]>([]);

  useEffect(() => {
    if (!mentionOpen) return;
    const handle = setTimeout(() => {
      const q = mentionQuery.trim();
      void (q ? searchQuery(q).then((result) => result.documents) : listDocuments({ limit: 20 }).then((page) => page.items))
        .then((items) => setMentionHits(items))
        .catch(() => setMentionHits([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [mentionOpen, mentionQuery]);

  const messages = service.current?.messages ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StackHeader
        title="对话"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        right={
          <Pressable onPress={() => service.toggleHistory()} hitSlop={8}>
            <Text style={styles.link}>记录</Text>
          </Pressable>
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.thread} keyboardShouldPersistTaps="handled">
          {messages.length === 0 ? (
            <Text style={styles.empty}>从一句问题开始。可以点名最多五篇文档。</Text>
          ) : null}
          {messages.map((message) => {
            const plain = messageBodyKind(message.role) === 'plain';
            return (
              <View
                key={message.id}
                style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}
              >
                {plain ? (
                  <Text style={styles.plain} selectable>
                    {message.content}
                  </Text>
                ) : (
                  <>
                    {message.status === 'pending' ? (
                      <Text style={styles.activity}>{pendingStatusLine(message.activity)}</Text>
                    ) : null}
                    {message.thinking.trim() ? (
                      <View style={styles.thinking}>
                        <Text style={styles.thinkingLabel}>思考</Text>
                        <ChatMarkdown text={message.thinking} />
                      </View>
                    ) : null}
                    {message.content.trim() ? <ChatMarkdown text={message.content} /> : null}
                    {message.actions.map((action, index) => {
                      const line = conversationActionLine(
                        action,
                        presence.bodyDirty ? presence.documentId : null,
                      );
                      return (
                        <Pressable
                          key={`${action.documentId}-${String(index)}`}
                          onPress={() => router.push(docPath(line.documentId))}
                        >
                          <Text style={styles.action}>{line.text}</Text>
                        </Pressable>
                      );
                    })}
                    {message.status === 'failed' ? (
                      <Pressable onPress={() => void service.retry(message.id)}>
                        <Text style={styles.link}>
                          {message.failReason ? `没答上：${message.failReason} · 重试` : '重试'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
                {plain && message.documents.length > 0 ? (
                  <Text style={styles.docs}>
                    {message.documents.map((doc) => `《${doc.title || '未命名文档'}》`).join(' ')}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {service.error ? <Text style={styles.error}>{service.error}</Text> : null}
        </ScrollView>

        <View style={styles.composer}>
          {service.mentions.length > 0 ? (
            <View style={styles.chips}>
              {service.mentions.map((mention) => (
                <Pressable key={mention.id} onPress={() => service.removeMention(mention.id)} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    《{mention.title}》 ×
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextInput
            value={service.draft}
            onChangeText={(value) => service.setDraft(value)}
            placeholder="接着问"
            placeholderTextColor={theme.colors.ink4}
            multiline
            style={styles.input}
          />
          <View style={styles.row}>
            <Pressable onPress={() => service.startNew()}>
              <Text style={styles.link}>新对话</Text>
            </Pressable>
            <Pressable onPress={() => setMentionOpen(true)}>
              <Text style={styles.link}>文档</Text>
            </Pressable>
            <Pressable onPress={() => setModelOpen(true)}>
              <Text style={styles.link}>{service.modelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => void service.send()}
              disabled={service.busy || service.draft.trim().length === 0}
              style={styles.send}
            >
              <Text style={styles.sendText}>{service.busy ? '等待' : '发送'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <BottomSheet visible={service.historyOpen} title="对话记录" onClose={() => service.closeHistory()}>
        {service.conversations.length === 0 ? (
          <Text style={styles.empty}>还没有对话。</Text>
        ) : (
          service.conversations.map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <Pressable style={styles.flex} onPress={() => void service.open(item.id)}>
                <Text style={styles.historyTitle} numberOfLines={1}>
                  {item.title || '未命名对话'}
                </Text>
                <Text style={styles.activity}>{formatRelativeTime(item.updatedAt)}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void (async () => {
                    const ok = await confirmAction('删除对话', '删除后这段对话无法恢复。', '删除', true);
                    if (ok) await service.remove(item.id);
                  })();
                }}
              >
                <Text style={styles.link}>删除</Text>
              </Pressable>
            </View>
          ))
        )}
      </BottomSheet>

      <BottomSheet visible={modelOpen} title="模型" onClose={() => setModelOpen(false)}>
        <Pressable
          onPress={() => {
            service.chooseModel(null);
            setModelOpen(false);
          }}
          style={styles.historyRow}
        >
          <Text style={styles.historyTitle}>默认</Text>
        </Pressable>
        {service.models.map((model) => (
          <Pressable
            key={model.id}
            onPress={() => {
              service.chooseModel(model.id);
              setModelOpen(false);
            }}
            style={styles.historyRow}
          >
            <Text style={styles.historyTitle}>
              {model.model}
              {model.isDefault ? ' · 默认' : ''}
            </Text>
          </Pressable>
        ))}
      </BottomSheet>

      <BottomSheet
        visible={mentionOpen}
        title="提到文档"
        onClose={() => setMentionOpen(false)}
      >
        <TextInput
          value={mentionQuery}
          onChangeText={setMentionQuery}
          placeholder="搜索文档"
          placeholderTextColor={theme.colors.ink4}
          style={styles.input}
        />
        {mentionHits.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => {
              const added = service.addMention({ id: item.id, title: mentionTitle(item) });
              if (!added) service.error = '最多提到五篇文档';
              else setMentionOpen(false);
            }}
            style={styles.historyRow}
          >
            <Text style={styles.historyTitle} numberOfLines={1}>
              {mentionTitle(item)}
            </Text>
          </Pressable>
        ))}
      </BottomSheet>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    flex: { flex: 1 },
    thread: { padding: theme.spacing[4], gap: 12 },
    empty: { color: theme.colors.ink3, fontSize: 14, lineHeight: 20 },
    bubble: { borderRadius: 12, padding: 12, gap: 8 },
    userBubble: { backgroundColor: theme.colors.surface2, alignSelf: 'flex-end', maxWidth: '92%' },
    assistantBubble: { backgroundColor: theme.colors.surface, alignSelf: 'stretch' },
    plain: { color: theme.colors.ink, fontSize: 15, lineHeight: 22 },
    activity: { color: theme.colors.ink3, fontSize: 12 },
    thinking: {
      gap: 4,
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.surface2,
    },
    thinkingLabel: { color: theme.colors.ink3, fontSize: 12, fontWeight: '700' },
    action: { color: theme.colors.accentDeep, fontSize: 14, fontWeight: '600' },
    docs: { color: theme.colors.ink3, fontSize: 12 },
    error: { color: theme.colors.accent, fontSize: 13 },
    composer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.lineSoft,
      padding: theme.spacing[3],
      gap: 8,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      backgroundColor: theme.colors.surface2,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      maxWidth: '100%',
    },
    chipText: { color: theme.colors.ink2, fontSize: 12 },
    input: {
      minHeight: 40,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: theme.colors.ink,
      backgroundColor: theme.colors.surface,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    link: { color: theme.colors.accentDeep, fontSize: 14, fontWeight: '600' },
    send: {
      marginLeft: 'auto',
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingHorizontal: 14,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendText: { color: theme.colors.onAccent, fontWeight: '700' },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    historyTitle: { color: theme.colors.ink, fontSize: 15 },
  });
}

export default bindServices(ChatContent, [ChatService]);
