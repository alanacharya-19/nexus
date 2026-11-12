import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Project } from '@nexus/shared';
import { colors, radius, space } from '@/theme';
import { plural } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';

const PROJECT_COLORS = [
  colors.ice,
  colors.mint,
  colors.amber,
  colors.coral,
  colors.lavender,
  colors.sky,
  colors.electric,
  colors.danger,
];

export interface ProjectFormValues {
  name: string;
  description: string | null;
  color: string;
}

type ProjectView =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; project: Project }
  | { mode: 'delete'; project: Project };

interface ProjectSheetProps {
  visible: boolean;
  createOnOpen?: boolean;
  projects: Project[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (values: ProjectFormValues) => Promise<boolean>;
  onUpdate: (project: Project, values: ProjectFormValues) => Promise<boolean>;
  onDelete: (project: Project) => Promise<boolean>;
}

/**
 * Single-sheet project manager. List, form, and delete confirmation live in
 * one modal so presenting a second native modal never races the first one's
 * dismiss animation (a real failure mode on iOS).
 */
export function ProjectSheet({
  visible,
  createOnOpen = false,
  projects,
  busy,
  error,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: ProjectSheetProps) {
  const [view, setView] = useState<ProjectView>({ mode: 'list' });
  const [wasVisible, setWasVisible] = useState(visible);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]!);
  const [localError, setLocalError] = useState<string | null>(null);

