import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useApp } from '../../context/AppContext';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { Badge, SectionCard } from '../../components/SectionCard';
import { ExposureFlareChart } from '../../components/ExposureFlareChart';
import { LagProfileChart } from '../../components/LagProfileChart';

export default function VariableDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { correlationResults } = useApp();

  const decodedId = useMemo(() => {
    if (!id) return '';
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }, [id]);

  const result = useMemo(
    () => correlationResults.find((r) => r.variableId === decodedId),
    [correlationResults, decodedId]
  );

  if (!result) {
    return (
      <View style={styles.emptyContainer}>
        <Stack.Screen options={{ title: 'Variable Details' }} />
        <Text style={styles.emptyTitle}>Variable not found</Text>
        <Text style={styles.emptySub}>
          Log a few days of data for this variable to compute multi-lag correlations.
        </Text>
      </View>
    );
  }

  const isTrigger = result.direction === 'trigger';
  const isProtective = result.direction === 'protective';
  const scoreColor = isTrigger
    ? COLORS.trigger
    : isProtective
    ? COLORS.protective
    : COLORS.textMuted;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: result.variableName }} />

      {/* Headline Metrics Card */}
      <SectionCard>
        <View style={styles.topHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.varTitle}>{result.variableName}</Text>
            <View style={styles.badgeRow}>
              <Badge
                label={result.typicalLagDescription}
                tone={
                  result.pattern === 'cumulative_buildup'
                    ? 'cumulative'
                    : isTrigger
                    ? 'trigger'
                    : isProtective
                    ? 'protective'
                    : 'neutral'
                }
              />
              <Badge label={`Confidence: ${result.confidence.replace('_', ' ')}`} tone="neutral" />
            </View>
          </View>
          <View style={styles.bigScoreBox}>
            <Text style={[styles.bigScore, { color: scoreColor }]}>
              {result.bestLag.score >= 0 ? '+' : ''}
              {result.bestLag.score.toFixed(2)}
            </Text>
            <Text style={styles.bigScoreLabel}>Peak r</Text>
          </View>
        </View>

        <Text style={styles.summary}>{result.summary}</Text>

        <View style={styles.compareRow}>
          <View style={styles.compareTile}>
            <Text style={styles.compareLabel}>Avg Severity When Exposed / High</Text>
            <Text style={[styles.compareVal, { color: COLORS.trigger }]}>
              {result.avgSeverityWhenHigh}/10
            </Text>
          </View>
          <View style={styles.compareTile}>
            <Text style={styles.compareLabel}>Avg Severity Baseline / Low</Text>
            <Text style={[styles.compareVal, { color: COLORS.protective }]}>
              {result.avgSeverityWhenLow}/10
            </Text>
          </View>
        </View>
      </SectionCard>

      {/* Exposure Time vs Eczema Flare-Up Graph */}
      <SectionCard
        title="Exposure Time → Eczema Flare-Up Graph"
        subtitle="Shows when exposures occurred, 3-day cumulative build-up, and exact hours until flare peaks."
      >
        <ExposureFlareChart result={result} windowDays={21} />
      </SectionCard>

      {/* Multi-Lag & Cumulative Profile */}
      <SectionCard
        title="Immediate vs. Delayed vs. Build-Up Profile"
        subtitle="Tests same-day (0d), delayed (1–3 days), and rolling multi-day accumulation (3d & 5d)."
      >
        <LagProfileChart lags={result.allLags} bestLagKey={result.bestLag.lagKey} />

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 1.7 }]}>Window</Text>
            <Text style={[styles.th, { flex: 0.9, textAlign: 'right' }]}>Score r</Text>
            <Text style={[styles.th, { flex: 0.9, textAlign: 'right' }]}>p-val</Text>
            <Text style={[styles.th, { flex: 0.7, textAlign: 'right' }]}>n</Text>
          </View>
          {result.allLags.map((lag) => {
            const isBest = lag.lagKey === result.bestLag.lagKey;
            return (
              <View
                key={lag.lagKey}
                style={[styles.tableRow, isBest && styles.tableRowBest]}
              >
                <Text
                  style={[
                    styles.td,
                    { flex: 1.7 },
                    isBest && styles.tdBold,
                  ]}
                >
                  {lag.label}
                </Text>
                <Text
                  style={[
                    styles.td,
                    { flex: 0.9, textAlign: 'right' },
                    isBest && styles.tdBold,
                  ]}
                >
                  {lag.score >= 0 ? `+${lag.score.toFixed(2)}` : lag.score.toFixed(2)}
                </Text>
                <Text style={[styles.td, { flex: 0.9, textAlign: 'right' }]}>
                  {lag.pValue < 0.001 ? '<.001' : lag.pValue.toFixed(3)}
                </Text>
                <Text style={[styles.td, { flex: 0.7, textAlign: 'right' }]}>
                  {lag.sampleSize}
                </Text>
              </View>
            );
          })}
        </View>
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: 44 },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xxl,
    backgroundColor: COLORS.background,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  emptySub: {
    fontSize: 13.5,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  varTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  bigScoreBox: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
  },
  bigScore: {
    fontSize: 22,
    fontWeight: '800',
  },
  bigScoreLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  summary: {
    fontSize: 13.5,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: SPACING.md,
  },
  compareRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: SPACING.md,
  },
  compareTile: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  compareLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  compareVal: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  table: {
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  th: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    paddingHorizontal: 4,
  },
  tableRowBest: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 6,
  },
  td: {
    fontSize: 12.5,
    color: COLORS.textSecondary,
  },
  tdBold: {
    fontWeight: '800',
    color: COLORS.primaryDark,
  },
});
