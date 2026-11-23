import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/theme';

export type StatTermKey =
  | 'r_value'
  | 'p_value'
  | 'sample_size'
  | 'lag_window'
  | 'cumulative_buildup'
  | 'confidence'
  | 'hrv_rhr';

export const STAT_GLOSSARY: Record<
  StatTermKey,
  { title: string; badge: string; summary: string; bullets: string[]; example: string }
> = {
  r_value: {
    title: 'Correlation Score (r value)',
    badge: '-1.00 to +1.00',
    summary:
      'Measures how strongly a variable moves with your eczema severity, blending Pearson r and Spearman rank correlation.',
    bullets: [
      '+0.50 to +1.00 (Strong Trigger): Higher exposure reliably corresponds to worse flares.',
      '+0.25 to +0.49 (Moderate Signal): Potential trigger—keep logging to confirm.',
      '-0.25 to -1.00 (Protective Factor): Higher values correspond to calmer skin (drops trigger flares).',
    ],
    example: 'Dairy at r = +0.66 means flares rise after dairy. Humidity at r = -0.58 means drier air worsens skin.',
  },
  p_value: {
    title: 'Statistical Significance (p-value)',
    badge: 'Lower = stronger',
    summary: 'Probability that the observed correlation happened by random chance.',
    bullets: [
      'p < 0.05: Statistically significant (< 5% chance of coincidence).',
      'p = 0.05 to 0.15: Emerging trend—keep logging daily.',
    ],
    example: 'Logging 14–21 days helps separate genuine triggers from background noise.',
  },
  sample_size: {
    title: 'Sample Size (n)',
    badge: 'Paired days',
    summary: 'Number of matched days where both this variable and an eczema check-in were recorded.',
    bullets: ['n < 6: Early data only.', 'n ≥ 14: Solid foundation for trigger detection.'],
    example: 'Log calm days (0–2/10) as well as flare days so the engine learns your baseline.',
  },
  lag_window: {
    title: 'Reaction Lag (0d, 1d, 2d, 3d)',
    badge: 'Exposure → Flare delay',
    summary: 'Shifts every variable forward in time to uncover immediate vs. delayed eczema flares.',
    bullets: [
      '0d (Same Day): Immediate pollen, sweat, or contact reactions.',
      '1d–3d (~24h–72h): Delayed T-cell food or sleep reactions.',
    ],
    example: 'The bar chart shows which reaction delay correlates most strongly for you.',
  },
  cumulative_buildup: {
    title: 'Multi-Day Build-Up (3d & 5d Sum)',
    badge: 'Stacking threshold',
    summary: 'Tracks rolling multi-day exposure load for triggers that accumulate before flaring.',
    bullets: [
      'Captures repeated dry air, multi-day stress streaks, or consecutive meals with the same ingredient.',
    ],
    example: 'Toggle 3d Build-Up on any Exposure → Flare graph to see the rolling purple curve.',
  },
  confidence: {
    title: 'Confidence Level',
    badge: 'High · Moderate · Early',
    summary: 'Combines correlation strength (|r|), p-value, sample size, and exposure count.',
    bullets: [
      'High: |r| ≥ 0.55, p ≤ 0.05, n ≥ 10, ≥ 3 exposures.',
      'Moderate: |r| ≥ 0.35, p ≤ 0.15, n ≥ 7.',
    ],
    example: 'Always verify suspected food triggers with your dermatologist.',
  },
  hrv_rhr: {
    title: 'HRV, Resting HR & Sleep Quality',
    badge: 'Wearable biometrics',
    summary: 'Synced from Apple Health, WHOOP, Garmin, or Strava—objective stress and recovery signals.',
    bullets: [
      'Lower Sleep Quality or HRV often precedes eczema flares by 24–48h.',
      'Elevated Resting HR can signal physiological stress or inflammation.',
    ],
    example: 'Connect wearables in Settings to automatically correlate sleep quality and heart rate.',
  },
};

export const StatTooltipModal: React.FC<{
  term: StatTermKey | null;
  onClose: () => void;
}> = ({ term, onClose }) => {
  if (!term) return null;
  const entry = STAT_GLOSSARY[term];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.badge}>{entry.badge}</Text>
          <Text style={styles.title}>{entry.title}</Text>
          <Text style={styles.summary}>{entry.summary}</Text>
          {entry.bullets.map((b, i) => (
            <Text key={i} style={styles.bullet}>
              • {b}
            </Text>
          ))}
          <View style={styles.exampleBox}>
            <Text style={styles.exampleText}>In practice: {entry.example}</Text>
          </View>
          <Pressable style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,24,22,0.52)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryLight,
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 8,
  },
  summary: {
    fontSize: 13.5,
    color: COLORS.text,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 8,
  },
  bullet: {
    fontSize: 12.5,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 4,
  },
  exampleBox: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: 8,
  },
  exampleText: {
    fontSize: 12,
    color: COLORS.primaryDark,
    lineHeight: 17,
  },
  btn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
