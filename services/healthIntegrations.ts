import { VariableMeasurement } from '../types';
import { toDateKey } from '../engine/correlationEngine';

export type HealthProviderId = 'apple_health' | 'whoop' | 'garmin' | 'strava';

export interface HealthProviderInfo {
  id: HealthProviderId;
  name: string;
  metrics: string[];
  supportsApiToken: boolean;
  description: string;
}

export const HEALTH_PROVIDERS: HealthProviderInfo[] = [
  {
    id: 'apple_health',
    name: 'Apple Health',
    metrics: ['Sleep Duration', 'Sleep Quality', 'HRV (SDNN)', 'Resting HR', 'Workouts'],
    supportsApiToken: false,
    description: 'Reads HealthKit sleep stages, HRV, resting HR, and workouts in native iOS builds or via export.xml.',
  },
  {
    id: 'whoop',
    name: 'WHOOP',
    metrics: ['Sleep Quality (%)', 'Sleep Duration', 'HRV (RMSSD)', 'Resting HR', 'Recovery / Stress', 'Workouts'],
    supportsApiToken: true,
    description: 'Connects to WHOOP Developer API v1 (sleep, recovery, workout) or imports WHOOP CSV exports.',
  },
  {
    id: 'garmin',
    name: 'Garmin Connect',
    metrics: ['Sleep Score', 'Sleep Duration', 'Resting HR', 'HRV', 'Stress Score', 'Active Minutes'],
    supportsApiToken: false,
    description: 'Imports Garmin Connect Sleep, HRV, and Activities CSV/JSON exports.',
  },
  {
    id: 'strava',
    name: 'Strava',
    metrics: ['Exercise Quantity (min)', 'Average Heart Rate', 'Workout Intensity'],
    supportsApiToken: true,
    description: 'Connects to Strava API v3 (/athlete/activities) using OAuth access token or imports activities.csv.',
  },
];

function makeHealthMeasurement(
  providerId: HealthProviderId,
  variableId: string,
  variableName: string,
  value: number,
  unit: string,
  date: Date
): VariableMeasurement {
  const dateKey = toDateKey(date);
  return {
    id: `health_${providerId}_${variableId}_${dateKey}`,
    variableId,
    variableName,
    category: 'lifestyle',
    timestamp: date.toISOString(),
    dateKey,
    numericValue: Number(value.toFixed(1)),
    unit,
    source: 'auto_health',
    textValue: `Synced from ${providerId}`,
  };
}

export async function syncStravaApi(
  accessToken: string,
  days = 21
): Promise<{ measurements: VariableMeasurement[]; summary: string }> {
  const token = accessToken.trim();
  if (!token) throw new Error('Enter a Strava OAuth access token first.');

  const afterSec = Math.floor((Date.now() - days * 86400000) / 1000);
  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${afterSec}&per_page=60`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Strava API returned HTTP ${res.status}. Verify your token has activity:read scope.`);
  }

  const activities = (await res.json()) as {
    start_date_local?: string;
    start_date?: string;
    moving_time?: number;
    elapsed_time?: number;
    average_heartrate?: number;
  }[];

  const minsByDate = new Map<string, number>();
  const hrsByDate = new Map<string, number[]>();

  for (const act of activities) {
    const dt = new Date(act.start_date_local || act.start_date || '');
    if (Number.isNaN(dt.getTime())) continue;
    const dk = toDateKey(dt);
    const mins = Math.round((act.moving_time ?? act.elapsed_time ?? 0) / 60);
    minsByDate.set(dk, (minsByDate.get(dk) ?? 0) + mins);
    if (typeof act.average_heartrate === 'number') {
      const arr = hrsByDate.get(dk) ?? [];
      arr.push(act.average_heartrate);
      hrsByDate.set(dk, arr);
    }
  }

  const measurements: VariableMeasurement[] = [];
  minsByDate.forEach((mins, dk) => {
    measurements.push(
      makeHealthMeasurement('strava', 'var_exercise', 'Exercise Quantity', mins, 'min', new Date(`${dk}T12:00:00`))
    );
  });
  hrsByDate.forEach((arr, dk) => {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    measurements.push(
      makeHealthMeasurement('strava', 'var_resting_hr', 'Resting Heart Rate', avg, 'bpm', new Date(`${dk}T12:00:00`))
    );
  });

  return {
    measurements,
    summary: `Synced ${activities.length} Strava activities (${measurements.length} metrics).`,
  };
}

