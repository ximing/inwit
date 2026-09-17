import { bindServices, observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
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
import { StackHeader } from '@/components/stack-header';
import { formatDate, formatDateTime } from '@/lib/format';
import { useTheme, type ThemeTokens } from '@/theme';
import {
  ACCESS_TOKEN_MAX_PER_USER,
  ACCESS_TOKEN_NAME_MAX,
  SettingsService,
} from './settings.service';

const TokensContent = observer(function TokensContent() {
  const service = useService(SettingsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const atMax = service.accessTokens.length >= ACCESS_TOKEN_MAX_PER_USER;

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="接口令牌" onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lede}>
            用于脚本或自动化调用接口。生成后永久有效。请求头 Authorization: Bearer &lt;token&gt;。
          </Text>

          <View style={styles.tabs}>
            <Pressable
              onPress={() => service.setTokenPane('list')}
              style={[styles.tab, service.tokenPane === 'list' && styles.tabOn]}
            >
              <Text style={[styles.tabText, service.tokenPane === 'list' && styles.tabTextOn]}>
                令牌
              </Text>
            </Pressable>
            <Pressable
              onPress={() => service.setTokenPane('logs')}
              style={[styles.tab, service.tokenPane === 'logs' && styles.tabOn]}
            >
              <Text style={[styles.tabText, service.tokenPane === 'logs' && styles.tabTextOn]}>
                调用日志
              </Text>
            </Pressable>
          </View>

          {service.tokenPane === 'list' ? (
            <>
              <Text style={styles.label}>名称</Text>
              <TextInput
                style={styles.input}
                value={service.tokenName}
                onChangeText={(value) => service.setTokenName(value)}
                maxLength={ACCESS_TOKEN_NAME_MAX}
                placeholder="例如：本地脚本"
                placeholderTextColor={theme.colors.ink4}
              />
              {service.accessTokenError ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {service.accessTokenError}
                </Text>
              ) : null}
              <Pressable
                disabled={service.$model.generateAccessToken.loading || atMax}
                onPress={() => void service.generateAccessToken()}
                style={[
                  styles.primary,
                  (service.$model.generateAccessToken.loading || atMax) && styles.dim,
                ]}
              >
                <Text style={styles.primaryText}>
                  {service.$model.generateAccessToken.loading ? '生成中…' : '生成令牌'}
                </Text>
              </Pressable>
              {atMax ? (
                <Text style={styles.hint}>已达到 {ACCESS_TOKEN_MAX_PER_USER} 个上限。</Text>
              ) : null}

              {service.accessTokens.length === 0 ? (
                <Text style={styles.hint}>还没有令牌。生成后可在脚本里调用接口。</Text>
              ) : (
                service.accessTokens.map((token) => (
                  <View key={token.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{token.name}</Text>
                    <Text style={styles.meta}>
                      {token.preview} · {formatDate(token.createdAt)} 生成
                    </Text>
                    <Pressable
                      disabled={service.copyingId === token.id}
                      onPress={() => void service.copyAccessToken(token.id)}
                      style={styles.secondary}
                    >
                      <Text style={styles.secondaryText}>
                        {service.copyingId === token.id ? '复制中…' : '复制'}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </>
          ) : (
            <>
              <Text style={styles.hint}>仅记录以接口令牌发起的请求，保留 7 天。</Text>
              {service.accessTokenLogsError ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {service.accessTokenLogsError}
                </Text>
              ) : null}
              {service.$model.loadAccessTokenLogs.loading && service.accessTokenLogs.length === 0 ? (
                <Text style={styles.hint}>读取日志…</Text>
              ) : null}
              {!service.$model.loadAccessTokenLogs.loading && service.accessTokenLogs.length === 0 ? (
                <Text style={styles.hint}>近 7 天没有调用记录。</Text>
              ) : null}
              {service.accessTokenLogs.map((log) => (
                <View key={log.id} style={styles.logRow}>
                  <Text style={styles.meta}>{formatDateTime(log.createdAt)}</Text>
                  <Text style={styles.cardTitle}>
                    {log.method} {log.path}
                  </Text>
                  <Text style={styles.meta}>
                    {log.tokenName} · {log.status}
                  </Text>
                </View>
              ))}
              {service.accessTokenLogsTotal > 0 ? (
                <View style={styles.pager}>
                  <Pressable
                    disabled={!service.accessTokenLogsHasPrev}
                    onPress={() => void service.loadAccessTokenLogs(service.accessTokenLogsPage - 1)}
                    style={[styles.ghostBtn, !service.accessTokenLogsHasPrev && styles.dim]}
                  >
                    <Text style={styles.ghostText}>上一页</Text>
                  </Pressable>
                  <Text style={styles.pageText}>
                    {service.accessTokenLogsPage} /{' '}
                    {Math.max(
                      1,
                      Math.ceil(service.accessTokenLogsTotal / service.accessTokenLogsLimit),
                    )}
                  </Text>
                  <Pressable
                    disabled={!service.accessTokenLogsHasNext}
                    onPress={() => void service.loadAccessTokenLogs(service.accessTokenLogsPage + 1)}
                    style={[styles.ghostBtn, !service.accessTokenLogsHasNext && styles.dim]}
                  >
                    <Text style={styles.ghostText}>下一页</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    flex: { flex: 1 },
    body: { paddingHorizontal: theme.spacing[5], paddingBottom: 48 },
    lede: { fontSize: 13.5, color: theme.colors.ink3, marginBottom: 14, lineHeight: 20 },
    tabs: {
      flexDirection: 'row',
      backgroundColor: theme.colors.surface2,
      borderRadius: theme.radius.md,
      padding: 3,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: theme.colors.lineSoft,
    },
    tab: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    tabOn: { backgroundColor: theme.colors.surface, ...theme.shadow[1] },
    tabText: { fontSize: 13, color: theme.colors.ink3 },
    tabTextOn: { color: theme.colors.ink, fontWeight: '600' },
    label: { fontSize: 13.5, color: theme.colors.ink2, marginBottom: 6, marginTop: 4 },
    input: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      minHeight: 42,
      color: theme.colors.ink,
      fontSize: 15,
    },
    error: { color: theme.colors.accent, fontSize: 13.5, marginTop: 8 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 12, lineHeight: 20 },
    primary: {
      marginTop: 14,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
    dim: { opacity: 0.45 },
    card: {
      marginTop: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.md,
      padding: 12,
    },
    cardTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.ink },
    meta: { fontSize: 12.5, color: theme.colors.ink3, marginTop: 4, fontFamily: theme.typography.mono },
    secondary: {
      alignSelf: 'flex-start',
      marginTop: 10,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { color: theme.colors.ink2, fontSize: 13, fontWeight: '500' },
    logRow: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    pager: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 16,
    },
    ghostBtn: {
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    ghostText: { fontSize: 13, color: theme.colors.ink2 },
    pageText: { fontSize: 12.5, color: theme.colors.ink3 },
  });
}

export default bindServices(TokensContent, [SettingsService]);
