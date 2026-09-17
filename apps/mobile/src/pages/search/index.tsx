import { docDisplayTitle } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type ThemeTokens } from '@/theme';
import { SearchService } from './search.service';

const SearchContent = observer(function SearchContent() {
  const service = useService(SearchService);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const params = useLocalSearchParams<{ topicId?: string | string[] }>();
  const topicId = Array.isArray(params.topicId) ? params.topicId[0] : params.topicId;

  useEffect(() => {
    service.setTopicId(topicId ?? null);
  }, [service, topicId]);

  const docs = service.results?.documents ?? [];
  const cards = service.results?.cards ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.head}>
        <TextInput
          style={styles.input}
          value={service.query}
          onChangeText={(value) => service.setQuery(value)}
          placeholder="搜索文档和卡片"
          placeholderTextColor={theme.colors.ink4}
          autoFocus
          returnKeyType="search"
        />
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancel}>取消</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {service.error ? (
          <View>
            <Text style={styles.error}>{service.error}</Text>
            <Pressable onPress={() => service.retry()}>
              <Text style={styles.retry}>{service.$model.runSearch.loading ? '重试中…' : '重试'}</Text>
            </Pressable>
          </View>
        ) : null}
        {service.searching ? <Text style={styles.status}>正在搜索…</Text> : null}
        {service.isEmpty ? <Text style={styles.status}>没有搜到，换个说法试试</Text> : null}

        {docs.length > 0 ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>文档</Text>
            {docs.map((doc) => (
              <Pressable
                key={doc.id}
                style={styles.hit}
                onPress={() =>
                  router.push({ pathname: '/docs/[id]', params: { id: doc.id } })
                }
              >
                <Text style={styles.hitTitle} numberOfLines={1}>
                  {docDisplayTitle(doc)}
                </Text>
                {doc.topicTitle ? <Text style={styles.hitMeta}>{doc.topicTitle}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {cards.length > 0 ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>卡片</Text>
            {cards.map((card) => (
              <Pressable
                key={card.id}
                style={styles.hit}
                onPress={() => {
                  if (card.documentId) {
                    router.push({
                      pathname: '/docs/[id]',
                      params: { id: card.documentId, anchor: card.id },
                    });
                    return;
                  }
                  router.back();
                }}
              >
                <Text style={styles.hitTitle} numberOfLines={2}>
                  {card.concept}
                </Text>
                {card.documentTitle ? (
                  <Text style={styles.hitMeta}>{card.documentTitle}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
});

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: 8,
    },
    input: {
      flex: 1,
      height: 40,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 12,
      color: theme.colors.ink,
      fontSize: 15,
    },
    cancel: { color: theme.colors.accentDeep, fontSize: 15, fontWeight: '600' },
    body: { paddingHorizontal: theme.spacing[5], paddingBottom: 40 },
    error: { color: theme.colors.accent, fontSize: 13.5, marginBottom: 8 },
    retry: { color: theme.colors.accentDeep, fontWeight: '600' },
    status: { color: theme.colors.ink3, fontSize: 13.5, marginTop: 12 },
    group: { marginTop: 18, gap: 4 },
    groupTitle: { fontSize: 13, fontWeight: '700', color: theme.colors.ink3, marginBottom: 6 },
    hit: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.lineSoft,
    },
    hitTitle: { fontSize: 15, color: theme.colors.ink, fontWeight: '500' },
    hitMeta: { fontSize: 12, color: theme.colors.ink4, marginTop: 2 },
  });
}

export default bindServices(SearchContent, [SearchService]);
