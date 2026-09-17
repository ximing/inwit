import { docDisplayTitle } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { DocEngineView, type DocEngineHandle } from '@/doc-engine/DocEngineView';
import { useDocEngineAssets } from '@/doc-engine/useDocEngineAssets';
import { resolveReportLink } from '@/lib/report-links';
import { getCard } from '@/api/cards';
import { useTheme } from '@/theme';
import { ReportsService } from './reports.service';

const ReportsContent = observer(function ReportsContent() {
  const service = useService(ReportsService);
  const theme = useTheme();
  const params = useLocalSearchParams<{ report?: string }>();
  const id = typeof params.report === 'string' && params.report ? params.report : null;
  const engine = useRef<DocEngineHandle>(null);
  const assets = useDocEngineAssets(engine);
  const text = { color: theme.colors.ink, fontSize: 15, lineHeight: 24 };
  const link = { color: theme.colors.accentDeep, fontSize: 15, paddingVertical: 12 };
  useEffect(() => { void service.load(); }, [service]);
  useEffect(() => { void service.open(id); }, [service, id]);
  useEffect(() => { if (service.report) engine.current?.setContent(service.report.contentJson); }, [service.report]);

  if (id) return <View style={{ flex: 1 }}>
    <Pressable accessibilityRole="button" onPress={() => router.setParams({ report: '' })} style={{ paddingHorizontal: 20 }}><Text style={link}>← 全部周报</Text></Pressable>
    {service.detailLoading ? <Text style={text}>正在加载周报…</Text> : null}
    {service.detailError ? <View style={{ padding: 20 }}><Text style={text}>{service.detailError}</Text><Pressable onPress={() => void service.retryDetail()}><Text style={link}>重试</Text></Pressable></View> : null}
    {service.report ? <>
      <Text style={{ ...text, fontSize: 22, fontWeight: '700', paddingHorizontal: 20, paddingBottom: 16 }}>{docDisplayTitle(service.report)}</Text>
      <DocEngineView key={id} ref={engine} style={{ flex: 1 }} onReady={() => { if (service.report) engine.current?.setContent(service.report.contentJson); }} onAssetNeeded={srcs => void assets(srcs)} onLinkClick={href => { void (async () => {
        const mapped = await resolveReportLink(href, getCard);
        if (mapped.kind === 'external') void WebBrowser.openBrowserAsync(mapped.url);
        else if (mapped.kind === 'internal') router.push({ pathname: mapped.pathname as '/docs/[id]', params: mapped.params });
      })().catch(() => { service.detailError = '链接暂时无法打开，请稍后重试'; }); }} />
    </> : null}
  </View>;

  return <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
    <Text style={{ ...text, fontSize: 26, fontWeight: '700' }}>学习周报</Text>
    <Text style={{ ...text, color: theme.colors.ink3, marginVertical: 12 }}>回顾每周的学习进展，找到值得再练一次的概念。</Text>
    {!service.ready ? <Text style={text}>正在加载周报…</Text> : null}
    {service.error ? <View><Text style={text}>{service.error}</Text><Pressable onPress={() => void service.load()}><Text style={link}>重试</Text></Pressable></View> : null}
    {service.ready && !service.error && service.reports.length === 0 ? <Text style={text}>第一份周报还在路上。本周有复习或新增学习内容后，系统会自动生成学习周报。</Text> : null}
    {service.reports.map(report => <Pressable key={report.id} accessibilityRole="button" onPress={() => router.setParams({ report: report.id })} style={{ paddingVertical: 20, borderTopWidth: 1, borderColor: theme.colors.line }}>
      <Text style={{ ...text, color: theme.colors.ink3, fontSize: 12 }}>{report.reportWeekStart} 起的一周</Text>
      <Text style={{ ...text, fontSize: 18, fontWeight: '600', marginTop: 8 }}>{docDisplayTitle(report)}</Text>
      <Text style={link}>阅读周报 →</Text>
    </Pressable>)}
    {service.reports.length < service.total ? <Pressable disabled={service.$model.loadMore.loading} onPress={() => void service.loadMore()}><Text style={link}>{service.$model.loadMore.loading ? '加载中…' : '更早的周报'}</Text></Pressable> : null}
  </ScrollView>;
});

export const ReportsPane = bindServices(ReportsContent, [ReportsService]);