  // Reopening always starts fresh, even if the last visit ended on a form.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLocalError(null);
      if (createOnOpen) {
        setName('');
        setDescription('');
        setColor(PROJECT_COLORS[0]!);
        setView({ mode: 'create' });
      } else {
        setView({ mode: 'list' });
      }
    }
  }

  const openCreate = () => {
    setName('');
    setDescription('');
    setColor(PROJECT_COLORS[0]!);
    setLocalError(null);
    setView({ mode: 'create' });
  };

  const openEdit = (project: Project) => {
    setName(project.name);
    setDescription(project.description ?? '');
    setColor(project.color);
    setLocalError(null);
    setView({ mode: 'edit', project });
  };

  const backToList = () => {
    setLocalError(null);
    setView({ mode: 'list' });
  };

  const submit = async () => {
    if (view.mode !== 'create' && view.mode !== 'edit') return;
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    if (cleanName.length === 0) {
      setLocalError('Give this project a name.');
      return;
    }
    if (cleanName.length > 80) {
      setLocalError('Project names can be at most 80 characters.');
      return;
    }
    if (cleanDescription.length > 500) {
      setLocalError('Descriptions can be at most 500 characters.');
      return;
    }
    setLocalError(null);
    const values: ProjectFormValues = {
      name: cleanName,
      description: cleanDescription || null,
      color,
    };
    const saved =
      view.mode === 'create'
        ? await onCreate(values)
        : await onUpdate(view.project, values);
    if (saved) setView({ mode: 'list' });
  };

  const confirmDelete = async () => {
    if (view.mode !== 'delete') return;
    const deleted = await onDelete(view.project);
    if (deleted) setView({ mode: 'list' });
  };

  const title =
    view.mode === 'create'
      ? 'New project'
      : view.mode === 'edit'
        ? 'Edit project'
        : view.mode === 'delete'
          ? 'Delete this project?'
          : 'Projects';
  const subtitle =
    view.mode === 'create'
      ? 'Group related conversations under one shared context.'
      : view.mode === 'edit'
        ? 'Rename it, adjust the brief, or change its accent.'
        : view.mode === 'delete'
          ? 'Conversations stay in your workspace, but they are no longer grouped ' +
            'under this project.'
          : 'Group conversations by objective, client, or workstream.';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        view.mode === 'list' ? (
          <>
            <Button label="New project" icon="add" fullWidth onPress={openCreate} />
            <Button label="Close" variant="ghost" fullWidth onPress={onClose} />
          </>
        ) : view.mode === 'delete' ? (
          <>
            <Button
              label="Delete project"
              variant="danger"
              fullWidth
              loading={busy}
              onPress={() => void confirmDelete()}
            />
            <Button label="Keep project" variant="ghost" fullWidth onPress={backToList} />
          </>
        ) : (
          <>
            <Button
              label={view.mode === 'create' ? 'Create project' : 'Save changes'}
              fullWidth
              loading={busy}
              onPress={() => void submit()}
            />
            <Button label="Cancel" variant="ghost" fullWidth onPress={backToList} />
          </>
        )
      }
    >
      {view.mode === 'list' ? (
        <ProjectList
          projects={projects}
          onEdit={openEdit}
          onDelete={(project) => setView({ mode: 'delete', project })}
        />
      ) : view.mode === 'delete' ? (
        <View style={styles.deleteBlock}>
          <View style={styles.deleteRow}>
            <View style={[styles.dot, { backgroundColor: view.project.color }]} />
            <Text variant="bodyMedium" style={styles.flexText}>
              {view.project.name}
            </Text>
          </View>
          <Text variant="caption" tone="tertiary">
            This only removes the project container. Its{' '}
            {plural(view.project.runCount ?? 0, 'conversation')} stay available under All
            projects.
          </Text>
          {error ? <FormError message={error} /> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Q4 launch"
            autoCapitalize="sentences"
            leftIcon="folder-outline"
            maxLength={80}
          />
          <Input
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What belongs in this project?"
            multiline
            maxLength={500}
            hint={`${description.trim().length} / 500 characters`}
          />
          <View style={styles.field}>
            <Text variant="label">Accent</Text>
            <View style={styles.swatchRow}>
              {PROJECT_COLORS.map((option) => {
                const active = option === color;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setColor(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Use project accent ${option}`}
                    style={[
                      styles.swatch,
                      { backgroundColor: option },
                      active && styles.swatchActive,
                    ]}
                  >
                    {active ? (
                      <Ionicons name="checkmark" size={14} color={colors.inverse} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
          {localError || error ? <FormError message={localError ?? error ?? ''} /> : null}
        </View>
      )}
    </Sheet>
  );
}

function ProjectList({
  projects,
  onEdit,
  onDelete,
}: {
  projects: Project[];
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
}) {
  if (projects.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <Ionicons name="folder-open-outline" size={20} color={colors.textTertiary} />
        </View>
        <Text variant="bodyMedium" align="center">
          No projects yet
        </Text>
        <Text variant="caption" tone="tertiary" align="center">
          Create a project to keep related conversations together and filter them in one tap.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {projects.map((project) => (
        <View key={project.id} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: project.color }]} />
          <Pressable
            onPress={() => onEdit(project)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${project.name}`}
            style={({ pressed }) => [styles.rowText, pressed && styles.pressed]}
          >
            <Text variant="bodyMedium" numberOfLines={1}>
              {project.name}
            </Text>
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {plural(project.runCount ?? 0, 'conversation')}
              {project.description ? ` · ${project.description}` : ''}
            </Text>
          </Pressable>
          <IconButton
            icon="create-outline"
            size={16}
            tone="muted"
            onPress={() => onEdit(project)}
            accessibilityLabel={`Edit ${project.name}`}
          />
          <IconButton
            icon="trash-outline"
            size={16}
            tone="danger"
            onPress={() => onDelete(project)}
            accessibilityLabel={`Delete ${project.name}`}
          />
        </View>
      ))}
    </View>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <View style={styles.errorRow}>
      <Ionicons name="alert-circle" size={14} color={colors.danger} />
      <Text variant="caption" tone="danger" style={styles.flexText}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flexText: {
    flex: 1,
  },
  list: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
    paddingVertical: space.xxs,
  },
  pressed: {
    opacity: 0.7,
  },
  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  form: {
    gap: space.xl,
  },
  field: {
    gap: space.sm,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  swatchActive: {
    opacity: 1,
    borderWidth: 3,
    borderColor: colors.surfaceHigh,
    transform: [{ scale: 1.1 }],
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  deleteBlock: {
    gap: space.md,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242,122,122,0.24)',
  },
});
