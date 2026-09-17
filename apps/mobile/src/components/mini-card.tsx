import { IMAGE_EXCERPT_QUOTE, type DocumentCard } from '@inwit/dto';
import { observer } from '@rabjs/react';
import { Image } from 'expo-image';
import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseCloze } from '@/lib/cloze';
import { formatNextReview, masteryLevel } from '@/lib/format';
import { useTheme, type ThemeTokens } from '@/theme';

export function ClozeText({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text style={{ color: theme.colors.ink, fontSize: 14.5, lineHeight: 22 }}>
      {parseCloze(text).map((part, index) =>
        part.type === 'cloze' ? (
          <Text key={index} style={{ backgroundColor: theme.colors.hl, color: theme.colors.ink }}>
            {part.value}
          </Text>
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        ),
      )}
    </Text>
  );
}

export function MasteryDots({ level }: { level: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[0, 1, 2, 3].map((slot) => (
        <View
          key={slot}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: slot < level ? theme.colors.gold : theme.colors.line,
          }}
        />
      ))}
    </View>
  );
}

export function cardMasteryLevel(card: DocumentCard): number {
  return card.review ? masteryLevel(card.review.intervalDays) : 0;
}

export function cardNextReviewLabel(card: DocumentCard): string {
  return card.review ? formatNextReview(card.review.dueAt) : '还没进复习队列';
}

export const MiniCard = observer(function MiniCard({
  card,
  active,
  lost,
  thumbUrl,
  onPress,
}: {
  card: DocumentCard;
  active?: boolean;
  lost?: boolean;
  thumbUrl?: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const question = card.questions[0]?.question ?? card.concept;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, active && styles.cardOn, lost && styles.cardLost]}
    >
      {thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={styles.thumb} contentFit="cover" />
      ) : null}
      {question.trim() !== IMAGE_EXCERPT_QUOTE ? (
        <View style={styles.q}>
          <ClozeText text={question} />
        </View>
      ) : null}
      <View style={styles.foot}>
        <MasteryDots level={cardMasteryLevel(card)} />
        <Text style={styles.meta}>{cardNextReviewLabel(card)}</Text>
        {card.source === 'manual' ? <Text style={styles.hand}>手写</Text> : null}
        {lost ? <Text style={styles.lost}>原文已删除</Text> : null}
      </View>
    </Pressable>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.md,
      padding: theme.spacing[3],
      gap: 8,
    },
    cardOn: { borderColor: theme.colors.accentLine, backgroundColor: theme.colors.accentSoft },
    cardLost: { opacity: 0.7 },
    thumb: { width: '100%', height: 96, borderRadius: 8, backgroundColor: theme.colors.bgSunken },
    q: {},
    foot: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    meta: { fontSize: 12, color: theme.colors.ink4 },
    hand: { fontSize: 11, color: theme.colors.ink3 },
    lost: { fontSize: 11, color: theme.colors.accent, fontWeight: '600' },
  });
}
