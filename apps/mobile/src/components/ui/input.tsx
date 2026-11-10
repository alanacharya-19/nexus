import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { colors, fonts, radius, space } from '@/theme';
import { Text } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  leftIcon?: IconName;
  rightElement?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  mono?: boolean;
  labelAction?: React.ReactNode;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leftIcon,
    rightElement,
    containerStyle,
    mono = false,
    labelAction,
    style,
    onFocus,
    onBlur,
    multiline,
    ...props
  },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label || labelAction ? (
        <View style={styles.labelRow}>
          {label ? <Text variant="label">{label}</Text> : <View />}
          {labelAction}
        </View>
      ) : null}
      <View
        style={[
          styles.field,
          multiline && styles.fieldMultiline,
          focused && styles.fieldFocused,
          Boolean(error) && styles.fieldError,
        ]}
      >
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={17}
            color={focused ? colors.textSecondary : colors.textTertiary}
            style={styles.leftIcon}
          />
        ) : null}
        <TextInput
          ref={ref}
          {...props}
          multiline={multiline}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.ice}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            mono && styles.mono,
            multiline && styles.inputMultiline,
            style,
          ]}
        />
        {rightElement}
      </View>
      {error ? (
        <View style={styles.messageRow}>
          <Ionicons name="alert-circle" size={13} color={colors.danger} />
          <Text variant="caption" tone="danger" style={styles.message}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="caption" tone="tertiary" style={styles.message}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    gap: space.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 16,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    minHeight: 48,
    gap: space.sm,
  },
  fieldMultiline: {
    alignItems: 'flex-start',
    minHeight: 120,
    paddingVertical: space.md,
  },
  fieldFocused: {
    borderColor: colors.borderFocus,
    backgroundColor: colors.surface,
  },
  fieldError: {
    borderColor: 'rgba(242,122,122,0.5)',
  },
  leftIcon: {
    marginTop: 1,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    paddingVertical: space.sm,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
    lineHeight: 23,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 13,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  message: {
    flex: 1,
  },
});
