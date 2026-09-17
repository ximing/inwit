import { observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackHeader } from '@/components/stack-header';
import { THEME_OPTIONS, ThemeService, useTheme, type ThemePreference, type ThemeTokens } from '@/theme';

const SWATCH: Record<ThemePreference, [string, string]> = {
  light: ['#f6f3ec', '#fffdf8'],
  dark: ['#1c1915', '#26221c'],
  system: ['#f6f3ec', '#1c1915'],
};

const AppearanceContent = observer(function AppearanceContent() {
  const theme = useTheme();
  const themeService = useService(ThemeService);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="外观" onBack={() => router.back()} />
      <Text style={styles.lede}>浅色是白日书桌，深色是灯下夜读。</Text>
      <View style={styles.opts}>
        {THEME_OPTIONS.map((option) => {
          const on = themeService.preference === option.id;
          const [a, b] = SWATCH[option.id];
          return (
            <Pressable
              key={option.id}
              onPress={() => themeService.setPreference(option.id)}
              style={[styles.opt, on && styles.optOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={styles.swatch}>
                <View style={[styles.swatchHalf, { backgroundColor: a }]} />
                <View style={[styles.swatchHalf, { backgroundColor: b }]} />
              </View>
              <Text style={[styles.optLabel, on && styles.optLabelOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    lede: {
      fontSize: 13.5,
      color: theme.colors.ink3,
      paddingHorizontal: theme.spacing[5],
      marginBottom: 16,
    },
    opts: { paddingHorizontal: theme.spacing[5], gap: 10 },
    opt: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.lg,
      padding: 12,
    },
    optOn: { borderColor: theme.colors.accentLine, backgroundColor: theme.colors.accentSoft },
    swatch: {
      width: 48,
      height: 32,
      borderRadius: 8,
      overflow: 'hidden',
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    swatchHalf: { flex: 1 },
    optLabel: { fontSize: 15.5, color: theme.colors.ink, fontWeight: '500' },
    optLabelOn: { color: theme.colors.accentDeep, fontWeight: '700' },
  });
}

export default AppearanceContent;
