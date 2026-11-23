import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  AppSettings,
  AutoMetadataSnapshot,
  BodyArea,
  DetectedIngredient,
  EczemaLogEntry,
  FoodLogEntry,
  InsightSlot,
  InsightsReport,
  VariableCategory,
  VariableCorrelationResult,
  VariableDefinition,
  VariableMeasurement,
  VariableValueType,
} from '../types';
import { DEFAULT_SETTINGS, STARTER_VARIABLES } from '../constants/starterVariables';
import { buildDemoDataset } from '../data/demoDataset';
import {
  analyzeCorrelations,
  generateInsightsReport,
  toDateKey,
} from '../engine/correlationEngine';
import {
  loadAllUserData,
  saveCustomVariables,
  saveEczemaLogs,
  saveFoodEntries,
  saveInsightsReports,
  saveLastMetadata,
  saveMeasurements,
  saveSettings,
} from '../services/storage';
import {
  collectAutoDeviceMetadata,
  getSeasonForLocation,
  getTimeOfDayBucket,
  snapshotToMeasurements,
} from '../services/deviceCollectors';
import {
  getMostRecentScheduledSlot,
  hasReportForSlot,
  registerBackgroundInsightsTask,
  syncScheduledInsightNotifications,
} from '../services/insightsScheduler';

interface AppContextValue {
  isLoading: boolean;
  isSyncingSensors: boolean;
  settings: AppSettings;
  allVariables: VariableDefinition[];
  customVariables: VariableDefinition[];
  eczemaLogs: EczemaLogEntry[];
  measurements: VariableMeasurement[];
  foodEntries: FoodLogEntry[];
  correlationResults: VariableCorrelationResult[];
  latestReport: InsightsReport | null;
  reportHistory: InsightsReport[];
  lastMetadata: AutoMetadataSnapshot | null;

  logEczemaCheckIn: (input: {
    severity: number;
    itchLevel: number;
    rednessLevel: number;
    drynessLevel: number;
    affectedAreas: BodyArea[];
    notes?: string;
    timestamp?: Date;
  }) => Promise<void>;

  logDailyVariables: (
    entries: {
      variableId: string;
      variableName: string;
      category: VariableCategory;
      numericValue: number;
      unit?: string;
      textValue?: string;
    }[],
    timestamp?: Date
  ) => Promise<void>;

  logFoodEntry: (input: {
    dishName: string;
    mealType: FoodLogEntry['mealType'];
    photoUri?: string;
    summary?: string;
    confidence?: number;
    analyzedByGemini: boolean;
    ingredients: DetectedIngredient[];
    timestamp?: Date;
  }) => Promise<void>;

  addCustomVariable: (input: {
    name: string;
    valueType: VariableValueType;
    unit?: string;
    min?: number;
    max?: number;
    description: string;
  }) => Promise<VariableDefinition>;

  deleteCustomVariable: (variableId: string) => Promise<void>;

  refreshAutoMetadata: () => Promise<AutoMetadataSnapshot>;

  runInsightsAnalysisNow: (slotOverride?: InsightSlot) => Promise<InsightsReport>;

  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;

