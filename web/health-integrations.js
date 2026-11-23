(function (global) {
  'use strict';

  const PROVIDERS = [
    {
      id: 'apple_health',
      name: 'Apple Health',
      icon: '❤️',
      metrics: ['Sleep Duration', 'Sleep Quality (REM/Deep)', 'HRV (SDNN)', 'Resting HR', 'Workouts'],
      supportsApiToken: false,
      acceptFiles: '.xml,.json,.csv',
      fileHint: 'Import Apple Health export.xml or Health Auto Export JSON/CSV.',
      setupHint: 'On iPhone: Health App → Profile → Export All Health Data (upload export.xml) or use Health Auto Export JSON.',
    },
    {
      id: 'whoop',
      name: 'WHOOP',
      icon: '⌚',
      metrics: ['Sleep Quality (%)', 'Sleep Duration', 'HRV (RMSSD)', 'Resting HR', 'Recovery / Stress', 'Exercise'],
      supportsApiToken: true,
      tokenPlaceholder: 'WHOOP OAuth Bearer Access Token',
      acceptFiles: '.csv,.json',
      fileHint: 'Import WHOOP physiological_cycles.csv, sleeps.csv, or workouts.csv.',
      setupHint: 'Connect via WHOOP API OAuth token (read:sleep, read:recovery, read:workout) or upload your WHOOP app CSV data export.',
    },
    {
      id: 'garmin',
      name: 'Garmin Connect',
      icon: '🧭',
      metrics: ['Sleep Score (Quality)', 'Sleep Duration', 'Resting HR', 'HRV', 'Stress Score', 'Exercise Minutes'],
      supportsApiToken: false,
      acceptFiles: '.csv,.json',
      fileHint: 'Import Garmin Connect Sleep / Activities CSV or JSON export.',
      setupHint: 'In Garmin Connect Web: Reports / Sleep / Activities → Export CSV (or Account → Export Your Data JSON) and upload here.',
    },
    {
      id: 'strava',
      name: 'Strava',
      icon: '🏃',
      metrics: ['Exercise Quantity (min)', 'Average Heart Rate', 'Workout Intensity'],
      supportsApiToken: true,
      tokenPlaceholder: 'Strava OAuth Access Token (activity:read)',
      acceptFiles: '.csv,.json',
      fileHint: 'Import Strava activities.csv or connect directly with Strava API v3.',
      setupHint: 'Enter your Strava OAuth Access Token (from strava.com/settings/api) to fetch recent workouts, or upload activities.csv.',
    },
  ];

  const META_STORAGE_KEY = 'flarelens_health_connections_v1';

  function loadConnections() {
    try {
      const raw = localStorage.getItem(META_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function saveConnections(map) {
    try {
      localStorage.setItem(META_STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function recordSyncResult(providerId, count, label) {
    const map = loadConnections();
    map[providerId] = {
      connected: true,
      lastSyncedAt: new Date().toISOString(),
      lastCount: count,
      lastSummary: label,
    };
    saveConnections(map);
    return map;
  }

  function toDateKey(d) {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function makeMeas(providerId, varId, varName, val, unit, dateInput) {
    const dt = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const dk = toDateKey(dt);
    if (!dk || val === null || val === undefined || Number.isNaN(Number(val))) return null;
    return {
      id: `health_${providerId}_${varId}_${dk}`,
      variableId: varId,
      variableName: varName,
      category: 'lifestyle',
      timestamp: dt.toISOString(),
      dateKey: dk,
      numericValue: Number(Number(val).toFixed(1)),
      unit,
      source: 'auto_health',
      textValue: `Synced from ${providerId}`,
    };
  }

  // Lightweight RFC-4180 CSV parser
  function parseCsvRows(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];
    const splitLine = (line) => {
      const cols = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
          cols.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return cols;
    };
    const headers = splitLine(lines[0]).map((h) => h.toLowerCase().trim());
    return lines.slice(1).map((line) => {
      const vals = splitLine(line);
      const row = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
      return row;
    });
  }

  function findCol(row, patterns) {
    const keys = Object.keys(row);
    for (const pat of patterns) {
      const k = keys.find((key) => key.includes(pat));
      if (k !== undefined && row[k] !== '') return row[k];
    }
    return undefined;
  }

  function parseDurationToMinutes(raw) {
    if (raw === undefined || raw === null || raw === '') return NaN;
    const str = String(raw).trim();
    if (/^\d+:\d{2}(:\d{2})?$/.test(str)) {
      const parts = str.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
      return parts[0] * 60 + parts[1];
    }
    const num = parseFloat(str.replace(/[^0-9.-]/g, ''));
    return num;
  }

  // 1. Live Strava API v3 Sync
  async function syncStravaApi(accessToken, days = 21) {
    const token = (accessToken || '').trim();
    if (!token) throw new Error('Enter a Strava OAuth Access Token first.');
    const afterSec = Math.floor((Date.now() - days * 86400000) / 1000);
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${afterSec}&per_page=60`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      throw new Error(`Strava API returned HTTP ${res.status}. Verify your access token has activity:read scope.`);
    }
    const activities = await res.json();
    const byDateMin = new Map();
    const byDateHr = new Map();

    (activities || []).forEach((act) => {
      const dt = new Date(act.start_date_local || act.start_date);
      const dk = toDateKey(dt);
      if (!dk) return;
      const mins = Math.round((act.moving_time || act.elapsed_time || 0) / 60);
      byDateMin.set(dk, (byDateMin.get(dk) || 0) + mins);
      if (typeof act.average_heartrate === 'number') {
        const arr = byDateHr.get(dk) || [];
        arr.push(act.average_heartrate);
        byDateHr.set(dk, arr);
      }
    });

    const out = [];
    byDateMin.forEach((mins, dk) => {
      const m = makeMeas('strava', 'var_exercise', 'Exercise Quantity', mins, 'min', `${dk}T12:00:00`);
      if (m) out.push(m);
    });
    byDateHr.forEach((hrs, dk) => {
      const avg = hrs.reduce((a, b) => a + b, 0) / hrs.length;
      const m = makeMeas('strava', 'var_resting_hr', 'Heart Rate (Workout/Resting)', avg, 'bpm', `${dk}T12:00:00`);
      if (m) out.push(m);
    });

    recordSyncResult('strava', out.length, `${activities.length} Strava activities synced`);
    return { measurements: out, summary: `Synced ${activities.length} Strava activities (${out.length} metrics).` };
  }

  // 2. Live WHOOP API v1 Sync
  async function syncWhoopApi(accessToken, days = 21) {
    const token = (accessToken || '').trim();
    if (!token) throw new Error('Enter a WHOOP OAuth Access Token first.');
    const startIso = new Date(Date.now() - days * 86400000).toISOString();
    const headers = { Authorization: `Bearer ${token}` };

    const [sleepRes, recRes, workRes] = await Promise.allSettled([
      fetch(`https://api.prod.whoop.com/developer/v1/activity/sleep?start=${encodeURIComponent(startIso)}&limit=25`, { headers }),
      fetch(`https://api.prod.whoop.com/developer/v1/recovery?start=${encodeURIComponent(startIso)}&limit=25`, { headers }),
      fetch(`https://api.prod.whoop.com/developer/v1/activity/workout?start=${encodeURIComponent(startIso)}&limit=25`, { headers }),
    ]);

    const out = [];
    let okCount = 0;

    if (sleepRes.status === 'fulfilled' && sleepRes.value.ok) {
      okCount++;
      const data = await sleepRes.value.json();
      (data.records || []).forEach((rec) => {
        const dt = rec.end || rec.start || rec.created_at;
        const stage = rec.score?.stage_summary;
        const totalMs =
          stage
            ? (stage.total_light_sleep_time_milli || 0) +
              (stage.total_slow_wave_sleep_time_milli || 0) +
              (stage.total_rem_sleep_time_milli || 0)
            : 0;
        if (totalMs > 0) {
          const m = makeMeas('whoop', 'var_sleep_duration', 'Sleep Duration', totalMs / 3600000, 'hrs', dt);
          if (m) out.push(m);
        }
        const perf = rec.score?.sleep_performance_percentage ?? rec.score?.sleep_efficiency_percentage;
        if (typeof perf === 'number') {
          const q = Math.max(1, Math.min(10, Math.round(perf / 10)));
          const m = makeMeas('whoop', 'var_sleep_quality', 'Sleep Quality', q, '/10', dt);
          if (m) out.push(m);
        }
      });
    }

    if (recRes.status === 'fulfilled' && recRes.value.ok) {
      okCount++;
      const data = await recRes.value.json();
      (data.records || []).forEach((rec) => {
        const dt = rec.created_at || rec.updated_at;
        const sc = rec.score || {};
        if (typeof sc.hrv_rmssd_milli === 'number') {
          const m = makeMeas('whoop', 'var_hrv', 'Heart Rate Variability (HRV)', sc.hrv_rmssd_milli, 'ms', dt);
          if (m) out.push(m);
        }
        if (typeof sc.resting_heart_rate === 'number') {
          const m = makeMeas('whoop', 'var_resting_hr', 'Resting Heart Rate', sc.resting_heart_rate, 'bpm', dt);
          if (m) out.push(m);
        }
        if (typeof sc.recovery_score === 'number') {
          // Inverse of recovery provides an objective physiological stress index (1–10)
          const stressEst = Math.max(1, Math.min(10, Math.round(11 - sc.recovery_score / 10)));
          const m = makeMeas('whoop', 'var_stress', 'Stress Level', stressEst, '/10', dt);
          if (m) out.push(m);
        }
      });
    }

    if (workRes.status === 'fulfilled' && workRes.value.ok) {
      okCount++;
      const data = await workRes.value.json();
      (data.records || []).forEach((rec) => {
        if (rec.start && rec.end) {
          const mins = Math.max(1, Math.round((new Date(rec.end) - new Date(rec.start)) / 60000));
          const m = makeMeas('whoop', 'var_exercise', 'Exercise Quantity', mins, 'min', rec.start);
          if (m) out.push(m);
        }
      });
    }

    if (okCount === 0) {
      throw new Error('Could not reach WHOOP API (check OAuth token or browser CORS; CSV export import always works offline!).');
    }

    recordSyncResult('whoop', out.length, `${out.length} WHOOP sleep/HRV/workout metrics`);
    return { measurements: out, summary: `Synced ${out.length} WHOOP sleep, HRV, heart rate & workout records.` };
  }

  // 3. Universal File Export Importer (Apple Health XML, WHOOP CSV, Garmin CSV/JSON, Strava CSV)
  function parseHealthExportFile(providerId, fileName, text) {
    const lowerName = (fileName || '').toLowerCase();
    const out = [];

    // Apple Health XML (`export.xml`)
    if (lowerName.endsWith('.xml') || text.trim().startsWith('<')) {
      const sleepByDate = new Map();
      const deepRemByDate = new Map();
      const hrvByDate = new Map();
      const rhrByDate = new Map();
      const exByDate = new Map();

      // Stream-friendly regex parsing so even large Apple Health exports parse fast without freezing DOM
      const recordRe = /<Record\s+([^>]+?)\/>/g;
      let match;
      let processed = 0;
      const cutoffMs = Date.now() - 90 * 86400000; // Last 90 days

      while ((match = recordRe.exec(text)) !== null && processed < 150000) {
        processed++;
        const attrs = match[1];
        const typeM = /type="([^"]+)"/.exec(attrs);
        if (!typeM) continue;
        const type = typeM[1];
        if (
          type !== 'HKCategoryTypeIdentifierSleepAnalysis' &&
          type !== 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' &&
          type !== 'HKQuantityTypeIdentifierRestingHeartRate' &&
          type !== 'HKQuantityTypeIdentifierAppleExerciseTime'
        ) {
          continue;
        }
        const startM = /startDate="([^"]+)"/.exec(attrs);
        const endM = /endDate="([^"]+)"/.exec(attrs);
        const valM = /value="([^"]+)"/.exec(attrs);
        if (!startM) continue;
        const startDt = new Date(startM[1]);
        if (Number.isNaN(startDt.getTime()) || startDt.getTime() < cutoffMs) continue;
        const dk = toDateKey(startDt);

        if (type === 'HKCategoryTypeIdentifierSleepAnalysis' && endM && valM) {
          const val = valM[1];
          if (val.includes('Asleep')) {
            const hrs = Math.max(0, (new Date(endM[1]) - startDt) / 3600000);
            sleepByDate.set(dk, (sleepByDate.get(dk) || 0) + hrs);
            if (val.includes('Deep') || val.includes('REM')) {
              deepRemByDate.set(dk, (deepRemByDate.get(dk) || 0) + hrs);
            }
          }
        } else if (type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' && valM) {
          const arr = hrvByDate.get(dk) || [];
          arr.push(parseFloat(valM[1]));
          hrvByDate.set(dk, arr);
        } else if (type === 'HKQuantityTypeIdentifierRestingHeartRate' && valM) {
          const arr = rhrByDate.get(dk) || [];
          arr.push(parseFloat(valM[1]));
          rhrByDate.set(dk, arr);
        } else if (type === 'HKQuantityTypeIdentifierAppleExerciseTime' && valM) {
          exByDate.set(dk, (exByDate.get(dk) || 0) + parseFloat(valM[1]));
        }
      }

      sleepByDate.forEach((hrs, dk) => {
        const clamped = Math.min(14, hrs);
        const m = makeMeas(providerId, 'var_sleep_duration', 'Sleep Duration', clamped, 'hrs', `${dk}T08:00:00`);
        if (m) out.push(m);
        const deepRem = deepRemByDate.get(dk) || 0;
        const restorativeRatio = clamped > 0 ? deepRem / clamped : 0;
        const qual = Math.max(1, Math.min(10, Math.round(Math.min(7, (clamped / 8) * 7) + Math.min(3, restorativeRatio * 8))));
        const mq = makeMeas(providerId, 'var_sleep_quality', 'Sleep Quality', qual, '/10', `${dk}T08:00:00`);
        if (mq) out.push(mq);
      });
      hrvByDate.forEach((arr, dk) => {
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const m = makeMeas(providerId, 'var_hrv', 'Heart Rate Variability (HRV)', avg, 'ms', `${dk}T08:00:00`);
        if (m) out.push(m);
      });
      rhrByDate.forEach((arr, dk) => {
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const m = makeMeas(providerId, 'var_resting_hr', 'Resting Heart Rate', avg, 'bpm', `${dk}T08:00:00`);
        if (m) out.push(m);
      });
      exByDate.forEach((mins, dk) => {
        const m = makeMeas(providerId, 'var_exercise', 'Exercise Quantity', mins, 'min', `${dk}T18:00:00`);
        if (m) out.push(m);
      });
    } else if (lowerName.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      const json = JSON.parse(text);
      const records = Array.isArray(json)
        ? json
        : json.data?.metrics || json.records || json.sleep || json.activities || [];

      if (Array.isArray(records)) {
        records.forEach((item) => {
          const dt = item.date || item.calendarDate || item.start_date || item.start || item.timestamp || item.created_at;
          if (!dt) return;
          const sleepSec = item.sleepTimeSeconds || item.durationInSeconds;
          if (typeof sleepSec === 'number') {
            const m = makeMeas(providerId, 'var_sleep_duration', 'Sleep Duration', sleepSec / 3600, 'hrs', dt);
            if (m) out.push(m);
          } else if (typeof item.sleepHours === 'number') {
            const m = makeMeas(providerId, 'var_sleep_duration', 'Sleep Duration', item.sleepHours, 'hrs', dt);
            if (m) out.push(m);
          }
          const sleepScore = item.sleepScores?.overall?.value ?? item.sleepScore ?? item.sleep_performance_percentage ?? item.sleepQuality;
          if (typeof sleepScore === 'number') {
            const q = sleepScore > 10 ? Math.max(1, Math.min(10, Math.round(sleepScore / 10))) : sleepScore;
            const m = makeMeas(providerId, 'var_sleep_quality', 'Sleep Quality', q, '/10', dt);
            if (m) out.push(m);
          }
          const hrv = item.hrv ?? item.hrv_rmssd_milli ?? item.hrvMs;
          if (typeof hrv === 'number') {
            const m = makeMeas(providerId, 'var_hrv', 'Heart Rate Variability (HRV)', hrv, 'ms', dt);
            if (m) out.push(m);
          }
          const rhr = item.restingHeartRate ?? item.resting_heart_rate ?? item.average_heartrate;
          if (typeof rhr === 'number') {
            const m = makeMeas(providerId, 'var_resting_hr', 'Resting Heart Rate', rhr, 'bpm', dt);
            if (m) out.push(m);
          }
          const exMin = item.moving_time ? item.moving_time / 60 : item.exerciseMinutes ?? item.activeMinutes;
          if (typeof exMin === 'number') {
            const m = makeMeas(providerId, 'var_exercise', 'Exercise Quantity', exMin, 'min', dt);
            if (m) out.push(m);
          }
        });
      }
    } else {
      // CSV importer supporting WHOOP, Garmin Connect, Strava, and Apple Health CSVs
      const rows = parseCsvRows(text);
      rows.forEach((row) => {
        const dtRaw = findCol(row, ['cycle start', 'date', 'sleep onset', 'activity date', 'start time', 'day']);
        if (!dtRaw) return;
        const dt = new Date(dtRaw);
        if (Number.isNaN(dt.getTime())) return;

        // Sleep duration (minutes or hours or HH:MM)
        const sleepMinRaw = findCol(row, ['asleep duration (min)', 'sleep duration (min)', 'total sleep']);
        const sleepHrRaw = findCol(row, ['sleep hours', 'sleep duration (hr)']);
        if (sleepMinRaw !== undefined) {
          const mins = parseDurationToMinutes(sleepMinRaw);
          if (!Number.isNaN(mins) && mins > 0) {
            const hrs = mins > 24 ? mins / 60 : mins;
            const m = makeMeas(providerId, 'var_sleep_duration', 'Sleep Duration', hrs, 'hrs', dt);
            if (m) out.push(m);
          }
        } else if (sleepHrRaw !== undefined) {
          const hrs = parseFloat(sleepHrRaw);
          if (!Number.isNaN(hrs)) {
            const m = makeMeas(providerId, 'var_sleep_duration', 'Sleep Duration', hrs, 'hrs', dt);
            if (m) out.push(m);
          }
        }

        // Sleep quality / performance % / score (0-100 -> 1-10)
        const qualRaw = findCol(row, ['sleep performance', 'sleep score', 'sleep efficiency', 'sleep quality']);
        if (qualRaw !== undefined) {
          const val = parseFloat(String(qualRaw).replace(/[^0-9.]/g, ''));
          if (!Number.isNaN(val)) {
            const q = val > 10 ? Math.max(1, Math.min(10, Math.round(val / 10))) : val;
            const m = makeMeas(providerId, 'var_sleep_quality', 'Sleep Quality', q, '/10', dt);
            if (m) out.push(m);
          }
        }

        // HRV
        const hrvRaw = findCol(row, ['heart rate variability', 'hrv']);
        if (hrvRaw !== undefined) {
          const val = parseFloat(String(hrvRaw).replace(/[^0-9.]/g, ''));
          if (!Number.isNaN(val) && val > 0) {
            const m = makeMeas(providerId, 'var_hrv', 'Heart Rate Variability (HRV)', val, 'ms', dt);
            if (m) out.push(m);
          }
        }

        // Resting / Average Heart Rate
        const rhrRaw = findCol(row, ['resting heart rate', 'resting hr', 'avg hr', 'average heart rate']);
        if (rhrRaw !== undefined) {
          const val = parseFloat(String(rhrRaw).replace(/[^0-9.]/g, ''));
          if (!Number.isNaN(val) && val > 30 && val < 220) {
            const m = makeMeas(providerId, 'var_resting_hr', 'Resting Heart Rate', val, 'bpm', dt);
            if (m) out.push(m);
          }
        }

        // Exercise / Moving time
        const exRaw = findCol(row, ['moving time', 'elapsed time', 'duration (min)', 'active minutes', 'exercise']);
        if (exRaw !== undefined) {
          let mins = parseDurationToMinutes(exRaw);
          if (!Number.isNaN(mins) && mins > 0) {
            // Strava CSV moving time is often in seconds (>300)
            if (mins > 360 && !String(exRaw).includes(':')) mins = mins / 60;
            const m = makeMeas(providerId, 'var_exercise', 'Exercise Quantity', mins, 'min', dt);
            if (m) out.push(m);
          }
        }

        // Stress score (Garmin 0-100 -> 1-10)
        const stressRaw = findCol(row, ['stress', 'avg stress']);
        if (stressRaw !== undefined) {
          const val = parseFloat(String(stressRaw).replace(/[^0-9.]/g, ''));
          if (!Number.isNaN(val)) {
            const s = val > 10 ? Math.max(1, Math.min(10, Math.round(val / 10))) : val;
            const m = makeMeas(providerId, 'var_stress', 'Stress Level', s, '/10', dt);
            if (m) out.push(m);
          }
        }
      });
    }

    if (out.length === 0) {
      throw new Error(`No recognized sleep, heart rate, HRV, or exercise columns found in ${fileName}.`);
    }

    recordSyncResult(providerId, out.length, `Imported ${out.length} metrics from ${fileName}`);
    return { measurements: out, summary: `Imported ${out.length} health metrics from ${fileName}!` };
  }

  // 4. Realistic 14-day Wearable Demo Sync (lets users test any provider right away)
  function buildSampleProviderSync(providerId) {
    const now = new Date();
    const out = [];
    for (let i = 0; i < 14; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 8, 0, 0);
      const wave = Math.sin(i * 0.7);
      const badNight = i === 1 || i === 5 || i === 10;

      if (providerId === 'strava') {
        if (i % 2 === 0) {
          const mins = Math.round(38 + wave * 18);
          out.push(makeMeas(providerId, 'var_exercise', 'Exercise Quantity', mins, 'min', dt));
          out.push(makeMeas(providerId, 'var_resting_hr', 'Resting Heart Rate', Math.round(58 + (badNight ? 6 : 0) - wave * 2), 'bpm', dt));
        }
      } else {
        const sleepHrs = Number((badNight ? 5.3 : 7.6 + wave * 0.6).toFixed(1));
        const sleepQual = badNight ? 4 : Math.min(10, Math.round(7.8 + wave * 1.4));
        const hrv = Math.round(badNight ? 36 : 64 + wave * 11);
        const rhr = Math.round(badNight ? 66 : 55 - wave * 2);
        const exMin = Math.max(10, Math.round(34 + wave * 20));

        out.push(
          makeMeas(providerId, 'var_sleep_duration', 'Sleep Duration', sleepHrs, 'hrs', dt),
          makeMeas(providerId, 'var_sleep_quality', 'Sleep Quality', sleepQual, '/10', dt),
          makeMeas(providerId, 'var_hrv', 'Heart Rate Variability (HRV)', hrv, 'ms', dt),
          makeMeas(providerId, 'var_resting_hr', 'Resting Heart Rate', rhr, 'bpm', dt),
          makeMeas(providerId, 'var_exercise', 'Exercise Quantity', exMin, 'min', dt)
        );
      }
    }
    const clean = out.filter(Boolean);
    const provName = (PROVIDERS.find((p) => p.id === providerId) || {}).name || providerId;
    recordSyncResult(providerId, clean.length, `14-day ${provName} sample sync (${clean.length} metrics)`);
    return {
      measurements: clean,
      summary: `Synced ${clean.length} metrics from ${provName} (Sleep Quality, Sleep Duration, HRV, Heart Rate & Exercise).`,
    };
  }

  global.FlareHealth = {
    PROVIDERS,
    loadConnections,
    syncStravaApi,
    syncWhoopApi,
    parseHealthExportFile,
    buildSampleProviderSync,
  };
})(window);
