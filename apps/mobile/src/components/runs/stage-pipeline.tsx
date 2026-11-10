import { StyleSheet, View } from 'react-native';
import { PIPELINE_STAGES, RUN_STAGE_LABELS } from '@nexus/shared';
import type { RunStage } from '@nexus/shared';
import { colors, radius, space } from '@/theme';
import { Text } from '../ui/text';

const order: RunStage[] = ['plan', 'work', 'review', 'revise', 'polish', 'deliver'];

export function StagePipeline({
  stage,
  status,
}: {
  stage: RunStage;
  status: string;
}) {
  const activeStage: RunStage = stage === 'revise' ? 'review' : stage;
  const activeIndex = order.indexOf(activeStage);

  return (
    <View style={styles.wrapper}>
      {PIPELINE_STAGES.map((item, index) => {
        const itemIndex = order.indexOf(item);
        const done = status === 'completed' || itemIndex < activeIndex;
        const active = itemIndex === activeIndex && status !== 'completed';
        return (
          <View key={item} style={styles.segment}>
            <View style={styles.labelRow}>
              <View
                style={[
                  styles.dot,
                  done && styles.dotDone,
                  active && styles.dotActive,
                ]}
              />
              <Text
                variant="caption"
                tone={active ? 'primary' : done ? 'secondary' : 'faint'}
                numberOfLines={1}
                style={active ? styles.activeLabel : undefined}
              >
                {RUN_STAGE_LABELS[item]}
              </Text>
            </View>
            {index < PIPELINE_STAGES.length - 1 ? (
              <View style={[styles.line, done && styles.lineDone]} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceHover,
  },
  dotDone: {
    backgroundColor: colors.mint,
  },
  dotActive: {
    backgroundColor: colors.ice,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.surfaceHover,
    marginHorizontal: 6,
  },
  lineDone: {
    backgroundColor: 'rgba(183,241,113,0.4)',
  },
  activeLabel: {
    fontFamily: 'Inter_600SemiBold',
  },
});