  clearPersonalData: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingSensors, setIsSyncingSensors] = useState(false);

  const [userEczemaLogs, setUserEczemaLogs] = useState<EczemaLogEntry[]>([]);
  const [userMeasurements, setUserMeasurements] = useState<VariableMeasurement[]>([]);
  const [userFoodEntries, setUserFoodEntries] = useState<FoodLogEntry[]>([]);
  const [userCustomVariables, setUserCustomVariables] = useState<VariableDefinition[]>([]);
  const [reportHistory, setReportHistory] = useState<InsightsReport[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [lastMetadata, setLastMetadata] = useState<AutoMetadataSnapshot | null>(null);

  const demoData = useMemo(() => buildDemoDataset(new Date()), []);

  // Merge demo data seamlessly when useDemoData is enabled so users can test live additions too
  const eczemaLogs = useMemo(() => {
    const merged = settings.useDemoData
      ? [...userEczemaLogs, ...demoData.eczemaLogs]
      : userEczemaLogs;
    return merged.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [settings.useDemoData, userEczemaLogs, demoData.eczemaLogs]);

  const measurements = useMemo(() => {
    const merged = settings.useDemoData
      ? [...userMeasurements, ...demoData.measurements]
      : userMeasurements;
    return merged.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [settings.useDemoData, userMeasurements, demoData.measurements]);

  const foodEntries = useMemo(() => {
    const merged = settings.useDemoData
      ? [...userFoodEntries, ...demoData.foodEntries]
      : userFoodEntries;
    return merged.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [settings.useDemoData, userFoodEntries, demoData.foodEntries]);

  const customVariables = useMemo(() => {
    if (!settings.useDemoData) return userCustomVariables;
    const ids = new Set(userCustomVariables.map((v) => v.id));
    return [
      ...userCustomVariables,
      ...demoData.customVariables.filter((v) => !ids.has(v.id)),
    ];
  }, [settings.useDemoData, userCustomVariables, demoData.customVariables]);

  const allVariables = useMemo(
    () => [...STARTER_VARIABLES, ...customVariables],
    [customVariables]
  );

  // Live correlation metrics for Metrics tab & variable detail charts
  const correlationResults = useMemo(
    () => analyzeCorrelations(eczemaLogs, measurements, allVariables),
    [eczemaLogs, measurements, allVariables]
  );

  // Refs to allow AppState listener to read latest data cleanly
  const latestStateRef = useRef({
    eczemaLogs,
    measurements,
    allVariables,
    settings,
    reportHistory,
  });
  latestStateRef.current = {
    eczemaLogs,
    measurements,
    allVariables,
    settings,
    reportHistory,
  };

  const ensureScheduledInsightsReady = useCallback(async () => {
    const {
      eczemaLogs: curLogs,
      measurements: curMeas,
      allVariables: curVars,
      settings: curSettings,
      reportHistory: curReports,
    } = latestStateRef.current;

    const now = new Date();
    const slotDesc = getMostRecentScheduledSlot(curSettings, now);

    // If we don't yet have a report for today's 9:00 AM or 9:00 PM boundary, generate it immediately!
    if (!hasReportForSlot(curReports, slotDesc)) {
      const report = generateInsightsReport({
        eczemaLogs: curLogs,
        measurements: curMeas,
        variableDefinitions: curVars,
        slot: slotDesc.slot,
        scheduledForLabel: slotDesc.label,
        now,
      });
      const updated = [report, ...curReports].slice(0, 30);
      setReportHistory(updated);
      await saveInsightsReports(updated);
    }
  }, []);

  // Hydrate persisted state on launch
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const persisted = await loadAllUserData();
        if (!mounted) return;
        setUserEczemaLogs(persisted.eczemaLogs);
        setUserMeasurements(persisted.measurements);
        setUserFoodEntries(persisted.foodEntries);
        setUserCustomVariables(persisted.customVariables);
        setReportHistory(persisted.insightsReports);
        setSettings(persisted.settings);
        setLastMetadata(persisted.lastMetadata);

        await registerBackgroundInsightsTask();
        await syncScheduledInsightNotifications(persisted.settings);
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Once loaded, make sure the latest 9am/9pm scheduled report is generated and ready
  useEffect(() => {
    if (!isLoading) {
      ensureScheduledInsightsReady();
    }
  }, [isLoading, ensureScheduledInsightsReady]);

  // Re-check 9am/9pm schedule whenever app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && !isLoading) {
        ensureScheduledInsightsReady();
      }
    });
    return () => sub.remove();
  }, [isLoading, ensureScheduledInsightsReady]);

  const latestReport = useMemo<InsightsReport | null>(() => {
    if (reportHistory.length > 0) return reportHistory[0];
    if (eczemaLogs.length === 0) return null;
    const slotDesc = getMostRecentScheduledSlot(settings, new Date());
    return generateInsightsReport({
      eczemaLogs,
      measurements,
      variableDefinitions: allVariables,
      slot: slotDesc.slot,
      scheduledForLabel: slotDesc.label,
    });
  }, [reportHistory, eczemaLogs, measurements, allVariables, settings]);

  const logEczemaCheckIn = useCallback(
    async (input: {
      severity: number;
      itchLevel: number;
      rednessLevel: number;
      drynessLevel: number;
      affectedAreas: BodyArea[];
      notes?: string;
      timestamp?: Date;
    }) => {
      const ts = input.timestamp ?? new Date();
      const entry: EczemaLogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: ts.toISOString(),
        dateKey: toDateKey(ts),
        severity: input.severity,
        itchLevel: input.itchLevel,
        rednessLevel: input.rednessLevel,
        drynessLevel: input.drynessLevel,
        affectedAreas: input.affectedAreas,
        timeOfDay: getTimeOfDayBucket(ts),
        season: getSeasonForLocation(ts, lastMetadata?.latitude),
        notes: input.notes?.trim() || undefined,
      };
      const next = [entry, ...userEczemaLogs];
      setUserEczemaLogs(next);
      await saveEczemaLogs(next);
    },
    [userEczemaLogs, lastMetadata?.latitude]
  );

  const logDailyVariables = useCallback(
    async (
      entries: {
        variableId: string;
        variableName: string;
        category: VariableCategory;
        numericValue: number;
        unit?: string;
        textValue?: string;
      }[],
      timestamp?: Date
    ) => {
      const ts = timestamp ?? new Date();
      const dateKey = toDateKey(ts);
      const newItems: VariableMeasurement[] = entries.map((e, idx) => ({
        id: `meas_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
        variableId: e.variableId,
        variableName: e.variableName,
        category: e.category,
        timestamp: ts.toISOString(),
        dateKey,
        numericValue: e.numericValue,
        unit: e.unit,
        textValue: e.textValue,
        source: 'manual',
      }));

      // Replace same-day manual measurements for these exact variableIds so updates stay clean
      const replacingIds = new Set(entries.map((e) => e.variableId));
      const filtered = userMeasurements.filter(
        (m) => !(m.dateKey === dateKey && m.source === 'manual' && replacingIds.has(m.variableId))
      );
      const next = [...newItems, ...filtered];
      setUserMeasurements(next);
      await saveMeasurements(next);
    },
    [userMeasurements]
  );

  const logFoodEntry = useCallback(
    async (input: {
      dishName: string;
      mealType: FoodLogEntry['mealType'];
      photoUri?: string;
      summary?: string;
      confidence?: number;
      analyzedByGemini: boolean;
      ingredients: DetectedIngredient[];
      timestamp?: Date;
    }) => {
      const ts = input.timestamp ?? new Date();
      const dateKey = toDateKey(ts);
      const foodId = `food_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const activeIngredients = input.ingredients.filter((i) => i.included);

      const foodEntry: FoodLogEntry = {
        id: foodId,
        timestamp: ts.toISOString(),
        dateKey,
        dishName: input.dishName.trim() || 'Logged Meal',
        mealType: input.mealType,
        photoUri: input.photoUri,
        summary: input.summary,
        confidence: input.confidence,
        analyzedByGemini: input.analyzedByGemini,
        ingredients: activeIngredients,
      };

      const ingredientMeasurements: VariableMeasurement[] = activeIngredients.map((ing, idx) => ({
        id: `ing_${foodId}_${idx}`,
        variableId: `ingredient:${ing.normalizedKey}`,
        variableName: ing.name,
        category: 'food_ingredient',
        timestamp: ts.toISOString(),
        dateKey,
        numericValue: 1,
        source: input.analyzedByGemini ? 'gemini_vision' : 'manual',
        foodEntryId: foodId,
      }));

      const nextFoods = [foodEntry, ...userFoodEntries];
      const nextMeas = [...ingredientMeasurements, ...userMeasurements];
      setUserFoodEntries(nextFoods);
      setUserMeasurements(nextMeas);
      await Promise.all([saveFoodEntries(nextFoods), saveMeasurements(nextMeas)]);
    },
    [userFoodEntries, userMeasurements]
  );

  const addCustomVariable = useCallback(
    async (input: {
      name: string;
      valueType: VariableValueType;
      unit?: string;
      min?: number;
      max?: number;
      description: string;
    }): Promise<VariableDefinition> => {
      const slug = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const newVar: VariableDefinition = {
        id: `custom_${slug}_${Date.now().toString(36)}`,
        name: input.name.trim(),
        category: 'custom',
        valueType: input.valueType,
        unit: input.unit?.trim() || (input.valueType === 'scale' ? '/10' : undefined),
        min: input.min ?? (input.valueType === 'scale' ? 1 : 0),
        max: input.max ?? (input.valueType === 'scale' ? 10 : 100),
        step: input.valueType === 'scale' ? 1 : 1,
        description: input.description.trim() || 'Custom user-defined tracking variable.',
        autoCollected: false,
        defaultSource: 'manual',
        isCustom: true,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      const next = [...userCustomVariables, newVar];
      setUserCustomVariables(next);
      await saveCustomVariables(next);
      return newVar;
    },
    [userCustomVariables]
  );

  const deleteCustomVariable = useCallback(
    async (variableId: string) => {
      const next = userCustomVariables.filter((v) => v.id !== variableId);
      setUserCustomVariables(next);
      await saveCustomVariables(next);
    },
    [userCustomVariables]
  );

  const refreshAutoMetadata = useCallback(async (): Promise<AutoMetadataSnapshot> => {
    setIsSyncingSensors(true);
    try {
      const snapshot = await collectAutoDeviceMetadata(settings);
      const autoMeasurements = snapshotToMeasurements(snapshot, lastMetadata?.locationName);
      setLastMetadata(snapshot);
      await saveLastMetadata(snapshot);

      if (autoMeasurements.length > 0) {
        const newIds = new Set(autoMeasurements.map((m) => m.id));
        const filtered = userMeasurements.filter((m) => !newIds.has(m.id));
        const next = [...autoMeasurements, ...filtered];
        setUserMeasurements(next);
        await saveMeasurements(next);
      }
      return snapshot;
    } finally {
      setIsSyncingSensors(false);
    }
  }, [settings, lastMetadata?.locationName, userMeasurements]);

  const runInsightsAnalysisNow = useCallback(
    async (slotOverride?: InsightSlot): Promise<InsightsReport> => {
      const now = new Date();
      const slotDesc = getMostRecentScheduledSlot(settings, now);
      const slot = slotOverride ?? slotDesc.slot;
      const label =
        slot === 'manual'
          ? 'Manual Refresh'
          : slot === 'morning'
          ? `${settings.morningInsightTime} Morning Brief`
          : `${settings.eveningInsightTime} Evening Digest`;

      const report = generateInsightsReport({
        eczemaLogs,
        measurements,
        variableDefinitions: allVariables,
        slot,
        scheduledForLabel: label,
        now,
      });

      const updated = [report, ...reportHistory].slice(0, 30);
      setReportHistory(updated);
      await saveInsightsReports(updated);
      return report;
    },
    [settings, eczemaLogs, measurements, allVariables, reportHistory]
  );

  const updateSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      const next: AppSettings = { ...settings, ...partial };
      setSettings(next);
      await saveSettings(next);

      if (
        partial.morningInsightTime !== undefined ||
        partial.eveningInsightTime !== undefined ||
        partial.notificationsEnabled !== undefined
      ) {
        await syncScheduledInsightNotifications(next);
      }

      // When toggling demo data mode, regenerate the latest report so Insights reflects the active dataset immediately
      if (partial.useDemoData !== undefined) {
        const now = new Date();
        const slotDesc = getMostRecentScheduledSlot(next, now);
        const targetLogs = partial.useDemoData
          ? [...userEczemaLogs, ...demoData.eczemaLogs]
          : userEczemaLogs;
        const targetMeas = partial.useDemoData
          ? [...userMeasurements, ...demoData.measurements]
          : userMeasurements;
        const targetVars = [
          ...STARTER_VARIABLES,
          ...(partial.useDemoData
            ? [...userCustomVariables, ...demoData.customVariables]
            : userCustomVariables),
        ];

        const refreshed = generateInsightsReport({
          eczemaLogs: targetLogs,
          measurements: targetMeas,
          variableDefinitions: targetVars,
          slot: slotDesc.slot,
          scheduledForLabel: slotDesc.label,
          now,
        });
        const updatedReports = [refreshed, ...reportHistory].slice(0, 30);
        setReportHistory(updatedReports);
        await saveInsightsReports(updatedReports);
      }
    },
    [
      settings,
      userEczemaLogs,
      userMeasurements,
      userCustomVariables,
      demoData,
      reportHistory,
    ]
  );

  const clearPersonalData = useCallback(async () => {
    setUserEczemaLogs([]);
    setUserMeasurements([]);
    setUserFoodEntries([]);
    setUserCustomVariables([]);
    setReportHistory([]);
    await Promise.all([
      saveEczemaLogs([]),
      saveMeasurements([]),
      saveFoodEntries([]),
      saveCustomVariables([]),
      saveInsightsReports([]),
    ]);
  }, []);

  const value: AppContextValue = {
    isLoading,
    isSyncingSensors,
    settings,
    allVariables,
    customVariables,
    eczemaLogs,
    measurements,
    foodEntries,
    correlationResults,
    latestReport,
    reportHistory,
    lastMetadata,
    logEczemaCheckIn,
    logDailyVariables,
    logFoodEntry,
    addCustomVariable,
    deleteCustomVariable,
    refreshAutoMetadata,
    runInsightsAnalysisNow,
    updateSettings,
    clearPersonalData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
