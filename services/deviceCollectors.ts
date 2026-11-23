import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';
import {
  AppSettings,
  AutoMetadataSnapshot,
  DataSource,
  Season,
  TimeOfDayBucket,
  VariableMeasurement,
} from '../types';
import { fetchWeatherAndPollen } from './weatherPollenService';
import { toDateKey } from '../engine/correlationEngine';

export function getTimeOfDayBucket(date: Date = new Date()): TimeOfDayBucket {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function getSeasonForLocation(date: Date = new Date(), latitude?: number): Season {
  const month = date.getMonth(); // 0-11
  const isSouthernHemisphere = latitude !== undefined && latitude < 0;

  let northernSeason: Season;
  if (month === 11 || month <= 1) northernSeason = 'winter';
  else if (month >= 2 && month <= 4) northernSeason = 'spring';
  else if (month >= 5 && month <= 7) northernSeason = 'summer';
  else northernSeason = 'autumn';

  if (!isSouthernHemisphere) return northernSeason;

  const flip: Record<Season, Season> = {
    winter: 'summer',
    spring: 'autumn',
    summer: 'winter',
    autumn: 'spring',
  };
  return flip[northernSeason];
}

/**
 * Optional native HealthKit (iOS) / Health Connect (Android) & Screen Time bridge.
 * In Expo Go or Web, OS health databases are unavailable without a custom dev client;
 * this adapter safely checks availability and returns any synced metrics without throwing.
 */
async function tryReadNativeHealthAndScreenTime(): Promise<{
  sleepHours?: number;
  screenTimeHours?: number;
  note?: string;
}> {
  if (Platform.OS === 'web') {
    return {
      note: 'Sleep & Screen Time auto-sync require an iOS/Android native build; manual quick-sliders remain enabled.',
    };
  }
  // Native dev-client hook point for react-native-health (HealthKit) & react-native-health-connect:
  // When built via `npx expo prebuild` with HealthKit / Health Connect plugins installed,
  // native modules expose sleep samples & Digital Wellbeing usage stats here.
  return {
    note:
      Platform.OS === 'ios'
        ? 'Apple Health sleep sync activates in custom dev builds; iOS restricts third-party Screen Time read access.'
        : 'Android Health Connect & UsageStats sync activate in custom dev builds.',
  };
}

/**
 * Collects as much environmental and device metadata automatically as permitted by the OS:
 * - Time of day & hemisphere-aware Season (100% automatic)
 * - GPS Location & Reverse Geocoded City (`expo-location`)
 * - Weather, Temperature, Humidity, UV & Local Allergens/Pollen (Open-Meteo API)
 * - Step count & estimated active exercise minutes (`expo-sensors` Pedometer)
 * - HealthKit / Health Connect sleep hook
 */
export async function collectAutoDeviceMetadata(
  settings: AppSettings
): Promise<AutoMetadataSnapshot> {
  const now = new Date();
  const sources: Record<string, DataSource> = {
    timeOfDay: 'auto_clock',
    season: 'auto_clock',
  };
  const warnings: string[] = [];

  let latitude: number | undefined;
  let longitude: number | undefined;
  let locationName: string | undefined;

  // 1. GPS Location
  if (settings.autoLocationEnabled) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
        sources.location = 'auto_gps';

        try {
          const places = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (places.length > 0) {
            const p = places[0];
            locationName = [p.city || p.subregion, p.region || p.country]
              .filter(Boolean)
              .join(', ');
          }
        } catch {
          locationName = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
        }
      } else {
        warnings.push('Location permission not granted — unable to auto-fetch local weather & pollen.');
      }
    } catch {
      warnings.push('Could not read GPS location on this device.');
    }
  }

  const season = getSeasonForLocation(now, latitude);
  const timeOfDay = getTimeOfDayBucket(now);

  const snapshot: AutoMetadataSnapshot = {
    capturedAt: now.toISOString(),
    locationName,
    latitude,
    longitude,
    season,
    timeOfDay,
    sources,
    warnings,
  };

  // 2. Weather, Humidity & Local Allergens (Pollen + AQI)
  if (settings.autoWeatherEnabled && latitude !== undefined && longitude !== undefined) {
    try {
      const env = await fetchWeatherAndPollen(latitude, longitude);
      Object.assign(snapshot, env);
      if (env.humidityPct !== undefined) sources.humidity = 'auto_weather_api';
      if (env.temperatureC !== undefined) sources.temperature = 'auto_weather_api';
      if (env.uvIndex !== undefined) sources.uvIndex = 'auto_weather_api';
      if (env.pollenIndex !== undefined) sources.localAllergens = 'auto_pollen_api';
    } catch {
      warnings.push('Unable to reach Open-Meteo weather/pollen API (offline?).');
    }
  }

  // 3. Pedometer Step Count -> Estimated Exercise Minutes (iOS & Android native in Expo!)
  if (settings.autoPedometerEnabled && Platform.OS !== 'web') {
    try {
      const available = await Pedometer.isAvailableAsync();
      if (available) {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const stepResult = await Pedometer.getStepCountAsync(startOfDay, now);
        snapshot.stepsToday = stepResult.steps;
        // ~100 brisk steps ≈ 1 active minute
        snapshot.estimatedExerciseMinutes = Math.round(stepResult.steps / 100);
        sources.exercise = 'auto_pedometer';
      }
    } catch {
      warnings.push('Motion/Pedometer permission unavailable; log exercise manually.');
    }
  }

  // 4. HealthKit / Health Connect & Screen Time bridge
  if (settings.healthSyncEnabled) {
    const nativeHealth = await tryReadNativeHealthAndScreenTime();
    if (nativeHealth.sleepHours !== undefined) {
      snapshot.sleepHours = nativeHealth.sleepHours;
      sources.sleep = 'auto_health';
    }
    if (nativeHealth.screenTimeHours !== undefined) {
      snapshot.screenTimeHours = nativeHealth.screenTimeHours;
      sources.screenTime = 'auto_screentime';
    }
    if (nativeHealth.note) {
      warnings.push(nativeHealth.note);
    }
  }

  return snapshot;
}

