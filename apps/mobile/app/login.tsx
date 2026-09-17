import { bindServices, observer, useService } from '@rabjs/react';
import { useMemo } from 'react';
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
import { LoginService } from '@/pages/login/login.service';
import { useTheme, type ThemeTokens } from '@/theme';

const LoginContent = observer(function LoginContent() {
  const form = useService(LoginService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const submitting = form.$model.submit.loading;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.panel}>
            <Text style={styles.brand}>Inwit</Text>
            <Text style={styles.title}>{form.mode === 'login' ? '进来复习' : '开一个账'}</Text>
            <Text style={styles.lede}>把笔记扔进来，它替你切成卡片，到点催你回想。</Text>

            <View style={styles.modeSwitch} accessibilityRole="tablist">
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: form.mode === 'login' }}
                onPress={() => form.setMode('login')}
                style={[styles.modeTab, form.mode === 'login' && styles.modeTabOn]}
              >
                <Text style={[styles.modeLabel, form.mode === 'login' && styles.modeLabelOn]}>
                  登录
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: form.mode === 'register' }}
                onPress={() => form.setMode('register')}
                style={[styles.modeTab, form.mode === 'register' && styles.modeTabOn]}
              >
                <Text style={[styles.modeLabel, form.mode === 'register' && styles.modeLabelOn]}>
                  注册
                </Text>
              </Pressable>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>邮箱</Text>
                <TextInput
                  style={styles.input}
                  value={form.email}
                  onChangeText={(value) => form.setEmail(value)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  keyboardType="email-address"
                  placeholder="name@example.com"
                  placeholderTextColor={theme.colors.ink4}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>密码</Text>
                <TextInput
                  style={styles.input}
                  value={form.password}
                  onChangeText={(value) => form.setPassword(value)}
                  secureTextEntry
                  autoComplete={form.mode === 'login' ? 'password' : 'new-password'}
                  textContentType={form.mode === 'login' ? 'password' : 'newPassword'}
                  placeholder="至少 8 位"
                  placeholderTextColor={theme.colors.ink4}
                />
                <Text style={styles.hint}>至少 8 位</Text>
              </View>
              {form.error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {form.error}
                </Text>
              ) : null}
              <Pressable
                onPress={() => void form.submit()}
                disabled={!form.canSubmit}
                style={[styles.submit, !form.canSubmit && styles.submitDisabled]}
              >
                <Text style={styles.submitText}>
                  {submitting ? '请稍等…' : form.mode === 'login' ? '登录' : '注册并进入'}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: theme.spacing[6],
    },
    panel: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing[6],
      paddingTop: theme.spacing[8],
      paddingBottom: theme.spacing[6],
      ...theme.shadow[3],
    },
    brand: {
      fontFamily: theme.typography.serif,
      fontSize: 19,
      fontWeight: '700',
      color: theme.colors.ink,
      letterSpacing: 0.4,
    },
    title: {
      marginTop: theme.spacing[2],
      fontFamily: theme.typography.serif,
      fontSize: theme.typography.size['2xl'],
      fontWeight: '700',
      color: theme.colors.ink,
    },
    lede: {
      marginTop: theme.spacing[2],
      color: theme.colors.ink3,
      fontSize: theme.typography.size.md,
      lineHeight: theme.typography.size.md * theme.typography.lineHeight.body,
    },
    modeSwitch: {
      flexDirection: 'row',
      marginTop: theme.spacing[5],
      marginBottom: theme.spacing[4],
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.line,
    },
    modeTab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: theme.spacing[2],
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      marginBottom: -1,
    },
    modeTabOn: {
      borderBottomColor: theme.colors.accent,
    },
    modeLabel: {
      color: theme.colors.ink4,
      fontSize: theme.typography.size.md,
    },
    modeLabelOn: {
      color: theme.colors.ink,
      fontWeight: '600',
    },
    form: { gap: theme.spacing[3] },
    field: { gap: 4 },
    label: { fontSize: 13.5, color: theme.colors.ink2 },
    input: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.line,
      borderWidth: 1,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[3],
      minHeight: 38,
      color: theme.colors.ink,
      fontSize: theme.typography.size.md,
    },
    hint: { fontSize: theme.typography.size.xs, color: theme.colors.ink4 },
    error: { color: theme.colors.accent, fontSize: theme.typography.size.sm },
    submit: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing[4],
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: theme.spacing[1],
    },
    submitDisabled: { opacity: 0.45 },
    submitText: { color: theme.colors.onAccent, fontSize: 13.5, fontWeight: '500' },
  });
}

export default bindServices(LoginContent, [LoginService]);
