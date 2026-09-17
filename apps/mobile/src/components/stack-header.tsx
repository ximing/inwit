import { observer } from '@rabjs/react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, type ThemeTokens } from '@/theme';

export const StackHeader = observer(function StackHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.head}>
      <Pressable onPress={onBack} hitSlop={8} style={styles.side}>
        <Text style={styles.back}>← 返回</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.sideRight}>{right}</View>
    </View>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing[4],
      paddingVertical: 8,
      gap: 8,
    },
    side: { minWidth: 64 },
    sideRight: { minWidth: 64, alignItems: 'flex-end' },
    back: { color: theme.colors.accentDeep, fontSize: 15, fontWeight: '600' },
    title: {
      flex: 1,
      textAlign: 'center',
      fontFamily: theme.typography.serif,
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.ink,
    },
  });
}
