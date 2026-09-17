import type { ReviewSettings } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { ChevronDown } from 'lucide-react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RangeSlider } from '@/components/range-slider';
import { useTheme, type ThemeTokens } from '@/theme';
import { ReviewService } from './review.service';
import {
  LEARNING_STEP_OPTIONS,
  cloneSettings,
  formatMult,
  normalizeDraft,
} from './review-settings-logic';

export const SettingsPanel = observer(function SettingsPanel() {
  const service = useService(ReviewService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReviewSettings>(() =>
    normalizeDraft(cloneSettings(service.settings)),
  );

  useEffect(() => {
    setDraft(normalizeDraft(cloneSettings(service.settings)));
  }, [service.settings]);

  const patch = (partial: Partial<ReviewSettings>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const toggleStep = (step: number) => {
    setDraft((prev) => {
      const has = prev.learningSteps.includes(step);
      if (has && prev.learningSteps.length <= 1) return prev;
      const next = has
        ? prev.learningSteps.filter((item) => item !== step)
        : [...prev.learningSteps, step].sort((a, b) => a - b);
      return { ...prev, learningSteps: next };
    });
  };

  const saving = service.$model.saveSettings.loading;
  const restoring = service.$model.restoreDefaults.loading;

  return (
    <View style={styles.panel}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <View style={styles.headText}>
          <Text style={styles.title}>复习设置</Text>
          <Text style={styles.sub}>记忆算法（SM-2）参数，默认适合大多数人</Text>
        </View>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown color={theme.colors.ink4} size={14} strokeWidth={2.2} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Field
            label="每日复习上限"
            value={`${String(draft.dailyReviewLimit)} 张`}
            desc="超过的到期卡会顺延到明天"
            styles={styles}
          >
            <RangeSlider
              min={5}
              max={100}
              step={1}
              value={draft.dailyReviewLimit}
              onChange={(dailyReviewLimit) => patch({ dailyReviewLimit })}
              theme={theme}
            />
          </Field>
          <Field
            label="每日新卡上限"
            value={`${String(draft.dailyNewLimit)} 张`}
            desc="从没刷过的卡，每天最多混入多少"
            styles={styles}
          >
            <RangeSlider
              min={0}
              max={30}
              step={1}
              value={draft.dailyNewLimit}
              onChange={(dailyNewLimit) => patch({ dailyNewLimit })}
              theme={theme}
            />
          </Field>
          <Field
            label="起始难度（ease）"
            value={`${formatMult(draft.startingEase)}×`}
            desc="越大间隔涨得越快，别轻易调高"
            styles={styles}
          >
            <RangeSlider
              min={1.3}
              max={3}
              step={0.1}
              value={draft.startingEase}
              onChange={(startingEase) => patch({ startingEase })}
              theme={theme}
            />
          </Field>
          <Field
            label={'"模糊"的后果'}
            value={`间隔 ×${formatMult(draft.fuzzyScale)}`}
            desc="往左更严格（接近重来），往右更宽松"
            styles={styles}
          >
            <RangeSlider
              min={1}
              max={1.5}
              step={0.1}
              value={draft.fuzzyScale}
              onChange={(fuzzyScale) => patch({ fuzzyScale })}
              theme={theme}
            />
          </Field>
          <View style={styles.field}>
            <Text style={styles.label}>学习步长</Text>
            <View style={styles.steps}>
              {LEARNING_STEP_OPTIONS.map((step) => {
                const on = draft.learningSteps.includes(step);
                return (
                  <Pressable
                    key={step}
                    onPress={() => toggleStep(step)}
                    style={[styles.step, on && styles.stepOn]}
                  >
                    <Text style={[styles.stepText, on && styles.stepTextOn]}>{step} 天</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.desc}>新卡连续答对时，间隔按这个阶梯走，之后按 ease 倍增</Text>
          </View>
          <Text style={styles.note}>改动只影响之后的调度，不会重排已有卡片</Text>
          <View style={styles.foot}>
            <Pressable
              disabled={saving || restoring}
              onPress={() => {
                void service.restoreDefaults().then((saved) => {
                  if (saved) setDraft(normalizeDraft(saved));
                });
              }}
              style={[styles.ghostBtn, (saving || restoring) && styles.disabled]}
            >
              <Text style={styles.ghostText}>{restoring ? '恢复中…' : '恢复默认'}</Text>
            </Pressable>
            <Pressable
              disabled={saving || restoring}
              onPress={() => {
                void service.saveSettings(normalizeDraft(draft));
              }}
              style={[styles.primaryBtn, (saving || restoring) && styles.disabled]}
            >
              <Text style={styles.primaryText}>{saving ? '保存中…' : '保存'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
});

function Field({
  label,
  value,
  desc,
  styles,
  children,
}: {
  label: string;
  value: string;
  desc: string;
  styles: ReturnType<typeof makeStyles>;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.val}>{value}</Text>
      </View>
      {children}
      <Text style={styles.desc}>{desc}</Text>
    </View>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    panel: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.lineSoft,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing[5],
      paddingVertical: theme.spacing[5],
      marginBottom: 14,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headText: { flex: 1, gap: 2 },
    title: { fontSize: 14, fontWeight: '700', color: theme.colors.ink },
    sub: { fontSize: 12, color: theme.colors.ink4 },
    body: { marginTop: theme.spacing[4], gap: 18 },
    field: { gap: 8 },
    labelRow: { flexDirection: 'row', alignItems: 'baseline' },
    label: { fontSize: 13.5, fontWeight: '600', color: theme.colors.ink, flex: 1 },
    val: { fontSize: 13.5, fontWeight: '700', color: theme.colors.accentDeep },
    desc: { fontSize: 12, color: theme.colors.ink4 },
    steps: { flexDirection: 'row', gap: 6 },
    step: {
      flex: 1,
      height: 30,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepOn: {
      backgroundColor: theme.colors.accentSoft,
      borderColor: theme.colors.accentLine,
    },
    stepText: { fontSize: 12.5, color: theme.colors.ink3 },
    stepTextOn: { color: theme.colors.accentDeep, fontWeight: '600' },
    note: { fontSize: 12, color: theme.colors.ink4 },
    foot: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    ghostBtn: {
      height: 34,
      paddingHorizontal: theme.spacing[4],
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostText: { fontSize: 13.5, color: theme.colors.ink2, fontWeight: '500' },
    primaryBtn: {
      height: 34,
      paddingHorizontal: theme.spacing[4],
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { fontSize: 13.5, color: theme.colors.onAccent, fontWeight: '500' },
    disabled: { opacity: 0.45 },
  });
}
