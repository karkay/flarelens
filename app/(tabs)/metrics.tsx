import React, { useMemo, useState } from 'react';
import {
  Alert,
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
import { VariableCategory } from '../../types';
import { CorrelationCard } from '../../components/CorrelationCard';
import { SectionCard } from '../../components/SectionCard';

type CategoryFilter = 'all' | VariableCategory;
type DirectionFilter = 'all' | 'trigger' | 'protective';

const CATEGORY_TABS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'food_ingredient', label: 'Food Ingredients' },
  { id: 'environment', label: 'Environment' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'custom', label: 'Custom' },
];

export default function MetricsScreen() {
  const router = useRouter();
  const { correlationResults, customVariables, deleteCustomVariable } = useApp();

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');

  const filtered = useMemo(() => {
    return correlationResults.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (directionFilter !== 'all' && item.direction !== directionFilter) return false;
      return true;
    });
  }, [correlationResults, categoryFilter, directionFilter]);

  const stats = useMemo(() => {
    const triggers = correlationResults.filter((r) => r.direction === 'trigger').length;
    const protective = correlationResults.filter((r) => r.direction === 'protective').length;
    const ingredients = correlationResults.filter((r) => r.category === 'food_ingredient').length;
    const delayedOrCumulative = correlationResults.filter(
      (r) => r.direction !== 'neutral' && r.pattern !== 'immediate'
    ).length;
    return { triggers, protective, ingredients, delayedOrCumulative };
  }, [correlationResults]);

  const confirmDeleteCustom = (id: string, name: string) => {
    Alert.alert('Remove Custom Variable', `Remove "${name}" from your custom variables?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => deleteCustomVariable(id),
      },
    ]);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Summary Strip */}
      <View style={styles.summaryGrid}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{correlationResults.length}</Text>
          <Text style={styles.statLabel}>Variables</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: COLORS.trigger }]}>{stats.triggers}</Text>
          <Text style={styles.statLabel}>Triggers (+)</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: COLORS.protective }]}>
            {stats.protective}
          </Text>
          <Text style={styles.statLabel}>Protective (-)</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: COLORS.cumulative }]}>
            {stats.delayedOrCumulative}
          </Text>
          <Text style={styles.statLabel}>Delayed / Build-Up</Text>
        </View>
      </View>

      {/* Add Custom Variable CTA */}
      <Pressable
        onPress={() => router.push('/add-variable')}
        style={styles.addBanner}
      >
        <View style={styles.addIcon}>
          <Ionicons name="add" size={20} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.addBannerTitle}>Add Custom Tracking Variable</Text>
          <Text style={styles.addBannerSub}>
            Track detergent, shower temperature, pet exposure, supplements, or any personal factor.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
      </Pressable>

      {/* Category Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {CATEGORY_TABS.map((tab) => {
          const active = categoryFilter === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setCategoryFilter(tab.id)}
              style={[styles.filterPill, active && styles.filterPillActive]}
            >
              <Text
                style={[styles.filterPillText, active && styles.filterPillTextActive]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Direction Filter */}
      <View style={styles.dirRow}>
        {(
          [
            { id: 'all', label: 'All Correlations' },
            { id: 'trigger', label: 'Suspected Triggers (+)' },
            { id: 'protective', label: 'Protective (-)' },
          ] as const
        ).map((d) => {
          const active = directionFilter === d.id;
          return (
            <Pressable
              key={d.id}
              onPress={() => setDirectionFilter(d.id)}
              style={[styles.dirChip, active && styles.dirChipActive]}
            >
              <Text style={[styles.dirChipText, active && styles.dirChipTextActive]}>
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Multi-Lag Explanation Note */}
      <View style={styles.infoNote}>
        <Ionicons name="information-circle-outline" size={16} color={COLORS.primaryDark} />
        <Text style={styles.infoNoteText}>
          Each variable is tested across Same-Day (0d), Delayed (1d, 2d, 3d), and Multi-Day Build-Up (3d & 5d cumulative) windows. Tap any card for its full Exposure → Flare graph.
        </Text>
      </View>

      {/* Ranked Correlation List */}
      {filtered.length === 0 ? (
        <SectionCard title="No Matching Correlations">
          <Text style={styles.emptyText}>
            Log at least 4–5 days of eczema check-ins and variable exposures (or enable the 21-day demo dataset in Settings) to see ranked correlations here.
          </Text>
        </SectionCard>
      ) : (
        filtered.map((item) => (
          <CorrelationCard
            key={item.variableId}
            result={item}
            onPress={() =>
              router.push({
                pathname: '/variable/[id]',
                params: { id: encodeURIComponent(item.variableId) },
              })
            }
          />
        ))
      )}

      {/* Custom Variables Management List */}
      {customVariables.length > 0 && (
        <SectionCard
          title={`Custom Variables (${customVariables.length})`}
          subtitle="Automatically included in daily check-ins, metrics & 9 AM / 9 PM insights."
        >
          {customVariables.map((cv) => (
            <View key={cv.id} style={styles.customRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customName}>{cv.name}</Text>
                <Text style={styles.customMeta}>
                  {cv.valueType.toUpperCase()}
                  {cv.unit ? ` · ${cv.unit}` : ''} · {cv.description}
                </Text>
              </View>
              {!cv.id.startsWith('custom_hot_shower') && (
                <Pressable
                  onPress={() => confirmDeleteCustom(cv.id, cv.name)}
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={17} color={COLORS.trigger} />
                </Pressable>
              )}
            </View>
          ))}
        </SectionCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  summaryGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.md,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  statVal: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  addBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: '#C5E3DF',
  },
  addIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryDark,
  },
  addBannerSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  filterScroll: {
    marginBottom: SPACING.sm,
  },
  filterRow: {
    gap: 8,
    paddingRight: 16,
  },
  filterPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterPillText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  dirRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: SPACING.md,
  },
  dirChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
  },
  dirChipActive: {
    backgroundColor: COLORS.text,
  },
  dirChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  dirChipTextActive: {
    color: '#FFFFFF',
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: SPACING.md,
  },
  infoNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  customName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  customMeta: {
    fontSize: 11.5,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 8,
  },
});
