import {
  ActiveRiskAlert,
  ConfidenceLevel,
  EczemaLogEntry,
  ExposureFlarePair,
  InsightSlot,
  InsightsReport,
  LagCorrelationStat,
  LagWindowKey,
  ReactionPattern,
  TimelinePoint,
  VariableCategory,
  VariableCorrelationResult,
  VariableDefinition,
  VariableMeasurement,
  VariableValueType,
} from '../types';

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  dt.setDate(dt.getDate() + deltaDays);
  return toDateKey(dt);
}

export function formatShortDateLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(m - 1) % 12]} ${d}`;
}

export function formatLagHours(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (Number.isInteger(days)) return `${days}d (${Math.round(hours)}h)`;
  return `${days.toFixed(1)}d (${Math.round(hours)}h)`;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + v, 0) / arr.length;
}

export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den < 1e-10) return 0;
  return Math.max(-1, Math.min(1, num / den));
}

function computeRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) {
      j++;
    }
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export function spearmanCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  return pearsonCorrelation(computeRanks(xs.slice(0, n)), computeRanks(ys.slice(0, n)));
}

/**
 * Two-tailed p-value approximation for Pearson r with df = n - 2.
 * Uses error-function approximation of the normal CDF with Wallace t-to-z transform,
 * which is accurate for both small and moderate sample sizes.
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
  return sign * y;
}

export function approxTwoTailedPValue(r: number, n: number): number {
  if (n < 4) return 1;
  const absR = Math.min(0.9999, Math.abs(r));
  if (absR < 1e-6) return 1;
  const df = n - 2;
  const t = absR * Math.sqrt(df / (1 - absR * absR));
  // Wallace (1959) approximation converting Student-t to standard normal z
  const z =
    Math.sqrt(df * Math.log(1 + (t * t) / df)) *
    (1 - 1 / (4 * df) + 1 / (21 * df * df));
  const p = 1 - erf(z / Math.SQRT2);
  return Math.max(0.0001, Math.min(1, p));
}

const LAG_CONFIGS: {
  lagKey: LagWindowKey;
  label: string;
  shortLabel: string;
  lagHoursApprox: number;
  kind: 'single' | 'cumulative';
  lagDays: number;
  windowDays?: number;
}[] = [
  {
    lagKey: 'immediate_0d',
    label: 'Same Day (0–12h)',
    shortLabel: '0d',
    lagHoursApprox: 4,
    kind: 'single',
    lagDays: 0,
  },
  {
    lagKey: 'delayed_1d',
    label: 'Next Day (~24h)',
    shortLabel: '1d',
    lagHoursApprox: 24,
    kind: 'single',
    lagDays: 1,
  },
  {
    lagKey: 'delayed_2d',
    label: '2 Days Later (~48h)',
    shortLabel: '2d',
    lagHoursApprox: 48,
    kind: 'single',
    lagDays: 2,
  },
  {
    lagKey: 'delayed_3d',
    label: '3 Days Later (~72h)',
    shortLabel: '3d',
    lagHoursApprox: 72,
    kind: 'single',
    lagDays: 3,
  },
  {
    lagKey: 'cumulative_3d',
    label: '3-Day Build-Up',
    shortLabel: '3d Sum',
    lagHoursApprox: 48,
    kind: 'cumulative',
    lagDays: 0,
    windowDays: 3,
  },
  {
    lagKey: 'cumulative_5d',
    label: '5-Day Build-Up',
    shortLabel: '5d Sum',
    lagHoursApprox: 72,
    kind: 'cumulative',
    lagDays: 0,
    windowDays: 5,
  },
];

function buildDateAxis(logs: EczemaLogEntry[], measurements: VariableMeasurement[]): string[] {
  const allKeys = new Set<string>();
  logs.forEach((l) => allKeys.add(l.dateKey));
  measurements.forEach((m) => allKeys.add(m.dateKey));
  if (allKeys.size === 0) return [];

  const sorted = Array.from(allKeys).sort();
  const start = sorted[0];
  const end = sorted[sorted.length - 1];

  const axis: string[] = [];
  let current = start;
  let guard = 0;
  while (current <= end && guard < 365) {
    axis.push(current);
    current = addDaysToDateKey(current, 1);
    guard++;
  }
  return axis;
}

function classifyPattern(lagKey: LagWindowKey): ReactionPattern {
  switch (lagKey) {
    case 'immediate_0d':
      return 'immediate';
    case 'delayed_1d':
      return 'delayed_24h';
    case 'delayed_2d':
      return 'delayed_48h';
    case 'delayed_3d':
      return 'delayed_72h';
    case 'cumulative_3d':
    case 'cumulative_5d':
      return 'cumulative_buildup';
  }
}

function classifyConfidence(absScore: number, pValue: number, sampleSize: number, exposureCount: number): ConfidenceLevel {
  if (sampleSize < 5 || exposureCount < 2) return 'insufficient';
  if (absScore >= 0.55 && pValue <= 0.05 && sampleSize >= 10 && exposureCount >= 3) {
    return 'high';
  }
  if (absScore >= 0.35 && pValue <= 0.15 && sampleSize >= 7 && exposureCount >= 3) {
    return 'moderate';
  }
  if (absScore >= 0.22 && sampleSize >= 5) {
    return 'early_signal';
  }
  return 'insufficient';
}

function describeLagWindow(pattern: ReactionPattern, typicalLagHours: number): string {
  switch (pattern) {
    case 'immediate':
      return `Immediate reaction (~${Math.max(1, Math.round(typicalLagHours))}h / same day)`;
    case 'delayed_24h':
      return `Delayed ~${Math.round(typicalLagHours)}h (next day)`;
    case 'delayed_48h':
      return `Delayed ~${Math.round(typicalLagHours)}h (2 days later)`;
    case 'delayed_72h':
      return `Delayed ~${Math.round(typicalLagHours)}h (3 days later)`;
    case 'cumulative_buildup':
      return `Multi-day cumulative build-up (peaks after 3–5 days)`;
  }
}

interface CandidateVariable {
  id: string;
  name: string;
  category: VariableCategory;
  valueType: VariableValueType;
  unit?: string;
}

export function analyzeCorrelations(
  eczemaLogs: EczemaLogEntry[],
  measurements: VariableMeasurement[],
  variableDefinitions: VariableDefinition[]
): VariableCorrelationResult[] {
  const dateAxis = buildDateAxis(eczemaLogs, measurements);
  if (dateAxis.length === 0) return [];

  // Map daily severity: combine daily max (65%) + daily mean (35%) to preserve acute flare spikes
  const logsByDate = new Map<string, EczemaLogEntry[]>();
  for (const log of eczemaLogs) {
    const arr = logsByDate.get(log.dateKey) ?? [];
    arr.push(log);
    logsByDate.set(log.dateKey, arr);
  }

  const dailySeverity = new Map<string, number>();
  const allDailySeverities: number[] = [];
  for (const dateKey of dateAxis) {
    const entries = logsByDate.get(dateKey);
    if (entries && entries.length > 0) {
      const severities = entries.map((e) => e.severity);
      const maxS = Math.max(...severities);
      const avgS = mean(severities);
      const score = Number((0.65 * maxS + 0.35 * avgS).toFixed(2));
      dailySeverity.set(dateKey, score);
      allDailySeverities.push(score);
    }
  }

  if (allDailySeverities.length < 3) return [];

  const baselineSeverity = mean(allDailySeverities);
  const flareThreshold = Math.max(4.5, Math.min(7.5, baselineSeverity + 1.35));

  // Build candidate variable catalog from definitions + dynamically discovered Gemini food ingredients
  const candidateMap = new Map<string, CandidateVariable>();
  for (const def of variableDefinitions) {
    if (!def.isActive || def.valueType === 'categorical') continue;
    candidateMap.set(def.id, {
      id: def.id,
      name: def.name,
      category: def.category,
      valueType: def.valueType,
      unit: def.unit,
    });
  }

  for (const m of measurements) {
    if (!candidateMap.has(m.variableId)) {
      const isIngredient = m.category === 'food_ingredient' || m.variableId.startsWith('ingredient:');
      candidateMap.set(m.variableId, {
        id: m.variableId,
        name: m.variableName,
        category: m.category,
        valueType: isIngredient ? 'boolean' : 'numeric',
        unit: m.unit,
      });
    }
  }

  // Group measurements by variableId -> dateKey
  const measByVar = new Map<string, VariableMeasurement[]>();
  for (const m of measurements) {
    const arr = measByVar.get(m.variableId) ?? [];
    arr.push(m);
    measByVar.set(m.variableId, arr);
  }

  const results: VariableCorrelationResult[] = [];

  for (const candidate of candidateMap.values()) {
    const varMeas = measByVar.get(candidate.id) ?? [];
    if (varMeas.length < 2) continue;

    const isExposureEventVar =
      candidate.category === 'food_ingredient' || candidate.valueType === 'boolean';

    // Map dateKey -> daily aggregated value
    const dailyValue = new Map<string, number>();
    const byDate = new Map<string, VariableMeasurement[]>();
    for (const m of varMeas) {
      const arr = byDate.get(m.dateKey) ?? [];
      arr.push(m);
      byDate.set(m.dateKey, arr);
    }

    for (const dateKey of dateAxis) {
      const dayItems = byDate.get(dateKey);
      if (dayItems && dayItems.length > 0) {
        if (isExposureEventVar) {
          // Sum exposures for dose-response (usually 1 per meal)
          dailyValue.set(
            dateKey,
            dayItems.reduce((acc, item) => acc + (item.numericValue > 0 ? item.numericValue : 0), 0)
          );
        } else {
          dailyValue.set(dateKey, mean(dayItems.map((item) => item.numericValue)));
        }
      } else if (isExposureEventVar) {
        // Unlogged food ingredient / boolean exposure on a tracked day = 0 exposure
        dailyValue.set(dateKey, 0);
      }
    }

    const exposureCount = isExposureEventVar
      ? Array.from(dailyValue.values()).filter((v) => v > 0).length
      : dailyValue.size;

    if (exposureCount < 2) continue;

    // Evaluate all lag windows + cumulative build-up windows
    const allLags: LagCorrelationStat[] = [];

    for (const cfg of LAG_CONFIGS) {
      const xs: number[] = [];
      const ys: number[] = [];
      const exposedSevs: number[] = [];
      const unexposedSevs: number[] = [];

      for (let i = 0; i < dateAxis.length; i++) {
        const targetDate = dateAxis[i];
        const sev = dailySeverity.get(targetDate);
        if (sev === undefined) continue;

        let xVal: number | undefined;
        if (cfg.kind === 'single') {
          const srcIdx = i - cfg.lagDays;
          if (srcIdx < 0) continue;
          xVal = dailyValue.get(dateAxis[srcIdx]);
        } else {
          const w = cfg.windowDays ?? 3;
          let weightedSum = 0;
          let weightTotal = 0;
          let validPoints = 0;
          for (let offset = 0; offset < w; offset++) {
            const srcIdx = i - offset;
            if (srcIdx < 0) continue;
            const v = dailyValue.get(dateAxis[srcIdx]);
            if (v !== undefined) {
              // Mild recency decay so recent days carry slightly more weight while rewarding sustained exposure
              const weight = Math.pow(0.82, offset);
              weightedSum += v * weight;
              weightTotal += weight;
              validPoints++;
            }
          }
          if (validPoints >= Math.min(2, w)) {
            xVal = isExposureEventVar ? weightedSum : weightedSum / weightTotal;
          }
        }

        if (xVal === undefined) continue;
        xs.push(xVal);
        ys.push(sev);

        if (isExposureEventVar) {
          if (xVal > 0) exposedSevs.push(sev);
          else unexposedSevs.push(sev);
        }
      }

      const n = xs.length;
      if (n < 4) {
        allLags.push({
          lagKey: cfg.lagKey,
          label: cfg.label,
          shortLabel: cfg.shortLabel,
          lagHoursApprox: cfg.lagHoursApprox,
          pearsonR: 0,
          spearmanRho: 0,
          score: 0,
          pValue: 1,
          sampleSize: n,
        });
        continue;
      }

      const r = pearsonCorrelation(xs, ys);
      const rho = spearmanCorrelation(xs, ys);
      // Blend Pearson and Spearman to capture both linear & monotonic threshold dynamics
      const score = Number((0.65 * r + 0.35 * rho).toFixed(3));
      const pValue = approxTwoTailedPValue(r, n);

      let severityLift: number | undefined;
      let flareRiskRatio: number | undefined;

      if (isExposureEventVar && exposedSevs.length > 0 && unexposedSevs.length > 0) {
        severityLift = Number((mean(exposedSevs) - mean(unexposedSevs)).toFixed(2));
        const exposedFlareRate =
          exposedSevs.filter((s) => s >= flareThreshold).length / exposedSevs.length;
        const unexposedFlareRate =
          unexposedSevs.filter((s) => s >= flareThreshold).length / unexposedSevs.length;
        flareRiskRatio = Number(
          ((exposedFlareRate + 0.05) / (unexposedFlareRate + 0.05)).toFixed(2)
        );
      }

      allLags.push({
        lagKey: cfg.lagKey,
        label: cfg.label,
        shortLabel: cfg.shortLabel,
        lagHoursApprox: cfg.lagHoursApprox,
        pearsonR: Number(r.toFixed(3)),
        spearmanRho: Number(rho.toFixed(3)),
        score,
        pValue: Number(pValue.toFixed(4)),
        sampleSize: n,
        severityLift,
        flareRiskRatio,
      });
    }

    // Pick strongest lag window (tie-break slightly preferring specific single-day lag unless cumulative clearly wins)
    let bestLag = allLags[0];
    for (const stat of allLags) {
      const currentAbs = Math.abs(stat.score);
      const bestAbs = Math.abs(bestLag.score);
      const isCumulative = stat.lagKey.startsWith('cumulative_');
      const bonus = isCumulative ? -0.025 : 0;
      if (currentAbs + bonus > bestAbs) {
        bestLag = stat;
      }
    }

    const absScore = Math.abs(bestLag.score);
    const direction: 'trigger' | 'protective' | 'neutral' =
      bestLag.score >= 0.18 ? 'trigger' : bestLag.score <= -0.18 ? 'protective' : 'neutral';

    const pattern = classifyPattern(bestLag.lagKey);
    const confidence = classifyConfidence(absScore, bestLag.pValue, bestLag.sampleSize, exposureCount);

    // Compute High vs Low severity comparison at best lag
    const observedVals = Array.from(dailyValue.values());
    const threshold = isExposureEventVar
      ? 0.5
      : observedVals.slice().sort((a, b) => a - b)[Math.floor(observedVals.length / 2)] ?? 0;

    const highSevList: number[] = [];
    const lowSevList: number[] = [];
    const bestLagDays =
      bestLag.lagKey === 'immediate_0d'
        ? 0
        : bestLag.lagKey === 'delayed_1d'
        ? 1
        : bestLag.lagKey === 'delayed_2d'
        ? 2
        : bestLag.lagKey === 'delayed_3d'
        ? 3
        : 0;

    for (let i = 0; i < dateAxis.length; i++) {
      const sev = dailySeverity.get(dateAxis[i]);
      if (sev === undefined) continue;
      let val: number | undefined;
      if (bestLag.lagKey === 'cumulative_3d' || bestLag.lagKey === 'cumulative_5d') {
        const w = bestLag.lagKey === 'cumulative_3d' ? 3 : 5;
        let sum = 0;
        let count = 0;
        for (let k = 0; k < w; k++) {
          const v = i - k >= 0 ? dailyValue.get(dateAxis[i - k]) : undefined;
          if (v !== undefined) {
            sum += v;
            count++;
          }
        }
        val = count > 0 ? (isExposureEventVar ? sum : sum / count) : undefined;
      } else if (i - bestLagDays >= 0) {
        val = dailyValue.get(dateAxis[i - bestLagDays]);
      }

      if (val === undefined) continue;
      const compareThreshold =
        isExposureEventVar && bestLag.lagKey.startsWith('cumulative_') ? 1.5 : threshold;
      if (val >= compareThreshold) highSevList.push(sev);
      else lowSevList.push(sev);
    }

    const avgSeverityWhenHigh = highSevList.length ? Number(mean(highSevList).toFixed(1)) : baselineSeverity;
    const avgSeverityWhenLow = lowSevList.length ? Number(mean(lowSevList).toFixed(1)) : baselineSeverity;

    // Build synchronized Timeline series (including 3-day cumulative overlay)
    const timeline: TimelinePoint[] = dateAxis.map((dateKey, idx) => {
      const sev = dailySeverity.get(dateKey) ?? null;
      const exp = dailyValue.get(dateKey) ?? null;

      // 3-day cumulative load up to this date
      let cumSum = 0;
      let cumCount = 0;
      for (let k = 0; k < 3; k++) {
        if (idx - k >= 0) {
          const v = dailyValue.get(dateAxis[idx - k]);
          if (v !== undefined) {
            cumSum += v;
            cumCount++;
          }
        }
      }
      const cumulativeExposure =
        cumCount > 0
          ? Number((isExposureEventVar ? cumSum : cumSum / cumCount).toFixed(2))
          : null;

      // Determine if this day is a local flare peak
      const prevSev = idx > 0 ? dailySeverity.get(dateAxis[idx - 1]) ?? 0 : 0;
      const nextSev = idx + 1 < dateAxis.length ? dailySeverity.get(dateAxis[idx + 1]) ?? 0 : 0;
      const isFlarePeak =
        sev !== null && sev >= flareThreshold && sev >= prevSev - 0.25 && sev >= nextSev - 0.25;

      const hasExposureEvent =
        exp !== null &&
        (isExposureEventVar
          ? exp > 0
          : direction === 'protective'
          ? exp <= threshold
          : exp >= threshold);

      return {
        dateKey,
        label: formatShortDateLabel(dateKey),
        timestamp: `${dateKey}T12:00:00.000Z`,
        severity: sev,
        exposureValue: exp !== null ? Number(exp.toFixed(2)) : null,
        cumulativeExposure,
        isFlarePeak,
        hasExposureEvent,
      };
    });

    // Pair concrete exposure events with subsequent flare peaks using exact timestamps!
    const flareLogs = eczemaLogs
      .filter((l) => l.severity >= flareThreshold)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const exposureEvents = varMeas
      .filter((m) =>
        isExposureEventVar
          ? m.numericValue > 0
          : direction === 'protective'
          ? m.numericValue <= threshold
          : m.numericValue >= threshold
      )
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const maxSearchHours = pattern === 'immediate' ? 18 : 84;
    const minSearchHours = pattern === 'immediate' ? 0 : 4;
    const exposureFlarePairs: ExposureFlarePair[] = [];
    const usedFlareDates = new Set<string>();

    for (const flare of flareLogs) {
      if (usedFlareDates.has(flare.dateKey)) continue;
      const flareMs = new Date(flare.timestamp).getTime();

      // Find the exposure event closest to the optimal lag before this flare
      let bestMatch: { m: VariableMeasurement; lagHours: number; dist: number } | null = null;
      for (const exp of exposureEvents) {
        const expMs = new Date(exp.timestamp).getTime();
        const diffHours = (flareMs - expMs) / 3600000;
        if (diffHours >= minSearchHours && diffHours <= maxSearchHours) {
          const dist = Math.abs(diffHours - bestLag.lagHoursApprox);
          if (!bestMatch || dist < bestMatch.dist) {
            bestMatch = { m: exp, lagHours: diffHours, dist };
          }
        }
      }

      if (bestMatch) {
        usedFlareDates.add(flare.dateKey);
        exposureFlarePairs.push({
          exposureTimestamp: bestMatch.m.timestamp,
          exposureDateKey: bestMatch.m.dateKey,
          exposureValue: bestMatch.m.numericValue,
          flareTimestamp: flare.timestamp,
          flareDateKey: flare.dateKey,
          flareSeverity: flare.severity,
          lagHours: Number(bestMatch.lagHours.toFixed(1)),
          lagLabel: formatLagHours(bestMatch.lagHours),
        });
      }
    }

    const typicalLagHours =
      exposureFlarePairs.length >= 2
        ? Number(mean(exposureFlarePairs.map((p) => p.lagHours)).toFixed(1))
        : bestLag.lagHoursApprox;

    const typicalLagDescription = describeLagWindow(pattern, typicalLagHours);

    // Build human-readable clinical summary
    let summary = '';
    if (direction === 'trigger') {
      if (isExposureEventVar) {
        summary =
          pattern === 'cumulative_buildup'
            ? `Repeated exposure to ${candidate.name} builds up over 3–5 days, raising average severity to ${avgSeverityWhenHigh}/10 vs ${avgSeverityWhenLow}/10 without buildup (r = +${bestLag.score.toFixed(2)}).`
            : `Exposure to ${candidate.name} is followed by flares peaking around ${formatLagHours(typicalLagHours)} later (avg severity ${avgSeverityWhenHigh}/10 vs ${avgSeverityWhenLow}/10, r = +${bestLag.score.toFixed(2)}).`;
      } else {
        summary =
          pattern === 'cumulative_buildup'
            ? `Sustained high ${candidate.name} over multiple days correlates with worsening eczema (r = +${bestLag.score.toFixed(2)}).`
            : `Higher ${candidate.name} correlates with flare-ups ${bestLag.label.toLowerCase()} (avg ${avgSeverityWhenHigh}/10 vs ${avgSeverityWhenLow}/10, r = +${bestLag.score.toFixed(2)}).`;
      }
    } else if (direction === 'protective') {
      summary = `Lower ${candidate.name} correlates with worse flares (${bestLag.label.toLowerCase()}: avg ${avgSeverityWhenLow}/10 when low vs ${avgSeverityWhenHigh}/10 when high, r = ${bestLag.score.toFixed(2)}). Keeping ${candidate.name} higher appears protective.`;
    } else {
      summary = `No strong correlation detected yet across immediate (0d), delayed (1–3d), or 3–5 day build-up windows (r = ${bestLag.score.toFixed(2)}).`;
    }

    results.push({
      variableId: candidate.id,
      variableName: candidate.name,
      category: candidate.category,
      valueType: candidate.valueType,
      unit: candidate.unit,
      bestLag,
      allLags,
      direction,
      pattern,
      confidence,
      exposureCount,
      totalDaysAnalyzed: dateAxis.length,
      avgSeverityWhenHigh,
      avgSeverityWhenLow,
      typicalLagHours,
      typicalLagDescription,
      summary,
      timeline,
      exposureFlarePairs,
    });
  }

  // Sort by strongest absolute correlation score first
  results.sort((a, b) => Math.abs(b.bestLag.score) - Math.abs(a.bestLag.score));
  return results;
}

export function generateInsightsReport(params: {
  eczemaLogs: EczemaLogEntry[];
  measurements: VariableMeasurement[];
  variableDefinitions: VariableDefinition[];
  slot: InsightSlot;
  scheduledForLabel: string;
  now?: Date;
}): InsightsReport {
  const { eczemaLogs, measurements, variableDefinitions, slot, scheduledForLabel } = params;
  const now = params.now ?? new Date();
  const dateKey = toDateKey(now);

  const allResults = analyzeCorrelations(eczemaLogs, measurements, variableDefinitions);

  const topTriggers = allResults
    .filter((r) => r.direction === 'trigger' && Math.abs(r.bestLag.score) >= 0.28)
    .slice(0, 6);

  const topProtective = allResults
    .filter((r) => r.direction === 'protective' && Math.abs(r.bestLag.score) >= 0.28)
    .slice(0, 4);

  const allSevs = eczemaLogs.map((l) => l.severity);
  const baselineSeverity = allSevs.length ? Number(mean(allSevs).toFixed(1)) : 0;

  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 3600000;
  const recentLogs = eczemaLogs.filter((l) => new Date(l.timestamp).getTime() >= sevenDaysAgoMs);
  const recent7DayAvgSeverity = recentLogs.length
    ? Number(mean(recentLogs.map((l) => l.severity)).toFixed(1))
    : baselineSeverity;

  // Build Active Exposure Watchlist: check exposures in past 72 hours against known triggers
  const activeAlerts: ActiveRiskAlert[] = [];
  const lookbackMs = 72 * 3600000;

  for (const trigger of topTriggers.slice(0, 5)) {
    const recentExposures = measurements
      .filter(
        (m) =>
          m.variableId === trigger.variableId &&
          now.getTime() - new Date(m.timestamp).getTime() <= lookbackMs &&
          now.getTime() - new Date(m.timestamp).getTime() >= 0
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (recentExposures.length === 0) continue;

    const latest = recentExposures[0];
    const isBinary = trigger.valueType === 'boolean' || trigger.category === 'food_ingredient';
    let isSignificantExposure = false;
    if (isBinary) {
      isSignificantExposure = latest.numericValue > 0;
    } else {
      const allVals = measurements
        .filter((m) => m.variableId === trigger.variableId)
        .map((m) => m.numericValue);
      const avgVal = mean(allVals);
      isSignificantExposure = latest.numericValue >= Math.max(avgVal * 1.15, avgVal + 0.5);
    }
    if (!isSignificantExposure) continue;

    const hoursSince = (now.getTime() - new Date(latest.timestamp).getTime()) / 3600000;
    const hoursUntilPeak = Math.round(trigger.typicalLagHours - hoursSince);

    if (hoursUntilPeak >= -12 && hoursUntilPeak <= 60) {
      const windowText =
        hoursUntilPeak <= 0
          ? 'Peak reaction window active now'
          : `Expected peak in ~${formatLagHours(hoursUntilPeak)}`;

      activeAlerts.push({
        variableId: trigger.variableId,
        variableName: trigger.variableName,
        category: trigger.category,
        exposureTimestamp: latest.timestamp,
        expectedPeakWindowLabel: windowText,
        hoursUntilPeak,
        riskLevel: trigger.confidence === 'high' ? 'high' : 'moderate',
        reason: `Exposed ${formatLagHours(hoursSince)} ago; historically peaks around ${formatLagHours(trigger.typicalLagHours)} after exposure (r = +${trigger.bestLag.score.toFixed(2)}).`,
      });
    }
  }

  // Also check protective variables currently running low (e.g., low humidity or poor sleep)
  for (const prot of topProtective.slice(0, 2)) {
    const recent = measurements
      .filter(
        (m) =>
          m.variableId === prot.variableId &&
          now.getTime() - new Date(m.timestamp).getTime() <= 36 * 3600000
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (recent.length > 0) {
      const vals = measurements
        .filter((m) => m.variableId === prot.variableId)
        .map((m) => m.numericValue);
      const avgVal = mean(vals);
      if (recent[0].numericValue < avgVal * 0.88) {
        activeAlerts.push({
          variableId: prot.variableId,
          variableName: `Low ${prot.variableName}`,
          category: prot.category,
          exposureTimestamp: recent[0].timestamp,
          expectedPeakWindowLabel: prot.bestLag.label,
          hoursUntilPeak: Math.round(prot.typicalLagHours),
          riskLevel: 'watch',
          reason: `Recent ${prot.variableName} (${recent[0].numericValue}${prot.unit ?? ''}) is below your average (${avgVal.toFixed(1)}${prot.unit ?? ''}), which tends to precede flares.`,
        });
      }
    }
  }

  const slotTitle =
    slot === 'morning'
      ? 'Morning Skin Forecast'
      : slot === 'evening'
      ? 'Evening Correlation Digest'
      : 'On-Demand Correlation Analysis';

  const leadTrigger = topTriggers[0];
  const headline = leadTrigger
    ? `${slotTitle}: ${leadTrigger.variableName} is your strongest signal (${leadTrigger.bestLag.shortLabel})`
    : `${slotTitle}: Keep logging daily to uncover trigger patterns`;

  const parts: string[] = [];
  if (topTriggers.length > 0) {
    const names = topTriggers
      .slice(0, 3)
      .map((t) => `${t.variableName} (${t.bestLag.label}, r=+${t.bestLag.score.toFixed(2)})`)
      .join(', ');
    parts.push(`Top suspected flare drivers: ${names}.`);
  }
  if (topProtective.length > 0) {
    parts.push(
      `Protective factor: higher ${topProtective[0].variableName} is associated with calmer skin (r=${topProtective[0].bestLag.score.toFixed(2)}).`
    );
  }
  if (activeAlerts.length > 0) {
    parts.push(
      `${activeAlerts.length} active exposure ${activeAlerts.length === 1 ? 'window' : 'windows'} to watch over the next 24–48 hours.`
    );
  }
  if (parts.length === 0) {
    parts.push(
      'Log your daily eczema severity, auto-collected environment data, and meal photos to detect immediate and multi-day triggers.'
    );
  }

  const uniqueDays = new Set(eczemaLogs.map((l) => l.dateKey)).size;

  return {
    id: `report_${dateKey}_${slot}_${now.getTime()}`,
    generatedAt: now.toISOString(),
    dateKey,
    slot,
    scheduledForLabel,
    headline,
    narrativeSummary: parts.join(' '),
    topTriggers,
    topProtective,
    allResults,
    activeAlerts,
    daysAnalyzed: uniqueDays,
    totalLogsAnalyzed: eczemaLogs.length + measurements.length,
    baselineSeverity,
    recent7DayAvgSeverity,
  };
}
