import { StyleSheet, View } from 'react-native';
import type { RunAgent } from '@nexus/shared';
import { ROLE_META } from '@nexus/shared';
import { colors, radius, space } from '@/theme';
import { Avatar } from '../ui/avatar';
import { Text } from '../ui/text';

export function AgentPill({ agent }: { agent: RunAgent }) {
  return (
    <View style={styles.pill}>
      <Avatar name={agent.name} accent={agent.accent} size={28} />
      <View style={styles.text}>
        <Text variant="caption" tone="primary" numberOfLines={1}>
          {agent.name}
        </Text>
        <Text variant="monoSmall" tone="faint" numberOfLines={1}>
          {ROLE_META[agent.role].label}
        </Text>
      </View>
    </View>
  );
}

export function AgentLineup({ agents }: { agents: RunAgent[] }) {
  return (
    <View style={styles.lineup}>
      {agents.map((agent) => (
        <AgentPill key={agent.agentId} agent={agent} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lineup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: space.md,
  },
  text: {
    gap: 1,
    maxWidth: 120,
  },
});