export async function syncWhoopApi(
  accessToken: string,
  days = 21
): Promise<{ measurements: VariableMeasurement[]; summary: string }> {
  const token = accessToken.trim();
  if (!token) throw new Error('Enter a WHOOP OAuth access token first.');

  const startIso = new Date(Date.now() - days * 86400000).toISOString();
  const headers = { Authorization: `Bearer ${token}` };

  const [sleepRes, recRes, workRes] = await Promise.allSettled([
    fetch(`https://api.prod.whoop.com/developer/v1/activity/sleep?start=${encodeURIComponent(startIso)}&limit=25`, { headers }),
    fetch(`https://api.prod.whoop.com/developer/v1/recovery?start=${encodeURIComponent(startIso)}&limit=25`, { headers }),
    fetch(`https://api.prod.whoop.com/developer/v1/activity/workout?start=${encodeURIComponent(startIso)}&limit=25`, { headers }),
  ]);

  const measurements: VariableMeasurement[] = [];
  let okCount = 0;

  if (sleepRes.status === 'fulfilled' && sleepRes.value.ok) {
    okCount++;
    const data = await sleepRes.value.json();
    for (const rec of data.records ?? []) {
      const dt = new Date(rec.end || rec.start || rec.created_at);
      if (Number.isNaN(dt.getTime())) continue;
      const stage = rec.score?.stage_summary;
      const totalMs = stage
        ? (stage.total_light_sleep_time_milli ?? 0) +
          (stage.total_slow_wave_sleep_time_milli ?? 0) +
          (stage.total_rem_sleep_time_milli ?? 0)
        : 0;
      if (totalMs > 0) {
        measurements.push(
          makeHealthMeasurement('whoop', 'var_sleep_duration', 'Sleep Duration', totalMs / 3600000, 'hrs', dt)
        );
      }
      const perf = rec.score?.sleep_performance_percentage ?? rec.score?.sleep_efficiency_percentage;
      if (typeof perf === 'number') {
        measurements.push(
          makeHealthMeasurement('whoop', 'var_sleep_quality', 'Sleep Quality', Math.max(1, Math.min(10, Math.round(perf / 10))), '/10', dt)
        );
      }
    }
  }

  if (recRes.status === 'fulfilled' && recRes.value.ok) {
    okCount++;
    const data = await recRes.value.json();
    for (const rec of data.records ?? []) {
      const dt = new Date(rec.created_at || rec.updated_at);
      if (Number.isNaN(dt.getTime())) continue;
      const sc = rec.score ?? {};
      if (typeof sc.hrv_rmssd_milli === 'number') {
        measurements.push(
          makeHealthMeasurement('whoop', 'var_hrv', 'Heart Rate Variability (HRV)', sc.hrv_rmssd_milli, 'ms', dt)
        );
      }
      if (typeof sc.resting_heart_rate === 'number') {
        measurements.push(
          makeHealthMeasurement('whoop', 'var_resting_hr', 'Resting Heart Rate', sc.resting_heart_rate, 'bpm', dt)
        );
      }
    }
  }

  if (workRes.status === 'fulfilled' && workRes.value.ok) {
    okCount++;
    const data = await workRes.value.json();
    for (const rec of data.records ?? []) {
      if (rec.start && rec.end) {
        const mins = Math.max(1, Math.round((new Date(rec.end).getTime() - new Date(rec.start).getTime()) / 60000));
        measurements.push(
          makeHealthMeasurement('whoop', 'var_exercise', 'Exercise Quantity', mins, 'min', new Date(rec.start))
        );
      }
    }
  }

  if (okCount === 0) {
    throw new Error('Could not reach WHOOP API. Check your OAuth token scopes (read:sleep, read:recovery, read:workout).');
  }

  return {
    measurements,
    summary: `Synced ${measurements.length} WHOOP sleep, HRV, heart rate & workout records.`,
  };
}
