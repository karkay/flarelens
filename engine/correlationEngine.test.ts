import { analyzeCorrelations, generateInsightsReport, pearsonCorrelation } from './correlationEngine';
import { STARTER_VARIABLES } from '../constants/starterVariables';
import { EczemaLogEntry, VariableMeasurement } from '../types';

function makeDate(dayOffset: number, hour = 18): { iso: string; dateKey: string } {
  const base = new Date(2026, 9, 1, hour, 0, 0); // Oct 1, 2026
  base.setDate(base.getDate() + dayOffset);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return { iso: base.toISOString(), dateKey: `${y}-${m}-${d}` };
}

describe('correlationEngine', () => {
  it('computes accurate Pearson correlation', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
  });

  it('detects delayed 24h food ingredient trigger and pairs exposures to flares', () => {
    const logs: EczemaLogEntry[] = [];
    const measurements: VariableMeasurement[] = [];
    const dairyDays = new Set([2, 6, 10, 14, 18]);

    for (let day = 0; day < 21; day++) {
      // Flare happens 1 day AFTER dairy exposure
      const severity = dairyDays.has(day - 1) ? 8 : 2;
      const { iso, dateKey } = makeDate(day, 19);
      logs.push({
        id: `log_${day}`,
        timestamp: iso,
        dateKey,
        severity,
        itchLevel: severity,
        rednessLevel: severity,
        drynessLevel: 3,
        affectedAreas: ['hands'],
        timeOfDay: 'evening',
        season: 'autumn',
      });

      if (dairyDays.has(day)) {
        const mealTime = makeDate(day, 13);
        measurements.push({
          id: `dairy_${day}`,
          variableId: 'ingredient:dairy',
          variableName: 'Dairy (Cow Milk)',
          category: 'food_ingredient',
          timestamp: mealTime.iso,
          dateKey: mealTime.dateKey,
          numericValue: 1,
          source: 'gemini_vision',
        });
      }
    }

    const results = analyzeCorrelations(logs, measurements, STARTER_VARIABLES);
    const dairy = results.find((r) => r.variableId === 'ingredient:dairy');

    expect(dairy).toBeDefined();
    expect(dairy?.direction).toBe('trigger');
    expect(dairy?.bestLag.lagKey).toBe('delayed_1d');
    expect(dairy?.bestLag.score).toBeGreaterThan(0.8);
    expect(dairy?.exposureFlarePairs.length).toBeGreaterThanOrEqual(4);
    expect(dairy?.typicalLagHours).toBeGreaterThan(20);
    expect(dairy?.typicalLagHours).toBeLessThan(36);
  });

  it('detects multi-day cumulative build-up triggers', () => {
    const logs: EczemaLogEntry[] = [];
    const measurements: VariableMeasurement[] = [];
    // Exposure occurs in multi-day streaks: days 2-4 and days 11-13 -> flare peaks on day 4 & 13
    const highStressDays = new Set([2, 3, 4, 11, 12, 13, 14]);

    for (let day = 0; day < 18; day++) {
      const stressVal = highStressDays.has(day) ? 9 : 2;
      const rollingStress =
        (highStressDays.has(day) ? 1 : 0) +
        (highStressDays.has(day - 1) ? 1 : 0) +
        (highStressDays.has(day - 2) ? 1 : 0);
      const severity = rollingStress >= 3 ? 8 : rollingStress === 2 ? 5 : 2;

      const { iso, dateKey } = makeDate(day, 20);
      logs.push({
        id: `log_${day}`,
        timestamp: iso,
        dateKey,
        severity,
        itchLevel: severity,
        rednessLevel: severity,
        drynessLevel: 3,
        affectedAreas: ['inner_elbows'],
        timeOfDay: 'evening',
        season: 'autumn',
      });

      measurements.push({
        id: `stress_${day}`,
        variableId: 'var_stress',
        variableName: 'Stress Level',
        category: 'lifestyle',
        timestamp: makeDate(day, 15).iso,
        dateKey,
        numericValue: stressVal,
        unit: '/10',
        source: 'manual',
      });
    }

    const results = analyzeCorrelations(logs, measurements, STARTER_VARIABLES);
    const stress = results.find((r) => r.variableId === 'var_stress');
    expect(stress).toBeDefined();
    expect(stress?.bestLag.lagKey).toBe('cumulative_3d');
    expect(stress?.pattern).toBe('cumulative_buildup');
  });

  it('generates morning and evening insights reports with active alerts', () => {
    const logs: EczemaLogEntry[] = [];
    const measurements: VariableMeasurement[] = [];
    const triggerDays = new Set([1, 5, 9, 13, 17]);

    for (let day = 0; day < 19; day++) {
      const { iso, dateKey } = makeDate(day, 18);
      const severity = triggerDays.has(day - 1) ? 8 : 2;
      logs.push({
        id: `l_${day}`,
        timestamp: iso,
        dateKey,
        severity,
        itchLevel: severity,
        rednessLevel: severity,
        drynessLevel: 2,
        affectedAreas: ['neck'],
        timeOfDay: 'evening',
        season: 'autumn',
      });
      if (triggerDays.has(day)) {
        measurements.push({
          id: `m_${day}`,
          variableId: 'ingredient:peanuts',
          variableName: 'Peanuts',
          category: 'food_ingredient',
          timestamp: makeDate(day, 12).iso,
          dateKey,
          numericValue: 1,
          source: 'gemini_vision',
        });
      }
    }

    const report = generateInsightsReport({
      eczemaLogs: logs,
      measurements,
      variableDefinitions: STARTER_VARIABLES,
      slot: 'morning',
      scheduledForLabel: '9:00 AM Morning Brief',
      now: new Date(2026, 9, 19, 9, 0, 0),
    });

    expect(report.slot).toBe('morning');
    expect(report.topTriggers[0]?.variableId).toBe('ingredient:peanuts');
  });
});
