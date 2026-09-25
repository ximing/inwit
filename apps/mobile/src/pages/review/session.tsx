import { IMAGE_EXCERPT_QUOTE } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { confirmAction } from '@/lib/confirm';
import { ROUTES } from '@/routes';
import { useTheme, type ThemeTokens } from '@/theme';
import { formatMult } from './review-settings-logic';
import { ReviewSessionService } from './session.service';

const SessionContent = observer(function SessionContent() {
  const service = useService(ReviewSessionService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const current = service.current;
  const complete = current == null && service.ready;
  const grading = service.grading;
  const ease = current?.reviewState.ease ?? service.settings.startingEase;
  const fuzzyScale = service.settings.fuzzyScale;
  const imageUrl = service.currentImageUrl;
  const showQuestion = (service.question.trim() || '') !== IMAGE_EXCERPT_QUOTE;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void service.load();
  }, [service]);

  useEffect(() => {
    if (!current?.card.hasImage) return;
    void service.loadCardImage(current.card.id);
  }, [current?.card.id, current?.card.hasImage, service]);

  useEffect(() => {
    if (!current) setMenuOpen(false);
  }, [current]);

  const goHub = () => {
    if (router.canGoBack()) router.back();
    else router.replace(ROUTES.review);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.head}>
        <Pressable onPress={goHub} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backText}>← 返回</Text>
        </Pressable>
        <Text style={styles.title}>今日复习</Text>
        <View style={styles.headSide}>
          {current ? (
            <Pressable
              accessibilityLabel="卡片操作"
              onPress={() => setMenuOpen(true)}
              hitSlop={8}
              style={styles.menuBtn}
            >
              <Text style={styles.menuGlyph}>···</Text>
            </Pressable>
          ) : (
            <View style={styles.menuBtn} />
          )}
          <Text style={styles.count}>
            {service.cardOrdinal} / {service.total}
          </Text>
        </View>
      </View>
      <View
        style={styles.progress}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: service.total, now: service.cardOrdinal }}
      >
        <View style={[styles.progressFill, { width: `${service.progressPct}%` }]} />
      </View>

      {current ? (
        <View style={styles.crumbRow}>
          <Text style={styles.crumb} numberOfLines={1}>
            {service.crumb ?? ''}
          </Text>
          {service.showSource ? (
            <Pressable onPress={() => service.onSourcePress()} hitSlop={8}>
              <Text style={styles.source}>原文</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {service.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {service.error}
        </Text>
      ) : null}

      {complete || !current ? (
        <View style={styles.done}>
          <Text style={styles.doneMark}>🎉</Text>
          <Text style={styles.doneTitle}>
            {service.ready ? service.completeHeadline : '正在准备…'}
          </Text>
          <Text style={styles.doneSub}>
            明天到期 <Text style={styles.doneN}>{service.tomorrowDue}</Text> 张
          </Text>
          <Pressable onPress={goHub} style={styles.startBtn}>
            <Text style={styles.startText}>返回 Hub</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.stage}>
          <Pressable onPress={() => service.flip()} style={styles.card}>
            {service.flipped ? (
              <>
                <Text style={[styles.kicker, styles.kickerAns]}>答案</Text>
                <ScrollView style={styles.cardBody} contentContainerStyle={styles.cardBodyInner}>
                  <Text style={styles.answer}>{service.answer}</Text>
                </ScrollView>
                <Text style={styles.tip}>想起来了吗？诚实打分，间隔才会准</Text>
              </>
            ) : (
              <>
                <Text style={styles.kicker}>先自己想</Text>
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={styles.excerpt}
                    contentFit="contain"
                    onError={() => service.retryCardImage(current.card.id)}
                  />
                ) : null}
                {showQuestion ? (
                  <ScrollView style={styles.cardBody} contentContainerStyle={styles.cardBodyInner}>
                    <Text style={styles.question}>{service.question}</Text>
                  </ScrollView>
                ) : null}
                <Text style={styles.tip}>点击卡片翻面</Text>
              </>
            )}
          </Pressable>

          {service.flipped ? (
            <View style={styles.gradeRow}>
              <GradeButton
                label="忘了"
                hint="明天再见"
                color={theme.colors.accentDeep}
                border={theme.colors.accentLine}
                bg={theme.colors.accentSoft}
                active={service.lastFeedback === 'forgot' && grading}
                disabled={grading}
                onPick={() => void service.grade('forgot')}
                styles={styles}
              />
              <GradeButton
                label="模糊"
                hint={`间隔 ×${formatMult(fuzzyScale)}`}
                color={theme.colors.gold}
                border={theme.colors.goldLine}
                bg={theme.colors.goldSoft}
                active={service.lastFeedback === 'fuzzy' && grading}
                disabled={grading}
                onPick={() => void service.grade('fuzzy')}
                styles={styles}
              />
              <GradeButton
                label="想起来了"
                hint={`间隔 ×${formatMult(ease)}`}
                color={theme.colors.green}
                border={theme.colors.greenLine}
                bg={theme.colors.greenSoft}
                active={service.lastFeedback === 'remembered' && grading}
                disabled={grading}
                onPick={() => void service.grade('remembered')}
                styles={styles}
              />
            </View>
          ) : (
            <Text style={styles.footTip}>先自己想，想起来了再翻。不要偷看。</Text>
          )}
        </View>
      )}
      <BottomSheet visible={menuOpen} title="卡片操作" onClose={() => setMenuOpen(false)}>
        <Pressable
          disabled={grading}
          onPress={() => {
            setMenuOpen(false);
            void service.markCurrentFamiliar();
          }}
          style={styles.menuRow}
        >
          <Text style={[styles.menuLabel, grading && styles.disabled]}>已熟悉，不复习</Text>
        </Pressable>
        <Pressable
          disabled={grading}
          onPress={() => {
            setMenuOpen(false);
            void (async () => {
              const ok = await confirmAction(
                '移入回收站',
                '可在「我的 → 回收站」恢复。',
                '移入回收站',
                true,
              );
              if (ok) await service.archiveCurrent();
            })();
          }}
          style={styles.menuRow}
        >
          <Text style={[styles.menuDanger, grading && styles.disabled]}>移入回收站</Text>
        </Pressable>
      </BottomSheet>
    </SafeAreaView>
  );
});

