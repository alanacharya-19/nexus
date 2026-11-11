import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentMutations } from '@/hooks/queries';
import { colors, space } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { AgentForm } from '@/components/agents/agent-form';
import { toast } from '@/stores/toast';

export default function NewAgentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { create } = useAgentMutations();

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title="New agent"
        subtitle="Give a specialist its own role, instructions, and model."
      />
      <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
        <AgentForm
          submitLabel="Create agent"
          busy={create.isPending}
          error={create.error instanceof Error ? create.error.message : null}
          onSubmit={async (values) => {
            try {
              await create.mutateAsync({
                name: values.name,
                role: values.role,
                provider: values.provider,
                model: values.model,
                systemPrompt: values.systemPrompt,
                temperature: values.temperature,
                maxTokens: values.maxTokens,
                accent: values.accent,
              });
              toast('Agent created', `${values.name} is ready for new runs.`, 'success');
              router.back();
            } catch {
              // The mutation error is surfaced inline.
            }
          }}
        />
      </ScrollScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
