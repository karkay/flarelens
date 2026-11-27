(function (global) {
  'use strict';

  const STARTER_CONDITIONS = [
    {
      id: 'cond_eczema',
      name: 'Eczema',
      icon: '🩹',
      color: '#D1493E',
      category: 'Skin',
      subMetrics: ['Itch Intensity', 'Redness / Inflammation', 'Skin Dryness'],
      areas: ['Hands', 'Wrists', 'Inner Elbows', 'Neck', 'Face / Eyelids', 'Behind Knees', 'Ankles', 'Torso', 'Scalp'],
      defaultActive: true,
      isCustom: false,
    },
    {
      id: 'cond_stomach_pain',
      name: 'Stomach Pain',
      icon: '🤢',
      color: '#C97B1A',
      category: 'Digestive',
      subMetrics: ['Cramping', 'Bloating', 'Acid / Nausea'],
      areas: ['Upper Abdomen', 'Lower Abdomen', 'Left Side', 'Right Side', 'Chest / Reflux'],
      defaultActive: true,
      isCustom: false,
    },
    {
      id: 'cond_acne',
      name: 'Acne',
      icon: '✨',
      color: '#7A52B3',
      category: 'Skin',
      subMetrics: ['Breakouts', 'Inflammation', 'Oiliness'],
      areas: ['Forehead', 'Cheeks', 'Jawline / Chin', 'Nose', 'Back / Shoulders', 'Chest'],
      defaultActive: true,
      isCustom: false,
    },
    {
      id: 'cond_migraine',
      name: 'Migraines',
      icon: '🧠',
      color: '#3B78B8',
      category: 'Neurological',
      subMetrics: ['Head Pain', 'Light / Sound Sensitivity', 'Brain Fog'],
      areas: ['Temples', 'Forehead', 'Behind Eyes', 'Back of Head', 'Neck'],
      defaultActive: false,
      isCustom: false,
    },
    {
      id: 'cond_allergies',
      name: 'Allergies / Sinus',
      icon: '🤧',
      color: '#248A67',
      category: 'Respiratory',
      subMetrics: ['Congestion', 'Sneezing', 'Itchy Eyes'],
      areas: ['Sinuses', 'Eyes', 'Throat', 'Chest'],
      defaultActive: false,
      isCustom: false,
    },
    {
      id: 'cond_joint_pain',
      name: 'Joint Pain',
      icon: '🦴',
      color: '#5C6F68',
      category: 'Musculoskeletal',
      subMetrics: ['Stiffness', 'Aching', 'Swelling'],
      areas: ['Hands / Fingers', 'Knees', 'Lower Back', 'Shoulders', 'Hips', 'Ankles'],
      defaultActive: false,
      isCustom: false,
    },
  ];

  const STARTER_VARIABLES = [
    { id: 'var_humidity', name: 'Humidity', category: 'environment', valueType: 'numeric', unit: '%', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_temperature', name: 'Temperature', category: 'environment', valueType: 'numeric', unit: '°C', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_local_allergens', name: 'Local Allergens (Pollen & AQI)', category: 'environment', valueType: 'numeric', unit: 'idx', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_uv_index', name: 'UV Index', category: 'environment', valueType: 'numeric', unit: 'UV', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_stress', name: 'Stress Level', category: 'lifestyle', valueType: 'scale', unit: '/10', autoCollected: false, isCustom: false, isActive: true },
    { id: 'var_sleep_duration', name: 'Sleep Duration', category: 'lifestyle', valueType: 'numeric', unit: 'hrs', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_sleep_quality', name: 'Sleep Quality', category: 'lifestyle', valueType: 'scale', unit: '/10', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_hrv', name: 'Heart Rate Variability (HRV)', category: 'lifestyle', valueType: 'numeric', unit: 'ms', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_resting_hr', name: 'Resting Heart Rate', category: 'lifestyle', valueType: 'numeric', unit: 'bpm', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_screen_time', name: 'Screen Time', category: 'lifestyle', valueType: 'numeric', unit: 'hrs', autoCollected: true, isCustom: false, isActive: true },
    { id: 'var_exercise', name: 'Exercise Quantity', category: 'lifestyle', valueType: 'numeric', unit: 'min', autoCollected: true, isCustom: false, isActive: true },
  ];

  const BODY_AREAS = [
    { id: 'hands', label: 'Hands' },
    { id: 'wrists', label: 'Wrists' },
    { id: 'inner_elbows', label: 'Inner Elbows' },
    { id: 'neck', label: 'Neck' },
    { id: 'face', label: 'Face / Eyelids' },
    { id: 'behind_knees', label: 'Behind Knees' },
    { id: 'ankles', label: 'Ankles' },
    { id: 'torso', label: 'Torso' },
    { id: 'scalp', label: 'Scalp' },
  ];

  function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDaysToDateKey(dateKey, delta) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    dt.setDate(dt.getDate() + delta);
    return toDateKey(dt);
  }

  function formatShortDate(dateKey) {
    const [, m, d] = dateKey.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[(m - 1) % 12]} ${d}`;
  }

  function formatLagHours(hours) {
    if (hours < 1) return '<1h';
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = hours / 24;
    return Number.isInteger(days) ? `${days}d (${Math.round(hours)}h)` : `${days.toFixed(1)}d (${Math.round(hours)}h)`;
  }

  function getTimeOfDayBucket(date = new Date()) {
    const h = date.getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
  }

  function getSeasonForLocation(date = new Date(), lat) {
    const m = date.getMonth();
    const south = typeof lat === 'number' && lat < 0;
    let s = 'autumn';
    if (m === 11 || m <= 1) s = 'winter';
    else if (m >= 2 && m <= 4) s = 'spring';
    else if (m >= 5 && m <= 7) s = 'summer';
    if (!south) return s;
    return { winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' }[s];
  }

  function normalizeIngredientKey(name) {
    return (name || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown_ingredient';
  }

  function dedupeIngredients(rawList) {
    const byKey = new Map();
    const order = [];
    const mergeList = (a, b) => {
      const items = `${a || ''},${b || ''}`
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const seen = new Set();
      return items
        .filter((s) => {
          const k = s.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .join(', ');
    };
    (rawList || []).forEach((item, idx) => {
      const rawName = String(item?.name || '').trim();
      if (!rawName) return;
      const key = item.normalizedKey || normalizeIngredientKey(rawName);
      const parenMatch = /\(([^)]+)\)/.exec(rawName);
      const baseName = rawName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      if (!byKey.has(key)) {
        const entry = {
          id: item.id || `gem_${Date.now()}_${idx}`,
          name: rawName,
          normalizedKey: key,
          category: item.category || 'Ingredient',
          commonEczemaTrigger: Boolean(item.commonEczemaTrigger),
          triggerGroup: item.triggerGroup || '',
          foundIn: String(item.foundIn || '').trim(),
          notes: item.notes || '',
          included: item.included !== false,
          _baseName: baseName,
        };
        byKey.set(key, entry);
        order.push(entry);
      } else {
        const existing = byKey.get(key);
        existing.commonEczemaTrigger = existing.commonEczemaTrigger || Boolean(item.commonEczemaTrigger);
        if (!existing.triggerGroup && item.triggerGroup) existing.triggerGroup = item.triggerGroup;
        if (existing._baseName && existing.name.includes('(') && rawName.includes('(')) {
          const prevParen = /\(([^)]+)\)/.exec(existing.name);
          if (prevParen) existing.foundIn = mergeList(existing.foundIn, prevParen[1]);
          if (parenMatch) existing.foundIn = mergeList(existing.foundIn, parenMatch[1]);
          existing.name = existing._baseName;
        }
        if (item.foundIn) existing.foundIn = mergeList(existing.foundIn, item.foundIn);
        if (!existing.notes && item.notes) existing.notes = item.notes;
      }
    });
    return order.map(({ _baseName, ...clean }) => clean);
  }

  function mean(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  function pearson(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 3) return 0;
    const mx = mean(xs.slice(0, n));
    const my = mean(ys.slice(0, n));
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const den = Math.sqrt(dx2 * dy2);
    return den < 1e-10 ? 0 : Math.max(-1, Math.min(1, num / den));
  }

  function ranks(values) {
    const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array(values.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[idx[k].i] = avg;
      i = j + 1;
    }
    return out;
  }

  function spearman(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    return n < 3 ? 0 : pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
  }

  function erf(x) {
    const sign = x >= 0 ? 1 : -1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
    return sign * y;
  }

  function approxPValue(r, n) {
    if (n < 4) return 1;
    const ar = Math.min(0.9999, Math.abs(r));
    if (ar < 1e-6) return 1;
    const df = n - 2;
    const t = ar * Math.sqrt(df / (1 - ar * ar));
    const z = Math.sqrt(df * Math.log(1 + (t * t) / df)) * (1 - 1 / (4 * df) + 1 / (21 * df * df));
    return Math.max(0.0001, Math.min(1, 1 - erf(z / Math.SQRT2)));
  }

  const LAG_CONFIGS = [
    { lagKey: 'immediate_0d', label: 'Same Day (0–12h)', shortLabel: '0d', lagHoursApprox: 4, kind: 'single', lagDays: 0 },
    { lagKey: 'delayed_1d', label: 'Next Day (~24h)', shortLabel: '1d', lagHoursApprox: 24, kind: 'single', lagDays: 1 },
    { lagKey: 'delayed_2d', label: '2 Days Later (~48h)', shortLabel: '2d', lagHoursApprox: 48, kind: 'single', lagDays: 2 },
    { lagKey: 'delayed_3d', label: '3 Days Later (~72h)', shortLabel: '3d', lagHoursApprox: 72, kind: 'single', lagDays: 3 },
    { lagKey: 'cumulative_3d', label: '3-Day Build-Up', shortLabel: '3d Sum', lagHoursApprox: 48, kind: 'cumulative', lagDays: 0, windowDays: 3 },
    { lagKey: 'cumulative_5d', label: '5-Day Build-Up', shortLabel: '5d Sum', lagHoursApprox: 72, kind: 'cumulative', lagDays: 0, windowDays: 5 },
  ];

  function analyzeCorrelations(eczemaLogs, measurements, variableDefinitions) {
    const keySet = new Set();
    eczemaLogs.forEach((l) => keySet.add(l.dateKey));
    measurements.forEach((m) => keySet.add(m.dateKey));
    if (keySet.size === 0) return [];

    const sortedKeys = Array.from(keySet).sort();
    const dateAxis = [];
    let cur = sortedKeys[0];
    const end = sortedKeys[sortedKeys.length - 1];
    let guard = 0;
    while (cur <= end && guard < 365) {
      dateAxis.push(cur);
      cur = addDaysToDateKey(cur, 1);
      guard++;
    }

    const logsByDate = new Map();
    eczemaLogs.forEach((l) => {
      const arr = logsByDate.get(l.dateKey) || [];
      arr.push(l);
      logsByDate.set(l.dateKey, arr);
    });

    const dailySev = new Map();
    const allSevs = [];
    dateAxis.forEach((dk) => {
      const arr = logsByDate.get(dk);
      if (arr && arr.length) {
        const vals = arr.map((e) => e.severity);
        const s = Number((0.65 * Math.max(...vals) + 0.35 * mean(vals)).toFixed(2));
        dailySev.set(dk, s);
        allSevs.push(s);
      }
    });
    if (allSevs.length < 3) return [];

    const baseline = mean(allSevs);
    const flareThreshold = Math.max(4.5, Math.min(7.5, baseline + 1.35));

    const candidates = new Map();
    variableDefinitions.forEach((def) => {
      if (def.isActive && def.valueType !== 'categorical') {
        candidates.set(def.id, { id: def.id, name: def.name, category: def.category, valueType: def.valueType, unit: def.unit });
      }
    });
    measurements.forEach((m) => {
      if (!candidates.has(m.variableId)) {
        const isIng = m.category === 'food_ingredient' || m.variableId.startsWith('ingredient:');
        candidates.set(m.variableId, {
          id: m.variableId,
          name: m.variableName,
          category: m.category,
          valueType: isIng ? 'boolean' : 'numeric',
          unit: m.unit,
        });
      }
    });

    const measByVar = new Map();
    measurements.forEach((m) => {
      const arr = measByVar.get(m.variableId) || [];
      arr.push(m);
      measByVar.set(m.variableId, arr);
    });

    const results = [];

    for (const cand of candidates.values()) {
      const vMeas = measByVar.get(cand.id) || [];
      if (vMeas.length < 2) continue;

      const isEvent = cand.category === 'food_ingredient' || cand.valueType === 'boolean';
      const byDate = new Map();
      vMeas.forEach((m) => {
        const arr = byDate.get(m.dateKey) || [];
        arr.push(m);
        byDate.set(m.dateKey, arr);
      });

      const dailyVal = new Map();
      dateAxis.forEach((dk) => {
        const items = byDate.get(dk);
        if (items && items.length) {
          dailyVal.set(dk, isEvent ? items.reduce((a, b) => a + (b.numericValue > 0 ? b.numericValue : 0), 0) : mean(items.map((x) => x.numericValue)));
        } else if (isEvent) {
          dailyVal.set(dk, 0);
        }
      });

      const exposureCount = isEvent
        ? Array.from(dailyVal.values()).filter((v) => v > 0).length
        : dailyVal.size;
      if (exposureCount < 2) continue;

      const allLags = LAG_CONFIGS.map((cfg) => {
        const xs = [], ys = [];
        for (let i = 0; i < dateAxis.length; i++) {
          const sev = dailySev.get(dateAxis[i]);
          if (sev === undefined) continue;
          let xVal;
          if (cfg.kind === 'single') {
            if (i - cfg.lagDays >= 0) xVal = dailyVal.get(dateAxis[i - cfg.lagDays]);
          } else {
            let wSum = 0, wTot = 0, valid = 0;
            for (let k = 0; k < cfg.windowDays; k++) {
              if (i - k >= 0) {
                const v = dailyVal.get(dateAxis[i - k]);
                if (v !== undefined) {
                  const w = Math.pow(0.82, k);
                  wSum += v * w;
                  wTot += w;
                  valid++;
                }
              }
            }
            if (valid >= Math.min(2, cfg.windowDays)) xVal = isEvent ? wSum : wSum / wTot;
          }
          if (xVal === undefined) continue;
          xs.push(xVal);
          ys.push(sev);
        }

        if (xs.length < 4) {
          return { ...cfg, pearsonR: 0, spearmanRho: 0, score: 0, pValue: 1, sampleSize: xs.length };
        }
        const r = pearson(xs, ys);
        const rho = spearman(xs, ys);
        const score = Number((0.65 * r + 0.35 * rho).toFixed(3));
        return {
          ...cfg,
          pearsonR: Number(r.toFixed(3)),
          spearmanRho: Number(rho.toFixed(3)),
          score,
          pValue: Number(approxPValue(r, xs.length).toFixed(4)),
          sampleSize: xs.length,
        };
      });

      let bestLag = allLags[0];
      allLags.forEach((st) => {
        const bonus = st.lagKey.startsWith('cumulative_') ? -0.025 : 0;
        if (Math.abs(st.score) + bonus > Math.abs(bestLag.score)) bestLag = st;
      });

      const direction = bestLag.score >= 0.18 ? 'trigger' : bestLag.score <= -0.18 ? 'protective' : 'neutral';
      const patternMap = {
        immediate_0d: 'immediate',
        delayed_1d: 'delayed_24h',
        delayed_2d: 'delayed_48h',
        delayed_3d: 'delayed_72h',
        cumulative_3d: 'cumulative_buildup',
        cumulative_5d: 'cumulative_buildup',
      };
      const pattern = patternMap[bestLag.lagKey];

      const absScore = Math.abs(bestLag.score);
      const confidence =
        bestLag.sampleSize < 5 || exposureCount < 2
          ? 'insufficient'
          : absScore >= 0.55 && bestLag.pValue <= 0.05 && bestLag.sampleSize >= 10 && exposureCount >= 3
          ? 'high'
          : absScore >= 0.35 && bestLag.pValue <= 0.15 && bestLag.sampleSize >= 7 && exposureCount >= 3
          ? 'moderate'
          : absScore >= 0.22
          ? 'early_signal'
          : 'insufficient';

      const obsVals = Array.from(dailyVal.values()).sort((a, b) => a - b);
      const threshold = isEvent ? 0.5 : (obsVals[Math.floor(obsVals.length / 2)] || 0);

      const highList = [], lowList = [];
      const bestDays = bestLag.lagDays || 0;
      for (let i = 0; i < dateAxis.length; i++) {
        const sev = dailySev.get(dateAxis[i]);
        if (sev === undefined) continue;
        let val;
        if (bestLag.kind === 'cumulative') {
          let s = 0, c = 0;
          for (let k = 0; k < bestLag.windowDays; k++) {
            const v = i - k >= 0 ? dailyVal.get(dateAxis[i - k]) : undefined;
            if (v !== undefined) { s += v; c++; }
          }
          val = c ? (isEvent ? s : s / c) : undefined;
        } else if (i - bestDays >= 0) {
          val = dailyVal.get(dateAxis[i - bestDays]);
        }
        if (val === undefined) continue;
        const cmp = isEvent && bestLag.kind === 'cumulative' ? 1.5 : threshold;
        if (val >= cmp) highList.push(sev);
        else lowList.push(sev);
      }

      const avgHigh = highList.length ? Number(mean(highList).toFixed(1)) : Number(baseline.toFixed(1));
      const avgLow = lowList.length ? Number(mean(lowList).toFixed(1)) : Number(baseline.toFixed(1));

      const timeline = dateAxis.map((dk, idx) => {
        const sev = dailySev.has(dk) ? dailySev.get(dk) : null;
        const exp = dailyVal.has(dk) ? dailyVal.get(dk) : null;
        let cSum = 0, cCnt = 0;
        for (let k = 0; k < 3; k++) {
          if (idx - k >= 0 && dailyVal.has(dateAxis[idx - k])) {
            cSum += dailyVal.get(dateAxis[idx - k]);
            cCnt++;
          }
        }
        const prevS = idx > 0 ? (dailySev.get(dateAxis[idx - 1]) || 0) : 0;
        const nextS = idx + 1 < dateAxis.length ? (dailySev.get(dateAxis[idx + 1]) || 0) : 0;
        return {
          dateKey: dk,
          label: formatShortDate(dk),
          severity: sev,
          exposureValue: exp !== null ? Number(exp.toFixed(2)) : null,
          cumulativeExposure: cCnt ? Number((isEvent ? cSum : cSum / cCnt).toFixed(2)) : null,
          isFlarePeak: sev !== null && sev >= flareThreshold && sev >= prevS - 0.25 && sev >= nextS - 0.25,
        };
      });

      const flareLogs = eczemaLogs
        .filter((l) => l.severity >= flareThreshold)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const expEvents = vMeas
        .filter((m) => (isEvent ? m.numericValue > 0 : direction === 'protective' ? m.numericValue <= threshold : m.numericValue >= threshold))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const minH = pattern === 'immediate' ? 0 : 4;
      const maxH = pattern === 'immediate' ? 18 : 84;
      const pairs = [];
      const usedDates = new Set();

      for (const fl of flareLogs) {
        if (usedDates.has(fl.dateKey)) continue;
        const flMs = new Date(fl.timestamp).getTime();
        let best = null;
        for (const ev of expEvents) {
          const diffH = (flMs - new Date(ev.timestamp).getTime()) / 3600000;
          if (diffH >= minH && diffH <= maxH) {
            const dist = Math.abs(diffH - bestLag.lagHoursApprox);
            if (!best || dist < best.dist) best = { ev, diffH, dist };
          }
        }
        if (best) {
          usedDates.add(fl.dateKey);
          pairs.push({
            exposureTimestamp: best.ev.timestamp,
            exposureDateKey: best.ev.dateKey,
            flareTimestamp: fl.timestamp,
            flareDateKey: fl.dateKey,
            flareSeverity: fl.severity,
            lagHours: Number(best.diffH.toFixed(1)),
            lagLabel: formatLagHours(best.diffH),
          });
        }
      }

      const typicalLagHours = pairs.length >= 2 ? Number(mean(pairs.map((p) => p.lagHours)).toFixed(1)) : bestLag.lagHoursApprox;
      const typicalLagDescription =
        pattern === 'immediate'
          ? `Immediate reaction (~${Math.max(1, Math.round(typicalLagHours))}h / same day)`
          : pattern === 'cumulative_buildup'
          ? 'Multi-day cumulative build-up (3–5 days)'
          : `Delayed ~${Math.round(typicalLagHours)}h (${bestLag.label})`;

      let summary = `No strong correlation detected yet across 0d–3d or multi-day build-up (r = ${bestLag.score.toFixed(2)}).`;
      if (direction === 'trigger') {
        summary =
          pattern === 'cumulative_buildup'
            ? `Sustained ${cand.name} builds up over 3–5 days, raising average severity to ${avgHigh}/10 vs ${avgLow}/10 (r = +${bestLag.score.toFixed(2)}).`
            : `Exposure to ${cand.name} is followed by flares peaking ~${formatLagHours(typicalLagHours)} later (avg ${avgHigh}/10 vs ${avgLow}/10, r = +${bestLag.score.toFixed(2)}).`;
      } else if (direction === 'protective') {
        summary = `Lower ${cand.name} correlates with worse flares (${bestLag.label.toLowerCase()}: avg ${avgLow}/10 when low vs ${avgHigh}/10 when high, r = ${bestLag.score.toFixed(2)}).`;
      }

      results.push({
        variableId: cand.id,
        variableName: cand.name,
        category: cand.category,
        valueType: cand.valueType,
        unit: cand.unit,
        bestLag,
        allLags,
        direction,
        pattern,
        confidence,
        exposureCount,
        totalDaysAnalyzed: dateAxis.length,
        avgSeverityWhenHigh: avgHigh,
        avgSeverityWhenLow: avgLow,
        typicalLagHours,
        typicalLagDescription,
        summary,
        timeline,
        exposureFlarePairs: pairs,
      });
    }

    results.sort((a, b) => Math.abs(b.bestLag.score) - Math.abs(a.bestLag.score));
    return results;
  }

  function parseTimeHHMM(str, fallback = 9) {
    const m = /^(\d{1,2}):(\d{2})$/.exec((str || '').trim());
    if (!m) return { hour: fallback, minute: 0 };
    return { hour: Math.min(23, Math.max(0, Number(m[1]))), minute: Math.min(59, Math.max(0, Number(m[2]))) };
  }

  function formatTime12h(str) {
    const { hour, minute } = parseTimeHHMM(str, 9);
    const p = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 === 0 ? 12 : hour % 12;
    return `${h}:${String(minute).padStart(2, '0')} ${p}`;
  }

  function getMostRecentScheduledSlot(settings, now = new Date()) {
    const am = parseTimeHHMM(settings.morningInsightTime, 9);
    const pm = parseTimeHHMM(settings.eveningInsightTime, 21);
    const tAm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), am.hour, am.minute, 0);
    const tPm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), pm.hour, pm.minute, 0);
    if (now >= tPm) {
      return { slot: 'evening', dateKey: toDateKey(now), label: `${formatTime12h(settings.eveningInsightTime)} Evening Digest` };
    }
    if (now >= tAm) {
      return { slot: 'morning', dateKey: toDateKey(now), label: `${formatTime12h(settings.morningInsightTime)} Morning Brief` };
    }
    const yPm = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, pm.hour, pm.minute, 0);
    return { slot: 'evening', dateKey: toDateKey(yPm), label: `${formatTime12h(settings.eveningInsightTime)} Evening Digest` };
  }

  function getNextScheduledRun(settings, now = new Date()) {
    const am = parseTimeHHMM(settings.morningInsightTime, 9);
    const pm = parseTimeHHMM(settings.eveningInsightTime, 21);
    const cands = [
      { slot: 'morning', dt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), am.hour, am.minute, 0), timeStr: settings.morningInsightTime },
      { slot: 'evening', dt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), pm.hour, pm.minute, 0), timeStr: settings.eveningInsightTime },
      { slot: 'morning', dt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, am.hour, am.minute, 0), timeStr: settings.morningInsightTime },
    ];
    const next = cands.find((c) => c.dt > now) || cands[2];
    const diffMin = Math.max(1, Math.round((next.dt - now) / 60000));
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return { ...next, countdown: h > 0 ? `in ${h}h ${m}m` : `in ${m}m` };
  }

  function generateInsightsReport({ eczemaLogs, measurements, variableDefinitions, slot, scheduledForLabel, conditionName = 'Symptom', now = new Date() }) {
    const allResults = analyzeCorrelations(eczemaLogs, measurements, variableDefinitions);
    const topTriggers = allResults.filter((r) => r.direction === 'trigger' && Math.abs(r.bestLag.score) >= 0.28).slice(0, 6);
    const topProtective = allResults.filter((r) => r.direction === 'protective' && Math.abs(r.bestLag.score) >= 0.28).slice(0, 4);

    const activeAlerts = [];
    for (const trig of topTriggers.slice(0, 5)) {
      const recent = measurements
        .filter((m) => m.variableId === trig.variableId && now - new Date(m.timestamp) <= 72 * 3600000 && now >= new Date(m.timestamp))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      if (!recent.length) continue;
      const latest = recent[0];
      const isBin = trig.valueType === 'boolean' || trig.category === 'food_ingredient';
      let sig = false;
      if (isBin) sig = latest.numericValue > 0;
      else {
        const avg = mean(measurements.filter((m) => m.variableId === trig.variableId).map((m) => m.numericValue));
        sig = latest.numericValue >= Math.max(avg * 1.15, avg + 0.5);
      }
      if (!sig) continue;
      const hoursSince = (now - new Date(latest.timestamp)) / 3600000;
      const hoursUntil = Math.round(trig.typicalLagHours - hoursSince);
      if (hoursUntil >= -12 && hoursUntil <= 60) {
        activeAlerts.push({
          conditionName,
          variableId: trig.variableId,
          variableName: trig.variableName,
          expectedPeakWindowLabel: hoursUntil <= 0 ? 'Peak reaction window active now' : `Expected peak in ~${formatLagHours(hoursUntil)}`,
          riskLevel: trig.confidence === 'high' ? 'high' : 'moderate',
          reason: `Exposed ${formatLagHours(hoursSince)} ago; ${conditionName} historically peaks ~${formatLagHours(trig.typicalLagHours)} after exposure (r = +${trig.bestLag.score.toFixed(2)}).`,
        });
      }
    }

    const slotTitle = slot === 'morning' ? `Morning ${conditionName} Forecast` : slot === 'evening' ? `Evening ${conditionName} Digest` : `${conditionName} Analysis`;
    const lead = topTriggers[0];
    const headline = lead ? `${slotTitle}: ${lead.variableName} is your strongest signal (${lead.bestLag.shortLabel})` : `${slotTitle}: Log daily to uncover ${conditionName.toLowerCase()} triggers`;

    const summaryParts = [];
    if (topTriggers.length) {
      summaryParts.push(`Top suspected ${conditionName.toLowerCase()} drivers: ` + topTriggers.slice(0, 3).map((t) => `${t.variableName} (${t.bestLag.label}, r=+${t.bestLag.score.toFixed(2)})`).join(', ') + '.');
    }
    if (topProtective.length) {
      summaryParts.push(`Protective factor: higher ${topProtective[0].variableName} correlates with milder ${conditionName.toLowerCase()} (r=${topProtective[0].bestLag.score.toFixed(2)}).`);
    }
    if (activeAlerts.length) {
      summaryParts.push(`${activeAlerts.length} active exposure window(s) to watch over the next 24–48h.`);
    }

    return {
      id: `rep_${toDateKey(now)}_${slot}_${now.getTime()}`,
      generatedAt: now.toISOString(),
      dateKey: toDateKey(now),
      slot,
      conditionName,
      scheduledForLabel,
      headline,
      narrativeSummary: summaryParts.join(' ') || `Keep logging ${conditionName.toLowerCase()} daily to uncover personal trigger patterns.`,
      topTriggers,
      topProtective,
      allResults,
      activeAlerts,
      daysAnalyzed: new Set(eczemaLogs.map((l) => l.dateKey)).size,
    };
  }

  function buildDemoDataset(refDate = new Date()) {
    const days = 21;
    const eczemaLogs = [];
    const measurements = [];
    const foodEntries = [];
    const customVariables = [
      {
        id: 'custom_hot_shower',
        name: 'Long Hot Shower (>15m)',
        category: 'custom',
        valueType: 'boolean',
        description: 'Extended hot shower that can dry out the skin barrier.',
        autoCollected: false,
        isCustom: true,
        isActive: true,
      },
    ];

    const noise = (i, s) => Math.sin(i * 12.9898 + s * 78.233) * 0.5;
    const dairyDays = new Set([1, 5, 10, 14, 19]);
    const pollenDays = new Set([3, 8, 13, 17, 20]);
    const tomatoDays = new Set([2, 8, 15]);
    const glutenDays = new Set([0, 2, 4, 6, 9, 11, 13, 16, 18, 20]);
    const eggDays = new Set([1, 3, 7, 12, 16, 19]);
    const showerDays = new Set([3, 6, 11, 15, 18]);

    const stressS = [], humS = [], polS = [], sleepS = [];
    for (let i = 0; i < days; i++) {
      const streak = (i >= 4 && i <= 6) || (i >= 13 && i <= 16);
      stressS.push(streak ? Math.min(10, Math.round(7.8 + noise(i, 1) * 2)) : Math.max(1, Math.round(3.2 + noise(i, 2) * 2)));
      const dry = (i >= 5 && i <= 7) || (i >= 14 && i <= 16) || i === 20;
      humS.push(dry ? Math.round(28 + noise(i, 3) * 8) : Math.round(58 + noise(i, 4) * 14));
      polS.push(pollenDays.has(i) ? Math.round(78 + noise(i, 5) * 16) : Math.round(20 + noise(i, 6) * 14));
      sleepS.push(Number((streak ? 5.4 + noise(i, 7) * 0.9 : 7.5 + noise(i, 8) * 1.1).toFixed(1)));
    }

    for (let i = 0; i < days; i++) {
      const dt = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() - (days - 1 - i), 12, 0, 0);
      const dk = toDateKey(dt);
      const season = getSeasonForLocation(dt);

      const s3 = (stressS[i] + stressS[Math.max(0, i - 1)] + stressS[Math.max(0, i - 2)]) / 3;
      const h2 = (humS[i] + humS[Math.max(0, i - 1)]) / 2;
      const rawSev =
        1.8 +
        (dairyDays.has(i - 1) ? 3.8 : 0) +
        (polS[i] > 60 ? 2.5 : 0) +
        (tomatoDays.has(i - 2) ? 1.7 : 0) +
        (s3 > 6.5 ? 2.1 : s3 > 5 ? 0.8 : 0) +
        (h2 < 38 ? 1.5 : h2 > 58 ? -0.6 : 0) +
        (sleepS[i] < 6 ? 0.9 : sleepS[i] >= 7.5 ? -0.4 : 0) +
        (showerDays.has(i) ? 0.9 : 0) +
        noise(i, 9) * 0.7;

      const pmSev = Math.max(0, Math.min(10, Math.round(rawSev)));
      const amSev = Math.max(0, Math.min(10, Math.round(pmSev * 0.65 + (dairyDays.has(i - 1) ? 1.2 : 0))));
      const areas = pmSev >= 6 ? ['hands', 'inner_elbows', 'neck'] : pmSev >= 4 ? ['hands', 'wrists'] : ['hands'];

      const amTs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 8, 30, 0).toISOString();
      eczemaLogs.push({ id: `d_am_${i}`, conditionId: 'cond_eczema', timestamp: amTs, dateKey: dk, severity: amSev, itchLevel: Math.min(10, amSev + 1), rednessLevel: Math.max(0, amSev - 1), drynessLevel: amSev, affectedAreas: areas, timeOfDay: 'morning', season });

      if (i < days - 1 || refDate.getHours() >= 19) {
        const pmTs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 19, 30, 0).toISOString();
        eczemaLogs.push({ id: `d_pm_${i}`, conditionId: 'cond_eczema', timestamp: pmTs, dateKey: dk, severity: pmSev, itchLevel: Math.min(10, pmSev + 1), rednessLevel: pmSev, drynessLevel: pmSev, affectedAreas: areas, timeOfDay: 'evening', season, notes: pmSev >= 7 ? 'Evening flare-up; applied moisturizer.' : undefined });
      }

      // Realistic Stomach Pain demo logs: reacts same-day (~4h) to Dairy & Tomato/Acid + high Stress
      const rawStomach =
        1.1 +
        (dairyDays.has(i) ? 4.2 : 0) +
        (tomatoDays.has(i) ? 2.6 : 0) +
        (stressS[i] >= 7 ? 1.8 : 0) +
        noise(i, 21) * 0.8;
      const stomachSev = Math.max(0, Math.min(10, Math.round(rawStomach)));
      const giTs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 17, 15, 0).toISOString();
      eczemaLogs.push({
        id: `d_gi_${i}`,
        conditionId: 'cond_stomach_pain',
        timestamp: giTs,
        dateKey: dk,
        severity: stomachSev,
        itchLevel: stomachSev,
        rednessLevel: Math.max(0, stomachSev - 1),
        drynessLevel: Math.max(0, stomachSev - 2),
        affectedAreas: stomachSev >= 5 ? ['Upper Abdomen', 'Lower Abdomen'] : ['Upper Abdomen'],
        timeOfDay: 'evening',
        season,
        notes: stomachSev >= 6 ? 'Cramping & bloating a few hours after meal.' : undefined,
      });

      // Realistic Acne demo logs: delayed ~48h after Dairy + 3-day cumulative Stress + short sleep
      const rawAcne =
        1.4 +
        (dairyDays.has(i - 2) ? 3.5 : 0) +
        (s3 > 6.5 ? 2.4 : s3 > 5 ? 0.9 : 0) +
        (sleepS[i - 1] !== undefined && sleepS[i - 1] < 6.2 ? 1.5 : 0) +
        noise(i, 22) * 0.7;
      const acneSev = Math.max(0, Math.min(10, Math.round(rawAcne)));
      eczemaLogs.push({
        id: `d_acne_${i}`,
        conditionId: 'cond_acne',
        timestamp: amTs,
        dateKey: dk,
        severity: acneSev,
        itchLevel: acneSev,
        rednessLevel: acneSev,
        drynessLevel: Math.min(10, acneSev + 1),
        affectedAreas: acneSev >= 5 ? ['Jawline / Chin', 'Cheeks'] : ['Forehead'],
        timeOfDay: 'morning',
        season,
        notes: acneSev >= 6 ? 'New inflammatory breakouts along jawline.' : undefined,
      });

      const envTs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 10, 0, 0).toISOString();
      measurements.push(
        { id: `d_hum_${i}`, variableId: 'var_humidity', variableName: 'Humidity', category: 'environment', timestamp: envTs, dateKey: dk, numericValue: humS[i], unit: '%', source: 'auto_weather_api' },
        { id: `d_tmp_${i}`, variableId: 'var_temperature', variableName: 'Temperature', category: 'environment', timestamp: envTs, dateKey: dk, numericValue: Number((13 + Math.sin(i * 0.45) * 5).toFixed(1)), unit: '°C', source: 'auto_weather_api' },
        { id: `d_pol_${i}`, variableId: 'var_local_allergens', variableName: 'Local Allergens (Pollen & AQI)', category: 'environment', timestamp: envTs, dateKey: dk, numericValue: polS[i], unit: 'idx', source: 'auto_pollen_api' },
        { id: `d_uv_${i}`, variableId: 'var_uv_index', variableName: 'UV Index', category: 'environment', timestamp: envTs, dateKey: dk, numericValue: Number(Math.max(1, 3.5 + Math.cos(i * 0.5) * 2.5).toFixed(1)), unit: 'UV', source: 'auto_weather_api' },
        { id: `d_str_${i}`, variableId: 'var_stress', variableName: 'Stress Level', category: 'lifestyle', timestamp: envTs, dateKey: dk, numericValue: stressS[i], unit: '/10', source: 'manual' },
        { id: `d_slp_${i}`, variableId: 'var_sleep_duration', variableName: 'Sleep Duration', category: 'lifestyle', timestamp: amTs, dateKey: dk, numericValue: sleepS[i], unit: 'hrs', source: 'auto_health' },
        { id: `d_slq_${i}`, variableId: 'var_sleep_quality', variableName: 'Sleep Quality', category: 'lifestyle', timestamp: amTs, dateKey: dk, numericValue: Math.max(1, Math.min(10, Math.round(sleepS[i] + 1))), unit: '/10', source: 'auto_health' },
        { id: `d_hrv_${i}`, variableId: 'var_hrv', variableName: 'Heart Rate Variability (HRV)', category: 'lifestyle', timestamp: amTs, dateKey: dk, numericValue: Math.round(sleepS[i] < 6.2 ? 38 + noise(i, 12) * 8 : 66 + noise(i, 13) * 10), unit: 'ms', source: 'auto_health' },
        { id: `d_rhr_${i}`, variableId: 'var_resting_hr', variableName: 'Resting Heart Rate', category: 'lifestyle', timestamp: amTs, dateKey: dk, numericValue: Math.round(stressS[i] > 6 ? 65 + noise(i, 14) * 3 : 55 + noise(i, 15) * 3), unit: 'bpm', source: 'auto_health' },
        { id: `d_scr_${i}`, variableId: 'var_screen_time', variableName: 'Screen Time', category: 'lifestyle', timestamp: envTs, dateKey: dk, numericValue: Number((4.5 + (stressS[i] > 6 ? 2.5 : 0.4)).toFixed(1)), unit: 'hrs', source: 'auto_screentime' },
        { id: `d_exe_${i}`, variableId: 'var_exercise', variableName: 'Exercise Quantity', category: 'lifestyle', timestamp: envTs, dateKey: dk, numericValue: Math.max(10, Math.round(35 + Math.sin(i * 0.8) * 22)), unit: 'min', source: 'auto_pedometer' }
      );

      if (showerDays.has(i)) {
        measurements.push({ id: `d_shw_${i}`, variableId: 'custom_hot_shower', variableName: 'Long Hot Shower (>15m)', category: 'custom', timestamp: new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 17, 0, 0).toISOString(), dateKey: dk, numericValue: 1, source: 'manual' });
      }

      const meals = [];
      if (dairyDays.has(i)) {
        meals.push({
          dishName: i % 2 === 0 ? 'Iced Vanilla Latte & Cheddar Croissant' : 'Creamy Mushroom Pasta',
          mealType: 'lunch',
          hour: 13,
          ingredients: [
            { name: "Dairy (Cow's Milk)", normalizedKey: 'dairy', commonEczemaTrigger: true, triggerGroup: 'Dairy / Casein' },
            { name: 'Wheat / Gluten', normalizedKey: 'wheat_gluten', commonEczemaTrigger: true, triggerGroup: 'Gluten' },
            { name: 'Caffeine', normalizedKey: 'caffeine', commonEczemaTrigger: false },
          ],
        });
      }
      if (tomatoDays.has(i)) {
        meals.push({
          dishName: 'Margherita Flatbread & Tomato Soup',
          mealType: 'dinner',
          hour: 18,
          ingredients: [
            { name: 'Tomato (Nightshade)', normalizedKey: 'tomato_nightshade', commonEczemaTrigger: true, triggerGroup: 'Nightshades / Histamine' },
            { name: 'Olive Oil', normalizedKey: 'olive_oil', commonEczemaTrigger: false },
          ],
        });
      }
      if (glutenDays.has(i) && !dairyDays.has(i)) {
        meals.push({
          dishName: 'Avocado Sourdough Toast',
          mealType: 'breakfast',
          hour: 9,
          ingredients: [
            { name: 'Wheat / Gluten', normalizedKey: 'wheat_gluten', commonEczemaTrigger: true, triggerGroup: 'Gluten' },
            { name: 'Avocado', normalizedKey: 'avocado', commonEczemaTrigger: false },
          ],
        });
      }
      if (eggDays.has(i)) {
        meals.push({
          dishName: 'Veggie Omelette & Green Tea',
          mealType: 'breakfast',
          hour: 8,
          ingredients: [
            { name: 'Eggs', normalizedKey: 'eggs', commonEczemaTrigger: true, triggerGroup: 'Eggs' },
            { name: 'Spinach', normalizedKey: 'spinach', commonEczemaTrigger: false },
          ],
        });
      }

      meals.forEach((meal, mIdx) => {
        const ts = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), meal.hour, 15, 0).toISOString();
        const fid = `d_food_${i}_${mIdx}`;
        const ings = meal.ingredients.map((ing, k) => ({ ...ing, id: `${fid}_${k}`, included: true }));
        foodEntries.push({ id: fid, timestamp: ts, dateKey: dk, dishName: meal.dishName, mealType: meal.mealType, analyzedByGemini: true, confidence: 0.93, ingredients: ings });
        ings.forEach((ing) => {
          measurements.push({ id: `d_m_${fid}_${ing.normalizedKey}`, variableId: `ingredient:${ing.normalizedKey}`, variableName: ing.name, category: 'food_ingredient', timestamp: ts, dateKey: dk, numericValue: 1, source: 'gemini_vision', foodEntryId: fid });
        });
      });
    }

    return { eczemaLogs, measurements, foodEntries, customVariables };
  }

  async function fetchLiveWeatherAndPollen() {
    let lat, lon, locationName;

    // 1. Try browser GPS first (works on HTTPS / localhost)
    if (navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4500 })
        );
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      } catch (_) {}
    }

    // 2. Automatic IP geolocation fallback (works over plain HTTP on local Wi-Fi!)
    if (lat === undefined) {
      try {
        const ipRes = await fetch('https://ipwho.is/').then((r) => r.json());
        if (ipRes && ipRes.success) {
          lat = ipRes.latitude;
          lon = ipRes.longitude;
          locationName = [ipRes.city, ipRes.region].filter(Boolean).join(', ');
        }
      } catch (_) {}
    }

    if (lat === undefined) {
      throw new Error('Could not determine location automatically.');
    }

    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,weather_code,uv_index&timezone=auto`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=us_aqi,pm2_5,birch_pollen,grass_pollen,ragweed_pollen,alder_pollen,mugwort_pollen&timezone=auto`;

    const [wJson, aqJson] = await Promise.all([
      fetch(wUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(aqUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    const cur = (wJson && wJson.current) || {};
    const aq = (aqJson && aqJson.current) || {};
    const totalPollen = (aq.birch_pollen || 0) + (aq.grass_pollen || 0) + (aq.ragweed_pollen || 0) + (aq.alder_pollen || 0) + (aq.mugwort_pollen || 0);
    const pollenIndex = Math.round(Math.min(100, Math.min(75, (totalPollen / 120) * 75) + (aq.us_aqi ? Math.min(25, (aq.us_aqi / 150) * 25) : 0)));

    return {
      capturedAt: new Date().toISOString(),
      locationName: locationName || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      latitude: lat,
      longitude: lon,
      temperatureC: typeof cur.temperature_2m === 'number' ? Number(cur.temperature_2m.toFixed(1)) : undefined,
      humidityPct: typeof cur.relative_humidity_2m === 'number' ? Math.round(cur.relative_humidity_2m) : undefined,
      uvIndex: typeof cur.uv_index === 'number' ? Number(cur.uv_index.toFixed(1)) : undefined,
      pollenIndex,
      usAqi: aq.us_aqi,
      season: getSeasonForLocation(new Date(), lat),
      timeOfDay: getTimeOfDayBucket(new Date()),
    };
  }

  const DEPRECATED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']);
  const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
  const RETRIABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

  function sanitizeGeminiModel(model) {
    if (!model || DEPRECATED_MODELS.has(model)) return DEFAULT_GEMINI_MODEL;
    return model;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseGeminiErrorBody(status, rawText) {
    let apiMessage = '';
    try {
      const parsed = JSON.parse(rawText);
      apiMessage = parsed?.error?.message || '';
    } catch (_) {
      apiMessage = (rawText || '').slice(0, 180);
    }

    if (status === 503) {
      return {
        code: 503,
        retriable: true,
        userMessage: 'Gemini is currently experiencing high demand (HTTP 503). Automatic retries and backup models were also busy—please retry in a moment or log ingredients manually.',
        detail: apiMessage || 'Service temporarily overloaded.',
      };
    }
    if (status === 429) {
      return {
        code: 429,
        retriable: true,
        userMessage: 'Gemini rate limit or quota temporarily reached (HTTP 429). Wait a few seconds and retry, or log ingredients manually.',
        detail: apiMessage || 'Too many requests.',
      };
    }
    if (status === 401 || status === 403) {
      return {
        code: status,
        retriable: false,
        userMessage: 'Gemini API key was rejected (HTTP ' + status + '). Please verify your API key in Settings.',
        detail: apiMessage || 'Authentication error.',
      };
    }
    if (status === 404) {
      return {
        code: 404,
        retriable: false,
        userMessage: 'Selected Gemini model is unavailable (HTTP 404). Open Settings → Test Connection to select an active model.',
        detail: apiMessage || 'Model not found.',
      };
    }
    if (status >= 500) {
      return {
        code: status,
        retriable: true,
        userMessage: `Gemini server error (HTTP ${status}). This is usually temporary—please retry or log ingredients manually.`,
        detail: apiMessage || 'Temporary server error.',
      };
    }
    return {
      code: status,
      retriable: false,
      userMessage: `Gemini request failed (HTTP ${status}): ${apiMessage || 'Unknown error'}`,
      detail: apiMessage,
    };
  }

  async function discoverAvailableGeminiModels(apiKey, excludeSet = new Set()) {
    const knownBackups = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite']
      .filter((id) => !excludeSet.has(id));
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`);
      if (!res.ok) return knownBackups;
      const data = await res.json();
      const models = (data.models || [])
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((id) =>
          id.startsWith('gemini-') &&
          !excludeSet.has(id) &&
          !DEPRECATED_MODELS.has(id) &&
          !/(embedding|tts|imagen|veo|aqa|audio|robotics|1\.0|1\.5|2\.0|2\.5)/i.test(id)
        );
      if (!models.length) return knownBackups;
      const scoreModel = (id) => {
        let s = 0;
        if (id === 'gemini-flash-latest') s += 50;
        if (id.includes('flash') && !id.includes('lite')) s += 40;
        else if (id.includes('flash')) s += 35;
        else if (id.includes('pro')) s += 20;
        if (!id.includes('preview') && !id.includes('exp')) s += 15;
        const ver = /gemini-(\d+(?:\.\d+)?)/.exec(id);
        if (ver) s += parseFloat(ver[1]) * 10;
        return s;
      };
      models.sort((a, b) => scoreModel(b) - scoreModel(a));
      return models;
    } catch (_) {
      return knownBackups;
    }
  }

  async function postGeminiGenerate(apiKey, model, payload, timeoutMs = 25000) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Calls Gemini with:
   * 1) Exponential backoff + jitter retries on 503/429/5xx/network errors
   * 2) Automatic backup model failover on persistent 503/429 or 404
   * 3) Live progress updates via onStatus()
   */
  async function callGeminiWithResilience({ apiKey, model, payload, onStatus, maxRetriesPrimary = 2 }) {
    const primaryModel = sanitizeGeminiModel(model);
    const triedModels = new Set([primaryModel]);
    let lastError = null;
    let shouldPersistResolvedModel = false;

    const attemptModel = async (targetModel, maxRetries) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const baseDelay = attempt === 1 ? 1200 : 2800;
          const jitter = Math.round(Math.random() * 450);
          const waitMs = baseDelay + jitter;
          if (onStatus) {
            onStatus(`${targetModel} is busy (high demand) — retrying in ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries + 1})…`);
          }
          await sleep(waitMs);
        }

        try {
          const res = await postGeminiGenerate(apiKey, targetModel, payload);
          if (res.ok) {
            return { ok: true, response: res, model: targetModel };
          }

          const rawText = await res.text().catch(() => '');
          const parsedErr = parseGeminiErrorBody(res.status, rawText);
          lastError = { ...parsedErr, model: targetModel };

          // 404 means model is invalid/deprecated -> don't retry same model, immediately failover
          if (res.status === 404) {
            shouldPersistResolvedModel = true;
            return { ok: false, status: 404, error: lastError };
          }

          // Non-retriable client error (e.g. 400 bad request, 401/403 invalid key) -> fail fast
          if (!RETRIABLE_HTTP_STATUSES.has(res.status)) {
            return { ok: false, status: res.status, error: lastError, fatal: true };
          }

          // Respect Retry-After header if reasonable (<= 6s)
          const retryAfterSec = parseInt(res.headers.get('retry-after') || '', 10);
          if (!Number.isNaN(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 6 && attempt < maxRetries) {
            if (onStatus) onStatus(`Server asked to wait ${retryAfterSec}s before retrying ${targetModel}…`);
            await sleep(retryAfterSec * 1000);
          }
        } catch (netErr) {
          const isTimeout = netErr && netErr.name === 'AbortError';
          lastError = {
            code: 0,
            retriable: true,
            model: targetModel,
            userMessage: isTimeout
              ? 'Request to Gemini timed out. Check your connection and retry, or log ingredients manually.'
              : 'Network error reaching Gemini. Check your internet connection or log ingredients manually.',
            detail: netErr?.message || 'Network failure',
          };
        }
      }
      return { ok: false, status: lastError?.code || 503, error: lastError };
    };

    // 1. Try primary model with exponential backoff
    if (onStatus) onStatus(`Analyzing with ${primaryModel}…`);
    const primaryRes = await attemptModel(primaryModel, maxRetriesPrimary);
    if (primaryRes.ok) {
      return {
        response: primaryRes.response,
        resolvedModel: primaryModel,
        usedBackupModel: false,
        shouldPersistModel: false,
      };
    }
    if (primaryRes.fatal) {
      const err = new Error(primaryRes.error.userMessage);
      err.geminiError = primaryRes.error;
      throw err;
    }

    // 2. Failover to up to 2 alternative available Gemini models (helps when one model has a 503 demand spike or 404!)
    if (onStatus) {
      onStatus(
        primaryRes.status === 404
          ? `${primaryModel} unavailable — discovering an active Gemini model…`
          : `${primaryModel} is experiencing high demand — trying a backup Gemini model…`
      );
    }
    const backups = (await discoverAvailableGeminiModels(apiKey, triedModels)).slice(0, 2);
    for (const backupModel of backups) {
      triedModels.add(backupModel);
      if (onStatus) onStatus(`Trying backup model ${backupModel}…`);
      const backupRes = await attemptModel(backupModel, 1);
      if (backupRes.ok) {
        return {
          response: backupRes.response,
          resolvedModel: backupModel,
          usedBackupModel: true,
          shouldPersistModel: shouldPersistResolvedModel,
        };
      }
      if (backupRes.fatal) {
        const err = new Error(backupRes.error.userMessage);
        err.geminiError = backupRes.error;
        throw err;
      }
    }

    // 3. All retries & backup models exhausted -> throw structured graceful error
    const finalMsg = lastError?.userMessage || 'Gemini is temporarily unavailable. Please retry or log ingredients manually.';
    const err = new Error(finalMsg);
    err.geminiError = lastError || { code: 503, retriable: true, userMessage: finalMsg };
    throw err;
  }

  async function testGeminiConnection(apiKey, model, onStatus, proxyOpts) {
    const proxyUrl = proxyOpts && proxyOpts.proxyUrl ? String(proxyOpts.proxyUrl).replace(/\/+$/, '') : '';
    const proxyToken = proxyOpts && proxyOpts.proxyToken ? String(proxyOpts.proxyToken) : '';

    if (proxyUrl) {
      if (onStatus) onStatus('Testing secure Cloudflare Worker proxy…');
      try {
        const res = await fetch(`${proxyUrl}/gemini/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(proxyToken ? { Authorization: `Bearer ${proxyToken}` } : {}),
          },
          body: JSON.stringify({ model: sanitizeGeminiModel(model) }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          return { ok: false, message: 'Proxy session expired or not signed in via proxy. Lock and sign in with your Worker password.' };
        }
        if (!res.ok || !data.ok) {
          return { ok: false, message: data.error || `Proxy returned HTTP ${res.status}.` };
        }
        return {
          ok: true,
          resolvedModel: data.resolvedModel,
          shouldPersistModel: Boolean(data.usedBackupModel),
          message: data.message || `Connected securely via proxy (${data.resolvedModel})!`,
        };
      } catch (err) {
        return { ok: false, message: err.message || 'Unable to reach Cloudflare Worker proxy.' };
      }
    }

    if (!apiKey || !apiKey.trim()) return { ok: false, message: 'Enter a Gemini API key (or configure a Cloudflare Worker Proxy URL) first.' };
    const payload = { contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }] };
    try {
      const result = await callGeminiWithResilience({
        apiKey,
        model,
        payload,
        onStatus,
        maxRetriesPrimary: 1,
      });
      return {
        ok: true,
        resolvedModel: result.resolvedModel,
        shouldPersistModel: result.shouldPersistModel || result.usedBackupModel,
        message: result.usedBackupModel
          ? `Connected using backup model ${result.resolvedModel}!`
          : `Connected successfully using ${result.resolvedModel}!`,
      };
    } catch (err) {
      return { ok: false, message: err.message || 'Unable to connect to Gemini.' };
    }
  }

  async function analyzeFoodWithGemini({ apiKey, proxyUrl, proxyToken, model, imageBase64, mimeType = 'image/jpeg', textHint, onStatus }) {
    const cleanProxy = proxyUrl ? String(proxyUrl).replace(/\/+$/, '') : '';
    if (cleanProxy) {
      if (onStatus) onStatus('Analyzing meal securely via FlareLens Worker proxy…');
      const res = await fetch(`${cleanProxy}/gemini/food-analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(proxyToken ? { Authorization: `Bearer ${proxyToken}` } : {}),
        },
        body: JSON.stringify({
          model: sanitizeGeminiModel(model),
          imageBase64,
          mimeType,
          textHint,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        const err = new Error('Your proxy session expired. Tap 🔒 Lock and sign in again.');
        err.geminiError = { code: 401, retriable: false, userMessage: err.message };
        throw err;
      }
      if (!res.ok) {
        const msg = data.error || `Proxy error (HTTP ${res.status}). Please retry or log ingredients manually.`;
        const err = new Error(msg);
        err.geminiError = { code: res.status, retriable: Boolean(data.retriable || res.status === 503), userMessage: msg };
        throw err;
      }
      return {
        ...data,
        dishes: Array.isArray(data.dishes) ? data.dishes : [],
        ingredients: dedupeIngredients(data.ingredients || []),
      };
    }

    if (!apiKey || !apiKey.trim()) {
      const lower = (textHint || '').toLowerCase();
      const splitDishes = (textHint || '')
        .split(/[\n,]+|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
      const mk = (name, cat, trig, grp, notes) => ({
        id: `prev_${normalizeIngredientKey(name)}_${Math.random().toString(36).slice(2, 6)}`,
        name, normalizedKey: normalizeIngredientKey(name), category: cat, commonEczemaTrigger: trig, triggerGroup: grp, notes, included: true,
      });
      if (lower.includes('latte') || lower.includes('coffee')) {
        return {
          dishName: textHint || 'Iced Vanilla Latte',
          dishes: splitDishes.length ? splitDishes : ['Iced Vanilla Latte'],
          mealType: 'beverage',
          confidence: 0.78,
          analyzedByGemini: false,
          summary: 'Preview Mode (connect AI in Settings for live multi-dish parsing).',
          ingredients: [
            mk("Dairy (Cow's Milk)", 'Dairy', true, 'Dairy / Casein', 'Milk base'),
            mk('Caffeine', 'Beverage', false, '', 'Espresso'),
            mk('Refined Sugar', 'Sweetener', true, 'Sugar', 'Vanilla syrup'),
          ],
        };
      }
      return {
        dishName: textHint || 'Scanned Meal (Preview Mode)',
        dishes: splitDishes,
        mealType: 'lunch',
        confidence: 0.74,
        analyzedByGemini: false,
        summary: 'Preview Mode active — connect AI in Settings for live photo & multi-dish ingredient recognition.',
        ingredients: [
          mk("Dairy (Cow's Milk)", 'Dairy', true, 'Dairy / Casein', 'Butter, cheese, or cream'),
          mk('Wheat / Gluten', 'Grain', true, 'Gluten', 'Bread, pasta, or flour'),
          mk('Tomato (Nightshade)', 'Produce', true, 'Nightshades / Histamine', 'Sauce or fresh tomato'),
          mk('Soy', 'Legume', true, 'Soy', 'Common in dressings or sauces'),
        ],
      };
    }

    const prompt = `You are a health & nutrition assistant helping a user track food and beverage triggers for symptoms like eczema, stomach pain/GI issues, acne, migraines, and allergies.
The user may provide a photo and/or text describing ONE OR MULTIPLE dishes, sides, and beverages eaten together (separated by commas, "and", or new lines).
1. Identify EVERY dish and beverage mentioned or pictured and list them in the "dishes" array.
2. List ALL typical & hidden ingredients across ALL dishes (dairy/milk/butter/cheese, wheat/gluten, soy, eggs, nuts, nightshades/tomato, shellfish, citrus, high-FODMAP/garlic/onion, histamine-rich/fermented items, caffeine, alcohol, refined sugar, spicy peppers, seed/cooking oils).
3. DEDUPLICATE shared ingredients across dishes: output ONE normalized ingredient entry (e.g., "Dairy (Cow's Milk)", "Wheat / Gluten", "Tomato (Nightshade)", "Soy", "Eggs") and list the dish names in "foundIn".
4. Set "dishName" to a concise combined title for all dishes. Return ONLY valid JSON.`;

    const parts = [{ text: prompt }];
    if (textHint && textHint.trim()) parts.push({ text: `User description: ${textHint.trim()}` });
    if (imageBase64) parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });

    const schema = {
      type: 'OBJECT',
      properties: {
        dishName: { type: 'STRING' },
        dishes: { type: 'ARRAY', items: { type: 'STRING' } },
        mealType: { type: 'STRING', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'beverage'] },
        confidence: { type: 'NUMBER' },
        summary: { type: 'STRING' },
        ingredients: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING' },
              category: { type: 'STRING' },
              commonEczemaTrigger: { type: 'BOOLEAN' },
              triggerGroup: { type: 'STRING' },
              foundIn: { type: 'STRING' },
              notes: { type: 'STRING' },
            },
            required: ['name', 'category', 'commonEczemaTrigger'],
          },
        },
      },
      required: ['dishName', 'mealType', 'confidence', 'summary', 'ingredients'],
    };

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    };

    const callResult = await callGeminiWithResilience({
      apiKey,
      model,
      payload,
      onStatus,
      maxRetriesPrimary: 2,
    });

    const json = await callResult.response.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Gemini returned an empty response. Please retry or log ingredients manually.');
    const parsed = JSON.parse(raw);
    const dishes = Array.isArray(parsed.dishes)
      ? parsed.dishes.map((d) => String(d || '').trim()).filter(Boolean)
      : [];

    return {
      dishName: parsed.dishName || (dishes.length ? dishes.join(', ') : textHint) || 'Scanned Meal',
      dishes,
      mealType: parsed.mealType || 'lunch',
      confidence: parsed.confidence || 0.88,
      summary: callResult.usedBackupModel
        ? `${parsed.summary || 'Ingredients extracted by Gemini.'} (Analyzed via backup model ${callResult.resolvedModel})`
        : (parsed.summary || 'Ingredients extracted by Gemini Vision.'),
      analyzedByGemini: true,
      resolvedModel: callResult.resolvedModel,
      shouldPersistModel: callResult.shouldPersistModel,
      ingredients: dedupeIngredients(parsed.ingredients || []),
    };
  }

  function buildManualFallbackDraft(textHint) {
    const mk = (name, cat, grp, included) => ({
      id: `man_${normalizeIngredientKey(name)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      normalizedKey: normalizeIngredientKey(name),
      category: cat,
      commonEczemaTrigger: true,
      triggerGroup: grp,
      notes: 'Tap to include if present in this meal.',
      included,
    });
    return {
      dishName: (textHint || '').trim() || 'My Meal',
      mealType: 'lunch',
      confidence: 0,
      analyzedByGemini: false,
      summary: 'Manual entry mode — check any ingredients present or type your own below.',
      ingredients: [
        mk("Dairy (Cow's Milk)", 'Dairy', 'Dairy / Casein', false),
        mk('Wheat / Gluten', 'Grain', 'Gluten', false),
        mk('Eggs', 'Protein', 'Eggs', false),
        mk('Soy', 'Legume', 'Soy', false),
        mk('Tomato (Nightshade)', 'Produce', 'Nightshades', false),
        mk('Tree Nuts / Peanuts', 'Nuts', 'Nuts', false),
        mk('Caffeine', 'Beverage', 'Stimulant', false),
      ],
    };
  }

  global.FlareEngine = {
    STARTER_CONDITIONS,
    STARTER_VARIABLES,
    BODY_AREAS,
    DEFAULT_GEMINI_MODEL,
    sanitizeGeminiModel,
    toDateKey,
    formatLagHours,
    formatTime12h,
    getTimeOfDayBucket,
    getSeasonForLocation,
    normalizeIngredientKey,
    analyzeCorrelations,
    generateInsightsReport,
    getMostRecentScheduledSlot,
    getNextScheduledRun,
    buildDemoDataset,
    fetchLiveWeatherAndPollen,
    analyzeFoodWithGemini,
    testGeminiConnection,
    buildManualFallbackDraft,
  };
})(window);
