import {
  BodyArea,
  DetectedIngredient,
  EczemaLogEntry,
  FoodLogEntry,
  Season,
  VariableDefinition,
  VariableMeasurement,
} from '../types';
import { toDateKey } from '../engine/correlationEngine';

function getSeasonForDate(d: Date): Season {
  const m = d.getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  return 'autumn';
}

export interface DemoDataset {
  eczemaLogs: EczemaLogEntry[];
  measurements: VariableMeasurement[];
  foodEntries: FoodLogEntry[];
  customVariables: VariableDefinition[];
}

/**
 * Generates a realistic 21-day dataset ending today with engineered multi-lag patterns:
 * - Dairy (Cow's Milk): strong delayed ~28h (1-day) trigger
 * - Local Allergens (Pollen): immediate same-day (4–8h) trigger
 * - Stress Level: 3-day cumulative build-up trigger
 * - Humidity (%): protective (dry spells drive flares)
 * - Sleep Duration: protective (short sleep worsens next-day severity)
 * - Tomato / Nightshades: delayed ~48h (2-day) moderate trigger
 * - Custom Variable (Hot Shower > 15m): mild immediate trigger
 */
export function buildDemoDataset(referenceDate: Date = new Date()): DemoDataset {
  const days = 21;
  const eczemaLogs: EczemaLogEntry[] = [];
  const measurements: VariableMeasurement[] = [];
  const foodEntries: FoodLogEntry[] = [];

  const customVariables: VariableDefinition[] = [
    {
      id: 'custom_hot_shower',
      name: 'Long Hot Shower (>15m)',
      category: 'custom',
      valueType: 'boolean',
      description: 'Custom variable tracking extended hot showers that can strip the skin barrier.',
      autoCollected: false,
      defaultSource: 'manual',
      isCustom: true,
      isActive: true,
      createdAt: new Date(referenceDate.getTime() - 25 * 86400000).toISOString(),
    },
  ];

  // Deterministic pseudo-noise helper
  const noise = (i: number, seed: number) =>
    Math.sin(i * 12.9898 + seed * 78.233) * 0.5;

  // Planned schedules across 21 days (index 0 = 20 days ago, index 20 = today)
  const dairyDays = new Set([1, 5, 10, 14, 19]); // Day 19 = yesterday so active alert triggers today!
  const pollenSpikeDays = new Set([3, 8, 13, 17, 20]);
  const tomatoDays = new Set([2, 8, 15]);
  const glutenDays = new Set([0, 2, 4, 6, 9, 11, 13, 16, 18, 20]);
  const eggDays = new Set([1, 3, 7, 12, 16, 19]);
  const hotShowerDays = new Set([3, 6, 11, 15, 18]);

  // Multi-day stress streaks (days 4-6 and days 13-16)
  const stressSeries: number[] = [];
  const humiditySeries: number[] = [];
  const pollenSeries: number[] = [];
  const sleepSeries: number[] = [];

  for (let i = 0; i < days; i++) {
    const inStressStreak = (i >= 4 && i <= 6) || (i >= 13 && i <= 16);
    const stress = inStressStreak
      ? Math.min(10, Math.round(7.8 + noise(i, 1) * 2))
      : Math.max(1, Math.round(3.2 + noise(i, 2) * 2));
    stressSeries.push(stress);

    // Dry spell during days 5-7 and 14-16
    const drySpell = (i >= 5 && i <= 7) || (i >= 14 && i <= 16) || i === 20;
    const humidity = drySpell
      ? Math.round(28 + noise(i, 3) * 8)
      : Math.round(58 + noise(i, 4) * 14);
    humiditySeries.push(humidity);

    const pollen = pollenSpikeDays.has(i)
      ? Math.round(78 + noise(i, 5) * 16)
      : Math.round(20 + noise(i, 6) * 14);
    pollenSeries.push(pollen);

    const sleep = inStressStreak
      ? Number((5.4 + noise(i, 7) * 0.9).toFixed(1))
      : Number((7.5 + noise(i, 8) * 1.1).toFixed(1));
    sleepSeries.push(sleep);
  }

  for (let i = 0; i < days; i++) {
    const dayDate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate() - (days - 1 - i),
      12,
      0,
      0
    );
    const dateKey = toDateKey(dayDate);
    const season = getSeasonForDate(dayDate);

    // Compute realistic eczema severity from immediate + delayed + cumulative triggers
    const hadDairyYesterday = dairyDays.has(i - 1) ? 1 : 0;
    const pollenToday = pollenSeries[i] > 60 ? 1 : 0;
    const tomatoTwoDaysAgo = tomatoDays.has(i - 2) ? 1 : 0;

    // 3-day cumulative stress build-up
    const stress3dAvg =
      ((stressSeries[i] ?? 3) +
        (stressSeries[Math.max(0, i - 1)] ?? 3) +
        (stressSeries[Math.max(0, i - 2)] ?? 3)) /
      3;
    const stressBuildupBoost = stress3dAvg > 6.5 ? 2.1 : stress3dAvg > 5 ? 0.8 : 0;

    // 2-day dry air impact
    const humAvg = ((humiditySeries[i] ?? 50) + (humiditySeries[Math.max(0, i - 1)] ?? 50)) / 2;
    const dryAirBoost = humAvg < 38 ? 1.5 : humAvg > 58 ? -0.6 : 0;

    // Sleep protection
    const sleepPenalty = sleepSeries[i] < 6.0 ? 0.9 : sleepSeries[i] >= 7.5 ? -0.4 : 0;
    const hotShowerBoost = hotShowerDays.has(i) ? 0.9 : 0;

    const rawEveningSeverity =
      1.8 +
      hadDairyYesterday * 3.8 +
      pollenToday * 2.5 +
      tomatoTwoDaysAgo * 1.7 +
      stressBuildupBoost +
      dryAirBoost +
      sleepPenalty +
      hotShowerBoost +
      noise(i, 9) * 0.7;

    const eveningSeverity = Math.max(0, Math.min(10, Math.round(rawEveningSeverity)));
    const morningSeverity = Math.max(
      0,
      Math.min(10, Math.round(eveningSeverity * 0.65 + (hadDairyYesterday ? 1.2 : 0)))
    );

    const areas: BodyArea[] =
      eveningSeverity >= 6
        ? ['hands', 'inner_elbows', 'neck']
        : eveningSeverity >= 4
        ? ['hands', 'wrists']
        : ['hands'];

    // Morning check-in (08:30)
    const morningTs = new Date(
      dayDate.getFullYear(),
      dayDate.getMonth(),
      dayDate.getDate(),
      8,
      30,
      0
    ).toISOString();

    eczemaLogs.push({
      id: `demo_log_am_${i}`,
      timestamp: morningTs,
      dateKey,
      severity: morningSeverity,
      itchLevel: Math.min(10, morningSeverity + 1),
      rednessLevel: Math.max(0, morningSeverity - 1),
      drynessLevel: humiditySeries[i] < 38 ? Math.min(10, morningSeverity + 2) : morningSeverity,
      affectedAreas: areas,
      timeOfDay: 'morning',
      season,
      notes: morningSeverity >= 6 ? 'Woke up itchy around inner elbows and wrists.' : undefined,
    });

    // Evening check-in (19:30) — skipped on today if current time is before 19:00 so user can log today!
    if (i < days - 1 || referenceDate.getHours() >= 19) {
      const eveningTs = new Date(
        dayDate.getFullYear(),
        dayDate.getMonth(),
        dayDate.getDate(),
        19,
        30,
        0
      ).toISOString();

      eczemaLogs.push({
        id: `demo_log_pm_${i}`,
        timestamp: eveningTs,
        dateKey,
        severity: eveningSeverity,
        itchLevel: Math.min(10, eveningSeverity + (pollenToday ? 1 : 0)),
        rednessLevel: eveningSeverity,
        drynessLevel: humiditySeries[i] < 38 ? Math.min(10, eveningSeverity + 1) : Math.max(1, eveningSeverity - 1),
        affectedAreas: areas,
        timeOfDay: 'evening',
        season,
        notes:
          eveningSeverity >= 7
            ? 'Noticeable flare-up in the evening; applied barrier cream.'
            : eveningSeverity <= 2
            ? 'Skin feeling calm and hydrated.'
            : undefined,
      });
    }

    // Environmental auto-collected measurements (10:00 AM daily)
    const envTs = new Date(
      dayDate.getFullYear(),
      dayDate.getMonth(),
      dayDate.getDate(),
      10,
      0,
      0
    ).toISOString();

    const tempC = Number((13 + Math.sin(i * 0.45) * 5).toFixed(1));
    const uv = Number(Math.max(1, 3.5 + Math.cos(i * 0.5) * 2.5).toFixed(1));
    const screenHrs = Number((4.5 + (stressSeries[i] > 6 ? 2.6 : 0.4) + noise(i, 11)).toFixed(1));
    const exerciseMin = Math.max(10, Math.round(35 + Math.sin(i * 0.8) * 22));

    measurements.push(
      {
        id: `demo_hum_${i}`,
        variableId: 'var_humidity',
        variableName: 'Humidity',
        category: 'environment',
        timestamp: envTs,
        dateKey,
        numericValue: humiditySeries[i],
        unit: '%',
        source: 'auto_weather_api',
      },
      {
        id: `demo_temp_${i}`,
        variableId: 'var_temperature',
        variableName: 'Temperature',
        category: 'environment',
        timestamp: envTs,
        dateKey,
        numericValue: tempC,
        unit: '°C',
        source: 'auto_weather_api',
      },
      {
        id: `demo_pollen_${i}`,
        variableId: 'var_local_allergens',
        variableName: 'Local Allergens (Pollen & AQI)',
        category: 'environment',
        timestamp: envTs,
        dateKey,
        numericValue: pollenSeries[i],
        unit: 'idx',
        source: 'auto_pollen_api',
      },
      {
        id: `demo_uv_${i}`,
        variableId: 'var_uv_index',
        variableName: 'UV Index',
        category: 'environment',
        timestamp: envTs,
        dateKey,
        numericValue: uv,
        unit: 'UV',
        source: 'auto_weather_api',
      },
      {
        id: `demo_stress_${i}`,
        variableId: 'var_stress',
        variableName: 'Stress Level',
        category: 'lifestyle',
        timestamp: envTs,
        dateKey,
        numericValue: stressSeries[i],
        unit: '/10',
        source: 'manual',
      },
      {
        id: `demo_sleep_dur_${i}`,
        variableId: 'var_sleep_duration',
        variableName: 'Sleep Duration',
        category: 'lifestyle',
        timestamp: morningTs,
        dateKey,
        numericValue: sleepSeries[i],
        unit: 'hrs',
        source: 'auto_health',
      },
      {
        id: `demo_sleep_qual_${i}`,
        variableId: 'var_sleep_quality',
        variableName: 'Sleep Quality',
        category: 'lifestyle',
        timestamp: morningTs,
        dateKey,
        numericValue: Math.max(1, Math.min(10, Math.round(sleepSeries[i] + 1))),
        unit: '/10',
        source: 'manual',
      },
      {
        id: `demo_screen_${i}`,
        variableId: 'var_screen_time',
        variableName: 'Screen Time',
        category: 'lifestyle',
        timestamp: envTs,
        dateKey,
        numericValue: screenHrs,
        unit: 'hrs',
        source: 'auto_screentime',
      },
      {
        id: `demo_ex_${i}`,
        variableId: 'var_exercise',
        variableName: 'Exercise Quantity',
        category: 'lifestyle',
        timestamp: envTs,
        dateKey,
        numericValue: exerciseMin,
        unit: 'min',
        source: 'auto_pedometer',
      }
    );

    if (hotShowerDays.has(i)) {
      measurements.push({
        id: `demo_shower_${i}`,
        variableId: 'custom_hot_shower',
        variableName: 'Long Hot Shower (>15m)',
        category: 'custom',
        timestamp: new Date(
          dayDate.getFullYear(),
          dayDate.getMonth(),
          dayDate.getDate(),
          17,
          0,
          0
        ).toISOString(),
        dateKey,
        numericValue: 1,
        source: 'manual',
      });
    }

    // Food entries + Gemini-extracted ingredients
    const mealsForDay: {
      dishName: string;
      mealType: FoodLogEntry['mealType'];
      hour: number;
      ingredients: Omit<DetectedIngredient, 'id' | 'included'>[];
    }[] = [];

    if (dairyDays.has(i)) {
      mealsForDay.push({
        dishName: i % 2 === 0 ? 'Iced Vanilla Latte & Cheddar Croissant' : 'Creamy Mushroom Pasta',
        mealType: 'lunch',
        hour: 13,
        ingredients: [
          {
            name: "Dairy (Cow's Milk)",
            normalizedKey: 'dairy',
            category: 'Dairy',
            commonEczemaTrigger: true,
            triggerGroup: 'Dairy / Casein',
            notes: 'Milk, butter, and aged cheese proteins.',
          },
          {
            name: 'Wheat / Gluten',
            normalizedKey: 'wheat_gluten',
            category: 'Grain',
            commonEczemaTrigger: true,
            triggerGroup: 'Gluten',
          },
          {
            name: 'Caffeine',
            normalizedKey: 'caffeine',
            category: 'Beverage',
            commonEczemaTrigger: false,
          },
        ],
      });
    }

    if (tomatoDays.has(i)) {
      mealsForDay.push({
        dishName: 'Margherita Flatbread & Tomato Soup',
        mealType: 'dinner',
        hour: 18,
        ingredients: [
          {
            name: 'Tomato (Nightshade)',
            normalizedKey: 'tomato_nightshade',
            category: 'Produce',
            commonEczemaTrigger: true,
            triggerGroup: 'Nightshades / Histamine',
            notes: 'High histamine & nightshade alkaloid content.',
          },
          {
            name: 'Olive Oil',
            normalizedKey: 'olive_oil',
            category: 'Oil',
            commonEczemaTrigger: false,
          },
        ],
      });
    }

    if (glutenDays.has(i) && !dairyDays.has(i)) {
      mealsForDay.push({
        dishName: 'Avocado Sourdough Toast',
        mealType: 'breakfast',
        hour: 9,
        ingredients: [
          {
            name: 'Wheat / Gluten',
            normalizedKey: 'wheat_gluten',
            category: 'Grain',
            commonEczemaTrigger: true,
            triggerGroup: 'Gluten',
          },
          {
            name: 'Avocado',
            normalizedKey: 'avocado',
            category: 'Produce',
            commonEczemaTrigger: false,
          },
        ],
      });
    }

    if (eggDays.has(i)) {
      mealsForDay.push({
        dishName: 'Veggie Omelette & Green Tea',
        mealType: 'breakfast',
        hour: 8,
        ingredients: [
          {
            name: 'Eggs',
            normalizedKey: 'eggs',
            category: 'Protein',
            commonEczemaTrigger: true,
            triggerGroup: 'Eggs',
          },
          {
            name: 'Spinach',
            normalizedKey: 'spinach',
            category: 'Produce',
            commonEczemaTrigger: false,
          },
        ],
      });
    }

    mealsForDay.forEach((meal, mIdx) => {
      const mealTs = new Date(
        dayDate.getFullYear(),
        dayDate.getMonth(),
        dayDate.getDate(),
        meal.hour,
        15,
        0
      ).toISOString();
      const foodId = `demo_food_${i}_${mIdx}`;

      const detected: DetectedIngredient[] = meal.ingredients.map((ing, k) => ({
        ...ing,
        id: `${foodId}_ing_${k}`,
        included: true,
      }));

      foodEntries.push({
        id: foodId,
        timestamp: mealTs,
        dateKey,
        dishName: meal.dishName,
        mealType: meal.mealType,
        summary: `Gemini Vision identified ${meal.dishName} with ${detected.length} typical ingredients.`,
        confidence: 0.93,
        analyzedByGemini: true,
        ingredients: detected,
      });

      detected.forEach((ing) => {
        measurements.push({
          id: `demo_meas_${foodId}_${ing.normalizedKey}`,
          variableId: `ingredient:${ing.normalizedKey}`,
          variableName: ing.name,
          category: 'food_ingredient',
          timestamp: mealTs,
          dateKey,
          numericValue: 1,
          source: 'gemini_vision',
          foodEntryId: foodId,
        });
      });
    });
  }

  return {
    eczemaLogs,
    measurements,
    foodEntries,
    customVariables,
  };
}
