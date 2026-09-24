import { Image } from 'expo-image';
import { observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmAction } from '@/lib/confirm';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';
import { useTheme, type ThemeTokens } from '@/theme';

const SECTIONS: Array<{ href: string; title: string; lede: string }> = [
  { href: ROUTES.meMemory, title: '记忆', lede: '集合和最近的整理记录' },
  { href: '/me/profile', title: '个人资料', lede: '头像、用户名和登录邮箱' },
  { href: '/me/appearance', title: '外观', lede: '浅色、深色或跟随系统' },
  { href: '/me/models', title: '模型配置', lede: '自带密钥（BYOK）' },
  { href: '/me/ocr', title: '文档解析', lede: '扫描版 PDF 的 OCR' },
  { href: '/me/tokens', title: '接口令牌', lede: '脚本与自动化调用' },
];

const MeContent = observer(function MeContent() {
  const auth = useService(AuthService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const avatar = auth.visibleAvatarUrl;

  const logout = async () => {
    const ok = await confirmAction('退出登录', '此设备将需要重新登录。', '退出', true);
    if (ok) await auth.logout();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.title}>我的</Text>
      </View>
      <View style={styles.hero}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.initial}>{auth.displayInitial}</Text>
          </View>
        )}
        <View style={styles.heroText}>
          <Text style={styles.name} numberOfLines={1}>
            {auth.displayLabel || '未命名'}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {auth.user?.email ?? ''}
          </Text>
        </View>
      </View>

      {SECTIONS.map((item) => (
        <Pressable
          key={item.href}
          onPress={() => router.push(item.href)}
          style={styles.row}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowLede}>{item.lede}</Text>
          </View>
          <ChevronRight color={theme.colors.ink4} size={16} strokeWidth={1.8} />
        </Pressable>
      ))}

      <Pressable onPress={() => void logout()} style={styles.logout}>
        <Text style={styles.logoutText}>退出登录</Text>
      </Pressable>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    head: {
      paddingHorizontal: theme.spacing[5],
      paddingTop: theme.spacing[3],
      paddingBottom: theme.spacing[2],
    },
    title: {
      fontFamily: theme.typography.serif,
      fontSize: theme.typography.size['2xl'],
      fontWeight: '700',
      color: theme.colors.ink,
    },
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: theme.spacing[5],
      paddingVertical: 16,
    },
    avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.surface2 },
    avatarFallback: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initial: { fontSize: 22, fontWeight: '700', color: theme.colors.accentDeep },
    heroText: { flex: 1 },
    name: { fontSize: 17, fontWeight: '700', color: theme.colors.ink },
    email: { fontSize: 13, color: theme.colors.ink3, marginTop: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing[5],
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15.5, fontWeight: '600', color: theme.colors.ink },
    rowLede: { fontSize: 12.5, color: theme.colors.ink3, marginTop: 2 },
    logout: { marginTop: 28, marginHorizontal: theme.spacing[5], alignItems: 'center', paddingVertical: 12 },
    logoutText: { color: theme.colors.accent, fontWeight: '600', fontSize: 15 },
  });
}

export default MeContent;
