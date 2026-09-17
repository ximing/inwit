import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
import { AuthService } from '@/services/auth.service';
import { useTheme, type ThemeTokens } from '@/theme';
import { SettingsService } from './settings.service';

const ProfileContent = observer(function ProfileContent() {
  const service = useService(SettingsService);
  const auth = useService(AuthService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    service.hydrateProfile();
  }, [service]);

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset) void service.uploadAvatar(asset);
  };

  const avatar = auth.visibleAvatarUrl;
  const uploading = service.$model.uploadAvatar.loading;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="个人资料" onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.avatarRow}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.initial}>{auth.displayInitial}</Text>
              </View>
            )}
            <Pressable
              disabled={uploading}
              onPress={() => void pick()}
              style={[styles.secondary, uploading && styles.dim]}
            >
              <Text style={styles.secondaryText}>{uploading ? '上传中…' : '更换头像'}</Text>
            </Pressable>
          </View>
          {service.avatarError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {service.avatarError}
            </Text>
          ) : null}

          <Text style={styles.label}>用户名</Text>
          <TextInput
            style={styles.input}
            value={service.displayName}
            onChangeText={(value) => service.setDisplayName(value)}
            maxLength={64}
            placeholder="怎么称呼你"
            placeholderTextColor={theme.colors.ink4}
            autoComplete="nickname"
          />
          <Text style={styles.label}>邮箱</Text>
          <TextInput
            style={styles.input}
            value={service.email}
            onChangeText={(value) => service.setEmail(value)}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="邮箱"
            placeholderTextColor={theme.colors.ink4}
          />
          {service.profileError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {service.profileError}
            </Text>
          ) : null}
          <Pressable
            disabled={service.$model.saveProfile.loading}
            onPress={() => void service.saveProfile()}
            style={[styles.primary, service.$model.saveProfile.loading && styles.dim]}
          >
            <Text style={styles.primaryText}>
              {service.$model.saveProfile.loading ? '保存中…' : '保存'}
            </Text>
          </Pressable>
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
    avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
    avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.surface2 },
    avatarFallback: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initial: { fontSize: 24, fontWeight: '700', color: theme.colors.accentDeep },
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
    primary: {
      marginTop: 18,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
    secondary: {
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 14,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    secondaryText: { color: theme.colors.ink2, fontSize: 13.5, fontWeight: '500' },
    dim: { opacity: 0.5 },
  });
}

export default bindServices(ProfileContent, [SettingsService]);
