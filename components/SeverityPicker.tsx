import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING, getSeverityColor, getSeverityLabel } from '../constants/theme';
import { BODY_AREAS } from '../constants/starterVariables';
import { BodyArea } from '../types';

export const ScaleRow: React.FC<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  colorizeSeverity?: boolean;
  onChange: (val: number) => void;
}> = ({ label, value, min = 0, max = 10, unit = '', colorizeSeverity = false, onChange }) => {
  const steps: number[] = [];
  for (let i = min; i <= max; i++) steps.push(i);

  const activeColor = colorizeSeverity ? getSeverityColor(value) : COLORS.primary;

  return (
    <View style={styles.scaleContainer}>
      <View style={styles.scaleHeader}>
        <Text style={styles.scaleLabel}>{label}</Text>
        <View style={styles.scaleValueRow}>
          <Text style={[styles.scaleValue, { color: activeColor }]}>
            {value}
            {unit}
          </Text>
          {colorizeSeverity ? (
            <Text style={[styles.severityTag, { color: activeColor }]}>
              · {getSeverityLabel(value)}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.pillRow}>
        {steps.map((stepVal) => {
          const selected = stepVal === value;
          const fill = colorizeSeverity ? getSeverityColor(stepVal) : COLORS.primary;
          return (
            <Pressable
              key={stepVal}
              onPress={() => onChange(stepVal)}
              style={[
                styles.stepPill,
                selected && { backgroundColor: fill, borderColor: fill },
              ]}
            >
              <Text style={[styles.stepText, selected && styles.stepTextSelected]}>
                {stepVal}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

export const BodyAreaPicker: React.FC<{
  selected: BodyArea[];
  onToggle: (area: BodyArea) => void;
}> = ({ selected, onToggle }) => {
  return (
    <View style={styles.areaContainer}>
      <Text style={styles.scaleLabel}>Affected Body Areas</Text>
      <View style={styles.chipWrap}>
        {BODY_AREAS.map((area) => {
          const active = selected.includes(area.id);
          return (
            <Pressable
              key={area.id}
              onPress={() => onToggle(area.id)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {area.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  scaleContainer: {
    marginBottom: SPACING.md,
  },
  scaleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs + 2,
  },
  scaleLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    color: COLORS.text,
  },
  scaleValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scaleValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  severityTag: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  pillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  stepPill: {
    flex: 1,
    height: 34,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  stepTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  areaContainer: {
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: SPACING.sm,
  },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  chipActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  chipTextActive: {
    color: COLORS.primaryDark,
  },
});
