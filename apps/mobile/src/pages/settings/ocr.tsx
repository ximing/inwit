import { OCR_DEFAULT_MODEL } from '@inwit/dto';
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
import { useTheme, type ThemeTokens } from '@/theme';
import { SettingsService } from './settings.service';

const OcrContent = observer(function OcrContent() {
  const service = useService(SettingsService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="文档解析" onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lede}>用于扫描版 PDF 文字提取，计费走用户自己的百炼账户。</Text>
          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={styles.input}
            value={service.ocrApiKey}
            onChangeText={(value) => service.setOcrApiKey(value)}
            placeholder={service.ocrConfig?.apiKeyPreview || 'sk-…'}
            placeholderTextColor={theme.colors.ink4}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={styles.label}>模型</Text>
          <TextInput
            style={styles.input}
            value={service.ocrModel}
            onChangeText={(value) => service.setOcrModel(value)}
            placeholder={OCR_DEFAULT_MODEL}
            placeholderTextColor={theme.colors.ink4}
            autoCapitalize="none"
          />
          <Text style={styles.label}>Base URL（可选）</Text>
          <TextInput
            style={styles.input}
            value={service.ocrBaseUrl}
            onChangeText={(value) => service.setOcrBaseUrl(value)}
            placeholder="https://…"
            placeholderTextColor={theme.colors.ink4}
            autoCapitalize="none"
            keyboardType="url"
          />
          {service.ocrFormError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {service.ocrFormError}
            </Text>
          ) : null}
          {service.ocrTestResult ? (
            <Text style={service.ocrTestResult.ok ? styles.ok : styles.error}>
              {service.ocrTestResult.ok ? '连通正常' : `不通：${service.ocrTestResult.error}`}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable
              disabled={service.$model.saveOcr.loading}
              onPress={() => void service.saveOcr()}
              style={[styles.primary, service.$model.saveOcr.loading && styles.dim]}
            >
              <Text style={styles.primaryText}>
                {service.$model.saveOcr.loading ? '保存中…' : '保存'}
              </Text>
            </Pressable>
            <Pressable
              disabled={service.$model.testOcr.loading}
              onPress={() => void service.testOcr()}
              style={[styles.secondary, service.$model.testOcr.loading && styles.dim]}
            >
              <Text style={styles.secondaryText}>
                {service.$model.testOcr.loading ? '测试中…' : '测试'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    flex: { flex: 1 },
    body: { paddingHorizontal: theme.spacing[5], paddingBottom: 40 },
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
    error: { color: theme.colors.accent, fontSize: 13.5, marginTop: 8 },
    ok: { color: theme.colors.green, fontSize: 13.5, marginTop: 8 },
    row: { flexDirection: 'row', gap: 10, marginTop: 18 },
    primary: {
      flex: 1,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
    secondary: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.sm,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    secondaryText: { color: theme.colors.ink2, fontSize: 15, fontWeight: '500' },
    dim: { opacity: 0.5 },
  });
}

export default bindServices(OcrContent, [SettingsService]);
