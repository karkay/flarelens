export type TimeOfDayBucket = 'morning' | 'afternoon' | 'evening' | 'night';

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export type VariableCategory =
  | 'environment'
  | 'lifestyle'
  | 'food_ingredient'
  | 'custom';

export type VariableValueType = 'numeric' | 'scale' | 'boolean' | 'categorical';

export type DataSource =
  | 'auto_gps'
  | 'auto_weather_api'
  | 'auto_pollen_api'
  | 'auto_clock'
  | 'auto_pedometer'
  | 'auto_health'
  | 'auto_screentime'
  | 'gemini_vision'
  | 'manual';

export interface VariableDefinition {
  id: string;
  name: string;
  category: VariableCategory;
  valueType: VariableValueType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  description: string;
  autoCollected: boolean;
  defaultSource: DataSource;
  isCustom: boolean;
  isActive: boolean;
  /** Optional hint on whether lower values can be triggers (e.g., low humidity, short sleep) */
  higherIsProtectiveHint?: boolean;
  createdAt: string;
}

export type BodyArea =
  | 'hands'
  | 'wrists'
  | 'inner_elbows'
  | 'neck'
  | 'face'
  | 'behind_knees'
  | 'ankles'
  | 'torso'
  | 'scalp';

export interface EczemaLogEntry {
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** YYYY-MM-DD local date key */
  dateKey: string;
  /** Overall eczema severity 0 (clear) to 10 (severe flare) */
  severity: number;
  /** Itch intensity 0 to 10 */
  itchLevel: number;
  /** Redness/inflammation 0 to 10 */
  rednessLevel: number;
  /** Dryness/cracking 0 to 10 */
  drynessLevel: number;
  affectedAreas: BodyArea[];
  timeOfDay: TimeOfDayBucket;
  season: Season;
  notes?: string;
}

export interface VariableMeasurement {
  id: string;
  variableId: string;
  /** Display name snapshot (useful for dynamic Gemini food ingredients) */
  variableName: string;
  category: VariableCategory;
  timestamp: string;
  dateKey: string;
  /** Numeric value (for boolean: 1 = exposed/yes, 0 = no) */
  numericValue: number;
  /** Optional text label (e.g., "Rainy", "San Francisco, CA", "Spring") */
  textValue?: string;
  unit?: string;
  source: DataSource;
  /** Optional reference to a FoodLogEntry ID if derived from a meal */
  foodEntryId?: string;
}

export interface DetectedIngredient {
  id: string;
  name: string;
  normalizedKey: string;
  category: string;
  commonEczemaTrigger: boolean;
  triggerGroup?: string;
  notes?: string;
  included: boolean;
}

export interface FoodLogEntry {
  id: string;
  timestamp: string;
  dateKey: string;
  dishName: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'beverage';
  photoUri?: string;
  summary?: string;
  confidence?: number;
  analyzedByGemini: boolean;
  ingredients: DetectedIngredient[];
}

export interface AutoMetadataSnapshot {
  capturedAt: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  temperatureC?: number;
  humidityPct?: number;
  uvIndex?: number;
  barometricPressureHpa?: number;
  weatherCondition?: string;
  pollenIndex?: number; // 0-100 composite local allergen score
  birchPollen?: number;
  grassPollen?: number;
  ragweedPollen?: number;
  pm25?: number;
  usAqi?: number;
  season: Season;
  timeOfDay: TimeOfDayBucket;
  stepsToday?: number;
  estimatedExerciseMinutes?: number;
  sleepHours?: number;
  sleepQuality?: number;
  screenTimeHours?: number;
  sources: Record<string, DataSource>;
  warnings: string[];
}

export type LagWindowKey =
  | 'immediate_0d'
  | 'delayed_1d'
  | 'delayed_2d'
  | 'delayed_3d'
  | 'cumulative_3d'
  | 'cumulative_5d';

export interface LagCorrelationStat {
  lagKey: LagWindowKey;
  label: string;
  shortLabel: string;
  lagHoursApprox: number;
  pearsonR: number;
  spearmanRho: number;
  /** Combined primary score used for ranking */
  score: number;
  pValue: number;
  sampleSize: number;
  /** For binary/exposure variables: average severity after exposure minus baseline */
  severityLift?: number;
  /** Relative risk of flare (>=5) after exposure vs non-exposure */
  flareRiskRatio?: number;
}

export interface ExposureFlarePair {
  exposureTimestamp: string;
  exposureDateKey: string;
  exposureValue: number;
  flareTimestamp: string;
  flareDateKey: string;
  flareSeverity: number;
  lagHours: number;
  lagLabel: string;
}

export interface TimelinePoint {
  dateKey: string;
  label: string;
  timestamp: string;
  severity: number | null;
  exposureValue: number | null;
  cumulativeExposure: number | null;
  isFlarePeak: boolean;
  hasExposureEvent: boolean;
}

export type ReactionPattern =
  | 'immediate'
  | 'delayed_24h'
  | 'delayed_48h'
  | 'delayed_72h'
  | 'cumulative_buildup';

export type ConfidenceLevel = 'high' | 'moderate' | 'early_signal' | 'insufficient';

export interface VariableCorrelationResult {
  variableId: string;
  variableName: string;
  category: VariableCategory;
  valueType: VariableValueType;
  unit?: string;
  /** Strongest correlation window across immediate, delayed, and cumulative */
  bestLag: LagCorrelationStat;
  allLags: LagCorrelationStat[];
  direction: 'trigger' | 'protective' | 'neutral';
  pattern: ReactionPattern;
  confidence: ConfidenceLevel;
  exposureCount: number;
  totalDaysAnalyzed: number;
  avgSeverityWhenHigh: number;
  avgSeverityWhenLow: number;
  typicalLagHours: number;
  typicalLagDescription: string;
  summary: string;
  timeline: TimelinePoint[];
  exposureFlarePairs: ExposureFlarePair[];
}

export interface ActiveRiskAlert {
  variableId: string;
  variableName: string;
  category: VariableCategory;
  exposureTimestamp: string;
  expectedPeakWindowLabel: string;
  hoursUntilPeak: number;
  riskLevel: 'high' | 'moderate' | 'watch';
  reason: string;
}

export type InsightSlot = 'morning' | 'evening' | 'manual';

export interface InsightsReport {
  id: string;
  generatedAt: string;
  dateKey: string;
  slot: InsightSlot;
  scheduledForLabel: string; // e.g., "9:00 AM Morning Brief" or "9:00 PM Evening Digest"
  headline: string;
  narrativeSummary: string;
  topTriggers: VariableCorrelationResult[];
  topProtective: VariableCorrelationResult[];
  allResults: VariableCorrelationResult[];
  activeAlerts: ActiveRiskAlert[];
  daysAnalyzed: number;
  totalLogsAnalyzed: number;
  baselineSeverity: number;
  recent7DayAvgSeverity: number;
}

export interface AppSettings {
  geminiApiKey: string;
  geminiModel: string;
  morningInsightTime: string; // "09:00"
  eveningInsightTime: string; // "21:00"
  notificationsEnabled: boolean;
  autoLocationEnabled: boolean;
  autoWeatherEnabled: boolean;
  autoPedometerEnabled: boolean;
  healthSyncEnabled: boolean;
  useDemoData: boolean;
  temperatureUnit: 'C' | 'F';
}
