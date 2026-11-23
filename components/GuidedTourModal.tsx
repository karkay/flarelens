import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/theme';

const STEPS = [
  {
    title: 'Welcome to FlareLens',
    subtitle: 'Step 1 of 6 · Uncover Your Eczema Triggers',
    body: 'Track daily severity alongside auto-synced weather, allergens, food ingredients, sleep quality, wearables—and create, log, and track your own custom triggers (like detergents, fabrics, or routines) to discover immediate (0–12h) and multi-day delayed (24–72h) triggers.',
  },
  {
    title: 'Daily Check-Ins & Auto Sensors',
    subtitle: 'Step 2 of 6 · Today Tab',
    body: 'Log 0–10 eczema severity anytime, auto-sync local humidity, weather & pollen via GPS, and add custom variables like laundry detergent or hot showers.',
  },
  {
    title: 'Health & Wearable Sync',
    subtitle: 'Step 3 of 6 · Apple Health, WHOOP, Garmin & Strava',
    body: 'Connect your health apps to extract sleep quality, sleep duration, HRV, resting heart rate, and exercise minutes directly into your correlation timeline.',
  },
  {
    title: 'Gemini Food Lens',
    subtitle: 'Step 4 of 6 · Food Lens Tab',
    body: 'Photograph meals and beverages so Gemini extracts typical and hidden ingredients (Dairy, Gluten, Nightshades, Soy, Eggs) as trackable exposure variables.',
  },
  {
    title: 'Metrics & Correlation (r)',
    subtitle: 'Step 5 of 6 · Metrics Tab',
    body: 'Positive +r scores indicate suspected triggers; negative -r scores indicate protective factors. Compare 0d, 1d, 2d, 3d, and 3d/5d Build-Up bars side by side.',
  },
  {
    title: '9 AM / 9 PM Insights & Flare Graphs',
    subtitle: 'Step 6 of 6 · Insights Tab',
    body: 'Twice-daily reports highlight active exposure windows and graph exact exposure timestamps against flare-up peaks with reaction lag connectors.',
  },
];

export const GuidedTourModal: React.FC<{
  visible: boolean;
  onFinish: () => void;
}> = ({ visible, onFinish }) => {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];

  const handleClose = () => {
    setIdx(0);
    onFinish();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.dot, i <= idx && styles.dotActive]} />
            ))}
          </View>
          <Text style={styles.sub}>{step.subtitle}</Text>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>
          <View style={styles.row}>
            <Pressable
              style={styles.secBtn}
              onPress={() => (idx > 0 ? setIdx(idx - 1) : handleClose())}
            >
              <Text style={styles.secText}>{idx > 0 ? '← Back' : 'Skip'}</Text>
            </Pressable>
            <Pressable
              style={styles.priBtn}
              onPress={() => (idx === STEPS.length - 1 ? handleClose() : setIdx(idx + 1))}
            >
              <Text style={styles.priText}>
                {idx === STEPS.length - 1 ? 'Start Using FlareLens' : 'Next →'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(14,30,28,0.55)',
    justifyContent: 'flex-end',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
  },
  dots: { flexDirection: 'row', gap: 5, marginBottom: 12 },
  dot: { flex: 1, height: 5, borderRadius: 99, backgroundColor: COLORS.surfaceMuted },
  dotActive: { backgroundColor: COLORS.primary },
  sub: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  title: { fontSize: 19, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  body: { fontSize: 13.5, color: COLORS.textSecondary, lineHeight: 20, marginVertical: 12 },
  row: { flexDirection: 'row', gap: 10 },
  secBtn: {
    flex: 1,
    backgroundColor: COLORS.primaryLight,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  secText: { color: COLORS.primaryDark, fontWeight: '700' },
  priBtn: {
    flex: 1.4,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  priText: { color: '#FFFFFF', fontWeight: '700' },
});
