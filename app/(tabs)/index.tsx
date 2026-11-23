import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { COLORS, RADIUS, SPACING, getSeverityColor, getSeverityLabel } from '../../constants/theme';
import { BodyArea } from '../../types';
import { Badge, SectionCard } from '../../components/SectionCard';
import { BodyAreaPicker, ScaleRow } from '../../components/SeverityPicker';
import { getSeasonForLocation, getTimeOfDayBucket } from '../../services/deviceCollectors';
import { toDateKey } from '../../engine/correlationEngine';

export default function TodayScreen() {
  const router = useRouter();
  const {
    settings,
    eczemaLogs,
    measurements,
    customVariables,
    lastMetadata,
    isSyncingSensors,
    logEczemaCheckIn,
    logDailyVariables,
    refreshAutoMetadata,
  } = useApp();

  // Eczema severity form state
  const [severity, setSeverity] = useState(3);
  const [itchLevel, setItchLevel] = useState(3);
  const [rednessLevel, setRednessLevel] = useState(2);
  const [drynessLevel, setDrynessLevel] = useState(4);
  const [affectedAreas, setAffectedAreas] = useState<BodyArea[]>(['hands']);
  const [notes, setNotes] = useState('');
  const [savingCheckIn, setSavingCheckIn] = useState(false);

  // Daily lifestyle & custom variable state
  const [stress, setStress] = useState(4);
  const [sleepHours, setSleepHours] = useState('7.5');
  const [sleepQuality, setSleepQuality] = useState(7);
  const [screenTime, setScreenTime] = useState('5.0');
  const [exerciseMinutes, setExerciseMinutes] = useState(
    lastMetadata?.estimatedExerciseMinutes !== undefined
      ? String(lastMetadata.estimatedExerciseMinutes)
      : '30'
  );
  const [customValues, setCustomValues] = useState<Record<string, string | boolean | number>>({});
  const [savingVars, setSavingVars] = useState(false);

  const now = new Date();
  const todayKey = toDateKey(now);
  const timeOfDay = lastMetadata?.timeOfDay ?? getTimeOfDayBucket(now);
  const season = lastMetadata?.season ?? getSeasonForLocation(now, lastMetadata?.latitude);

  const todaysLogs = useMemo(
    () => eczemaLogs.filter((l) => l.dateKey === todayKey),
    [eczemaLogs, todayKey]
  );

  // Show latest environmental reading from live sensor sync or today's measurements
  const latestEnv = useMemo(() => {
    const findLatest = (varId: string) =>
      measurements.find((m) => m.variableId === varId)?.numericValue;

    const tempC = lastMetadata?.temperatureC ?? findLatest('var_temperature');
    const humidity = lastMetadata?.humidityPct ?? findLatest('var_humidity');
    const pollen = lastMetadata?.pollenIndex ?? findLatest('var_local_allergens');
    const uv = lastMetadata?.uvIndex ?? findLatest('var_uv_index');
    const exercise =
      lastMetadata?.estimatedExerciseMinutes ?? findLatest('var_exercise');

    return { tempC, humidity, pollen, uv, exercise };
  }, [lastMetadata, measurements]);

  const displayTemp = (tempC?: number) => {
    if (tempC === undefined) return '—';
    if (settings.temperatureUnit === 'F') {
      return `${Math.round((tempC * 9) / 5 + 32)}°F`;
    }
    return `${tempC.toFixed(1)}°C`;
  };

  const toggleArea = (area: BodyArea) => {
    setAffectedAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  const handleSyncSensors = async () => {
    const snap = await refreshAutoMetadata();
    if (snap.estimatedExerciseMinutes !== undefined) {
      setExerciseMinutes(String(snap.estimatedExerciseMinutes));
    }
    if (snap.sleepHours !== undefined) {
      setSleepHours(String(snap.sleepHours));
    }
    if (snap.screenTimeHours !== undefined) {
      setScreenTime(String(snap.screenTimeHours));
    }
    if (snap.warnings.length > 0 && snap.temperatureC === undefined) {
      Alert.alert('Sensor Sync Note', snap.warnings[0]);
    }
  };

  const shouldAutoSyncLive = () => {
    if (!lastMetadata?.capturedAt) return true;
    const ageMs = Date.now() - new Date(lastMetadata.capturedAt).getTime();
    return Number.isNaN(ageMs) || ageMs > 30 * 60 * 1000;
  };

  const handleSaveEczema = async () => {
    setSavingCheckIn(true);
    try {
      await logEczemaCheckIn({
        severity,
        itchLevel,
        rednessLevel,
        drynessLevel,
        affectedAreas,
        notes,
      });
      setNotes('');
      let syncedNote = '';
      if (shouldAutoSyncLive()) {
        try {
          const snap = await refreshAutoMetadata();
          if (snap.locationName) syncedNote = ` Auto-synced live weather & pollen (${snap.locationName}).`;
        } catch {
          // Offline or permission denied — keep check-in saved smoothly
        }
      }
      Alert.alert(
        'Check-In Saved',
        `Logged eczema severity ${severity}/10 (${getSeverityLabel(severity)}).${syncedNote}`
      );
    } finally {
      setSavingCheckIn(false);
    }
  };

  const handleSaveDailyVariables = async () => {
    setSavingVars(true);
    try {
      const batch: {
        variableId: string;
        variableName: string;
        category: 'lifestyle' | 'custom';
        numericValue: number;
        unit?: string;
      }[] = [
        {
          variableId: 'var_stress',
          variableName: 'Stress Level',
          category: 'lifestyle',
          numericValue: stress,
          unit: '/10',
        },
        {
          variableId: 'var_sleep_duration',
          variableName: 'Sleep Duration',
          category: 'lifestyle',
          numericValue: Math.max(0, parseFloat(sleepHours) || 0),
          unit: 'hrs',
        },
        {
          variableId: 'var_sleep_quality',
          variableName: 'Sleep Quality',
          category: 'lifestyle',
          numericValue: sleepQuality,
          unit: '/10',
        },
        {
          variableId: 'var_screen_time',
          variableName: 'Screen Time',
          category: 'lifestyle',
          numericValue: Math.max(0, parseFloat(screenTime) || 0),
          unit: 'hrs',
        },
        {
          variableId: 'var_exercise',
          variableName: 'Exercise Quantity',
          category: 'lifestyle',
          numericValue: Math.max(0, parseFloat(exerciseMinutes) || 0),
          unit: 'min',
        },
      ];

      for (const cv of customVariables) {
        if (!cv.isActive) continue;
        const raw = customValues[cv.id];
        if (cv.valueType === 'boolean') {
          batch.push({
            variableId: cv.id,
            variableName: cv.name,
            category: 'custom',
            numericValue: raw ? 1 : 0,
          });
        } else if (cv.valueType === 'scale') {
          batch.push({
            variableId: cv.id,
            variableName: cv.name,
            category: 'custom',
            numericValue: typeof raw === 'number' ? raw : 5,
            unit: cv.unit ?? '/10',
          });
        } else if (raw !== undefined && String(raw).trim() !== '') {
          const parsed = parseFloat(String(raw));
          if (!Number.isNaN(parsed)) {
            batch.push({
              variableId: cv.id,
              variableName: cv.name,
              category: 'custom',
              numericValue: parsed,
              unit: cv.unit,
            });
          }
        }
      }

      await logDailyVariables(batch);
      Alert.alert(
        'Variables Logged',
        `Saved ${batch.length} lifestyle & custom variables for today.`
      );
    } finally {
      setSavingVars(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Context strip */}
      <View style={styles.contextStrip}>
        <View style={styles.contextLeft}>
          <Badge label={`${timeOfDay.toUpperCase()} · ${season.toUpperCase()}`} tone="primary" />
          {settings.useDemoData && <Badge label="21d Demo Active" tone="warning" />}
        </View>
        <Pressable onPress={() => router.push('/(tabs)/food')} style={styles.quickScanBtn}>
          <Ionicons name="camera" size={14} color="#FFFFFF" />
          <Text style={styles.quickScanText}>Scan Food</Text>
        </Pressable>
      </View>

      {/* Auto-Collected Environmental & Device Metadata */}
      <SectionCard
        title="Auto-Collected Metadata"
        subtitle={
          lastMetadata?.locationName
            ? `${lastMetadata.locationName} · ${lastMetadata.weatherCondition ?? 'Live sensors'}`
            : 'GPS Weather, Humidity, Local Allergens & Pedometer'
        }
        rightElement={
          <Pressable
            onPress={handleSyncSensors}
            disabled={isSyncingSensors}
            style={styles.syncBtn}
          >
            {isSyncingSensors ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="refresh" size={15} color={COLORS.primary} />
            )}
            <Text style={styles.syncBtnText}>
              {isSyncingSensors ? 'Syncing…' : 'Sync Device'}
            </Text>
          </Pressable>
        }
      >
        <View style={styles.metaGrid}>
          <View style={styles.metaTile}>
            <Text style={styles.metaTileLabel}>Humidity</Text>
            <Text style={styles.metaTileVal}>
              {latestEnv.humidity !== undefined ? `${latestEnv.humidity}%` : '—'}
            </Text>
            <Text style={styles.metaTileSrc}>Open-Meteo</Text>
          </View>
          <View style={styles.metaTile}>
            <Text style={styles.metaTileLabel}>Weather</Text>
            <Text style={styles.metaTileVal}>{displayTemp(latestEnv.tempC)}</Text>
            <Text style={styles.metaTileSrc}>
              {lastMetadata?.weatherCondition ?? 'Auto GPS'}
            </Text>
          </View>
          <View style={styles.metaTile}>
            <Text style={styles.metaTileLabel}>Allergens</Text>
            <Text style={styles.metaTileVal}>
              {latestEnv.pollen !== undefined ? `${latestEnv.pollen}/100` : '—'}
            </Text>
            <Text style={styles.metaTileSrc}>Pollen + AQI</Text>
          </View>
          <View style={styles.metaTile}>
            <Text style={styles.metaTileLabel}>Activity</Text>
            <Text style={styles.metaTileVal}>
              {lastMetadata?.stepsToday !== undefined
                ? `${lastMetadata.stepsToday}`
                : latestEnv.exercise !== undefined
                ? `${latestEnv.exercise}m`
                : '—'}
            </Text>
            <Text style={styles.metaTileSrc}>
              {lastMetadata?.stepsToday !== undefined ? 'Steps today' : 'Pedometer'}
            </Text>
          </View>
        </View>
      </SectionCard>

      {/* Daily Eczema Severity Logger */}
      <SectionCard
        title="Log Eczema Severity"
        subtitle="Log morning, evening, or instant flare-ups to track exact exposure-to-reaction lag."
      >
        <ScaleRow
          label="Overall Eczema Severity"
          value={severity}
          min={0}
          max={10}
          unit="/10"
          colorizeSeverity
          onChange={setSeverity}
        />
        <ScaleRow
          label="Itch Intensity"
          value={itchLevel}
          min={0}
          max={10}
          unit="/10"
          colorizeSeverity
          onChange={setItchLevel}
        />
        <ScaleRow
          label="Redness / Inflammation"
          value={rednessLevel}
          min={0}
          max={10}
          unit="/10"
          colorizeSeverity
          onChange={setRednessLevel}
        />
        <ScaleRow
          label="Skin Dryness"
          value={drynessLevel}
          min={0}
          max={10}
          unit="/10"
          onChange={setDrynessLevel}
        />

        <BodyAreaPicker selected={affectedAreas} onToggle={toggleArea} />

        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional notes (e.g., flared after lunch, itchy wrists)..."
          placeholderTextColor={COLORS.textMuted}
          style={styles.notesInput}
          multiline
        />

        <Pressable
          onPress={handleSaveEczema}
          disabled={savingCheckIn}
          style={[styles.primaryBtn, savingCheckIn && styles.btnDisabled]}
        >
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>
            {savingCheckIn ? 'Saving…' : 'Save Eczema Check-In'}
          </Text>
        </Pressable>
      </SectionCard>

      {/* Lifestyle & Custom Variables */}
      <SectionCard
        title="Daily Variables"
        subtitle="Track stress, sleep, screen time, exercise & your custom triggers."
        rightElement={
          <Pressable
            onPress={() => router.push('/add-variable')}
            style={styles.addVarBtn}
          >
            <Ionicons name="add" size={16} color={COLORS.primary} />
            <Text style={styles.addVarBtnText}>Add Variable</Text>
          </Pressable>
        }
      >
        <ScaleRow
          label="Stress Level"
          value={stress}
          min={1}
          max={10}
          unit="/10"
          onChange={setStress}
        />

        <ScaleRow
          label="Sleep Quality"
          value={sleepQuality}
          min={1}
          max={10}
          unit="/10"
          onChange={setSleepQuality}
        />

        <View style={styles.numericGrid}>
          <View style={styles.numericField}>
            <Text style={styles.fieldLabel}>Sleep Duration (hrs)</Text>
            <TextInput
              value={sleepHours}
              onChangeText={setSleepHours}
              keyboardType="decimal-pad"
              style={styles.numInput}
            />
          </View>
          <View style={styles.numericField}>
            <Text style={styles.fieldLabel}>Screen Time (hrs)</Text>
            <TextInput
              value={screenTime}
              onChangeText={setScreenTime}
              keyboardType="decimal-pad"
              style={styles.numInput}
            />
          </View>
          <View style={styles.numericField}>
            <Text style={styles.fieldLabel}>Exercise (min)</Text>
            <TextInput
              value={exerciseMinutes}
              onChangeText={setExerciseMinutes}
              keyboardType="numeric"
              style={styles.numInput}
            />
          </View>
        </View>

        {/* User Custom Variables */}
        {customVariables.length > 0 && (
          <View style={styles.customSection}>
            <Text style={styles.customSectionTitle}>Your Custom Variables</Text>
            {customVariables.map((cv) => {
              if (cv.valueType === 'boolean') {
                const boolVal = Boolean(customValues[cv.id]);
                return (
                  <View key={cv.id} style={styles.boolRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.boolLabel}>{cv.name}</Text>
                      <Text style={styles.boolSub}>{cv.description}</Text>
                    </View>
                    <Switch
                      value={boolVal}
                      onValueChange={(v) =>
                        setCustomValues((prev) => ({ ...prev, [cv.id]: v }))
                      }
                      trackColor={{ false: COLORS.border, true: COLORS.primary }}
                    />
                  </View>
                );
              }
              if (cv.valueType === 'scale') {
                const numVal =
                  typeof customValues[cv.id] === 'number'
                    ? (customValues[cv.id] as number)
                    : 5;
                return (
                  <ScaleRow
                    key={cv.id}
                    label={cv.name}
                    value={numVal}
                    min={cv.min ?? 1}
                    max={cv.max ?? 10}
                    unit={cv.unit ?? '/10'}
                    onChange={(v) =>
                      setCustomValues((prev) => ({ ...prev, [cv.id]: v }))
                    }
                  />
                );
              }
              return (
                <View key={cv.id} style={styles.customNumRow}>
                  <Text style={styles.fieldLabel}>
                    {cv.name} {cv.unit ? `(${cv.unit})` : ''}
                  </Text>
                  <TextInput
                    value={String(customValues[cv.id] ?? '')}
                    onChangeText={(txt) =>
                      setCustomValues((prev) => ({ ...prev, [cv.id]: txt }))
                    }
                    keyboardType="decimal-pad"
                    placeholder="Enter value"
                    placeholderTextColor={COLORS.textMuted}
                    style={styles.numInput}
                  />
                </View>
              );
            })}
          </View>
        )}

        <Pressable
          onPress={handleSaveDailyVariables}
          disabled={savingVars}
          style={[styles.secondaryBtn, savingVars && styles.btnDisabled]}
        >
          <Ionicons name="save-outline" size={17} color={COLORS.primaryDark} />
          <Text style={styles.secondaryBtnText}>
            {savingVars ? 'Saving…' : 'Save Daily Variables'}
          </Text>
        </Pressable>
      </SectionCard>

      {/* Today's Check-In Timeline */}
      <SectionCard
        title={`Today's Check-Ins (${todaysLogs.length})`}
        subtitle="Timestamped entries power exact exposure-to-flare lag charts."
      >
        {todaysLogs.length === 0 ? (
          <Text style={styles.emptyText}>
            No check-ins logged today yet. Save your morning or evening severity above.
          </Text>
        ) : (
          todaysLogs.map((log) => {
            const d = new Date(log.timestamp);
            const timeStr = d.toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <View key={log.id} style={styles.logItem}>
                <View
                  style={[
                    styles.sevDot,
                    { backgroundColor: getSeverityColor(log.severity) },
                  ]}
                >
                  <Text style={styles.sevDotText}>{log.severity}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logTitle}>
                    {getSeverityLabel(log.severity)} · {timeStr}
                  </Text>
                  <Text style={styles.logSub}>
                    Itch {log.itchLevel}/10 · Redness {log.rednessLevel}/10 ·{' '}
                    {log.affectedAreas.map((a) => a.replace('_', ' ')).join(', ')}
                  </Text>
                  {log.notes ? <Text style={styles.logNote}>{log.notes}</Text> : null}
                </View>
              </View>
            );
          })
        )}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  contextStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
    gap: 8,
  },
  contextLeft: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  quickScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
  },
  quickScanText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  syncBtnText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: '700',
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaTile: {
    width: '48%',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACING.md,
  },
  metaTileLabel: {
    fontSize: 11.5,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  metaTileVal: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 2,
  },
  metaTileSrc: {
    fontSize: 11,
    color: COLORS.primaryMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  notesInput: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 13.5,
    color: COLORS.text,
    minHeight: 54,
    marginTop: SPACING.xs,
    marginBottom: SPACING.md,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
  },
  secondaryBtnText: {
    color: COLORS.primaryDark,
    fontSize: 14,
    fontWeight: '700',
  },
  btnDisabled: { opacity: 0.6 },
  addVarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  addVarBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  numericGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.xs,
  },
  numericField: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  numInput: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  customSection: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  customSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  boolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 6,
  },
  boolLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  boolSub: {
    fontSize: 11.5,
    color: COLORS.textMuted,
  },
  customNumRow: {
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  sevDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sevDotText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  logTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  logSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  logNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
