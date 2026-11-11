import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space, useAccent } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { StreamingDots } from '@/components/ui/animated';
import { Text } from '@/components/ui/text';

export interface ChatAuthor {
  name: string;
  role?: string;
  accent?: string;
  model?: string;
}

interface MessageBlockProps {
  author: ChatAuthor;
  time?: string;
  tone?: 'user' | 'agent' | 'system';
  streaming?: boolean;
  badge?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * A workspace message. User messages use the accent-tinted surface; agent
 * messages carry a role-colored spine so the pipeline stays legible without
 * falling back to a generic chat bubble.
 */
export function MessageBlock({
  author,
  time,
  tone = 'agent',
  streaming = false,
  badge,
  children,
  footer,
}: MessageBlockProps) {
  const accent = useAccent();
  const authorAccent =
    tone === 'user' ? accent.accent : author.accent ?? colors.ice;
  const isUser = tone === 'user';

  return (
    <View style={styles.row}>
      <Avatar name={author.name} accent={authorAccent} size={30} />
      <View style={styles.body}>
        <View style={styles.header}>
          <Text variant="bodySemibold" numberOfLines={1} style={styles.name}>
            {author.name}
          </Text>
          {author.role ? (
            <Text variant="caption" tone="faint" numberOfLines={1}>
              {author.role}
            </Text>
          ) : null}
          {author.model ? (
            <Text variant="monoSmall" tone="faint" numberOfLines={1}>
              {author.model}
            </Text>
          ) : null}
          {badge ? <Badge label={badge} tone="neutral" /> : null}
          {streaming ? <StreamingDots color={authorAccent} /> : null}
          {time ? (
            <Text variant="caption" tone="faint" style={styles.time}>
              {time}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.bubble,
            isUser
              ? {
                  backgroundColor: accent.surface,
                  borderColor: accent.border,
                }
              : styles.agentBubble,
            !isUser && { borderLeftColor: authorAccent },
          ]}
        >
          {children}
        </View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  body: {
    flex: 1,
    gap: space.sm,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  name: {
    flexShrink: 1,
  },
  time: {
    marginLeft: 'auto',
  },
  bubble: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.sm,
  },
  agentBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
});
