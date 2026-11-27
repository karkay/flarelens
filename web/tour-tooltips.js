(function (global) {
  'use strict';

  const TOUR_STORAGE_KEY = 'flarelens_tour_completed_v1';

  const STAT_GLOSSARY = {
    r_value: {
      title: 'Correlation Score (r value)',
      badge: '-1.00 to +1.00',
      summary:
        'Measures how strongly a variable moves together with your eczema severity. FlareLens blends Pearson r (linear link) and Spearman ρ (threshold/rank link).',
      bullets: [
        '+0.50 to +1.00 (Strong Trigger): Higher exposure reliably corresponds to worse flares.',
        '+0.25 to +0.49 (Moderate Signal): Possible trigger—keep logging to confirm.',
        '-0.25 to -1.00 (Protective Factor): Higher values correspond to calmer skin (meaning drops—like low humidity or short sleep—tend to precede flares).',
        'Near 0.00: Little or no relationship found yet.',
      ],
      example:
        'Example: Dairy at r = +0.66 (Next Day) means flares consistently rise ~24–36 hours after dairy intake. Humidity at r = -0.58 means drier air correlates with worse skin.',
    },
    p_value: {
      title: 'Statistical Significance (p-value)',
      badge: 'Lower = stronger',
      summary:
        'Estimates the probability that the observed correlation happened purely by random coincidence.',
      bullets: [
        'p < 0.05: Statistically significant—less than a 5% chance this pattern is random noise.',
        'p = 0.05 to 0.15: Early / moderate trend—more days of logging will sharpen certainty.',
        'p > 0.15: Not enough evidence yet to rule out coincidence.',
      ],
      example:
        'Even a genuine trigger starts with a higher p-value during your first week; logging 14–21 days brings true triggers below p < 0.05.',
    },
    sample_size: {
      title: 'Sample Size (n)',
      badge: 'Paired days',
      summary:
        'The number of matched days where both this variable and an eczema check-in were recorded within the tested lag window.',
      bullets: [
        'n < 6: Too few points to draw firm conclusions.',
        'n = 7 to 13: Emerging pattern.',
        'n ≥ 14: Solid foundation for personal trigger detection.',
      ],
      example:
        'Logging consistently every day—even when your skin is clear (0–2/10)—gives the engine the baseline it needs!',
    },
    lag_window: {
      title: 'Reaction Lag (0d, 1d, 2d, 3d)',
      badge: 'Exposure → Flare delay',
      summary:
        'Eczema rarely reacts at the exact same speed for every trigger. FlareLens shifts every variable forward in time to find your personal delay.',
      bullets: [
        '0d (Same Day / 0–12h): Immediate reactions like pollen spikes, sweat, hot showers, or contact irritants.',
        '1d (~24h): Next-day reactions like poor sleep, low HRV, or delayed food responses.',
        '2d–3d (~48h–72h): Classic T-cell-mediated delayed eczema flares (very common with foods like dairy, nightshades, or gluten).',
      ],
      example:
        'The bar chart shows correlation strength at every delay so you can pinpoint when a trigger peaks.',
    },
    cumulative_buildup: {
      title: 'Multi-Day Build-Up (3d & 5d Sum)',
      badge: 'Stacking threshold',
      summary:
        'Some eczema triggers do not flare after a single exposure, but build up inflammation over several consecutive days.',
      bullets: [
        '3d Sum / 5d Sum computes an exponentially weighted rolling load over the past 3 or 5 days.',
        'Catches "bucket overflow" triggers like 3 stressful days in a row, consecutive dry nights, or repeated meals with the same ingredient.',
        'Toggle "3d Build-Up" on any Exposure → Flare graph to see the purple rolling curve.',
      ],
      example:
        'If 3d Sum has a higher r value than 0d or 1d, your skin reacts mainly when that factor stacks up over multiple days.',
    },
    confidence: {
      title: 'Confidence Level',
      badge: 'High · Moderate · Early',
      summary:
        'Combines correlation strength (|r|), p-value, sample size (n), and number of exposures so you know which findings to trust first.',
      bullets: [
        'High: |r| ≥ 0.55, p ≤ 0.05, n ≥ 10, and ≥ 3 exposures.',
        'Moderate: |r| ≥ 0.35, p ≤ 0.15, and ≥ 7 days analyzed.',
        'Early Signal: Interesting early trend—keep tracking before eliminating foods.',
      ],
      example:
        'Always verify suspected food triggers with your dermatologist before making restrictive dietary changes.',
    },
    hrv_rhr: {
      title: 'HRV, Resting HR & Sleep Quality',
      badge: 'Wearable biometrics',
      summary:
        'Synced from Apple Health, WHOOP, Garmin, or Strava. Objective autonomic markers often shift 12–48 hours before a visible flare.',
      bullets: [
        'Sleep Quality (1–10): Poor or fragmented sleep elevates inflammatory cytokines and nighttime scratching.',
        'HRV (ms): Higher HRV = better recovery. Sharp drops often signal physiological stress.',
        'Resting HR (bpm): Sustained +3–6 bpm elevation can warn of systemic stress or immune activation.',
      ],
      example:
        'Connect your wearable under Today → Health Apps or Settings to import sleep quality, HRV, and workouts automatically.',
    },
  };

  const TOUR_STEPS = [
    {
      tab: 'today',
      icon: '👋',
      title: 'Welcome to FlareLens',
      subtitle: 'Step 1 of 6 · Track any symptom & find your triggers',
      body:
        'Symptoms like eczema, stomach pain, acne, or migraines can flare within hours—or build up quietly over 2 to 4 days. FlareLens lets you track multiple health issues at once from one landing page, alongside auto-synced weather, allergens, food ingredients, sleep, wearables—and lets you create, log, and track your own custom conditions and custom triggers.',
      tip: 'A realistic 21-day demo dataset is pre-loaded for Eczema, Stomach Pain, and Acne so you can explore multi-issue correlations right away. Turn it off anytime in Settings.',
    },
    {
      tab: 'today',
      icon: '🏠',
      title: 'Multi-Issue Hub & Quick Check-In',
      subtitle: 'Step 2 of 6 · Home landing page',
      body:
        'Track multiple conditions side by side! Tap Clear, Mild, Moderate, or Severe on each condition and save once (local weather, humidity & pollen update automatically), or tap "+ Add Issue" to track anything else like migraines, bloating, or joint pain.',
      tip: 'Log both calm days and flare days—calm days help FlareLens learn your personal baseline!',
    },
    {
      tab: 'today',
      icon: '⌚',
      title: 'Connect Health & Fitness Apps',
      subtitle: 'Step 3 of 6 · Apple Health, WHOOP, Garmin & Strava',
      body:
        'Tap "Apps" on Home or Settings to bring in sleep, HRV, resting heart rate, and workouts from Apple Health, WHOOP, Garmin, or Strava.',
      tip: 'Sleep quality and recovery drops often show up 1–2 days before a visible flare.',
    },
    {
      tab: 'food',
      icon: '📷',
      title: 'Food Lens',
      subtitle: 'Step 4 of 6 · Food Lens tab',
      body:
        'Snap a photo or list multiple dishes you ate. FlareLens pulls out typical and hidden ingredients—like Dairy, Gluten, Shellfish, Nightshades, Eggs, and Soy—so you can track them automatically.',
      tip: 'You can tap any ingredient to include or exclude it, or add missing ones before saving.',
    },
    {
      tab: 'metrics',
      icon: '📊',
      title: 'Your Triggers & What Helps',
      subtitle: 'Step 5 of 6 · Metrics tab',
      body:
        'See your suspected triggers and protective habits ranked in plain English, along with whether each reacts same-day, 1–3 days later, or after building up over several days.',
      tip: 'Want the numbers? Toggle "Show Technical Stats" anytime to view exact scores and explanations.',
    },
    {
      tab: 'insights',
      icon: '✨',
      title: '9 AM / 9 PM Insights & Flare Graphs',
      subtitle: 'Step 6 of 6 · Insights tab',
      body:
        'Your analysis runs automatically for the start (9:00 AM) and end (9:00 PM) of each day. Inspect the Active Reaction Watchlist for recent exposures entering their peak window, and explore the Exposure Time → Eczema Flare-Up graph showing exact reaction delays (like +28h).',
      tip: 'You can replay this tour anytime by tapping "? Tour" in the top bar!',
    },
  ];

  function hasCompletedTour() {
    try {
      return localStorage.getItem(TOUR_STORAGE_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  function markTourCompleted() {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    } catch (_) {}
  }

  function renderInfoBtn(termKey, label = '') {
    return `<button type="button" class="info-pill" data-tooltip="${termKey}" aria-label="Explain ${termKey}">${label ? `${label} ` : ''}ⓘ</button>`;
  }

  global.FlareGuide = {
    STAT_GLOSSARY,
    TOUR_STEPS,
    hasCompletedTour,
    markTourCompleted,
    renderInfoBtn,
  };
})(window);
