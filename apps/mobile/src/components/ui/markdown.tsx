import { useMemo } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, space } from '@/theme';
import { toast } from '@/stores/toast';
import { IconButton } from './icon-button';
import { Text } from './text';

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string };

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]]+\]\([^)]+\))/g;

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, index) });
    }
    const raw = match[0];
    if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    } else if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
      if (linkMatch) {
        tokens.push({ type: 'link', value: linkMatch[1]!, href: linkMatch[2]! });
      } else {
        tokens.push({ type: 'text', value: raw });
      }
    } else {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    }
    lastIndex = index + raw.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return tokens;
}

function Inline({ text, style }: { text: string; style?: TextStyle }) {
  const tokens = useMemo(() => parseInline(text), [text]);
  return (
    <Text style={style}>
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'bold':
            return (
              <Text key={index} style={styles.bold}>
                {token.value}
              </Text>
            );
          case 'italic':
            return (
              <Text key={index} style={styles.italic}>
                {token.value}
              </Text>
            );
          case 'code':
            return (
              <Text key={index} style={styles.inlineCode}>
                {token.value}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={index}
                style={styles.link}
                onPress={() => {
                  Linking.openURL(token.href).catch(() =>
                    toast('Could not open link', token.href, 'error')
                  );
                }}
              >
                {token.value}
              </Text>
            );
          default:
            return <Text key={index}>{token.value}</Text>;
        }
      })}
    </Text>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text variant="monoSmall" tone="tertiary">
          {language || 'code'}
        </Text>
        <IconButton
          icon="copy-outline"
          size={14}
          tone="muted"
          accessibilityLabel="Copy code"
          onPress={() => {
            Clipboard.setStringAsync(code).then(
              () => toast('Copied', undefined, 'success'),
              () => toast('Could not copy', undefined, 'error')
            );
          }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.codeText}>{code}</Text>
      </ScrollView>
    </View>
  );
}

interface Block {
  type: 'heading' | 'paragraph' | 'list' | 'ordered' | 'quote' | 'code' | 'table' | 'hr';
  level?: number;
  text?: string;
  items?: string[];
  code?: string;
  language?: string;
  rows?: string[][];
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^---+$/.test(line) ||
    /^\|.+\|$/.test(line)
  );
}

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index]!)) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', code: code.join('\n'), language });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        text: heading[2]!.trim(),
      });
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }

    if (/^\|.+\|$/.test(line)) {
      const rows: string[][] = [];
      while (index < lines.length && /^\|.+\|$/.test(lines[index]!)) {
        const raw = lines[index]!.trim();
        if (!/^\|[\s:|-]+\|$/.test(raw)) {
          rows.push(
            raw
              .slice(1, -1)
              .split('|')
              .map((cell) => cell.trim())
          );
        }
        index += 1;
      }
      if (rows.length > 0) blocks.push({ type: 'table', rows });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim() && !isBlockStart(lines[index]!)) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

export function Markdown({
  content,
  compact = false,
}: {
  content: string;
  compact?: boolean;
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <View style={styles.markdown}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            const level = block.level ?? 1;
            return (
              <Text
                key={index}
                variant={level === 1 ? 'title' : level === 2 ? 'heading' : 'subheading'}
                style={[
                  styles.heading,
                  level === 1 && styles.h1,
                  level >= 4 && styles.hSmall,
                ]}
              >
                {block.text}
              </Text>
            );
          }
          case 'paragraph':
            return (
              <Inline
                key={index}
                text={block.text ?? ''}
                style={compact ? styles.paragraphCompact : styles.paragraph}
              />
            );
          case 'list':
          case 'ordered':
            return (
              <View key={index} style={styles.list}>
                {(block.items ?? []).map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.listItem}>
                    <Text style={styles.bullet}>
                      {block.type === 'ordered' ? `${itemIndex + 1}.` : '•'}
                    </Text>
                    <Inline text={item} style={styles.listText} />
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View key={index} style={styles.quote}>
                <Inline text={block.text ?? ''} style={styles.quoteText} />
              </View>
            );
          case 'code':
            return <CodeBlock key={index} code={block.code ?? ''} language={block.language ?? ''} />;
          case 'table': {
            const rows = block.rows ?? [];
            const [header, ...body] = rows;
            return (
              <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.table}>
                  {header ? (
                    <View style={[styles.tableRow, styles.tableHeader]}>
                      {header.map((cell, cellIndex) => (
                        <View key={cellIndex} style={styles.tableCell}>
                          <Text variant="caption" style={styles.tableHeaderText}>
                            {cell}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {body.map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.tableRow}>
                      {row.map((cell, cellIndex) => (
                        <View key={cellIndex} style={styles.tableCell}>
                          <Inline text={cell} style={styles.tableText} />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          }
          case 'hr':
            return <View key={index} style={styles.hr} />;
          default:
            return null;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  markdown: {
    gap: space.md,
  },
  heading: {
    marginTop: space.sm,
  },
  h1: {
    fontSize: 24,
    lineHeight: 30,
  },
  hSmall: {
    fontSize: 15,
    lineHeight: 21,
  },
  paragraph: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textSecondary,
  },
  paragraphCompact: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  bold: {
    fontFamily: fonts.bodySemibold,
    color: colors.text,
  },
  italic: {
    fontStyle: 'italic',
    color: colors.textSecondary,
  },
  inlineCode: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.ice,
  },
  link: {
    color: colors.ice,
    textDecorationLine: 'underline',
  },
  list: {
    gap: space.xs + 2,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  bullet: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textTertiary,
    minWidth: 16,
  },
  listText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textSecondary,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    paddingLeft: space.md,
  },
  quoteText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  codeBlock: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 34,
  },
  codeText: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    lineHeight: 20,
    color: colors.textSecondary,
    padding: space.md,
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
    minWidth: 320,
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tableHeader: {
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 0,
  },
  tableCell: {
    flex: 1,
    minWidth: 110,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  tableHeaderText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    color: colors.text,
  },
  tableText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.sm,
  },
});
