import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { Badge, SectionCard } from '../../components/SectionCard';
import { ExposureFlareChart } from '../../components/ExposureFlareChart';
import { LagProfileChart } from '../../components/LagProfileChart';
import {
  formatTime12h,
  getNextScheduledRunInfo,
} from '../../services/insightsScheduler';

export default function InsightsScreen() {
  const router = useRouter();
  const { settings, latestReport, reportHistory, runInsightsAnalysisNow } = useApp();

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedVarId, setSelectedVarId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const activeReport = useMemo(() => {
    if (selectedReportId) {
      const found = reportHistory.find((r) => r.id === selectedReportId);
      if (found) return found;
    }
    return latestReport;
  }, [selectedReportId, reportHistory, latestReport]);

  const nextRun = useMemo(() => getNextScheduledRunInfo(settings), [settings]);

  const chartCandidates = useMemo(() => {
    if (!activeReport) return [];
    const merged = [
      ...activeReport.topTriggers,
      ...activeReport.topProtective,
    ];
    if (merged.length > 0) return merged;
    return activeReport.allResults.slice(0, 5);
  }, [activeReport]);

  const activeVariableResult = useMemo(() => {
    if (chartCandidates.length === 0) return null;
    if (selectedVarId) {
      const match = chartCandidates.find((v) => v.variableId === selectedVarId);
      if (match) return match;
    }
    return chartCandidates[0];
  }, [chartCandidates, selectedVarId]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      const fresh = await runInsightsAnalysisNow('manual');
      setSelectedReportId(fresh.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  const generatedTimeStr = activeReport
    ? new Date(activeReport.generatedAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Not generated yet';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Twice-Daily 9 AM / 9 PM Schedule Banner */}
      <View style={styles.scheduleCard}>
        <View style={styles.scheduleHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.slotBadgeRow}>
              <Ionicons
                name={activeReport?.slot === 'evening' ? 'moon' : 'sunny'}
                size={15}
                color="#FFFFFF"
              />
              <Text style={styles.slotLabel}>
                {activeReport?.scheduledForLabel ?? 'Daily Insights Schedule'}
              </Text>
            </View>
            <Text style={styles.scheduleHeadline}>
              {activeReport?.headline ?? 'Ready to analyze your eczema triggers'}
            </Text>
          </View>

          <Pressable
            onPress={handleManualRefresh}
            disabled={isRefreshing}
            style={styles.refreshBtn}
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color={COLORS.primaryDark} />
            ) : (
              <Ionicons name="refresh" size={16} color={COLORS.primaryDark} />
            )}
          </Pressable>
        </View>

        <Text style={styles.narrative}>
          {activeReport?.narrativeSummary ??
            'Insights automatically run at 9:00 AM and 9:00 PM each day.'}
        </Text>

        <View style={styles.scheduleMetaBar}>
          <Text style={styles.scheduleMetaText}>
            Ready: {generatedTimeStr}
          </Text>
          <Text style={styles.scheduleMetaText}>
            Next auto-run: {formatTime12h(
              nextRun.slot === 'morning'
                ? settings.morningInsightTime
                : settings.eveningInsightTime
            )}{' '}
            ({nextRun.countdownLabel})
          </Text>
        </View>
      </View>

      {/* Active Exposure Watchlist (Upcoming Reaction Windows) */}
      {activeReport && activeReport.activeAlerts.length > 0 && (
        <SectionCard
          title="Active Reaction Watchlist"
          subtitle="Recent exposures from the last 72h whose typical flare window is approaching or active."
          rightElement={
            <Badge
              label={`${activeReport.activeAlerts.length} Active`}
              tone="warning"
            />
          }
        >
          {activeReport.activeAlerts.map((alert, idx) => (
            <Pressable
              key={`${alert.variableId}_${idx}`}
              onPress={() => setSelectedVarId(alert.variableId)}
              style={styles.alertRow}
            >
              <View
                style={[
                  styles.alertIndicator,
                  {
                    backgroundColor:
                      alert.riskLevel === 'high'
                        ? COLORS.trigger
                        : alert.riskLevel === 'moderate'
                        ? COLORS.warning
                        : COLORS.exposure,
                  },
                ]}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.alertTitleRow}>
                  <Text style={styles.alertTitle}>{alert.variableName}</Text>
                  <Badge
                    label={alert.expectedPeakWindowLabel}
                    tone={alert.riskLevel === 'high' ? 'trigger' : 'warning'}
                  />
                </View>
                <Text style={styles.alertReason}>{alert.reason}</Text>
              </View>
            </Pressable>
          ))}
        </SectionCard>
      )}

      {/* Signature Exposure-to-Flare Timeline Graph */}
      {activeVariableResult ? (
        <SectionCard
          title="Exposure Time vs. Eczema Flare-Up"
          subtitle="Compare when you were exposed to a variable against when your eczema flared up."
          rightElement={
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/variable/[id]',
                  params: { id: encodeURIComponent(activeVariableResult.variableId) },
                })
              }
            >
              <Text style={styles.deepDiveLink}>Full Stats →</Text>
            </Pressable>
          }
        >
          {/* Variable Selector Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.varSelectorScroll}
            contentContainerStyle={styles.varSelectorRow}
          >
            {chartCandidates.map((cand) => {
              const selected = cand.variableId === activeVariableResult.variableId;
              const isTrigger = cand.direction === 'trigger';
              return (
                <Pressable
                  key={cand.variableId}
                  onPress={() => setSelectedVarId(cand.variableId)}
                  style={[
                    styles.varPill,
                    selected && {
                      backgroundColor: isTrigger ? COLORS.trigger : COLORS.protective,
                      borderColor: isTrigger ? COLORS.trigger : COLORS.protective,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.varPillText,
                      selected && { color: '#FFFFFF' },
                    ]}
                  >
                    {cand.variableName} ({cand.bestLag.score >= 0 ? '+' : ''}
                    {cand.bestLag.score.toFixed(2)})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.selectedSummaryBox}>
            <View style={styles.selectedBadges}>
              <Badge
                label={activeVariableResult.typicalLagDescription}
                tone={
                  activeVariableResult.pattern === 'cumulative_buildup'
                    ? 'cumulative'
                    : activeVariableResult.direction === 'trigger'
                    ? 'trigger'
                    : 'protective'
                }
              />
              <Badge
                label={`r = ${activeVariableResult.bestLag.score >= 0 ? '+' : ''}${activeVariableResult.bestLag.score.toFixed(2)}`}
                tone="neutral"
              />
            </View>
            <Text style={styles.selectedSummaryText}>
              {activeVariableResult.summary}
            </Text>
          </View>

          <ExposureFlareChart result={activeVariableResult} windowDays={21} />

          <View style={styles.lagDivider}>
            <Text style={styles.lagSubheading}>
              Reaction Lag Profile (Immediate vs. Delayed vs. Multi-Day Build-Up)
            </Text>
            <LagProfileChart
              lags={activeVariableResult.allLags}
              bestLagKey={activeVariableResult.bestLag.lagKey}
            />
          </View>
        </SectionCard>
      ) : (
        <SectionCard title="No Insights Data Yet">
          <Text style={styles.emptyText}>
            Log daily eczema severity, environmental data, and meal photos to unlock exposure-to-flare graphs.
          </Text>
        </SectionCard>
      )}

      {/* Top Suspected Triggers List */}
      {activeReport && activeReport.topTriggers.length > 0 && (
        <SectionCard
          title="Suspected Eczema Triggers"
          subtitle="Ranked by strongest correlation across 0h–72h and 3–5 day build-up windows."
        >
          {activeReport.topTriggers.map((t, idx) => (
            <Pressable
              key={t.variableId}
              onPress={() => setSelectedVarId(t.variableId)}
              style={styles.findingRow}
            >
              <View style={styles.rankCircle}>
                <Text style={styles.rankText}>{idx + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.findingTitleLine}>
                  <Text style={styles.findingName}>{t.variableName}</Text>
                  <Text style={styles.findingScore}>
                    r = +{t.bestLag.score.toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.findingLag}>{t.typicalLagDescription}</Text>
                <Text style={styles.findingSub}>{t.summary}</Text>
              </View>
            </Pressable>
          ))}
        </SectionCard>
      )}

      {/* Protective Factors */}
      {activeReport && activeReport.topProtective.length > 0 && (
        <SectionCard
          title="Protective & Calming Factors"
          subtitle="Higher values correlate with calmer skin; drops in these often precede flares."
        >
          {activeReport.topProtective.map((p) => (
            <Pressable
              key={p.variableId}
              onPress={() => setSelectedVarId(p.variableId)}
              style={styles.findingRow}
            >
              <View style={[styles.rankCircle, { backgroundColor: COLORS.protectiveLight }]}>
                <Ionicons name="shield-checkmark" size={15} color={COLORS.protective} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.findingTitleLine}>
                  <Text style={styles.findingName}>{p.variableName}</Text>
                  <Text style={[styles.findingScore, { color: COLORS.protective }]}>
                    r = {p.bestLag.score.toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.findingSub}>{p.summary}</Text>
              </View>
            </Pressable>
          ))}
        </SectionCard>
      )}

      {/* Twice-Daily Report History */}
      {reportHistory.length > 0 && (
        <SectionCard
          title="Scheduled 9 AM / 9 PM Digest History"
          subtitle={`Automatically generated at ${formatTime12h(
            settings.morningInsightTime
          )} and ${formatTime12h(settings.eveningInsightTime)} daily.`}
        >
          {reportHistory.slice(0, 8).map((rep) => {
            const active = activeReport?.id === rep.id;
            const dt = new Date(rep.generatedAt).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <Pressable
                key={rep.id}
                onPress={() => setSelectedReportId(rep.id)}
                style={[styles.historyItem, active && styles.historyItemActive]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyLabel}>{rep.scheduledForLabel}</Text>
                  <Text style={styles.historyTime}>
                    {dt} · {rep.topTriggers.length} triggers · {rep.daysAnalyzed}d analyzed
                  </Text>
                </View>
                {active && <Badge label="Viewing" tone="primary" />}
              </Pressable>
            );
          })}
        </SectionCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: 44 },
  scheduleCard: {
    backgroundColor: COLORS.primaryDark,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  slotBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  slotLabel: {
    color: '#BCE6DF',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  scheduleHeadline: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E5F3F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  narrative: {
    color: '#E6F2F0',
    fontSize: 13,
    lineHeight: 19,
    marginTop: SPACING.sm,
  },
  scheduleMetaBar: {
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  scheduleMetaText: {
    color: '#AEDBD4',
    fontSize: 11.5,
    fontWeight: '600',
  },
  alertRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  alertIndicator: {
    width: 4,
    borderRadius: 2,
  },
  alertTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  alertReason: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    lineHeight: 17,
  },
  deepDiveLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.primary,
  },
  varSelectorScroll: {
    marginBottom: SPACING.sm,
  },
  varSelectorRow: {
    gap: 8,
    paddingRight: 16,
  },
  varPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  varPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  selectedSummaryBox: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  selectedBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  selectedSummaryText: {
    fontSize: 12.5,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  lagDivider: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  lagSubheading: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  findingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  rankCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.triggerLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.trigger,
  },
  findingTitleLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  findingName: {
    fontSize: 14.5,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  findingScore: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.trigger,
  },
  findingLag: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primaryDark,
    marginTop: 2,
  },
  findingSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
    marginTop: 3,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: RADIUS.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  historyItemActive: {
    backgroundColor: COLORS.primaryLight,
  },
  historyLabel: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  historyTime: {
    fontSize: 11.5,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
});
