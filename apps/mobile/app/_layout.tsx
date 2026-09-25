import 'react-native-gesture-handler';

import { observer, register, resolve, RSRoot, useService } from '@rabjs/react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { ToastHost } from '@/components/toast';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { AuthService } from '@/services/auth.service';
import { LayoutService } from '@/services/layout.service';
import { ToastService } from '@/services/toast.service';
import { ThemeService, useTheme } from '@/theme';

register(ThemeService);
register(AuthService);
register(LayoutService);
register(ToastService);
register(AssetUrlsService);
resolve(ThemeService);
resolve(AuthService);
resolve(LayoutService);
resolve(ToastService);
resolve(AssetUrlsService);

const Splash = observer(function Splash() {
  const auth = useService(AuthService);
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing[3],
        paddingHorizontal: theme.spacing[6],
      }}
    >
      <Text
        style={{
          fontFamily: theme.typography.serif,
          fontSize: 19,
          fontWeight: '700',
          color: theme.colors.ink,
          letterSpacing: 0.4,
        }}
      >
        Inwit
      </Text>
      {auth.bootstrapError ? (
        <>
          <Text
            style={{
              color: theme.colors.accent,
              fontSize: theme.typography.size.sm,
              textAlign: 'center',
            }}
          >
            {auth.bootstrapError}
          </Text>
          <Pressable
            onPress={() => void auth.bootstrap()}
            style={{
              marginTop: theme.spacing[2],
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.sm,
              paddingHorizontal: theme.spacing[4],
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.onAccent, fontSize: 13.5, fontWeight: '500' }}>重试</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
});

const RootNavigation = observer(function RootNavigation() {
  const auth = useService(AuthService);
  const themeService = useService(ThemeService);
  const theme = useTheme();
  const loggedIn = auth.user !== null;

  if (auth.bootstrapping || auth.bootstrapError) {
    return (
      <>
        <StatusBar style={themeService.resolved === 'dark' ? 'light' : 'dark'} />
        <Splash />
      </>
    );
  }

  return (
    <>
      <StatusBar style={themeService.resolved === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Protected guard={loggedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="review/session"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="docs/[id]"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="search"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="topics/[id]"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="me/profile"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="me/appearance"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="me/models"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="me/ocr"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="me/tokens"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="me/memory"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
          <Stack.Screen
            name="me/archive"
            options={{ animation: 'slide_from_right', gestureEnabled: true }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!loggedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      <ToastHost />
    </>
  );
});

export default function RootLayout() {
  return (
    <RSRoot>
      <RootNavigation />
    </RSRoot>
  );
}
