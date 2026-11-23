import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  AppSettings,
  AutoMetadataSnapshot,
  EczemaLogEntry,
  FoodLogEntry,
  InsightsReport,
  VariableDefinition,
  VariableMeasurement,
} from '../types';
import { DEFAULT_SETTINGS } from '../constants/starterVariables';
import { sanitizeGeminiModel } from './geminiFoodService';

const KEYS = {
  ECZEMA_LOGS: 'flarelens_eczema_logs_v1',
  MEASUREMENTS: 'flarelens_measurements_v1',
  FOOD_ENTRIES: 'flarelens_food_entries_v1',
  CUSTOM_VARIABLES: 'flarelens_custom_variables_v1',
  INSIGHTS_REPORTS: 'flarelens_insights_reports_v1',
  SETTINGS: 'flarelens_settings_v1',
  LAST_METADATA: 'flarelens_last_metadata_v1',
  SECURE_GEMINI_KEY: 'flarelens_gemini_api_key',
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadGeminiApiKey(): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      return (await AsyncStorage.getItem(KEYS.SECURE_GEMINI_KEY)) ?? '';
    }
    return (await SecureStore.getItemAsync(KEYS.SECURE_GEMINI_KEY)) ?? '';
  } catch {
    return (await AsyncStorage.getItem(KEYS.SECURE_GEMINI_KEY)) ?? '';
  }
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  try {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(KEYS.SECURE_GEMINI_KEY, trimmed);
      return;
    }
    if (trimmed) {
      await SecureStore.setItemAsync(KEYS.SECURE_GEMINI_KEY, trimmed);
    } else {
      await SecureStore.deleteItemAsync(KEYS.SECURE_GEMINI_KEY);
    }
  } catch {
    await AsyncStorage.setItem(KEYS.SECURE_GEMINI_KEY, trimmed);
  }
}

export interface PersistedUserData {
  eczemaLogs: EczemaLogEntry[];
  measurements: VariableMeasurement[];
  foodEntries: FoodLogEntry[];
  customVariables: VariableDefinition[];
  insightsReports: InsightsReport[];
  settings: AppSettings;
  lastMetadata: AutoMetadataSnapshot | null;
}

export async function loadAllUserData(): Promise<PersistedUserData> {
  const [
    eczemaLogs,
    measurements,
    foodEntries,
    customVariables,
    insightsReports,
    savedSettings,
    geminiApiKey,
    lastMetadata,
  ] = await Promise.all([
    readJson<EczemaLogEntry[]>(KEYS.ECZEMA_LOGS, []),
    readJson<VariableMeasurement[]>(KEYS.MEASUREMENTS, []),
    readJson<FoodLogEntry[]>(KEYS.FOOD_ENTRIES, []),
    readJson<VariableDefinition[]>(KEYS.CUSTOM_VARIABLES, []),
    readJson<InsightsReport[]>(KEYS.INSIGHTS_REPORTS, []),
    readJson<Partial<AppSettings>>(KEYS.SETTINGS, {}),
    loadGeminiApiKey(),
    readJson<AutoMetadataSnapshot | null>(KEYS.LAST_METADATA, null),
  ]);

  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    geminiModel: sanitizeGeminiModel(savedSettings.geminiModel),
    geminiApiKey,
  };

  return {
    eczemaLogs,
    measurements,
    foodEntries,
    customVariables,
    insightsReports,
    settings,
    lastMetadata,
  };
}

export async function saveEczemaLogs(logs: EczemaLogEntry[]): Promise<void> {
  await writeJson(KEYS.ECZEMA_LOGS, logs);
}

export async function saveMeasurements(measurements: VariableMeasurement[]): Promise<void> {
  await writeJson(KEYS.MEASUREMENTS, measurements);
}

export async function saveFoodEntries(entries: FoodLogEntry[]): Promise<void> {
  await writeJson(KEYS.FOOD_ENTRIES, entries);
}

export async function saveCustomVariables(vars: VariableDefinition[]): Promise<void> {
  await writeJson(KEYS.CUSTOM_VARIABLES, vars);
}

export async function saveInsightsReports(reports: InsightsReport[]): Promise<void> {
  // Keep latest 30 reports (15 days of 9am/9pm digests)
  await writeJson(KEYS.INSIGHTS_REPORTS, reports.slice(0, 30));
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const { geminiApiKey, ...nonSensitive } = settings;
  await Promise.all([
    writeJson(KEYS.SETTINGS, nonSensitive),
    saveGeminiApiKey(geminiApiKey),
  ]);
}

export async function saveLastMetadata(snapshot: AutoMetadataSnapshot): Promise<void> {
  await writeJson(KEYS.LAST_METADATA, snapshot);
}

export async function exportAllDataAsJson(): Promise<string> {
  const data = await loadAllUserData();
  const { geminiApiKey: _redacted, ...safeSettings } = data.settings;
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'FlareLens',
      schemaVersion: 1,
      ...data,
      settings: safeSettings,
    },
    null,
    2
  );
}