function GradeButton({
  label,
  hint,
  color,
  border,
  bg,
  active,
  disabled,
  onPick,
  styles,
}: {
  label: string;
  hint: string;
  color: string;
  border: string;
  bg: string;
  active: boolean;
  disabled: boolean;
  onPick: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPick}
      style={[
        styles.grade,
        { borderColor: border, backgroundColor: active ? bg : undefined },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.gradeLabel, { color }]}>{label}</Text>
      <Text style={styles.gradeHint}>{hint}</Text>
    </Pressable>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[2],
      gap: 8,
    },
    backBtn: { paddingVertical: 6, paddingRight: 8 },
    backText: { fontSize: 14, color: theme.colors.ink2, fontWeight: '500' },
    title: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: theme.colors.ink },
    headSide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
    menuBtn: { minWidth: 28, alignItems: 'center' },
    menuGlyph: { fontSize: 18, color: theme.colors.ink2, fontWeight: '700', letterSpacing: 1 },
    count: { fontSize: 13, color: theme.colors.ink3, minWidth: 48, textAlign: 'right' },
    menuRow: { paddingVertical: 14 },
    menuLabel: { fontSize: 16, color: theme.colors.ink },
    menuDanger: { fontSize: 16, color: theme.colors.accent },
    progress: {
      height: 4,
      backgroundColor: theme.colors.lineSoft,
      marginHorizontal: theme.spacing[4],
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressFill: { height: 4, backgroundColor: theme.colors.accent, borderRadius: 2 },
    crumbRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: theme.spacing[4],
      paddingTop: theme.spacing[3],
    },
    crumb: { flex: 1, fontSize: 12.5, color: theme.colors.ink3 },
    source: { fontSize: 12.5, color: theme.colors.accentDeep, fontWeight: '600' },
    error: {
      fontSize: 13.5,
      color: theme.colors.accent,
      paddingHorizontal: theme.spacing[4],
      paddingTop: 8,
    },
    stage: { flex: 1, paddingHorizontal: theme.spacing[4], paddingTop: theme.spacing[3], paddingBottom: 8 },
    card: {
      flex: 1,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.xl,
      paddingHorizontal: theme.spacing[6],
      paddingVertical: theme.spacing[6],
      ...theme.shadow[2],
    },
    kicker: {
      fontSize: 11.5,
      fontWeight: '600',
      letterSpacing: 1.2,
      color: theme.colors.ink4,
    },
    kickerAns: { color: theme.colors.accent },
    cardBody: { flex: 1, marginTop: 16 },
    cardBodyInner: { paddingBottom: 8 },
    question: {
      fontFamily: theme.typography.serif,
      fontSize: 20,
      fontWeight: '600',
      lineHeight: 34,
      color: theme.colors.ink,
    },
    answer: {
      fontFamily: theme.typography.serif,
      fontSize: 16.5,
      lineHeight: 30,
      color: theme.colors.prose,
    },
    excerpt: {
      width: '100%',
      height: 180,
      marginTop: 16,
      borderRadius: 8,
      backgroundColor: theme.colors.bgSunken,
    },
    tip: { fontSize: 12, color: theme.colors.ink4, textAlign: 'center', marginTop: 18 },
    gradeRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    grade: {
      flex: 1,
      minHeight: 56,
      borderRadius: theme.radius.md,
      borderWidth: 1.5,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
    },
    gradeLabel: { fontSize: 15, fontWeight: '600' },
    gradeHint: { fontSize: 12, color: theme.colors.ink3, marginTop: 2 },
    footTip: { textAlign: 'center', fontSize: 12.5, color: theme.colors.ink4, marginTop: 18 },
    done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 48 },
    doneMark: { fontSize: 40 },
    doneTitle: {
      fontFamily: theme.typography.serif,
      fontSize: 28,
      fontWeight: '700',
      color: theme.colors.ink,
    },
    doneSub: { fontSize: 14, color: theme.colors.ink3 },
    doneN: { fontWeight: '700', color: theme.colors.ink },
    startBtn: {
      marginTop: 12,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[5],
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    startText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
    disabled: { opacity: 0.45 },
  });
}

export default bindServices(SessionContent, [ReviewSessionService]);
