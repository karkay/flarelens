import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/theme';

export const SectionCard: React.FC<{
  title?: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}> = ({ title, subtitle, rightElement, children, style }) => {
  return (
    <View style={[styles.card, style]}>
      {(title || rightElement) && (
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {rightElement}
        </View>
      )}
      {children}
    </View>
  );
};

export const Badge: React.FC<{
  label: string;
  tone?: 'primary' | 'trigger' | 'protective' | 'exposure' | 'cumulative' | 'warning' | 'neutral';
}> = ({ label, tone = 'neutral' }) => {
  const palette = {
    primary: { bg: COLORS.primaryLight, fg: COLORS.primaryDark },
    trigger: { bg: COLORS.triggerLight, fg: COLORS.trigger },
    protective: { bg: COLORS.protectiveLight, fg: COLORS.protective },
    exposure: { bg: COLORS.exposureLight, fg: COLORS.exposure },
    cumulative: { bg: COLORS.cumulativeLight, fg: COLORS.cumulative },
    warning: { bg: COLORS.warningLight, fg: COLORS.warning },
    neutral: { bg: COLORS.surfaceMuted, fg: COLORS.textSecondary },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: SPACING.md,
    shadowColor: '#0E2925',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 12.5,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
});
