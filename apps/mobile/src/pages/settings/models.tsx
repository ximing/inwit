import { bindServices, observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackHeader } from '@/components/stack-header';
import { confirmAction } from '@/lib/confirm';
import { useTheme, type ThemeTokens } from '@/theme';
import {
  PROVIDER_LABELS,
  PROVIDERS,
  SettingsService,
} from './settings.service';

const ModelsContent = observer(function ModelsContent() {
  const service = useService(SettingsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="模型配置" onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lede}>
            自带密钥（BYOK）。完整密钥只在新增时提交一次，列表里只显示掩码。
          </Text>
          {service.error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {service.error}
            </Text>
          ) : null}

          <Text style={styles.label}>供应商</Text>
          <View style={styles.chips}>
            {PROVIDERS.map((provider) => {
              const on = service.provider === provider;
              return (
                <Pressable
                  key={provider}
                  onPress={() => service.setProvider(provider)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {PROVIDER_LABELS[provider]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>模型</Text>
          <TextInput
            style={styles.input}
            value={service.model}
            onChangeText={(value) => service.setModel(value)}
            placeholder="模型名"
            placeholderTextColor={theme.colors.ink4}
            autoCapitalize="none"
          />
          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={styles.input}
            value={service.apiKey}
            onChangeText={(value) => service.setApiKey(value)}
            placeholder="sk-…"
            placeholderTextColor={theme.colors.ink4}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={styles.label}>Base URL（可选）</Text>
          <TextInput
            style={styles.input}
            value={service.baseUrl}
            onChangeText={(value) => service.setBaseUrl(value)}
            placeholder="https://…"
            placeholderTextColor={theme.colors.ink4}
            autoCapitalize="none"
            keyboardType="url"
          />
          <View style={styles.check}>
            <Switch
              value={service.isDefault}
              onValueChange={(value) => service.setIsDefault(value)}
              trackColor={{ false: theme.colors.line, true: theme.colors.accentLine }}
              thumbColor={service.isDefault ? theme.colors.accent : theme.colors.ink4}
            />
            <Text style={styles.checkLabel}>设为默认</Text>
          </View>
          {service.formError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {service.formError}
            </Text>
          ) : null}
          <Pressable
            disabled={service.$model.add.loading}
            onPress={() => void service.add()}
            style={[styles.primary, service.$model.add.loading && styles.dim]}
          >
            <Text style={styles.primaryText}>
              {service.$model.add.loading ? '保存中…' : '新增配置'}
            </Text>
          </Pressable>

          {service.$model.load.loading && service.configs.length === 0 ? (
            <Text style={styles.hint}>读取配置…</Text>
          ) : null}
          {service.configs.length === 0 && !service.$model.load.loading ? (
            <Text style={styles.hint}>还没有自己的模型，现在会走系统通义 —— 想换的话在上面加一条。</Text>
          ) : null}

          {service.configs.map((config) => {
            const result = service.testResults[config.id];
            return (
              <View key={config.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {PROVIDER_LABELS[config.provider]}
                  <Text style={styles.mono}>  {config.model}</Text>
                  {config.isDefault ? <Text style={styles.badge}>  默认</Text> : null}
                </Text>
                <Text style={styles.meta}>
                  密钥 {config.apiKeyPreview}
                  {config.baseUrl ? ` · ${config.baseUrl}` : ''}
                </Text>
                {result ? (
                  <Text style={result.ok ? styles.ok : styles.error}>
                    {result.ok ? '连通正常' : `不通：${result.error}`}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  {!config.isDefault ? (
                    <Pressable
                      disabled={service.busyId === config.id}
                      onPress={() => void service.makeDefault(config.id)}
                    >
                      <Text style={styles.link}>设为默认</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    disabled={service.testingId === config.id}
                    onPress={() => void service.test(config.id)}
                  >
                    <Text style={styles.link}>
                      {service.testingId === config.id ? '测试中…' : '测试连通'}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={service.busyId === config.id}
                    onPress={() => {
                      void confirmAction('删除配置', '删除这个模型配置？', '删除', true).then(
                        (ok) => {
                          if (ok) void service.remove(config.id);
                        },
                      );
                    }}
                  >
                    <Text style={styles.danger}>删除</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
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
    label: { fontSize: 13.5, color: theme.colors.ink2, marginBottom: 6, marginTop: 10 },
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
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      height: 30,
      paddingHorizontal: 10,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentLine },
    chipText: { fontSize: 12.5, color: theme.colors.ink2 },
    chipTextOn: { color: theme.colors.accentDeep, fontWeight: '600' },
    check: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
    checkLabel: { fontSize: 14, color: theme.colors.ink2 },
    error: { color: theme.colors.accent, fontSize: 13.5, marginTop: 8 },
    ok: { color: theme.colors.green, fontSize: 13.5, marginTop: 6 },
    hint: { fontSize: 13.5, color: theme.colors.ink3, marginTop: 16, lineHeight: 20 },
    primary: {
      marginTop: 16,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
    dim: { opacity: 0.5 },
    card: {
      marginTop: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.md,
      padding: 12,
    },
    cardTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.ink },
    mono: { fontFamily: theme.typography.mono, fontWeight: '400', fontSize: 13, color: theme.colors.ink2 },
    badge: { fontSize: 12, color: theme.colors.accentDeep, fontWeight: '600' },
    meta: { fontSize: 12.5, color: theme.colors.ink3, marginTop: 4 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10 },
    link: { color: theme.colors.accentDeep, fontWeight: '600', fontSize: 13 },
    danger: { color: theme.colors.accent, fontWeight: '600', fontSize: 13 },
  });
}

export default bindServices(ModelsContent, [SettingsService]);
