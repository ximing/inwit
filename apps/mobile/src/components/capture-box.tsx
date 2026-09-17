import type { Topic } from '@inwit/dto';
import { observer } from '@rabjs/react';
import { ChevronDown } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme, type ThemeTokens } from '@/theme';

export const CaptureBox = observer(function CaptureBox({
  draft,
  onChangeDraft,
  canSend,
  sending,
  looksLikeQuestion,
  onSend,
  topics,
  topicId,
  onSelectTopic,
  onCreateTopic,
  lockedTopic = false,
  disabled = false,
  placeholder,
}: {
  draft: string;
  onChangeDraft: (value: string) => void;
  canSend: boolean;
  sending: boolean;
  looksLikeQuestion: boolean;
  onSend: (mode: 'auto' | 'chat') => void;
  topics: Topic[];
  topicId: string | null;
  onSelectTopic: (id: string | null) => void;
  onCreateTopic: (title: string, goal: string) => Promise<string | null>;
  lockedTopic?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const topicLabel = topics.find((topic) => topic.id === topicId)?.title ?? '不指定主题';
  const sendable = canSend && !disabled;
  const hint = placeholder ?? '扔一句话进来，或以问号结尾问 AI…';
  const [menuOpen, setMenuOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const openNew = () => {
    setMenuOpen(false);
    setNewTitle('');
    setNewGoal('');
    setNewError(null);
    setNewOpen(true);
  };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    const error = await onCreateTopic(newTitle, newGoal);
    setCreating(false);
    if (error) {
      setNewError(error);
      return;
    }
    setNewOpen(false);
  };

  return (
    <View style={[styles.capture, disabled && styles.disabled]}>
      <TextInput
        style={styles.textarea}
        multiline
        textAlignVertical="top"
        autoCorrect
        editable={!disabled}
        placeholder={hint}
        placeholderTextColor={theme.colors.ink4}
        value={draft}
        onChangeText={onChangeDraft}
      />
      <View style={styles.captureBar}>
        {lockedTopic ? null : (
          <Pressable onPress={() => setMenuOpen(true)} style={styles.topicPick}>
            <View style={[styles.dot, !topicId && styles.dotOff]} />
            <Text style={styles.topicLabel} numberOfLines={1}>
              {topicLabel}
            </Text>
            <ChevronDown color={theme.colors.ink3} size={10} strokeWidth={2.4} />
          </Pressable>
        )}
        <View style={styles.captureActions}>
          <Pressable
            disabled={!sendable}
            onPress={() => onSend('chat')}
            style={[styles.ghostBtn, looksLikeQuestion && styles.ghostAccent, !sendable && styles.disabled]}
          >
            <Text style={[styles.ghostText, looksLikeQuestion && styles.ghostAccentText]}>
              {sending ? '提问中…' : '问 AI'}
            </Text>
          </Pressable>
          <Pressable
            disabled={!sendable}
            onPress={() => onSend('auto')}
            style={[styles.primaryBtn, !sendable && styles.disabled]}
          >
            <Text style={styles.primaryText}>{sending ? '投入中…' : '扔进去'}</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menu} onPress={() => {}}>
            <Pressable
              onPress={() => {
                onSelectTopic(null);
                setMenuOpen(false);
              }}
              style={[styles.menuItem, topicId === null && styles.menuItemOn]}
            >
              <Text style={styles.menuText}>不指定主题</Text>
            </Pressable>
            {topics.map((topic) => (
              <Pressable
                key={topic.id}
                onPress={() => {
                  onSelectTopic(topic.id);
                  setMenuOpen(false);
                }}
                style={[styles.menuItem, topicId === topic.id && styles.menuItemOn]}
              >
                <Text style={styles.menuText}>{topic.title}</Text>
              </Pressable>
            ))}
            <View style={styles.menuSep} />
            <Pressable onPress={openNew} style={styles.menuItem}>
              <Text style={styles.menuNew}>新建主题</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={newOpen} transparent animationType="fade" onRequestClose={() => setNewOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setNewOpen(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>新建主题</Text>
            <Text style={styles.dialogLede}>
              一句话标题，可选学习目标。目标会锚定这个专题里的消化方式。
            </Text>
            <Text style={styles.fieldLabel}>标题</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              maxLength={200}
              placeholder="例如：强化学习"
              placeholderTextColor={theme.colors.ink4}
            />
            <Text style={styles.fieldLabel}>目标（可选）</Text>
            <TextInput
              style={[styles.input, styles.inputArea]}
              value={newGoal}
              onChangeText={setNewGoal}
              maxLength={4000}
              multiline
              textAlignVertical="top"
              placeholder="例如：把 PPO 从直觉讲到能自己推 KL 项"
              placeholderTextColor={theme.colors.ink4}
            />
            {newError ? (
              <Text style={styles.error} accessibilityRole="alert">
                {newError}
              </Text>
            ) : null}
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setNewOpen(false)} style={styles.ghostBtn}>
                <Text style={styles.ghostText}>取消</Text>
              </Pressable>
              <Pressable
                disabled={creating}
                onPress={() => void create()}
                style={[styles.primaryBtn, creating && styles.disabled]}
              >
                <Text style={styles.primaryText}>{creating ? '创建中…' : '创建'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    capture: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      padding: theme.spacing[3],
      ...theme.shadow[1],
      marginBottom: 14,
    },
    textarea: {
      minHeight: 72,
      color: theme.colors.ink,
      fontSize: theme.typography.size.md,
      lineHeight: 22,
      padding: 4,
    },
    captureBar: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    topicPick: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      height: 32,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface2,
      maxWidth: '100%',
      flexShrink: 1,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
    },
    dotOff: { backgroundColor: theme.colors.ink4 },
    topicLabel: { fontSize: 12.5, color: theme.colors.ink2, maxWidth: 140 },
    captureActions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
    primaryBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[4],
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 13.5, fontWeight: '500' },
    ghostBtn: {
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[3],
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
    },
    ghostText: { color: theme.colors.ink2, fontSize: 13.5, fontWeight: '500' },
    ghostAccent: { borderColor: theme.colors.accentLine, backgroundColor: theme.colors.accentSoft },
    ghostAccentText: { color: theme.colors.accentDeep },
    disabled: { opacity: 0.45 },
    error: { color: theme.colors.accent, fontSize: 13.5, marginBottom: 10 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(34, 29, 22, 0.35)',
      justifyContent: 'center',
      padding: 24,
    },
    menu: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.line,
      paddingVertical: 6,
      ...theme.shadow[2],
    },
    menuItem: { paddingHorizontal: 16, paddingVertical: 12 },
    menuItemOn: { backgroundColor: theme.colors.accentSoft },
    menuText: { fontSize: 14, color: theme.colors.ink },
    menuNew: { fontSize: 14, color: theme.colors.accentDeep, fontWeight: '600' },
    menuSep: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.line, marginVertical: 4 },
    dialog: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.line,
      padding: theme.spacing[5],
      ...theme.shadow[3],
    },
    dialogTitle: {
      fontFamily: theme.typography.serif,
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    dialogLede: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 6, marginBottom: 14, lineHeight: 20 },
    fieldLabel: { fontSize: 13.5, color: theme.colors.ink2, marginBottom: 4 },
    input: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[3],
      minHeight: 38,
      color: theme.colors.ink,
      fontSize: theme.typography.size.md,
      marginBottom: 12,
    },
    inputArea: { minHeight: 80, paddingTop: 8 },
    dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  });
}
