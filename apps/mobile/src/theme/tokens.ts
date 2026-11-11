/**
 * NEXUS design tokens.
 *
 * The palette is deliberately restrained: near-black surfaces, a single white
 * primary action, and a small set of cool role accents. No neon, no purple
 * gradients, no chat-app clichés.
 */

export const colors = {
  bg: '#08090B',
  bgElevated: '#0C0E11',
  surface: '#101216',
  surfaceRaised: '#15181D',
  surfaceHigh: '#1B1F25',
  surfaceHover: '#20252C',
  border: 'rgba(255,255,255,0.075)',
  borderStrong: 'rgba(255,255,255,0.14)',
  borderFocus: 'rgba(255,255,255,0.34)',
  text: '#F4F5F6',
  textSecondary: '#A4A9B2',
  textTertiary: '#6D737D',
  textFaint: '#4C525B',
  inverse: '#08090B',
  white: '#FFFFFF',
  electric: '#5B8CFF',
  electricBright: '#7AA3FF',
  electricSurface: 'rgba(91,140,255,0.12)',
  electricBorder: 'rgba(91,140,255,0.32)',
  cyan: '#5AD1E6',
  cyanSurface: 'rgba(90,209,230,0.12)',
  ice: '#A8C7FA',
  mint: '#B7F171',
  amber: '#E7C48A',
  coral: '#F2A38C',
  lavender: '#C9C4F2',
  sky: '#8AB4F8',
  danger: '#F27A7A',
  dangerSurface: 'rgba(242,122,122,0.12)',
  success: '#8FE3B0',
  successSurface: 'rgba(143,227,176,0.10)',
  warning: '#E7C48A',
  warningSurface: 'rgba(231,196,138,0.10)',
  overlay: 'rgba(4,5,7,0.72)',
  glass: 'rgba(16,18,22,0.78)',
  transparent: 'transparent',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
  giant: 64,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

export const fonts = {
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

export const layout = {
  maxWidth: 760,
  tabBarHeight: 66,
  headerHeight: 52,
} as const;

export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 18 },
    elevation: 16,
  },
} as const;

/** Semantic elevation scale, from resting surfaces to floating chrome. */
export const elevation = {
  none: {},
  surface: {
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  raised: shadows.card,
  floating: shadows.floating,
} as const;

export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
  spring: { damping: 18, stiffness: 220, mass: 0.8 },
} as const;

export const accentThemes = {
  electric: {
    label: 'Electric blue',
    accent: '#5B8CFF',
    accentBright: '#7AA3FF',
    surface: 'rgba(91,140,255,0.12)',
    border: 'rgba(91,140,255,0.32)',
    onAccent: '#07101F',
  },
  cyan: {
    label: 'Signal cyan',
    accent: '#5AD1E6',
    accentBright: '#8AE4F2',
    surface: 'rgba(90,209,230,0.12)',
    border: 'rgba(90,209,230,0.32)',
    onAccent: '#041417',
  },
  mint: {
    label: 'Studio mint',
    accent: '#A8E36F',
    accentBright: '#C4F296',
    surface: 'rgba(168,227,111,0.12)',
    border: 'rgba(168,227,111,0.32)',
    onAccent: '#0C1604',
  },
  iris: {
    label: 'Deep iris',
    accent: '#A99BFF',
    accentBright: '#C4BAFF',
    surface: 'rgba(169,155,255,0.14)',
    border: 'rgba(169,155,255,0.34)',
    onAccent: '#0C0820',
  },
} as const;

export type AccentThemeId = keyof typeof accentThemes;

export const roleAccent = {
  planner: colors.ice,
  worker: colors.mint,
  reviewer: colors.amber,
  polisher: colors.coral,
  custom: colors.lavender,
} as const;

export const statusTone = {
  queued: colors.textSecondary,
  running: colors.ice,
  paused: colors.amber,
  awaiting_approval: colors.amber,
  completed: colors.mint,
  failed: colors.danger,
  cancelled: colors.textTertiary,
} as const;
