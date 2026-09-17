import { observer, useService } from '@rabjs/react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ToastService } from '@/services/toast.service';
import { useTheme } from '@/theme';

export const ToastHost = observer(function ToastHost() {
  const toast = useService(ToastService);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (!toast.message) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, 12) + 56, paddingHorizontal: theme.spacing[4] },
      ]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: theme.colors.ink,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing[4],
            paddingVertical: theme.spacing[3],
            ...theme.shadow[2],
          },
        ]}
      >
        <Text style={[styles.text, { color: theme.colors.surface }]}>{toast.message}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  bubble: {
    maxWidth: 360,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
