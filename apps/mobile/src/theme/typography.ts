import { StyleSheet, type TextStyle } from 'react-native';
import { colors, fonts } from './tokens';

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyMedium'
  | 'bodySemibold'
  | 'label'
  | 'caption'
  | 'mono'
  | 'monoSmall';

export const textStyles = StyleSheet.create<Record<TextVariant, TextStyle>>({
  display: {
    fontFamily: fonts.displayBold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1.2,
    color: colors.text,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.7,
    color: colors.text,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: colors.text,
  },
  subheading: {
    fontFamily: fonts.bodySemibold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  bodyMedium: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 23,
    color: colors.text,
  },
  bodySemibold: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  label: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  monoSmall: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textTertiary,
  },
});
