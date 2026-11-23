export const COLORS = {
  // Primary calm clinical teal / sage palette
  primary: '#1B6B63',
  primaryDark: '#124D47',
  primaryLight: '#E5F3F1',
  primaryMuted: '#4C8F87',

  // Surfaces
  background: '#F6F7F5',
  surface: '#FFFFFF',
  surfaceElevated: '#FCFDFA',
  surfaceMuted: '#EEF1EC',

  // Text
  text: '#182422',
  textSecondary: '#4E605D',
  textMuted: '#7C8E8A',

  // Borders
  border: '#DCE4E0',
  borderLight: '#EBF0ED',

  // Severity & semantic colors
  clear: '#2A9D6F',
  mild: '#7BB661',
  moderate: '#E09F3E',
  severe: '#D95D39',
  extreme: '#B22234',

  // Correlation indicators
  trigger: '#D1493E',
  triggerLight: '#FDECEB',
  protective: '#248A67',
  protectiveLight: '#E6F6EF',
  exposure: '#3B78B8',
  exposureLight: '#E8F2FC',
  cumulative: '#7A52B3',
  cumulativeLight: '#F2ECFA',
  warning: '#C97B1A',
  warningLight: '#FDF4E3',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export function getSeverityColor(severity: number): string {
  if (severity <= 1.5) return COLORS.clear;
  if (severity <= 3.5) return COLORS.mild;
  if (severity <= 5.5) return COLORS.moderate;
  if (severity <= 7.5) return COLORS.severe;
  return COLORS.extreme;
}

export function getSeverityLabel(severity: number): string {
  if (severity === 0) return 'Clear';
  if (severity <= 2) return 'Very Mild';
  if (severity <= 4) return 'Mild';
  if (severity <= 6) return 'Moderate';
  if (severity <= 8) return 'Severe Flare';
  return 'Intense Flare';
}
