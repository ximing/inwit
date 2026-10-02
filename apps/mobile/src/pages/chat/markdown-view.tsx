import { observer } from '@rabjs/react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import {
  parseChatMarkdown,
  safeHref,
  safeImageSrc,
  type ChatBlock,
  type ChatInline,
  type ChatItem,
} from './chat-logic';

export const ChatMarkdown = observer(function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseChatMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </View>
  );
});

function BlockView({ block }: { block: ChatBlock }) {
  const theme = useTheme();
  switch (block.t) {
    case 'p': {
      const images = block.c.flatMap((node) => (node.t === 'image' ? [node] : []));
      const rest = block.c.filter((node) => node.t !== 'image');
      return (
        <View style={{ gap: 6 }}>
          {rest.length > 0 ? (
            <Text style={{ color: theme.colors.ink, fontSize: 15, lineHeight: 22 }}>
              <Inlines nodes={rest} />
            </Text>
          ) : null}
          {images.map((node, index) => (
            <ImageView key={index} alt={node.alt} src={node.src} />
          ))}
        </View>
      );
    }
    case 'h':
      return (
        <Text
          style={{
            color: theme.colors.ink,
            fontFamily: theme.typography.serif,
            fontSize: 20 - block.level,
            fontWeight: '700',
            lineHeight: 26,
          }}
        >
          <Inlines nodes={block.c} />
        </Text>
      );
    case 'ul':
    case 'ol':
      return (
        <View style={{ gap: 4 }}>
          {block.items.map((item, index) => (
            <ItemView
              key={index}
              item={item}
              marker={block.t === 'ol' ? `${String(block.start + index)}.` : '·'}
            />
          ))}
        </View>
      );
    case 'code':
      return (
        <View
          style={{
            backgroundColor: theme.colors.surface2,
            borderRadius: 8,
            padding: 10,
            gap: 4,
          }}
        >
          {block.lang ? (
            <Text style={{ color: theme.colors.ink3, fontSize: 11 }}>{block.lang}</Text>
          ) : null}
          <Text style={{ color: theme.colors.ink, fontFamily: 'Menlo', fontSize: 13 }} selectable>
            {block.v}
          </Text>
        </View>
      );
    case 'table':
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <TableRow cells={block.head} strong />
            {block.rows.map((row, index) => (
              <TableRow key={index} cells={row} />
            ))}
          </View>
        </ScrollView>
      );
    default:
      return null;
  }
}

function TableRow({ cells, strong = false }: { cells: ChatInline[][]; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row' }}>
      {cells.map((cell, index) => (
        <Text
          key={index}
          style={{
            width: 120,
            paddingVertical: 4,
            paddingRight: 8,
            color: theme.colors.ink,
            fontSize: 13,
            fontWeight: strong ? '700' : '400',
          }}
        >
          <Inlines nodes={cell} />
        </Text>
      ))}
    </View>
  );
}

function ItemView({ item, marker }: { item: ChatItem; marker: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <Text style={{ color: theme.colors.ink3, width: 18 }}>{marker}</Text>
      <View style={{ flex: 1, gap: 4 }}>
        {item.c.map((child, index) => (
          <BlockView key={index} block={child} />
        ))}
      </View>
    </View>
  );
}

function ImageView({ alt, src }: { alt: string; src: string }) {
  const safe = safeImageSrc(src);
  if (!safe) return <Text>{alt}</Text>;
  return (
    <Image
      source={{ uri: safe }}
      style={{ width: 220, height: 140, borderRadius: 8 }}
      contentFit="contain"
      accessibilityLabel={alt}
    />
  );
}

function Inlines({ nodes }: { nodes: ChatInline[] }) {
  return nodes.map((node, index) => <InlineView key={index} node={node} />);
}

function InlineView({ node }: { node: ChatInline }) {
  const theme = useTheme();
  switch (node.t) {
    case 'text':
      return node.v;
    case 'br':
      return '\n';
    case 'code':
      return (
        <Text style={{ fontFamily: 'Menlo', backgroundColor: theme.colors.surface2 }}>{node.v}</Text>
      );
    case 'strong':
      return (
        <Text style={{ fontWeight: '700' }}>
          <Inlines nodes={node.c} />
        </Text>
      );
    case 'em':
      return (
        <Text style={{ fontStyle: 'italic' }}>
          <Inlines nodes={node.c} />
        </Text>
      );
    case 'del':
      return (
        <Text style={{ textDecorationLine: 'line-through' }}>
          <Inlines nodes={node.c} />
        </Text>
      );
    case 'link': {
      const href = safeHref(node.href);
      const label = (
        <Text style={{ color: href ? theme.colors.accentDeep : theme.colors.ink }}>
          <Inlines nodes={node.c} />
        </Text>
      );
      if (!href) return label;
      return (
        <Text
          style={{ color: theme.colors.accentDeep }}
          onPress={() => {
            if (href.startsWith('/')) router.push(href);
            else void Linking.openURL(href);
          }}
        >
          <Inlines nodes={node.c} />
        </Text>
      );
    }
    case 'image':
      return node.alt;
    default:
      return null;
  }
}
