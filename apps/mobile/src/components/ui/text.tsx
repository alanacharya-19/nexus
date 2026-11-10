import { forwardRef } from 'react';
import {
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { colors } from '@/theme';
import { textStyles, type TextVariant } from '@/theme/typography';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'faint'
  | 'inverse'
  | 'ice'
  | 'mint'
  | 'amber'
  | 'coral'
  | 'lavender'
  | 'danger';

const toneColor: Record<TextTone, string> = {
  primary: colors.text,
  secondary: colors.textSecondary,
  tertiary: colors.textTertiary,
  faint: colors.textFaint,
  inverse: colors.inverse,
  ice: colors.ice,
  mint: colors.mint,
  amber: colors.amber,
  coral: colors.coral,
  lavender: colors.lavender,
  danger: colors.danger,
};

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  color?: string;
}

export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', tone, align, color, style, ...props },
  ref
) {
  return (
    <RNText
      ref={ref}
      {...props}
      style={[
        textStyles[variant],
        tone ? { color: toneColor[tone] } : null,
        color ? { color } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
});