/**
 * Converts an AutoMetadataSnapshot into structured VariableMeasurements
 * ready to persist into the correlation database.
 */
export function snapshotToMeasurements(
  snapshot: AutoMetadataSnapshot,
  previousLocationName?: string
): VariableMeasurement[] {
  const ts = snapshot.capturedAt;
  const dateKey = toDateKey(new Date(ts));
  const idPrefix = `auto_${dateKey}_${new Date(ts).getHours()}`;
  const list: VariableMeasurement[] = [];

  if (snapshot.humidityPct !== undefined) {
    list.push({
      id: `${idPrefix}_humidity`,
      variableId: 'var_humidity',
      variableName: 'Humidity',
      category: 'environment',
      timestamp: ts,
      dateKey,
      numericValue: snapshot.humidityPct,
      unit: '%',
      source: 'auto_weather_api',
    });
  }

  if (snapshot.temperatureC !== undefined) {
    list.push({
      id: `${idPrefix}_temperature`,
      variableId: 'var_temperature',
      variableName: 'Temperature',
      category: 'environment',
      timestamp: ts,
      dateKey,
      numericValue: snapshot.temperatureC,
      textValue: snapshot.weatherCondition,
      unit: '°C',
      source: 'auto_weather_api',
    });
  }

  if (snapshot.pollenIndex !== undefined) {
    list.push({
      id: `${idPrefix}_pollen`,
      variableId: 'var_local_allergens',
      variableName: 'Local Allergens (Pollen & AQI)',
      category: 'environment',
      timestamp: ts,
      dateKey,
      numericValue: snapshot.pollenIndex,
      unit: 'idx',
      source: 'auto_pollen_api',
    });
  }

  if (snapshot.uvIndex !== undefined) {
    list.push({
      id: `${idPrefix}_uv`,
      variableId: 'var_uv_index',
      variableName: 'UV Index',
      category: 'environment',
      timestamp: ts,
      dateKey,
      numericValue: snapshot.uvIndex,
      unit: 'UV',
      source: 'auto_weather_api',
    });
  }

  if (snapshot.locationName) {
    const locationChanged =
      previousLocationName !== undefined &&
      previousLocationName.length > 0 &&
      previousLocationName !== snapshot.locationName;

    list.push({
      id: `${idPrefix}_location`,
      variableId: 'var_location_change',
      variableName: 'Location / Travel Shift',
      category: 'environment',
      timestamp: ts,
      dateKey,
      numericValue: locationChanged ? 1 : 0,
      textValue: snapshot.locationName,
      source: 'auto_gps',
    });
  }

  if (snapshot.estimatedExerciseMinutes !== undefined) {
    list.push({
      id: `${idPrefix}_exercise`,
      variableId: 'var_exercise',
      variableName: 'Exercise Quantity',
      category: 'lifestyle',
      timestamp: ts,
      dateKey,
      numericValue: snapshot.estimatedExerciseMinutes,
      unit: 'min',
      source: 'auto_pedometer',
    });
  }

  return list;
}
