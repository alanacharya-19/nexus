import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Agent, AgentRole } from '@nexus/shared';
import { PROVIDER_META, ROLE_META, getModel } from '@nexus/shared';
import { useAgents } from '@/hooks/queries';
import { colors, radius, space } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { IconButton } from '@/components/ui/icon-button';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/section-header';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { plural } from '@/lib/format';

const ROLE_ORDER: AgentRole[] = ['planner', 'worker', 'reviewer', 'polisher', 'custom'];

export default function AgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const agentsQuery = useAgents();
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);

  const sections = useMemo(() => {
    const sorted = [...agents].sort(
      (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
    );
    return {
      defaultAgents: sorted.filter((agent) => agent.isDefault),
      customAgents: sorted.filter((agent) => !agent.isDefault),
    };
  }, [agents]);

  const enabledCount = agents.filter((agent) => agent.enabled).length;

  return (
    <View style={styles.flex}>
      <PageHeader
        title="Agents"
        subtitle={
          agentsQuery.isLoading
            ? 'Loading your lineup…'
            : `${plural(enabledCount, 'agent')} enabled · ${agents.length} total`
        }
        right={
          <IconButton
            icon="add"
            variant="surface"
            onPress={() => router.push('/agents/new')}
            accessibilityLabel="Create agent"
          />
        }
      />
      <OfflineBanner />
      <ScrollScreen
        refreshing={agentsQuery.isFetching}
        onRefresh={() => agentsQuery.refetch()}
        bottomPadding={insets.bottom + 110}
      >
        {agentsQuery.isLoading ? (
          <ListSkeleton rows={4} />
        ) : agentsQuery.isError ? (
          <ErrorState
            message={agentsQuery.error.message}
            onRetry={() => agentsQuery.refetch()}
          />
        ) : agents.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No agents configured"
            description="Default agents are created on first sign-in. Add a specialist if you need a different role."
            actionLabel="Create agent"
            onAction={() => router.push('/agents/new')}
          />
        ) : (
          <View style={styles.stack}>
            <Card tone="raised" style={styles.intro}>
              <Text variant="bodyMedium">A specialist for every stage</Text>
              <Text variant="caption" tone="tertiary">
                The planner decomposes the objective, workers execute steps, the reviewer
                audits the result, and the polisher ships the final deliverable. Every run
                captures a frozen copy of this lineup.
              </Text>
            </Card>

            <AgentSection
              title="Core lineup"
              subtitle="Created automatically for your workspace"
              agents={sections.defaultAgents}
              onPress={(agent) => router.push(`/agents/${agent.id}`)}
            />

            {sections.customAgents.length > 0 ? (
              <AgentSection
                title="Specialists"
                subtitle="Custom agents you have added"
                agents={sections.customAgents}
                onPress={(agent) => router.push(`/agents/${agent.id}`)}
              />
            ) : (
              <View>
                <SectionHeader title="Specialists" subtitle="Custom agents you have added" />
                <Card tone="flat" style={styles.addCard}>
                  <Text variant="caption" tone="tertiary" style={styles.addText}>
                    Need a different perspective? Add a specialist with its own instructions and
                    model.
                  </Text>
                  <IconButton
                    icon="add"
                    variant="surface"
                    onPress={() => router.push('/agents/new')}
                    accessibilityLabel="Add specialist"
                  />
                </Card>
              </View>
            )}
          </View>
        )}
      </ScrollScreen>
    </View>
  );
}

function AgentSection({
  title,
  subtitle,
  agents,
  onPress,
}: {
  title: string;
  subtitle: string;
  agents: Agent[];
  onPress: (agent: Agent) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <View>
      <SectionHeader title={title} subtitle={subtitle} />
      <View style={styles.list}>
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onPress={() => onPress(agent)} />
        ))}
      </View>
    </View>
  );
}

function AgentCard({ agent, onPress }: { agent: Agent; onPress: () => void }) {
  const role = ROLE_META[agent.role];
  const provider = PROVIDER_META[agent.provider];
  const model = getModel(agent.model);

  return (
    <Card onPress={onPress} style={styles.agentCard}>
      <Avatar name={agent.name} accent={agent.accent} size={40} />
      <View style={styles.agentText}>
        <View style={styles.agentTitleRow}>
          <Text variant="bodySemibold" numberOfLines={1} style={styles.agentName}>
            {agent.name}
          </Text>
          {!agent.enabled ? <Badge label="Disabled" tone="neutral" /> : null}
        </View>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {role.label} · {model?.label ?? agent.model}
        </Text>
        <View style={styles.agentMeta}>
          <View style={[styles.providerDot, { backgroundColor: provider.accent }]} />
          <Text variant="monoSmall" tone="faint">
            {provider.label}
          </Text>
          <Text variant="monoSmall" tone="faint">
            ·
          </Text>
          <Text variant="monoSmall" tone="faint">
            temp {agent.temperature}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stack: {
    gap: space.xxl,
  },
  intro: {
    gap: space.xs,
  },
  list: {
    gap: space.md,
  },
  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  agentText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  agentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  agentName: {
    flexShrink: 1,
  },
  agentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    marginTop: 2,
  },
  providerDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
  },
  addText: {
    flex: 1,
  },
});
