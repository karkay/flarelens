import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { VariableCorrelationResult } from '../types';
import { Badge } from './SectionCard';
import { LagProfileChart } from './LagProfileChart';

const CATEGORY_LABELS: Record<VariableCorrelationResult['category'], string> = {
  environment: 'Environment',
  lifestyle: 'Lifestyle',
  food_ingredient: 'Food Ingredient',
  custom: 'Custom',
};

export const CorrelationCard: React.FC<{
  result: VariableCorrelationResult;
  onPress?: () => void;
}> = ({ result, onPress }) => {
  const score = result.bestLag.score;
  const scoreText = `${score >= 0 ? '+' : ''}${score.toFixed(2)}`;
  const isTrigger = result.direction === 'trigger';
  const isProtective = result.direction === 'protective';

  const scoreColor = isTrigger
    ? COLORS.trigger
    : isProtective
    ? COLORS.protective
    : COLORS.textMuted;

  const patternTone =
    result.pattern === 'cumulative_buildup'
      ? 'cumulative'
      : isTrigger
      ? 'trigger'
      : isProtective
      ? 'protective'
      : 'neutral';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{result.variableName}</Text>
          <View style={styles.metaRow}>
            <Badge label={CATEGORY_LABELS[result.category]} tone="neutral" />
            <Badge label={result.bestLag.label} tone={patternTone} />
          </View>
        </View>

        <View style={styles.scoreCol}>
          <Text style={[styles.scoreValue, { color: scoreColor }]}>r = {scoreText}</Text>
          <Text style={styles.confidenceText}>
            {result.confidence === 'high'
              ? 'High confidence'
              : result.confidence === 'moderate'
              ? 'Moderate signal'
              : result.confidence === 'early_signal'
              ? 'Early signal'
              : 'Collecting data'}
          </Text>
        </View>
      </View>

      <Text style={styles.summary} numberOfLines={2}>
        {result.summary}
      </Text>

      <LagProfileChart lags={result.allLags} bestLagKey={result.bestLag.lagKey} compact />

      <View style={styles.footerRow}>
        <Text style={styles.footerStat}>
          {result.exposureCount} exposures · {result.exposureFlarePairs.length} paired flares
        </Text>
        <View style={styles.detailLink}>
          <Text style={styles.detailLinkText}>Exposure graph</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md + 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: SPACING.md,
  },
  cardPressed: {
    opacity: 0.9,
    borderColor: COLORS.primary,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  name: {
    fontSize: 15.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  scoreCol: {
    alignItems: 'flex-end',
  },
  scoreValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  confidenceText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  summary: {
    fontSize: 12.5,
    color: COLORS.textSecondary,
    lineHeight: 17.5,
    marginTop: SPACING.sm,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.sm + 2,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  footerStat: {
    fontSize: 11.5,
    color: COLORS.textMuted,
  },
  detailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  detailLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
