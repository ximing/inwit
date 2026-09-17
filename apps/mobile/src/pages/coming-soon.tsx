import { observer } from '@rabjs/react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

export const ComingSoon = observer(function ComingSoon({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: theme.spacing[6], paddingTop: theme.spacing[4] }}>
        <Text
          style={{
            fontFamily: theme.typography.serif,
            fontSize: theme.typography.size['2xl'],
            fontWeight: '700',
            color: theme.colors.ink,
            letterSpacing: 0.02 * theme.typography.size['2xl'],
          }}
        >
          {title}
        </Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.line,
            borderWidth: 1,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.spacing[8],
            paddingVertical: theme.spacing[6],
            ...theme.shadow[1],
          }}
        >
          <Text style={{ color: theme.colors.ink3, fontSize: theme.typography.size.md }}>即将上线</Text>
        </View>
      </View>
    </SafeAreaView>
  );
});
