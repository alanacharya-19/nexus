import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentMutations, useAgents } from '@/hooks/queries';
import { colors, space } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { AgentForm } from '@/components/agents/agent-form';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { toast } from '@/stores/toast';

export default function EditAgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const agentsQuery = useAgents();
  const { update, remove } = useAgentMutations();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const agent = agentsQuery.data?.find((entry) => entry.id === id);

  const deleteAgent = async () => {
    if (!agent) return;
    try {
      await remove.mutateAsync(agent.id);
      setDeleteOpen(false);
      toast('Agent deleted', `${agent.name} was removed from the lineup.`, 'success');
      router.back();
    } catch {
      setDeleteOpen(false);
    }
  };

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title={agent?.name ?? 'Agent'}
        subtitle={agent ? 'Adjust how this agent behaves in new runs.' : undefined}
      />
      <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
        {agentsQuery.isLoading ? (
          <ListSkeleton rows={3} />
        ) : !agent ? (
          <ErrorState
            title="Agent not found"
            message="This agent may have been deleted. Return to the lineup to refresh."
            onRetry={() => agentsQuery.refetch()}
          />
        ) : (
          <View style={styles.stack}>
            <AgentForm
              initial={agent}
              roleLocked
              submitLabel="Save changes"
              busy={update.isPending}
              error={update.error instanceof Error ? update.error.message : null}
              onSubmit={async (values) => {
                try {
                  await update.mutateAsync({
                    id: agent.id,
                    input: {
                      name: values.name,
                      provider: values.provider,
                      model: values.model,
                      systemPrompt: values.systemPrompt,
                      temperature: values.temperature,
                      maxTokens: values.maxTokens,
                      accent: values.accent,
                      enabled: values.enabled,
                    },
                  });
                  toast('Agent updated', `${values.name}'s changes are saved.`, 'success');
                  router.back();
                } catch {
                  // The mutation error is surfaced inline.
                }
              }}
            />

            {agent.isDefault ? (
              <Text variant="caption" tone="faint">
                {agent.name} is a core agent. It can be disabled but not deleted.
              </Text>
            ) : (
              <Button
                label="Delete agent"
                variant="danger"
                fullWidth
                onPress={() => setDeleteOpen(true)}
              />
            )}
          </View>
        )}
      </ScrollScreen>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${agent?.name ?? 'agent'}?`}
        subtitle="Existing runs keep their frozen lineup; new runs will no longer include it."
        footer={
          <>
            <Button
              label="Delete"
              variant="danger"
              fullWidth
              loading={remove.isPending}
              onPress={() => void deleteAgent()}
            />
            <Button
              label="Keep agent"
              variant="ghost"
              fullWidth
              onPress={() => setDeleteOpen(false)}
            />
          </>
        }
      >
        <Text variant="body" tone="secondary">
          This cannot be undone. Any prompts you wrote for this specialist will be lost.
        </Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stack: {
    gap: space.xl,
  },
});
