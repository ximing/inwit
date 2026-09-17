import { observer, useService } from '@rabjs/react';
import { Tabs } from 'expo-router';
import { FileText, Home, ListTodo, Repeat, Tags, User } from 'lucide-react-native';
import { useEffect } from 'react';
import { LayoutService } from '@/services/layout.service';
import { ThemeService, useTheme } from '@/theme';

const TabsLayout = observer(function TabsLayout() {
  const theme = useTheme();
  const themeService = useService(ThemeService);
  const layout = useService(LayoutService);
  const dark = themeService.resolved === 'dark';
  const dueCount = layout.dueCount;

  useEffect(() => {
    void layout.refreshDue();
  }, [layout]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? theme.colors.accentDeep : theme.colors.accentDeep,
        tabBarInactiveTintColor: theme.colors.ink3,
        tabBarStyle: {
          backgroundColor: theme.colors.bg,
          borderTopColor: theme.colors.lineSoft,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        sceneStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '今日',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="docs"
        options={{
          title: '文档',
          tabBarIcon: ({ color, size }) => <FileText color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: '复习',
          tabBarBadge: dueCount > 0 ? dueCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.accent,
            color: theme.colors.onAccent,
            fontSize: 11,
          },
          tabBarIcon: ({ color, size }) => <Repeat color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="topics"
        options={{
          title: '主题',
          tabBarIcon: ({ color, size }) => <Tags color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: '任务',
          tabBarIcon: ({ color, size }) => <ListTodo color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: '我的',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} strokeWidth={1.75} />,
        }}
      />
    </Tabs>
  );
});

export default TabsLayout;
