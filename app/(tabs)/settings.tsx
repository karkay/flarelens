import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { SectionCard } from '../../components/SectionCard';
import { testGeminiConnection } from '../../services/geminiFoodService';
import { exportAllDataAsJson } from '../../services/storage';
import { formatTime12h } from '../../services/insightsScheduler';

export default function SettingsScreen() {
  const { settings, updateSettings, clearPersonalData } = useApp();

  const [apiKeyDraft, setApiKeyDraft] = useState(settings.geminiApiKey);
  const [showKey, setShowKey] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [morningDraft, setMorningDraft] = useState(settings.morningInsightTime);
  const [eveningDraft, setEveningDraft] = useState(settings.eveningInsightTime);

  useEffect(() => {
    setApiKeyDraft(settings.geminiApiKey);
    setMorningDraft(settings.morningInsightTime);
    setEveningDraft(settings.eveningInsightTime);
  }, [settings.geminiApiKey, settings.morningInsightTime, settings.eveningInsightTime]);

  const handleSaveApiKey = async () => {
    await updateSettings({ geminiApiKey: apiKeyDraft.trim() });
    Alert.alert('Saved', 'Gemini API key saved securely on this device.');
  };

  const handleTestGemini = async () => {
    setTestingGemini(true);
    try {
      const res = await testGeminiConnection(apiKeyDraft, settings.geminiModel);
      if (res.shouldPersistModel && res.resolvedModel && res.resolvedModel !== settings.geminiModel) {
        await updateSettings({ geminiModel: res.resolvedModel });
      }
      Alert.alert(res.ok ? 'Gemini Connected' : 'Connection Failed', res.message);
    } finally {
      setTestingGemini(false);
    }
  };

  const handleSaveSchedule = async () => {
    const valid = /^\d{1,2}:\d{2}$/;
    if (!valid.test(morningDraft.trim()) || !valid.test(eveningDraft.trim())) {
      Alert.alert('Invalid Time Format', 'Use 24-hour HH:MM format (for example, 09:00 and 21:00).');
      return;
    }
    await updateSettings({
      morningInsightTime: morningDraft.trim(),
      eveningInsightTime: eveningDraft.trim(),
    });
    Alert.alert(
      'Schedule Updated',
      `Daily insights will be prepared at ${formatTime12h(morningDraft)} and ${formatTime12h(eveningDraft)}.`
    );
  };

  const handleExportJson = async () => {
    const json = await exportAllDataAsJson();
    try {
      await Share.share({
        title: 'FlareLens Eczema Logs Export',
        message: json,
      });
    } catch {
      Alert.alert('Export Ready', `Prepared ${json.length} bytes of JSON health data.`);
    }
  };

  const handleClearPersonal = () => {
    Alert.alert(
      'Clear Personal Data',
      'Delete all locally saved personal check-ins, food logs, and custom variables? (Demo dataset toggle is unaffected.)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => clearPersonalData(),
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Gemini Vision API Settings */}
      <SectionCard
        title="Gemini Vision API (Food Lens)"
        subtitle="Stored privately on your device using Keychain / Keystore. Powers food photo ingredient extraction."
      >
        <Text style={styles.label}>Gemini API Key</Text>
        <View style={styles.keyRow}>
          <TextInput
            value={apiKeyDraft}
            onChangeText={setApiKeyDraft}
            placeholder="AIza..."
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.keyInput}
          />
          <Pressable onPress={() => setShowKey((s) => !s)} style={styles.eyeBtn}>
            <Ionicons
              name={showKey ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={COLORS.textSecondary}
            />
          </Pressable>
        </View>

        <Text style={[styles.label, { marginTop: SPACING.md }]}>
          Gemini Model (auto-discovers fallback if unavailable)
        </Text>
        <View style={styles.modelRow}>
          {(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest'] as const).map((model) => {
            const active = settings.geminiModel === model;
            return (
              <Pressable
                key={model}
                onPress={() => updateSettings({ geminiModel: model })}
                style={[styles.modelPill, active && styles.modelPillActive]}
              >
                <Text
                  style={[styles.modelPillText, active && styles.modelPillTextActive]}
                >
                  {model}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.btnRow}>
          <Pressable onPress={handleSaveApiKey} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Save Key</Text>
          </Pressable>
          <Pressable
            onPress={handleTestGemini}
            disabled={testingGemini}
            style={styles.secondaryBtn}
          >
            {testingGemini ? (
              <ActivityIndicator size="small" color={COLORS.primaryDark} />
            ) : (
              <Text style={styles.secondaryBtnText}>Test Connection</Text>
            )}
          </Pressable>
        </View>
      </SectionCard>

      {/* Twice-Daily Scheduled Insights */}
      <SectionCard
        title="Twice-Daily Insights Schedule"
        subtitle="Correlation analysis runs automatically for the beginning and end of your day (default 9:00 AM & 9:00 PM)."
      >
        <View style={styles.timeGrid}>
          <View style={styles.timeCol}>
            <Text style={styles.label}>Morning Brief (24h)</Text>
            <TextInput
              value={morningDraft}
              onChangeText={setMorningDraft}
              placeholder="09:00"
              style={styles.timeInput}
            />
            <Text style={styles.timeHint}>{formatTime12h(morningDraft)}</Text>
          </View>
          <View style={styles.timeCol}>
            <Text style={styles.label}>Evening Digest (24h)</Text>
            <TextInput
              value={eveningDraft}
              onChangeText={setEveningDraft}
              placeholder="21:00"
              style={styles.timeInput}
            />
            <Text style={styles.timeHint}>{formatTime12h(eveningDraft)}</Text>
          </View>
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Daily Ready Notifications</Text>
            <Text style={styles.switchSub}>
              Notify me when Morning & Evening insights are ready.
            </Text>
          </View>
          <Switch
            value={settings.notificationsEnabled}
            onValueChange={(v) => updateSettings({ notificationsEnabled: v })}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
          />
        </View>

        <Pressable onPress={handleSaveSchedule} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save 9 AM / 9 PM Schedule</Text>
        </Pressable>
      </SectionCard>

      {/* Automatic Device Metadata Collectors */}
      <SectionCard
        title="Automatic Device Data Collection"
        subtitle="Collect environmental & activity variables automatically whenever permitted by your device."
      >
        <ToggleRow
          title="GPS Location & Season"
          sub="Detects city/climate shifts and hemisphere season."
          value={settings.autoLocationEnabled}
          onChange={(v) => updateSettings({ autoLocationEnabled: v })}
        />
        <ToggleRow
          title="Weather, Humidity & Local Allergens"
          sub="Auto-fetches temperature, humidity, UV, pollen & PM2.5 via Open-Meteo (free)."
          value={settings.autoWeatherEnabled}
          onChange={(v) => updateSettings({ autoWeatherEnabled: v })}
        />
        <ToggleRow
          title="Pedometer Exercise Tracking"
          sub="Reads daily device step counts to estimate active exercise minutes."
          value={settings.autoPedometerEnabled}
          onChange={(v) => updateSettings({ autoPedometerEnabled: v })}
        />
        <ToggleRow
          title="Apple Health / Health Connect Bridge"
          sub="Reads sleep duration & workout metadata in native dev builds."
          value={settings.healthSyncEnabled}
          onChange={(v) => updateSettings({ healthSyncEnabled: v })}
        />

        <View style={styles.unitRow}>
          <Text style={styles.switchTitle}>Temperature Unit</Text>
          <View style={styles.unitPills}>
            {(['C', 'F'] as const).map((unit) => (
              <Pressable
                key={unit}
                onPress={() => updateSettings({ temperatureUnit: unit })}
                style={[
                  styles.unitPill,
                  settings.temperatureUnit === unit && styles.unitPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.unitPillText,
                    settings.temperatureUnit === unit && styles.unitPillTextActive,
                  ]}
                >
                  °{unit}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </SectionCard>

      {/* Demo Dataset & Privacy */}
      <SectionCard
        title="Sample Data & Privacy"
        subtitle="All health logs stay locally on your device."
      >
        <ToggleRow
          title="Include 21-Day Demo Dataset"
          sub="Pre-loads realistic multi-lag triggers (Dairy ~28h, Pollen immediate, Stress 3d build-up, Low Humidity) so you can explore charts right away."
          value={settings.useDemoData}
          onChange={(v) => updateSettings({ useDemoData: v })}
        />

        <View style={styles.btnRow}>
          <Pressable onPress={handleExportJson} style={styles.secondaryBtn}>
            <Ionicons name="download-outline" size={16} color={COLORS.primaryDark} />
            <Text style={styles.secondaryBtnText}>Export JSON</Text>
          </Pressable>
          <Pressable onPress={handleClearPersonal} style={styles.dangerBtn}>
            <Ionicons name="trash-outline" size={16} color={COLORS.trigger} />
            <Text style={styles.dangerBtnText}>Clear Personal Logs</Text>
          </Pressable>
        </View>
      </SectionCard>
    </ScrollView>
  );
}

const ToggleRow: React.FC<{
  title: string;
  sub: string;
  value: boolean;
  onChange: (val: boolean) => void;
}> = ({ title, sub, value, onChange }) => (
  <View style={styles.switchRow}>
    <View style={{ flex: 1 }}>
      <Text style={styles.switchTitle}>{title}</Text>
      <Text style={styles.switchSub}>{sub}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: COLORS.border, true: COLORS.primary }}
    />
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: 44 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 5,
  },
  keyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  keyInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    color: COLORS.text,
  },
  eyeBtn: {
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  modelRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.md,
  },
  modelPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
  },
  modelPillActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  modelPillText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  modelPillTextActive: {
    color: COLORS.primaryDark,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: SPACING.sm,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: COLORS.primaryDark,
    fontSize: 13.5,
    fontWeight: '700',
  },
  dangerBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: COLORS.triggerLight,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerBtnText: {
    color: COLORS.trigger,
    fontSize: 13.5,
    fontWeight: '700',
  },
  timeGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: SPACING.sm,
  },
  timeCol: { flex: 1 },
  timeInput: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  timeHint: {
    fontSize: 11.5,
    color: COLORS.primaryMuted,
    marginTop: 4,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  switchSub: {
    fontSize: 11.5,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  unitPills: {
    flexDirection: 'row',
    gap: 6,
  },
  unitPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  unitPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  unitPillText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  unitPillTextActive: {
    color: '#FFFFFF',
  },
});
