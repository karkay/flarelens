(function () {
  'use strict';

  const E = window.FlareEngine;
  const A = window.FlareAuth;
  const H = window.FlareHealth;
  const G = window.FlareGuide;
  const STORAGE_KEY = 'flarelens_web_state_v1';

  // Decrypted AES key lives strictly in JS memory (and optionally sessionStorage until tab closes)
  let sessionAesKey = null;
  let legacyPlainApiKey = '';
  let failedLoginAttempts = 0;
  let lockoutUntilMs = 0;

  const DEFAULT_SETTINGS = {
    geminiApiKey: '', // Kept in RAM only; NEVER persisted in plaintext
    encryptedGeminiKey: null,
    geminiModel: E.DEFAULT_GEMINI_MODEL || 'gemini-3.8-flash',
    morningInsightTime: '09:00',
    eveningInsightTime: '21:00',
    useDemoData: true,
    temperatureUnit: 'C',
  };

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const rawSettings = parsed.settings || {};
        if (rawSettings.geminiApiKey && typeof rawSettings.geminiApiKey === 'string') {
          legacyPlainApiKey = rawSettings.geminiApiKey.trim();
        }
        const mergedSettings = {
          ...DEFAULT_SETTINGS,
          ...rawSettings,
          geminiApiKey: '', // Never hydrate plaintext into state before auth unlock
        };
        mergedSettings.geminiModel = E.sanitizeGeminiModel(mergedSettings.geminiModel);
        return {
          userEczemaLogs: parsed.userEczemaLogs || [],
          userMeasurements: parsed.userMeasurements || [],
          userFoodEntries: parsed.userFoodEntries || [],
          userCustomVariables: parsed.userCustomVariables || [],
          userConditions: Array.isArray(parsed.userConditions) && parsed.userConditions.length
            ? parsed.userConditions
            : E.STARTER_CONDITIONS.filter((c) => c.defaultActive).map((c) => ({ ...c, isActive: true })),
          reportHistory: parsed.reportHistory || [],
          lastMetadata: parsed.lastMetadata || null,
          settings: mergedSettings,
        };
      }
    } catch (_) {}
    return {
      userEczemaLogs: [],
      userMeasurements: [],
      userFoodEntries: [],
      userCustomVariables: [],
      userConditions: E.STARTER_CONDITIONS.filter((c) => c.defaultActive).map((c) => ({ ...c, isActive: true })),
      reportHistory: [],
      lastMetadata: null,
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  const state = {
    ...loadPersisted(),
    demo: E.buildDemoDataset(new Date()),
    activeTab: 'today',
    activeConditionId: 'cond_eczema',
    // Today form state
    form: {
      conditionSeverities: { cond_eczema: 3, cond_stomach_pain: 2, cond_acne: 2 },
      severity: 3,
      itch: 3,
      redness: 2,
      dryness: 4,
      areas: ['hands'],
      notes: '',
      stress: 4,
      sleepQuality: 7,
      sleepHours: '7.5',
      screenTime: '5.0',
      exercise: '30',
      customVals: {},
    },
    // Food draft state
    foodDraft: {
      photoDataUrl: '',
      photoBase64: '',
      mimeType: 'image/jpeg',
      textHint: '',
      dishName: '',
      dishes: [],
      mealType: 'lunch',
      summary: '',
      analyzedByGemini: false,
      confidence: 0,
      ingredients: [],
      analyzing: false,
      statusMessage: '',
      errorMessage: '',
      errorRetriable: false,
    },
    // Metrics filters & simplified view toggles
    metricsCategory: 'all',
    metricsDirection: 'all',
    showTechnicalStats: false,
    showMoreLifestyle: false,
    showInsightLagChart: false,
    // Insights state
    selectedInsightVarId: null,
    selectedReportId: null,
    showCumulative: false,
    syncingSensors: false,
  };

  // --- Plain-English Simplification Helpers (fewer raw numbers, clearer takeaways) ---
  function humanStrength(item) {
    const abs = Math.abs(item.bestLag.score);
    const pct = Math.min(100, Math.max(12, Math.round(abs * 100)));
    if (item.direction === 'trigger') {
      if (abs >= 0.6) return { label: 'Strong Trigger', pct, color: '#D1493E', badge: 'badge-trigger' };
      if (abs >= 0.4) return { label: 'Likely Trigger', pct, color: '#D95D39', badge: 'badge-trigger' };
      if (abs >= 0.25) return { label: 'Possible Trigger', pct, color: '#C97B1A', badge: 'badge-warning' };
    } else if (item.direction === 'protective') {
      if (abs >= 0.55) return { label: 'Strong Protector', pct, color: '#248A67', badge: 'badge-protective' };
      if (abs >= 0.35) return { label: 'Helps Calm', pct, color: '#2A9D6F', badge: 'badge-protective' };
      return { label: 'Mildly Helpful', pct, color: '#4C8F87', badge: 'badge-protective' };
    }
    return { label: 'No Clear Link', pct: Math.min(30, pct), color: '#7C8E8A', badge: 'badge-neutral' };
  }

  function humanTiming(item) {
    switch (item.bestLag.lagKey) {
      case 'immediate_0d': return 'Same day';
      case 'delayed_1d': return 'Next day';
      case 'delayed_2d': return '2 days later';
      case 'delayed_3d': return '3 days later';
      case 'cumulative_3d': return 'Builds up (3 days)';
      case 'cumulative_5d': return 'Builds up (5 days)';
      default: return item.bestLag.label;
    }
  }

  function humanTakeaway(item, condName) {
    const cond = (condName || 'symptoms').toLowerCase();
    const timing = humanTiming(item).toLowerCase();
    if (item.direction === 'trigger') {
      if (item.pattern === 'cumulative_buildup') {
        return `Repeated ${item.variableName.toLowerCase()} over several days tends to flare your ${cond}.`;
      }
      const worseWord = item.avgSeverityWhenHigh >= 6 ? 'noticeably worse' : 'higher';
      return `${item.variableName} is linked to ${worseWord} ${cond} (${timing}).`;
    }
    if (item.direction === 'protective') {
      return `Higher ${item.variableName.toLowerCase()} tends to mean calmer ${cond}; drops often precede flares.`;
    }
    return `Not enough evidence of a link to ${cond} yet.`;
  }

  function severityTierLabel(v) {
    if (v <= 1) return 'Clear';
    if (v <= 4) return 'Mild';
    if (v <= 7) return 'Moderate';
    return 'Severe';
  }

  function persist() {
    try {
      // Explicitly strip plaintext geminiApiKey so only AES-256-GCM ciphertext is ever stored
      const { geminiApiKey: _redacted, ...safeSettings } = state.settings;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          userEczemaLogs: state.userEczemaLogs,
          userMeasurements: state.userMeasurements,
          userFoodEntries: state.userFoodEntries,
          userCustomVariables: state.userCustomVariables,
          userConditions: state.userConditions,
          reportHistory: state.reportHistory.slice(0, 30),
          lastMetadata: state.lastMetadata,
          settings: safeSettings,
        })
      );
    } catch (_) {}
  }

  async function saveEncryptedGeminiKey(plainKey) {
    const trimmed = (plainKey || '').trim();
    state.settings.geminiApiKey = trimmed;
    if (!trimmed) {
      state.settings.encryptedGeminiKey = null;
    } else if (sessionAesKey) {
      state.settings.encryptedGeminiKey = await A.encryptWithAesKey(trimmed, sessionAesKey);
    }
    persist();
  }

  async function hydrateUnlockedSecrets(aesKeyBytes, siteDecryptedKey) {
    sessionAesKey = aesKeyBytes;
    A.saveSessionKey(aesKeyBytes);

    // 1. Migrate any legacy plaintext key into the encrypted vault immediately
    if (legacyPlainApiKey) {
      await saveEncryptedGeminiKey(legacyPlainApiKey);
      legacyPlainApiKey = '';
      return;
    }

    // 2. Try local encrypted vault first, then site-wide encrypted auth-config.js vault
    if (state.settings.encryptedGeminiKey) {
      try {
        state.settings.geminiApiKey = await A.decryptWithAesKey(state.settings.encryptedGeminiKey, aesKeyBytes);
        return;
      } catch (_) {}
    }

    if (siteDecryptedKey) {
      state.settings.geminiApiKey = siteDecryptedKey;
      return;
    }

    const activeCfg = A.getActiveAuthConfig();
    if (activeCfg.encryptedGeminiKey) {
      try {
        state.settings.geminiApiKey = await A.decryptWithAesKey(activeCfg.encryptedGeminiKey, aesKeyBytes);
      } catch (_) {}
    }
  }

  function getActiveData(conditionIdOverride) {
    const useDemo = state.settings.useDemoData;
    const conditions = (state.userConditions || []).filter((c) => c.isActive !== false);
    const activeConditions = conditions.length ? conditions : [{ ...E.STARTER_CONDITIONS[0], isActive: true }];

    let targetCondId = conditionIdOverride || state.activeConditionId;
    if (!activeConditions.some((c) => c.id === targetCondId)) {
      targetCondId = activeConditions[0].id;
      state.activeConditionId = targetCondId;
    }
    const activeCondition = activeConditions.find((c) => c.id === targetCondId) || activeConditions[0];

    const allSymptomLogs = (useDemo ? [...state.userEczemaLogs, ...state.demo.eczemaLogs] : [...state.userEczemaLogs])
      .map((l) => ({ ...l, conditionId: l.conditionId || 'cond_eczema' }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const eczemaLogs = allSymptomLogs.filter((l) => l.conditionId === activeCondition.id);

    const measurements = (useDemo ? [...state.userMeasurements, ...state.demo.measurements] : [...state.userMeasurements]).sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    const foodEntries = (useDemo ? [...state.userFoodEntries, ...state.demo.foodEntries] : [...state.userFoodEntries]).sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    const customIds = new Set(state.userCustomVariables.map((v) => v.id));
    const customVariables = useDemo
      ? [...state.userCustomVariables, ...state.demo.customVariables.filter((v) => !customIds.has(v.id))]
      : [...state.userCustomVariables];
    const allVariables = [...E.STARTER_VARIABLES, ...customVariables];

    const correlationsByCondition = {};
    activeConditions.forEach((c) => {
      const cLogs = allSymptomLogs.filter((l) => l.conditionId === c.id);
      correlationsByCondition[c.id] = E.analyzeCorrelations(cLogs, measurements, allVariables);
    });

    const correlations = correlationsByCondition[activeCondition.id] || [];
    return {
      conditions: activeConditions,
      activeCondition,
      allSymptomLogs,
      eczemaLogs,
      measurements,
      foodEntries,
      customVariables,
      allVariables,
      correlationsByCondition,
      correlations,
    };
  }

  function renderConditionSwitcher(data) {
    return `<div class="cond-switcher">
      ${data.conditions.map((c) => {
        const active = c.id === data.activeCondition.id;
        return `<button class="cond-pill ${active ? 'active' : ''}" data-switch-cond="${esc(c.id)}" style="${active ? `background:${c.color || '#1B6B63'}` : ''}">${c.icon || '🩺'} ${esc(c.name)}</button>`;
      }).join('')}
      <button class="cond-pill" id="open-manage-conds-btn" style="border-style:dashed;color:var(--primary)">+ Add Issue</button>
    </div>`;
  }

  function ensureScheduledInsightsReady() {
    const now = new Date();
    const slotDesc = E.getMostRecentScheduledSlot(state.settings, now);
    const already = state.reportHistory.some((r) => r.dateKey === slotDesc.dateKey && r.slot === slotDesc.slot);
    if (!already) {
      const data = getActiveData();
      const rep = E.generateInsightsReport({
        eczemaLogs: data.eczemaLogs,
        measurements: data.measurements,
        variableDefinitions: data.allVariables,
        conditionName: data.activeCondition.name,
        slot: slotDesc.slot,
        scheduledForLabel: slotDesc.label,
        now,
      });
      state.reportHistory = [rep, ...state.reportHistory].slice(0, 30);
      persist();
    }
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function severityColor(v) {
    if (v <= 1.5) return '#2A9D6F';
    if (v <= 3.5) return '#7BB661';
    if (v <= 5.5) return '#E09F3E';
    if (v <= 7.5) return '#D95D39';
    return '#B22234';
  }

  function severityLabel(v) {
    if (v === 0) return 'Clear';
    if (v <= 2) return 'Very Mild';
    if (v <= 4) return 'Mild';
    if (v <= 6) return 'Moderate';
    if (v <= 8) return 'Severe Flare';
    return 'Intense Flare';
  }

  function formatTemp(c) {
    if (c === undefined || c === null) return '—';
    return state.settings.temperatureUnit === 'F' ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Number(c).toFixed(1)}°C`;
  }

  function renderScalePills(key, label, value, min, max, colorize) {
    let pills = '';
    for (let i = min; i <= max; i++) {
      const sel = i === value;
      const bg = colorize ? severityColor(i) : '#1B6B63';
      pills += `<button class="step-pill ${sel ? 'selected' : ''}" data-scale-key="${key}" data-scale-val="${i}" style="${sel ? `background:${bg}` : ''}">${i}</button>`;
    }
    const valColor = colorize ? severityColor(value) : '#1B6B63';
    return `
      <div class="scale-block">
        <div class="scale-top">
          <span>${esc(label)}</span>
          <span style="color:${valColor};font-weight:800">${value}/${max}${colorize ? ` · ${severityLabel(value)}` : ''}</span>
        </div>
        <div class="pill-row">${pills}</div>
      </div>`;
  }

  function renderExposureFlareSVG(result, showCumulative) {
    const pts = result.timeline.slice(-21);
    const isBin = result.category === 'food_ingredient' || result.valueType === 'boolean';
    const W = 340, H = 225, pL = 28, pR = 12, pT = 26, pB = 30;
    const plotW = W - pL - pR, plotH = H - pT - pB;
    const n = Math.max(1, pts.length);
    const xOf = (i) => (n === 1 ? pL + plotW / 2 : pL + (i / (n - 1)) * plotW);
    const ySev = (s) => pT + plotH - (Math.max(0, Math.min(10, s)) / 10) * plotH;

    const exps = pts.map((p) => p.exposureValue).filter((v) => v !== null);
    const maxE = Math.max(1, ...exps), minE = isBin ? 0 : Math.min(0, ...exps), rngE = Math.max(1, maxE - minE);
    const cums = pts.map((p) => p.cumulativeExposure).filter((v) => v !== null);
    const maxC = Math.max(1, ...cums), minC = isBin ? 0 : Math.min(0, ...cums), rngC = Math.max(1, maxC - minC);
    const yExp = (v) => pT + plotH - ((v - minE) / rngE) * (plotH * 0.72);
    const yCum = (v) => pT + plotH - ((v - minC) / rngC) * (plotH * 0.78);

    const sevCoords = pts.map((p, i) => (p.severity !== null ? { x: xOf(i), y: ySev(p.severity), p } : null)).filter(Boolean);
    const sevPath = sevCoords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const areaPath = sevCoords.length >= 2 ? `${sevPath} L ${sevCoords[sevCoords.length - 1].x.toFixed(1)} ${(pT + plotH).toFixed(1)} L ${sevCoords[0].x.toFixed(1)} ${(pT + plotH).toFixed(1)} Z` : '';

    const cumCoords = pts.map((p, i) => (p.cumulativeExposure !== null ? { x: xOf(i), y: yCum(p.cumulativeExposure) } : null)).filter(Boolean);
    const cumPath = cumCoords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

    const idxMap = new Map();
    pts.forEach((p, i) => idxMap.set(p.dateKey, i));
    const visPairs = result.exposureFlarePairs.filter((pr) => idxMap.has(pr.exposureDateKey) && idxMap.has(pr.flareDateKey));

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#D1493E" stop-opacity="0.24"/><stop offset="100%" stop-color="#D1493E" stop-opacity="0.02"/></linearGradient></defs>`;

    [0, 5, 10].forEach((v) => {
      const y = ySev(v);
      svg += `<line x1="${pL}" y1="${y}" x2="${W - pR}" y2="${y}" stroke="#EBF0ED" stroke-width="1"/>`;
      svg += `<text x="${pL - 5}" y="${y + 3}" font-size="9.5" fill="#7C8E8A" text-anchor="end">${v}</text>`;
    });

    pts.forEach((p, i) => {
      if (p.exposureValue === null) return;
      const x = xOf(i), bot = pT + plotH;
      if (isBin) {
        if (p.exposureValue <= 0) return;
        const top = pT + plotH * 0.34;
        svg += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bot}" stroke="#3B78B8" stroke-width="2" stroke-dasharray="3,2" opacity="0.75"/>`;
        svg += `<polygon points="${x},${top - 5.5} ${x + 5.5},${top} ${x},${top + 5.5} ${x - 5.5},${top}" fill="#3B78B8"/>`;
      } else {
        const top = yExp(p.exposureValue);
        const bw = Math.max(4, Math.min(11, plotW / (n * 1.6)));
        svg += `<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="${Math.max(2, bot - top)}" rx="2.5" fill="#3B78B8" opacity="0.28"/>`;
      }
    });

    if (showCumulative && cumPath) {
      svg += `<path d="${cumPath}" fill="none" stroke="#7A52B3" stroke-width="1.9" stroke-dasharray="5,3"/>`;
    }
    if (areaPath) svg += `<path d="${areaPath}" fill="url(#fg)"/>`;
    if (sevPath) svg += `<path d="${sevPath}" fill="none" stroke="#D1493E" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;

    const placedBadges = [];
    visPairs.slice(-4).forEach((pr) => {
      const x1 = xOf(idxMap.get(pr.exposureDateKey));
      const x2 = xOf(idxMap.get(pr.flareDateKey));
      const yp = ySev(pr.flareSeverity);
      const mx = Math.max(pL + 20, Math.min(W - pR - 20, (x1 + x2) / 2));
      let ay = Math.max(14, yp - 18);
      for (const prev of placedBadges) {
        if (Math.abs(prev.mx - mx) < 42 && Math.abs(prev.ay - ay) < 17) {
          ay = Math.max(12, prev.ay - 17);
        }
      }
      placedBadges.push({ mx, ay });
      svg += `<path d="M ${x1.toFixed(1)} ${(ay + 8).toFixed(1)} Q ${mx.toFixed(1)} ${(ay - 4).toFixed(1)} ${x2.toFixed(1)} ${(yp - 6).toFixed(1)}" fill="none" stroke="#124D47" stroke-width="1.3" stroke-dasharray="2.5,2"/>`;
      svg += `<rect x="${(mx - 18).toFixed(1)}" y="${(ay - 10).toFixed(1)}" width="36" height="14" rx="7" fill="#124D47"/>`;
      svg += `<text x="${mx.toFixed(1)}" y="${ay.toFixed(1)}" font-size="8.5" font-weight="700" fill="#fff" text-anchor="middle">+${Math.round(pr.lagHours)}h</text>`;
    });

    sevCoords.forEach((c) => {
      svg += `<circle cx="${c.x}" cy="${c.y}" r="${c.p.isFlarePeak ? 4.5 : 2.3}" fill="${c.p.isFlarePeak ? '#B22234' : '#D1493E'}" stroke="#fff" stroke-width="${c.p.isFlarePeak ? 1.5 : 0.6}"/>`;
    });

    const step = Math.max(1, Math.floor((pts.length - 1) / 4));
    for (let i = 0; i < pts.length; i += step) {
      svg += `<text x="${xOf(i)}" y="${H - 8}" font-size="9.5" fill="#7C8E8A" text-anchor="middle">${pts[i].label}</text>`;
    }
    svg += `</svg>`;

    let pairsHtml = '';
    if (result.exposureFlarePairs.length) {
      const fmtClock = (iso) => {
        const d = new Date(iso);
        return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      };
      pairsHtml = `<div class="pairs-box">
        <div style="font-size:12px;font-weight:700;margin-bottom:6px">Exposure → Flare-Up Reaction Timing (${result.exposureFlarePairs.length} matched)</div>
        ${result.exposureFlarePairs.slice(-4).reverse().map((pr) => `
          <div class="pair-row">
            <div>
              <div style="font-weight:600">Exposed ${fmtClock(pr.exposureTimestamp)}</div>
              <div style="color:var(--text-sec);font-size:11.5px">Flare (${pr.flareSeverity}/10) at ${fmtClock(pr.flareTimestamp)}</div>
            </div>
            <span class="badge badge-primary">+${esc(pr.lagLabel)}</span>
          </div>`).join('')}
      </div>`;
    }

    return `
      <div class="row-between" style="margin-bottom:6px;flex-wrap:wrap">
        <div class="wrap" style="font-size:11px;font-weight:600;color:var(--text-sec)">
          <span><b style="color:#D1493E">●</b> Symptom Severity</span>
          <span><b style="color:#3B78B8">●</b> ${isBin ? 'Exposure Time' : esc(result.variableName)}</span>
          ${showCumulative ? '<span><b style="color:#7A52B3">●</b> 3d Build-Up</span>' : ''}
        </div>
        <button class="chip ${showCumulative ? 'active' : ''}" id="toggle-cum-btn" style="padding:4px 9px;font-size:11px">3d Build-Up</button>
      </div>
      <div class="chart-frame">${svg}</div>
      ${pairsHtml}`;
  }

  function renderLagProfileSVG(lags, bestKey) {
    const W = 320, H = 142, pL = 10, pR = 10, midY = 74, maxH = 44;
    const colW = (W - pL - pR) / Math.max(1, lags.length);
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${pL}" y1="${midY}" x2="${W - pR}" y2="${midY}" stroke="#DCE4E0" stroke-width="1.2" stroke-dasharray="3,3"/>`;
    lags.forEach((l, i) => {
      const cx = pL + colW * i + colW / 2;
      const bw = Math.min(28, colW * 0.56);
      const bh = Math.max(3, Math.abs(l.score) * maxH);
      const pos = l.score >= 0;
      const y = pos ? midY - bh : midY;
      const best = l.lagKey === bestKey;
      const fill = l.score >= 0.18 ? (l.lagKey.startsWith('cumulative_') ? '#7A52B3' : '#D1493E') : l.score <= -0.18 ? '#248A67' : '#7C8E8A';
      svg += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="${fill}" opacity="${best ? 1 : 0.4}"/>`;
      svg += `<text x="${cx}" y="${pos ? y - 5 : y + bh + 11}" font-size="9.5" font-weight="${best ? 700 : 500}" fill="${best ? '#182422' : '#7C8E8A'}" text-anchor="middle">${l.score >= 0 ? '+' : ''}${l.score.toFixed(2)}</text>`;
      svg += `<text x="${cx}" y="${H - 5}" font-size="9.5" font-weight="${best ? 700 : 500}" fill="${best ? '#124D47' : '#4E605D'}" text-anchor="middle">${l.shortLabel}</text>`;
    });
    svg += `</svg>`;
    return svg;
  }

  function renderToday(data) {
    const now = new Date();
    const todayKey = E.toDateKey(now);
    const todaysLogs = data.allSymptomLogs.filter((l) => l.dateKey === todayKey);
    const findVal = (id) => (data.measurements.find((m) => m.variableId === id) || {}).numericValue;
    const lm = state.lastMetadata || {};
    const hum = lm.humidityPct ?? findVal('var_humidity');
    const tmp = lm.temperatureC ?? findVal('var_temperature');
    const pol = lm.pollenIndex ?? findVal('var_local_allergens');
    const exe = findVal('var_exercise');

    const condMap = new Map(data.conditions.map((c) => [c.id, c]));

    const conditionCardsHtml = data.conditions.map((cond) => {
      const val = state.form.conditionSeverities[cond.id] !== undefined ? state.form.conditionSeverities[cond.id] : 0;
      const condCorrs = data.correlationsByCondition[cond.id] || [];
      const topTrig = condCorrs.find((r) => r.direction === 'trigger' && Math.abs(r.bestLag.score) >= 0.3);
      const latestLog = data.allSymptomLogs.find((l) => l.conditionId === cond.id);
      const signalText = topTrig
        ? `Top suspect: ${topTrig.variableName} (${humanTiming(topTrig).toLowerCase()})`
        : latestLog
        ? `Last logged: ${severityTierLabel(latestLog.severity)}`
        : 'Tap how you feel today to start tracking';

      const levels = [
        { label: 'Clear', val: 0, color: '#2A9D6F' },
        { label: 'Mild', val: 3, color: '#7BB661' },
        { label: 'Moderate', val: 6, color: '#E09F3E' },
        { label: 'Severe', val: 9, color: '#D1493E' },
      ];
      const activeTier = severityTierLabel(val);

      return `<div class="cond-card" style="border-left-color:${cond.color || '#1B6B63'}">
        <div class="cond-card-top">
          <div style="flex:1">
            <div class="cond-name">${cond.icon || '🩺'} ${esc(cond.name)}</div>
            <div class="cond-signal">${esc(signalText)}</div>
          </div>
          <span class="badge" style="background:${severityColor(val)}20;color:${severityColor(val)}">${activeTier}</span>
        </div>
        <div class="level-grid">
          ${levels.map((lv) => {
            const sel = activeTier === lv.label;
            return `<button class="level-btn ${sel ? 'selected' : ''}" data-cond-sev="${esc(cond.id)}" data-val="${lv.val}" style="${sel ? `background:${lv.color}` : ''}">${lv.label}</button>`;
          }).join('')}
        </div>
        <div class="cond-actions">
          <button class="link-btn" data-detail-cond="${esc(cond.id)}">✎ Detailed Log</button>
          <button class="link-btn" data-goto-metrics="${esc(cond.id)}">View Triggers →</button>
        </div>
      </div>`;
    }).join('');

    const customHtml = data.customVariables.length
      ? `<div class="divider-row" style="margin-top:10px">
          <div style="font-size:12.5px;font-weight:700;color:var(--text-sec);margin-bottom:6px">Your Custom Variables</div>
          ${data.customVariables.map((cv) => {
            if (cv.valueType === 'boolean') {
              const chk = Boolean(state.form.customVals[cv.id]);
              return `<div class="switch-row">
                <div><div style="font-size:13.5px;font-weight:600">${esc(cv.name)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(cv.description || '')}</div></div>
                <input type="checkbox" data-custom-bool="${cv.id}" ${chk ? 'checked' : ''} />
              </div>`;
            }
            if (cv.valueType === 'scale') {
              const v = typeof state.form.customVals[cv.id] === 'number' ? state.form.customVals[cv.id] : 5;
              return renderScalePills(`custom:${cv.id}`, cv.name, v, 1, 10, false);
            }
            return `<label class="field-label">${esc(cv.name)} ${cv.unit ? `(${esc(cv.unit)})` : ''}</label>
              <input class="input" type="number" step="any" data-custom-num="${cv.id}" value="${esc(state.form.customVals[cv.id] ?? '')}" placeholder="Enter value" />`;
          }).join('')}
        </div>`
      : '';

    return `
      <div class="row-between" style="margin-bottom:10px">
        <div class="wrap">
          <span class="badge badge-primary">${E.getTimeOfDayBucket(now).toUpperCase()} · ${E.getSeasonForLocation(now, lm.latitude).toUpperCase()}</span>
          ${state.settings.useDemoData ? '<span class="badge badge-warning">21d Demo Active</span>' : ''}
        </div>
        <button class="btn btn-primary btn-sm" id="goto-food-btn">📷 Scan Food</button>
      </div>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Your Tracked Conditions (${data.conditions.length})</h2>
            <p class="card-sub">Log multiple issues at once—auto-syncs live weather &amp; pollen on save.</p>
          </div>
          <button class="btn btn-primary btn-sm" id="open-manage-conds-btn">+ Add Issue</button>
        </div>
        ${conditionCardsHtml}
        <textarea class="input" id="eczema-notes" rows="2" placeholder="Optional note for this check-in (e.g., after lunch, high stress)...">${esc(state.form.notes)}</textarea>
        <button class="btn btn-primary" id="save-all-conds-btn" style="margin-top:10px">✓ Save Check-In for All ${data.conditions.length} Conditions</button>
      </section>

      ${(() => {
        const conns = H.loadConnections();
        const connectedCount = Object.values(conns).filter((c) => c && c.connected).length;
        const slq = findVal('var_sleep_quality');
        const hrv = findVal('var_hrv');
        const humText = hum === undefined ? 'Humidity —' : hum < 38 ? `Dry air (${hum}%)` : hum > 60 ? `Humid (${hum}%)` : `Comfortable air (${hum}%)`;
        const polText = pol === undefined ? 'Pollen —' : pol >= 60 ? 'High pollen' : pol >= 35 ? 'Moderate pollen' : 'Low pollen';
        const slpText = slq === undefined ? 'Sleep —' : slq >= 7 ? 'Good sleep' : slq >= 5 ? 'Fair sleep' : 'Poor sleep';
        const hrvText = hrv === undefined ? '' : hrv >= 55 ? 'Good recovery' : 'Low recovery';
        return `<section class="card">
          <div class="card-header" style="margin-bottom:8px">
            <div>
              <h2 class="card-title">Today's Environment &amp; Wearables</h2>
              <p class="card-sub">${esc(lm.locationName || 'Auto-synced when you save a check-in')}${connectedCount > 0 ? ` · ${connectedCount} health app linked` : ''}</p>
            </div>
            <div class="row" style="gap:5px">
              <button class="btn btn-secondary btn-sm" id="sync-env-btn">${state.syncingSensors ? '…' : '↻ Sync'}</button>
              <button class="btn btn-primary btn-sm" id="open-health-apps-btn">⌚ Apps</button>
            </div>
          </div>
          <div class="env-strip">
            <span class="env-pill">💧 ${humText}</span>
            <span class="env-pill">🌡️ ${formatTemp(tmp)}</span>
            <span class="env-pill">🌿 ${polText}</span>
            <span class="env-pill">😴 ${slpText}</span>
            ${hrvText ? `<span class="env-pill">❤️ ${hrvText}</span>` : ''}
          </div>
        </section>`;
      })()}

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Daily Habits &amp; Custom Triggers</h2>
            <p class="card-sub">Quick check-in on stress, sleep &amp; your personal triggers.</p>
          </div>
          <button class="btn btn-secondary btn-sm" id="open-add-var-btn">+ Add Trigger</button>
        </div>
        <div class="scale-block">
          <div class="scale-top"><span>Stress Today</span><span style="color:var(--primary);font-weight:800">${state.form.stress <= 3 ? 'Low' : state.form.stress <= 6 ? 'Moderate' : state.form.stress <= 8 ? 'High' : 'Very High'}</span></div>
          <div class="level-grid">
            ${[['Low', 2, '#2A9D6F'], ['Moderate', 5, '#E09F3E'], ['High', 7, '#D95D39'], ['Very High', 9, '#B22234']].map(([lbl, v, col]) => {
              const sel = (lbl === 'Low' && state.form.stress <= 3) || (lbl === 'Moderate' && state.form.stress >= 4 && state.form.stress <= 6) || (lbl === 'High' && state.form.stress >= 7 && state.form.stress <= 8) || (lbl === 'Very High' && state.form.stress >= 9);
              return `<button class="level-btn ${sel ? 'selected' : ''}" data-scale-key="stress" data-scale-val="${v}" style="${sel ? `background:${col}` : ''}">${lbl}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="scale-block">
          <div class="scale-top"><span>Last Night's Sleep</span><span style="color:var(--primary);font-weight:800">${state.form.sleepQuality <= 3 ? 'Poor' : state.form.sleepQuality <= 6 ? 'Fair' : state.form.sleepQuality <= 8 ? 'Good' : 'Great'}</span></div>
          <div class="level-grid">
            ${[['Poor', 3, '#D1493E'], ['Fair', 5, '#E09F3E'], ['Good', 7, '#7BB661'], ['Great', 9, '#2A9D6F']].map(([lbl, v, col]) => {
              const sel = (lbl === 'Poor' && state.form.sleepQuality <= 3) || (lbl === 'Fair' && state.form.sleepQuality >= 4 && state.form.sleepQuality <= 6) || (lbl === 'Good' && state.form.sleepQuality >= 7 && state.form.sleepQuality <= 8) || (lbl === 'Great' && state.form.sleepQuality >= 9);
              return `<button class="level-btn ${sel ? 'selected' : ''}" data-scale-key="sleepQuality" data-scale-val="${v}" style="${sel ? `background:${col}` : ''}">${lbl}</button>`;
            }).join('')}
          </div>
        </div>
        <button type="button" class="details-toggle" id="toggle-more-lifestyle">
          <span>More Details (Sleep hrs, Screen time, Exercise)</span>
          <span>${state.showMoreLifestyle ? '▴' : '▾'}</span>
        </button>
        ${state.showMoreLifestyle ? `
          <div class="grid-3" style="margin-top:8px">
            <div><label class="field-label">Sleep (hrs)</label><input class="input" id="inp-sleep" type="number" step="0.5" value="${esc(state.form.sleepHours)}" /></div>
            <div><label class="field-label">Screen (hrs)</label><input class="input" id="inp-screen" type="number" step="0.5" value="${esc(state.form.screenTime)}" /></div>
            <div><label class="field-label">Exercise (min)</label><input class="input" id="inp-exercise" type="number" value="${esc(state.form.exercise)}" /></div>
          </div>` : ''}
        ${customHtml}
        <button class="btn btn-secondary" id="save-vars-btn" style="margin-top:12px">Save Daily Habits</button>
      </section>

      <section class="card">
        <div class="card-header"><div><h2 class="card-title">Today's Log (${todaysLogs.length})</h2></div></div>
        ${todaysLogs.length === 0 ? '<p class="card-sub">No check-ins logged today yet.</p>' : todaysLogs.slice(0, 8).map((l) => {
          const c = condMap.get(l.conditionId) || { icon: '🩺', name: 'Symptom' };
          return `<div class="row-between divider-row">
            <div>
              <div style="font-size:13.5px;font-weight:700">${c.icon} ${esc(c.name)}</div>
              <div style="font-size:11.5px;color:var(--text-muted)">${new Date(l.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${l.notes ? ' · ' + esc(l.notes) : ''}</div>
            </div>
            <span class="badge" style="background:${severityColor(l.severity)}20;color:${severityColor(l.severity)}">${severityTierLabel(l.severity)}</span>
          </div>`;
        }).join('')}
      </section>`;
  }

  function renderFood(data) {
    const d = state.foodDraft;
    const hasAi = Boolean(A.getProxyUrl() || state.settings.geminiApiKey);
    const banner = hasAi
      ? ''
      : `<div class="banner-warn" id="goto-settings-key">
          <div style="font-size:13px;font-weight:700;color:var(--warning)">✨ AI Vision Not Connected</div>
          <div style="font-size:11.5px;color:var(--text-sec);margin-top:2px">Preview Mode active. Tap to connect in Settings.</div>
        </div>`;

    const shortTriggerSub = (ing) => {
      const fromDishes = (ing.foundIn || '').trim();
      const grp = (ing.triggerGroup || '').trim();
      const nameLower = (ing.name || '').trim().toLowerCase();
      let grpClean = '';
      if (grp && grp.toLowerCase() !== nameLower) {
        const parts = grp
          .split(/[\/,]/)
          .map((p) => p.trim())
          .filter((p) => p && p.toLowerCase() !== nameLower);
        const concise = (parts.length ? parts.slice(0, 2).join(' · ') : grp).trim();
        grpClean = concise.length > 26 ? parts[0] || concise.slice(0, 24).trim() : concise;
      }
      if (fromDishes && d.dishes && d.dishes.length > 1) {
        return grpClean ? `${grpClean} · ${fromDishes}` : `From: ${fromDishes}`;
      }
      return grpClean || (fromDishes ? `From: ${fromDishes}` : '');
    };

    let draftHtml = '';
    if (d.analyzing) {
      draftHtml = `<section class="card scan-progress-card" id="food-scan-progress" aria-live="polite">
        <div class="scan-bar-track"><div class="scan-bar-fill"></div></div>
        <div class="row" style="align-items:center;gap:11px;margin-top:4px">
          <span class="spinner-teal"></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14.5px;font-weight:800;color:var(--primary-dark)">Scanning your meal…</div>
            <div style="font-size:12px;color:var(--text-sec);margin-top:1px">${esc(d.statusMessage || 'Identifying dishes and ingredients…')}</div>
          </div>
        </div>
        <div class="skeleton-row" style="margin-top:12px"></div>
        <div class="skeleton-row" style="animation-delay:0.2s"></div>
        <div class="skeleton-row" style="animation-delay:0.4s"></div>
      </section>`;
    } else if (d.errorMessage) {
      draftHtml = `<section class="card" id="food-error-card" style="border-color:#F3D299;background:var(--warning-light)">
        <div style="font-size:14px;font-weight:800;color:var(--warning);margin-bottom:4px">⚠️ Couldn't Analyze Right Now</div>
        <p class="card-sub" style="color:var(--text);margin-bottom:12px">${esc(d.errorMessage)}</p>
        <div class="row">
          <button class="btn btn-primary" id="retry-food-btn">↻ Try Again</button>
          <button class="btn btn-secondary" id="manual-fallback-btn">Log Manually</button>
        </div>
      </section>`;
    } else if (d.ingredients.length) {
      const mealTypes = [
        ['breakfast', 'Breakfast'],
        ['lunch', 'Lunch'],
        ['dinner', 'Dinner'],
        ['snack', 'Snack'],
        ['beverage', 'Drink'],
      ];
      const activeCnt = d.ingredients.filter((i) => i.included).length;
      const triggerCnt = d.ingredients.filter((i) => i.included && i.commonEczemaTrigger).length;
      const dishCount = Array.isArray(d.dishes) ? d.dishes.length : 0;
      draftHtml = `<section class="card" id="food-review-card">
        <div class="card-header" style="margin-bottom:8px">
          <div>
            <h2 class="card-title">Review Ingredients</h2>
            <p class="card-sub">${dishCount > 1 ? `${dishCount} dishes · ` : ''}${activeCnt} ingredient${activeCnt === 1 ? '' : 's'}${triggerCnt ? ` · ${triggerCnt} trigger${triggerCnt > 1 ? 's' : ''}` : ''}</p>
          </div>
          <span class="badge ${d.analyzedByGemini ? 'badge-primary' : 'badge-neutral'}">${d.analyzedByGemini ? 'AI Scan' : 'Preview'}</span>
        </div>
        ${dishCount > 1 ? `<div class="wrap" style="margin-bottom:8px">
          ${d.dishes.map((dn) => `<span class="dish-chip">🍽 ${esc(dn)}</span>`).join('')}
        </div>` : ''}
        <label class="field-label">Meal Name</label>
        <input class="input" id="draft-dish" value="${esc(d.dishName)}" />
        <label class="field-label">Meal Type</label>
        <div class="wrap" style="margin-bottom:10px">
          ${mealTypes.map(([m, lbl]) => `<button class="chip chip-solid ${d.mealType === m ? 'active' : ''}" data-meal-type="${m}">${lbl}</button>`).join('')}
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px">Tap any ingredient to include or exclude:</div>
        ${d.ingredients.map((ing) => {
          const sub = shortTriggerSub(ing);
          return `<div class="ing-row ${ing.included ? '' : 'excluded'}" data-toggle-ing="${ing.id}">
            <span class="ing-check ${ing.included ? 'checked' : ''}">${ing.included ? '✓' : ''}</span>
            <div class="ing-main">
              <div class="ing-name">${esc(ing.name)}</div>
              ${sub ? `<div class="ing-sub">${esc(sub)}</div>` : ''}
            </div>
            ${ing.commonEczemaTrigger ? `<span class="ing-flag">⚠ Trigger</span>` : ''}
          </div>`;
        }).join('')}
        <div class="row" style="margin-top:10px">
          <input class="input" id="add-ing-input" placeholder="Add ingredient (e.g. Oat Milk)" />
          <button class="btn btn-secondary btn-sm" id="add-ing-btn" style="padding:11px 14px;border-radius:11px">+ Add</button>
        </div>
        <button class="btn btn-primary" id="save-meal-btn" style="margin-top:12px">✓ Save Meal (${activeCnt} ingredient${activeCnt === 1 ? '' : 's'})</button>
      </section>`;
    }

    return `
      ${banner}
      <section class="card">
        <div class="card-header" style="margin-bottom:10px">
          <div>
            <h2 class="card-title">Scan a Meal</h2>
            <p class="card-sub">Snap a photo or list one or more dishes you ate.</p>
          </div>
        </div>
        <div class="food-capture-grid">
          <label class="food-capture-btn btn-primary ${d.analyzing ? 'disabled' : ''}">
            📷 Take Photo
            <input type="file" accept="image/*" capture="environment" id="camera-input" ${d.analyzing ? 'disabled' : ''} style="display:none" />
          </label>
          <label class="food-capture-btn btn-secondary ${d.analyzing ? 'disabled' : ''}">
            🖼 Library
            <input type="file" accept="image/*" id="library-input" ${d.analyzing ? 'disabled' : ''} style="display:none" />
          </label>
        </div>
        ${d.photoDataUrl ? `<img src="${d.photoDataUrl}" class="photo-preview" alt="Meal preview" />` : ''}
        <textarea class="input" id="food-hint-input" rows="2" ${d.analyzing ? 'disabled' : ''} placeholder="Or list dishes (e.g. iced latte, scrambled eggs, sourdough toast)">${esc(d.textHint)}</textarea>
        <button class="btn btn-primary" id="analyze-food-btn" style="margin-top:8px" ${d.analyzing ? 'disabled' : ''}>
          ${d.analyzing ? '<span class="spinner"></span> Scanning…' : (d.photoDataUrl ? '✨ Scan Photo & Dishes' : '✨ Scan Dishes')}
        </button>
      </section>

      ${draftHtml}

      <section class="card">
        <div class="card-header" style="margin-bottom:6px"><div><h2 class="card-title">Recent Meals (${data.foodEntries.length})</h2></div></div>
        ${data.foodEntries.slice(0, 10).map((f) => `
          <div class="divider-row">
            <div class="row-between" style="align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:14px;overflow-wrap:anywhere">${esc(f.dishName)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${f.mealType[0].toUpperCase() + f.mealType.slice(1)} · ${new Date(f.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              </div>
            </div>
            <div class="wrap" style="margin-top:7px">
              ${f.ingredients.map((ing) => `<span class="meal-ing-pill ${ing.commonEczemaTrigger ? 'is-trigger' : ''}">${ing.commonEczemaTrigger ? '⚠ ' : ''}${esc(ing.name)}</span>`).join('')}
            </div>
          </div>`).join('') || '<p class="card-sub">No meals logged yet.</p>'}
      </section>`;
  }

  function renderMetrics(data) {
    const res = data.correlations;
    const triggers = res.filter((r) => r.direction === 'trigger').length;
    const protective = res.filter((r) => r.direction === 'protective').length;
    const delayed = res.filter((r) => r.direction !== 'neutral' && r.pattern !== 'immediate').length;

    const filtered = res.filter((r) => {
      if (state.metricsCategory !== 'all' && r.category !== state.metricsCategory) return false;
      if (state.metricsDirection !== 'all' && r.direction !== state.metricsDirection) return false;
      return true;
    });

    const catTabs = [
      ['all', 'All'], ['food_ingredient', 'Food Ingredients'], ['environment', 'Environment'], ['lifestyle', 'Lifestyle'], ['custom', 'Custom'],
    ];

    return `
      ${renderConditionSwitcher(data)}

      <div class="row-between" style="margin-bottom:10px">
        <button class="btn btn-secondary btn-sm" id="open-add-var-btn">+ Add Custom Trigger</button>
        <button class="chip ${state.showTechnicalStats ? 'active' : ''}" id="toggle-tech-stats-btn">${state.showTechnicalStats ? '✓ Technical Stats On' : 'Show Technical Stats (r, p)'}</button>
      </div>

      <div class="scroll-x">
        ${catTabs.map(([id, lbl]) => `<button class="chip chip-solid ${state.metricsCategory === id ? 'active' : ''}" data-mcat="${id}">${lbl}</button>`).join('')}
      </div>

      <div class="row" style="margin-bottom:10px">
        ${[['all', 'All'], ['trigger', 'Suspected Triggers'], ['protective', 'What Helps']].map(([id, lbl]) =>
          `<button class="chip chip-solid ${state.metricsDirection === id ? 'active' : ''}" data-mdir="${id}" style="flex:1;text-align:center">${lbl}</button>`
        ).join('')}
      </div>

      ${state.showTechnicalStats ? `
        <div class="card" style="padding:11px 13px;background:var(--surface-elev)">
          <div style="font-size:11.5px;font-weight:700;color:var(--text-sec);margin-bottom:6px">Tap any stat term to learn how it works:</div>
          <div class="wrap">
            ${G.renderInfoBtn('r_value', 'r value')}
            ${G.renderInfoBtn('lag_window', 'Reaction Lag')}
            ${G.renderInfoBtn('cumulative_buildup', '3d / 5d Build-Up')}
            ${G.renderInfoBtn('p_value', 'p-value')}
            ${G.renderInfoBtn('confidence', 'Confidence')}
          </div>
        </div>` : ''}

      ${filtered.map((item) => {
        const s = item.bestLag.score;
        const hs = humanStrength(item);
        const timing = humanTiming(item);
        const takeaway = humanTakeaway(item, data.activeCondition.name);
        return `<section class="card" data-open-var="${esc(item.variableId)}" style="cursor:pointer">
          <div class="row-between" style="align-items:flex-start">
            <div style="flex:1">
              <div style="font-size:15.5px;font-weight:800">${esc(item.variableName)}</div>
              <div class="wrap" style="margin-top:5px">
                <span class="badge ${hs.badge}">${hs.label}</span>
                <span class="badge ${item.pattern === 'cumulative_buildup' ? 'badge-cumulative' : 'badge-neutral'}">⏱ ${esc(timing)}</span>
              </div>
            </div>
            ${state.showTechnicalStats ? `
              <div style="text-align:right">
                <div style="font-size:15px;font-weight:800;color:${hs.color}">r = ${s >= 0 ? '+' : ''}${s.toFixed(2)} ${G.renderInfoBtn('r_value')}</div>
                <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">${item.confidence.replace('_', ' ')}</div>
              </div>` : ''}
          </div>
          <div class="impact-bar-track"><div class="impact-bar-fill" style="width:${hs.pct}%;background:${hs.color}"></div></div>
          <p class="card-sub" style="margin-top:6px;color:var(--text);font-size:13px">${esc(takeaway)}</p>
          ${state.showTechnicalStats ? `
            <div class="mini-lags">
              ${item.allLags.map((l) => {
                const best = l.lagKey === item.bestLag.lagKey;
                const fc = l.score >= 0.18 ? '#D1493E' : l.score <= -0.18 ? '#248A67' : '#DCE4E0';
                return `<div class="mini-lag-col">
                  <div class="mini-lag-track"><div class="mini-lag-fill" style="height:${Math.max(12, Math.round(Math.abs(l.score) * 100))}%;background:${fc};opacity:${best ? 1 : 0.42}"></div></div>
                  <div class="mini-lag-lbl ${best ? 'best' : ''}">${l.shortLabel}</div>
                </div>`;
              }).join('')}
            </div>` : ''}
          <div class="row-between divider-row" style="margin-top:8px;padding-bottom:0;font-size:11.5px;color:var(--text-muted)">
            <span>${item.category.replace('_', ' ')}</span>
            <span style="color:var(--primary);font-weight:700">See flare timeline →</span>
          </div>
        </section>`;
      }).join('') || '<section class="card"><p class="card-sub">No matching triggers yet.</p></section>'}`;
  }

  function renderInsights(data) {
    const cond = data.activeCondition;
    const slotDesc = E.getMostRecentScheduledSlot(state.settings, new Date());
    const activeReport = E.generateInsightsReport({
      eczemaLogs: data.eczemaLogs,
      measurements: data.measurements,
      variableDefinitions: data.allVariables,
      conditionName: cond.name,
      slot: slotDesc.slot,
      scheduledForLabel: slotDesc.label,
      now: new Date(),
    });
    const nextRun = E.getNextScheduledRun(state.settings);
    const cands = [...activeReport.topTriggers, ...activeReport.topProtective];
    const list = cands.length ? cands : activeReport.allResults.slice(0, 5);
    const activeVar = (state.selectedInsightVarId && list.find((v) => v.variableId === state.selectedInsightVarId)) || list[0];

    // Cross-condition active watchlist across ALL tracked conditions
    const crossAlerts = [];
    data.conditions.forEach((c) => {
      const cRep = E.generateInsightsReport({
        eczemaLogs: data.allSymptomLogs.filter((l) => l.conditionId === c.id),
        measurements: data.measurements,
        variableDefinitions: data.allVariables,
        conditionName: c.name,
        slot: slotDesc.slot,
        scheduledForLabel: slotDesc.label,
        now: new Date(),
      });
      cRep.activeAlerts.slice(0, 2).forEach((al) => crossAlerts.push({ ...al, conditionId: c.id, conditionIcon: c.icon, conditionName: c.name }));
    });

    const genStr = new Date(activeReport.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const leadTrigger = activeReport.topTriggers[0];
    const leadProt = activeReport.topProtective[0];
    const simpleHeadline = leadTrigger
      ? `${leadTrigger.variableName} is your top ${cond.name} trigger`
      : `Keep logging ${cond.name} daily to uncover triggers`;
    const simpleNarrative = leadTrigger
      ? `${leadTrigger.variableName} tends to flare your ${cond.name.toLowerCase()} ${humanTiming(leadTrigger).toLowerCase()}.${leadProt ? ` Higher ${leadProt.variableName.toLowerCase()} appears to help keep symptoms calmer.` : ''}`
      : `Once you log a few days of check-ins and meals, FlareLens will highlight what triggers your ${cond.name.toLowerCase()} and what helps.`;

    return `
      ${renderConditionSwitcher(data)}

      <section class="hero-card">
        <div class="row-between" style="align-items:flex-start">
          <div>
            <div class="hero-slot">${activeReport.slot === 'evening' ? '🌙' : '☀️'} ${esc(activeReport.scheduledForLabel)} · ${cond.icon} ${esc(cond.name)}</div>
            <h2 class="hero-headline">${esc(simpleHeadline)}</h2>
          </div>
          <button class="btn btn-secondary btn-sm" id="refresh-insights-btn">↻ Refresh</button>
        </div>
        <p class="hero-body">${esc(simpleNarrative)}</p>
        <div class="hero-meta">
          <span>Updated: ${genStr}</span>
          <span>Next report: ${E.formatTime12h(nextRun.timeStr)} (${nextRun.countdown})</span>
        </div>
      </section>

      ${crossAlerts.length ? `
        <section class="card">
          <div class="card-header">
            <div><h2 class="card-title">What to Watch Right Now</h2><p class="card-sub">Recent exposures that may trigger a flare soon.</p></div>
            <span class="badge badge-warning">${crossAlerts.length} Active</span>
          </div>
          ${crossAlerts.map((a) => `
            <div class="divider-row" data-pick-cond-ivar="${esc(a.conditionId)}|${esc(a.variableId)}" style="cursor:pointer">
              <div class="row-between">
                <b style="font-size:13.5px">${a.conditionIcon} ${esc(a.conditionName)} ← ${esc(a.variableName)}</b>
                <span class="badge ${a.riskLevel === 'high' ? 'badge-trigger' : 'badge-warning'}">${esc(a.expectedPeakWindowLabel)}</span>
              </div>
              <p class="card-sub" style="margin-top:4px">${esc(a.reason.replace(/\s*\(r\s*=[^)]+\)/g, ''))}</p>
            </div>`).join('')}
        </section>` : ''}

      ${activeVar ? `
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">When ${esc(activeVar.variableName)} Triggers ${esc(cond.name)}</h2>
              <p class="card-sub">Blue markers show exposure time; red peaks show flare-ups.</p>
            </div>
            <button class="btn btn-secondary btn-sm" data-open-var="${esc(activeVar.variableId)}">Full Stats</button>
          </div>
          <div class="scroll-x">
            ${list.map((v) => {
              const sel = v.variableId === activeVar.variableId;
              const bg = v.direction === 'trigger' ? '#D1493E' : '#248A67';
              return `<button class="chip" data-pick-ivar="${esc(v.variableId)}" style="${sel ? `background:${bg};border-color:${bg};color:#fff` : ''}">${esc(v.variableName)}</button>`;
            }).join('')}
          </div>
          <div class="pairs-box" style="margin-top:0;margin-bottom:10px">
            <div class="wrap" style="margin-bottom:5px;align-items:center">
              <span class="badge ${humanStrength(activeVar).badge}">${humanStrength(activeVar).label}</span>
              <span class="badge badge-neutral">⏱ ${esc(humanTiming(activeVar))}</span>
              ${G.renderInfoBtn('r_value', 'How we score this')}
            </div>
            <div style="font-size:12.5px;color:var(--text)">${esc(humanTakeaway(activeVar, cond.name))}</div>
          </div>
          ${renderExposureFlareSVG(activeVar, state.showCumulative)}
          <button type="button" class="details-toggle" id="toggle-insight-lag-btn">
            <span>Detailed Timing &amp; Statistical Breakdown</span>
            <span>${state.showInsightLagChart ? '▴' : '▾'}</span>
          </button>
          ${state.showInsightLagChart ? `
            <div style="margin-top:10px">
              <div class="row-between" style="margin-bottom:4px">
                <div style="font-size:12.5px;font-weight:700">Reaction Lag Profile (r = ${activeVar.bestLag.score >= 0 ? '+' : ''}${activeVar.bestLag.score.toFixed(2)})</div>
                <div class="wrap">${G.renderInfoBtn('lag_window', 'Lag')}${G.renderInfoBtn('cumulative_buildup', 'Build-Up')}</div>
              </div>
              ${renderLagProfileSVG(activeVar.allLags, activeVar.bestLag.lagKey)}
            </div>` : ''}
        </section>` : ''}

      ${activeReport && activeReport.topTriggers.length ? `
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">Top Suspected Triggers</h2><p class="card-sub">Tap any trigger to view its exposure-to-flare graph above.</p></div></div>
          ${activeReport.topTriggers.slice(0, 4).map((t, idx) => {
            const hs = humanStrength(t);
            return `<div class="divider-row" data-pick-ivar="${esc(t.variableId)}" style="cursor:pointer">
              <div class="row-between">
                <b style="font-size:14px">${idx + 1}. ${esc(t.variableName)}</b>
                <span class="badge ${hs.badge}">${hs.label}</span>
              </div>
              <div style="font-size:11.5px;font-weight:700;color:var(--primary-dark);margin-top:3px">⏱ ${esc(humanTiming(t))}</div>
              <p class="card-sub">${esc(humanTakeaway(t, cond.name))}</p>
            </div>`;
          }).join('')}
        </section>` : ''}

      <section class="card">
        <div class="card-header"><div><h2 class="card-title">9 AM / 9 PM Digest History</h2><p class="card-sub">Automatically ready at ${E.formatTime12h(state.settings.morningInsightTime)} & ${E.formatTime12h(state.settings.eveningInsightTime)} daily.</p></div></div>
        ${state.reportHistory.slice(0, 6).map((r) => `
          <div class="row-between divider-row" data-pick-rep="${esc(r.id)}" style="cursor:pointer">
            <div>
              <div style="font-size:13px;font-weight:700">${esc(r.scheduledForLabel)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${new Date(r.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${r.topTriggers.length} triggers</div>
            </div>
            ${activeReport && activeReport.id === r.id ? '<span class="badge badge-primary">Viewing</span>' : ''}
          </div>`).join('')}
      </section>`;
  }

  function renderSettings() {
    const s = state.settings;
    const proxyUrl = A.getProxyUrl();
    const condNames = (state.userConditions || []).filter((c) => c.isActive !== false).map((c) => `${c.icon} ${c.name}`).join(', ');
    return `
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Tracked Health Conditions</h2>
            <p class="card-sub">Active: ${esc(condNames || 'None')}. Add stomach pain, acne, migraines, or any custom issue.</p>
          </div>
        </div>
        <button class="btn btn-primary" id="open-manage-conds-btn">+ Manage / Add Health Conditions</button>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Cloudflare Worker Proxy (Zero-Exposure)</h2>
            <p class="card-sub">Recommended for GitHub Pages: keeps GEMINI_API_KEY &amp; APP_PASSWORD 100% server-side.</p>
          </div>
          <span class="badge ${proxyUrl ? 'badge-protective' : 'badge-neutral'}">${proxyUrl ? 'Proxy Active' : 'Direct Mode'}</span>
        </div>
        <label class="field-label">Cloudflare Worker URL</label>
        <input class="input" id="set-proxy-url" type="url" value="${esc(proxyUrl)}" placeholder="https://flarelens-gemini-proxy.yourname.workers.dev" />
        <label class="field-label">Gemini Model (auto-discovers fallback if unavailable)</label>
        <div class="wrap" style="margin-bottom:10px">
          ${['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest'].map((m) => `<button class="chip chip-solid ${s.geminiModel === m ? 'active' : ''}" data-set-model="${m}">${m}</button>`).join('')}
        </div>
        <div class="row">
          <button class="btn btn-primary" id="save-proxy-btn">Save Proxy URL</button>
          <button class="btn btn-secondary" id="test-gemini-btn">Test Connection</button>
        </div>
      </section>

      ${proxyUrl ? '' : `
      <section class="card">
        <div class="card-header"><div><h2 class="card-title">Direct Gemini API Key (Optional Local Mode)</h2><p class="card-sub">Only needed when not using the Cloudflare Worker proxy. Encrypted with AES-256-GCM locally.</p></div></div>
        <label class="field-label">Gemini API Key</label>
        <input class="input" id="set-apikey" type="password" value="${esc(s.geminiApiKey)}" placeholder="AIza..." />
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary" id="save-apikey-btn">Encrypt &amp; Save Key</button>
        </div>
      </section>`}

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Security, Password &amp; GitHub Pages</h2>
            <p class="card-sub">${proxyUrl ? 'Login verified server-side by your Cloudflare Worker with signed 12h session tokens.' : 'Password verified via PBKDF2-SHA256 (200k rounds). API keys encrypted via AES-256-GCM.'}</p>
          </div>
          <span class="badge badge-primary">${proxyUrl ? 'Server Auth' : (A.hasWebCrypto() ? 'AES-256-GCM' : 'Local HTTP')}</span>
        </div>
        ${proxyUrl ? '' : `
        <label class="field-label">Change Local Login Password (re-encrypts saved API key)</label>
        <input class="input" id="chg-pw-cur" type="password" placeholder="Current password" style="margin-bottom:7px" />
        <input class="input" id="chg-pw-new" type="password" placeholder="New password (min 8 chars)" style="margin-bottom:7px" />
        <button class="btn btn-secondary" id="change-pw-btn" style="margin-bottom:10px">Update Password</button>`}
        <div class="row">
          <button class="btn btn-primary" id="download-authcfg-btn">Download auth-config.js</button>
          <button class="btn btn-danger" id="settings-lock-btn">🔒 Lock Now</button>
        </div>
        <p class="card-sub" style="margin-top:8px">Drop the downloaded <code>auth-config.js</code> into <code>web/auth-config.js</code> before pushing to GitHub Pages (contains zero plaintext secrets).</p>
      </section>

      <section class="card">
        <div class="card-header"><div><h2 class="card-title">Twice-Daily Insights Schedule</h2><p class="card-sub">Insights are automatically prepared at the start and end of your day.</p></div></div>
        <div class="row" style="margin-bottom:10px">
          <div style="flex:1"><label class="field-label">Morning Brief (24h)</label><input class="input" id="set-am" value="${esc(s.morningInsightTime)}" /></div>
          <div style="flex:1"><label class="field-label">Evening Digest (24h)</label><input class="input" id="set-pm" value="${esc(s.eveningInsightTime)}" /></div>
        </div>
        <button class="btn btn-primary" id="save-sched-btn">Save 9 AM / 9 PM Schedule</button>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Connected Health Apps &amp; Wearables</h2>
            <p class="card-sub">Extract sleep quality, sleep duration, HRV, resting heart rate &amp; exercise from Apple Health, WHOOP, Garmin, and Strava.</p>
          </div>
        </div>
        <button class="btn btn-primary" id="open-health-apps-btn">⌚ Manage Health App Connections</button>
      </section>

      <section class="card">
        <div class="card-header"><div><h2 class="card-title">Sample Data, Tour &amp; Preferences</h2></div></div>
        <button class="btn btn-secondary" id="replay-tour-btn" style="margin-bottom:10px">🧭 Replay Guided App Tour</button>
        <div class="switch-row">
          <div><div style="font-size:13.5px;font-weight:600">Include 21-Day Demo Dataset</div><div style="font-size:11.5px;color:var(--text-muted)">Toggle off to analyze strictly your own personal logs.</div></div>
          <input type="checkbox" id="toggle-demo" ${s.useDemoData ? 'checked' : ''} />
        </div>
        <div class="switch-row">
          <div><div style="font-size:13.5px;font-weight:600">Temperature Unit</div></div>
          <div class="row">
            <button class="chip chip-solid ${s.temperatureUnit === 'C' ? 'active' : ''}" data-unit="C">°C</button>
            <button class="chip chip-solid ${s.temperatureUnit === 'F' ? 'active' : ''}" data-unit="F">°F</button>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-secondary" id="export-json-btn">Export JSON</button>
          <button class="btn btn-danger" id="clear-data-btn">Clear Personal</button>
        </div>
      </section>`;
  }

  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    const bodyEl = document.getElementById('modal-body');
    bodyEl.innerHTML = html;
    bodyEl.scrollTop = 0;
    document.getElementById('modal-backdrop').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
  }

  function openManageConditionsModal() {
    const activeIds = new Set((state.userConditions || []).filter((c) => c.isActive !== false).map((c) => c.id));
    const customList = (state.userConditions || []).filter((c) => c.isCustom);
    const emojiOptions = ['🩹', '🤢', '✨', '🧠', '🤧', '🦴', '⚡', '🔥', '💤', '❤️‍🩹', '🫁', '🌡️'];
    const colorOptions = ['#D1493E', '#C97B1A', '#7A52B3', '#3B78B8', '#248A67', '#1B6B63'];

    openModal(
      'Track Health Conditions',
      `<div style="font-size:12.5px;color:var(--text-sec);margin-bottom:10px">
        Enable any starter conditions below or add your own custom symptoms to track &amp; correlate simultaneously.
      </div>
      <div class="card" style="padding:12px">
        <div style="font-size:13px;font-weight:800;margin-bottom:6px">Starter Conditions</div>
        ${E.STARTER_CONDITIONS.map((c) => {
          const checked = activeIds.has(c.id);
          return `<div class="switch-row">
            <div>
              <div style="font-size:14px;font-weight:700">${c.icon} ${esc(c.name)} <span class="badge badge-neutral" style="font-size:10px">${esc(c.category)}</span></div>
              <div style="font-size:11px;color:var(--text-muted)">${esc((c.subMetrics || []).join(' · '))}</div>
            </div>
            <input type="checkbox" data-toggle-starter-cond="${esc(c.id)}" ${checked ? 'checked' : ''} />
          </div>`;
        }).join('')}
      </div>

      ${customList.length ? `<div class="card" style="padding:12px">
        <div style="font-size:13px;font-weight:800;margin-bottom:6px">Your Custom Conditions (${customList.length})</div>
        ${customList.map((c) => `<div class="row-between divider-row">
          <div>
            <div style="font-size:14px;font-weight:700">${c.icon || '🩺'} ${esc(c.name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(c.category || 'Custom')}${c.subMetrics && c.subMetrics.length ? ' · ' + esc(c.subMetrics.join(', ')) : ''}</div>
          </div>
          <button class="btn btn-danger btn-sm" data-del-cond="${esc(c.id)}">Remove</button>
        </div>`).join('')}
      </div>` : ''}

      <div class="card" style="padding:13px">
        <div style="font-size:13.5px;font-weight:800;margin-bottom:4px">+ Add Custom Health Issue</div>
        <label class="field-label">Condition / Symptom Name</label>
        <input class="input" id="new-cond-name" placeholder="e.g., Bloating, Fatigue, Hives, Anxiety, Reflux" />
        <label class="field-label">Category</label>
        <select class="input" id="new-cond-cat">
          <option value="General">General</option>
          <option value="Digestive">Digestive</option>
          <option value="Skin">Skin</option>
          <option value="Neurological">Neurological</option>
          <option value="Respiratory">Respiratory</option>
          <option value="Mood / Energy">Mood / Energy</option>
          <option value="Musculoskeletal">Musculoskeletal</option>
        </select>
        <label class="field-label">Icon</label>
        <div class="wrap" style="margin-bottom:6px">
          ${emojiOptions.map((em, idx) => `<button type="button" class="chip ${idx === 0 ? 'active' : ''}" data-pick-emoji="${em}">${em}</button>`).join('')}
        </div>
        <label class="field-label">Optional Sub-Symptoms (comma-separated)</label>
        <input class="input" id="new-cond-subs" placeholder="e.g., Pain, Intensity, Duration" />
        <button class="btn btn-primary" id="create-cond-btn" style="margin-top:12px">+ Add Condition</button>
      </div>`
    );

    let chosenEmoji = emojiOptions[0];
    document.querySelectorAll('[data-pick-emoji]').forEach((b) => {
      b.addEventListener('click', () => {
        chosenEmoji = b.dataset.pickEmoji;
        document.querySelectorAll('[data-pick-emoji]').forEach((x) => x.classList.toggle('active', x === b));
      });
    });

    document.querySelectorAll('[data-toggle-starter-cond]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.toggleStarterCond;
        const tpl = E.STARTER_CONDITIONS.find((c) => c.id === id);
        if (!tpl) return;
        const existingIdx = state.userConditions.findIndex((c) => c.id === id);
        if (chk.checked) {
          if (existingIdx >= 0) state.userConditions[existingIdx].isActive = true;
          else state.userConditions.push({ ...tpl, isActive: true });
          if (state.form.conditionSeverities[id] === undefined) state.form.conditionSeverities[id] = 2;
        } else {
          const activeNow = state.userConditions.filter((c) => c.isActive !== false);
          if (activeNow.length <= 1) {
            chk.checked = true;
            return showToast('Keep at least 1 active condition');
          }
          if (existingIdx >= 0) state.userConditions[existingIdx].isActive = false;
        }
        persist();
        render();
      });
    });

    document.querySelectorAll('[data-del-cond]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.delCond;
        state.userConditions = state.userConditions.filter((c) => c.id !== id);
        persist();
        openManageConditionsModal();
        render();
        showToast('Removed custom condition');
      });
    });

    document.getElementById('create-cond-btn').addEventListener('click', () => {
      const name = (document.getElementById('new-cond-name').value || '').trim();
      if (!name) return showToast('Enter a condition or symptom name');
      const category = document.getElementById('new-cond-cat').value;
      const subsRaw = (document.getElementById('new-cond-subs').value || '').trim();
      const subMetrics = subsRaw
        ? subsRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3)
        : ['Intensity', 'Discomfort'];
      const id = `cond_${E.normalizeIngredientKey(name)}_${Date.now().toString(36)}`;
      const color = colorOptions[state.userConditions.length % colorOptions.length];
      state.userConditions.push({
        id,
        name,
        icon: chosenEmoji,
        color,
        category,
        subMetrics,
        areas: [],
        isActive: true,
        isCustom: true,
      });
      state.form.conditionSeverities[id] = 2;
      state.activeConditionId = id;
      persist();
      closeModal();
      showToast(`Added "${name}" to your tracked conditions`);
      render();
    });
  }

  function openDetailedConditionModal(condId) {
    const data = getActiveData();
    const cond = data.conditions.find((c) => c.id === condId);
    if (!cond) return;
    let sev = state.form.conditionSeverities[cond.id] !== undefined ? state.form.conditionSeverities[cond.id] : 3;
    const subs = cond.subMetrics && cond.subMetrics.length ? cond.subMetrics : ['Intensity', 'Discomfort'];
    const subVals = {};
    subs.forEach((s) => { subVals[s] = sev; });
    let selAreas = [];

    const draw = () => {
      const mkScale = (key, lbl, val) => {
        let pills = '';
        for (let i = 0; i <= 10; i++) {
          const sel = i === val;
          pills += `<button type="button" class="step-pill ${sel ? 'selected' : ''}" data-dscale="${esc(key)}" data-dval="${i}" style="${sel ? `background:${severityColor(i)}` : ''}">${i}</button>`;
        }
        return `<div class="scale-block">
          <div class="scale-top"><span>${esc(lbl)}</span><span style="color:${severityColor(val)};font-weight:800">${val}/10</span></div>
          <div class="pill-row">${pills}</div>
        </div>`;
      };

      openModal(
        `${cond.icon || '🩺'} Detailed ${cond.name} Check-In`,
        `${mkScale('overall', `Overall ${cond.name} Severity`, sev)}
        ${subs.map((s) => mkScale(`sub:${s}`, s, subVals[s])).join('')}
        ${cond.areas && cond.areas.length ? `
          <label class="field-label">Affected Areas</label>
          <div class="wrap" style="margin-bottom:10px">
            ${cond.areas.map((a) => `<button type="button" class="chip ${selAreas.includes(a) ? 'active' : ''}" data-darea="${esc(a)}">${esc(a)}</button>`).join('')}
          </div>` : ''}
        <label class="field-label">Notes</label>
        <textarea class="input" id="detail-cond-notes" rows="2" placeholder="Optional context (e.g., started 2h after lunch)..."></textarea>
        <button class="btn btn-primary" id="save-detail-cond-btn" style="margin-top:12px">✓ Save ${esc(cond.name)} Check-In</button>`
      );

      document.querySelectorAll('[data-dscale]').forEach((b) => {
        b.addEventListener('click', () => {
          const k = b.dataset.dscale;
          const v = Number(b.dataset.dval);
          if (k === 'overall') sev = v;
          else subVals[k.slice(4)] = v;
          draw();
        });
      });
      document.querySelectorAll('[data-darea]').forEach((b) => {
        b.addEventListener('click', () => {
          const a = b.dataset.darea;
          selAreas = selAreas.includes(a) ? selAreas.filter((x) => x !== a) : [...selAreas, a];
          draw();
        });
      });
      document.getElementById('save-detail-cond-btn').addEventListener('click', async () => {
        const now = new Date();
        const noteText = (document.getElementById('detail-cond-notes').value || '').trim();
        state.form.conditionSeverities[cond.id] = sev;
        state.userEczemaLogs.unshift({
          id: `log_${cond.id}_${Date.now()}`,
          conditionId: cond.id,
          timestamp: now.toISOString(),
          dateKey: E.toDateKey(now),
          severity: sev,
          itchLevel: subVals[subs[0]] ?? sev,
          rednessLevel: subVals[subs[1]] ?? sev,
          drynessLevel: subVals[subs[2]] ?? sev,
          affectedAreas: [...selAreas],
          timeOfDay: E.getTimeOfDayBucket(now),
          season: E.getSeasonForLocation(now, state.lastMetadata?.latitude),
          notes: noteText || undefined,
        });
        persist();
        closeModal();
        showToast(`Saved ${cond.name} check-in (${sev}/10)`);
        render();
        // Auto-sync live weather/pollen if stale
        if (!state.lastMetadata || Date.now() - new Date(state.lastMetadata.capturedAt).getTime() > 30 * 60 * 1000) {
          try {
            const snap = await E.fetchLiveWeatherAndPollen();
            state.lastMetadata = snap;
            const dk = E.toDateKey(new Date(snap.capturedAt));
            const addM = [];
            if (snap.humidityPct !== undefined) addM.push({ id: `w_h_${dk}`, variableId: 'var_humidity', variableName: 'Humidity', category: 'environment', timestamp: snap.capturedAt, dateKey: dk, numericValue: snap.humidityPct, unit: '%', source: 'auto_weather_api' });
            if (snap.temperatureC !== undefined) addM.push({ id: `w_t_${dk}`, variableId: 'var_temperature', variableName: 'Temperature', category: 'environment', timestamp: snap.capturedAt, dateKey: dk, numericValue: snap.temperatureC, unit: '°C', source: 'auto_weather_api' });
            if (snap.pollenIndex !== undefined) addM.push({ id: `w_p_${dk}`, variableId: 'var_local_allergens', variableName: 'Local Allergens (Pollen & AQI)', category: 'environment', timestamp: snap.capturedAt, dateKey: dk, numericValue: snap.pollenIndex, unit: 'idx', source: 'auto_pollen_api' });
            const ids = new Set(addM.map((m) => m.id));
            state.userMeasurements = [...addM, ...state.userMeasurements.filter((m) => !ids.has(m.id))];
            persist();
            render();
          } catch (_) {}
        }
      });
    };

    draw();
  }

  function openAddVariableModal() {
    const templates = [
      { name: 'New Laundry Detergent', type: 'boolean', unit: '', desc: 'Fragranced detergent exposure' },
      { name: 'Moisturizer Applications', type: 'numeric', unit: 'times/day', desc: 'Daily barrier cream applications' },
      { name: 'Pet Contact', type: 'boolean', unit: '', desc: 'Direct contact with pet dander' },
      { name: 'Water Intake', type: 'numeric', unit: 'liters', desc: 'Daily hydration quantity' },
      { name: 'Pool Chlorine', type: 'boolean', unit: '', desc: 'Swimming pool exposure' },
    ];
    openModal(
      'Add Custom Variable',
      `<div style="font-size:12px;color:var(--text-sec);margin-bottom:8px">Tap a quick template or define your own:</div>
      <div class="wrap" style="margin-bottom:12px">
        ${templates.map((t, i) => `<button class="chip active" data-tpl="${i}">+ ${esc(t.name)}</button>`).join('')}
      </div>
      <label class="field-label">Variable Name</label>
      <input class="input" id="cv-name" placeholder="e.g., Wool Clothing, Vitamin D" />
      <label class="field-label">Measurement Type</label>
      <select class="input" id="cv-type">
        <option value="boolean">Yes / No Exposure</option>
        <option value="scale">1–10 Scale</option>
        <option value="numeric">Number + Unit</option>
      </select>
      <label class="field-label">Unit (optional)</label>
      <input class="input" id="cv-unit" placeholder="e.g., liters, mg, minutes" />
      <label class="field-label">Description (optional)</label>
      <input class="input" id="cv-desc" placeholder="What are you tracking?" />
      <button class="btn btn-primary" id="cv-submit" style="margin-top:14px">Add Custom Variable</button>`
    );

    document.querySelectorAll('[data-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = templates[Number(btn.dataset.tpl)];
        document.getElementById('cv-name').value = t.name;
        document.getElementById('cv-type').value = t.type;
        document.getElementById('cv-unit').value = t.unit;
        document.getElementById('cv-desc').value = t.desc;
      });
    });

    document.getElementById('cv-submit').addEventListener('click', () => {
      const name = document.getElementById('cv-name').value.trim();
      if (!name) return showToast('Please enter a variable name');
      const valueType = document.getElementById('cv-type').value;
      const unit = document.getElementById('cv-unit').value.trim();
      const description = document.getElementById('cv-desc').value.trim();
      state.userCustomVariables.push({
        id: `custom_${E.normalizeIngredientKey(name)}_${Date.now().toString(36)}`,
        name,
        category: 'custom',
        valueType,
        unit: valueType === 'numeric' ? unit : valueType === 'scale' ? '/10' : undefined,
        description: description || `Custom variable: ${name}`,
        autoCollected: false,
        isCustom: true,
        isActive: true,
      });
      persist();
      closeModal();
      showToast(`Added custom variable "${name}"`);
      render();
    });
  }

  function openVariableDetailModal(varId) {
    const data = getActiveData();
    const item = data.correlations.find((r) => r.variableId === varId);
    if (!item) return;
    openModal(
      `${item.variableName} → ${data.activeCondition.name}`,
      `<div class="card">
        <div class="row-between">
          <div class="wrap" style="align-items:center">
            <span class="badge ${item.pattern === 'cumulative_buildup' ? 'badge-cumulative' : item.direction === 'trigger' ? 'badge-trigger' : 'badge-protective'}">${esc(item.typicalLagDescription)}</span>
            <span class="badge badge-neutral">Confidence: ${item.confidence.replace('_', ' ')}</span>
            ${G.renderInfoBtn('confidence')}
          </div>
          <div style="text-align:right">
            <b style="font-size:20px;color:${item.direction === 'trigger' ? 'var(--trigger)' : 'var(--protective)'}">${item.bestLag.score >= 0 ? '+' : ''}${item.bestLag.score.toFixed(2)}</b>
            <div>${G.renderInfoBtn('r_value', 'r value')}</div>
          </div>
        </div>
        <p class="card-sub" style="margin-top:8px">${esc(item.summary)}</p>
        <div class="meta-grid" style="margin-top:10px">
          <div class="meta-tile"><div class="meta-label">Avg When Exposed / High</div><div class="meta-val" style="color:var(--trigger)">${item.avgSeverityWhenHigh}/10</div></div>
          <div class="meta-tile"><div class="meta-label">Avg Baseline / Low</div><div class="meta-val" style="color:var(--protective)">${item.avgSeverityWhenLow}/10</div></div>
        </div>
      </div>
      <div class="card">
        <h3 class="card-title" style="margin-bottom:6px">Exposure Time → Flare-Up Graph</h3>
        ${renderExposureFlareSVG(item, item.pattern === 'cumulative_buildup')}
      </div>
      <div class="card">
        <h3 class="card-title" style="margin-bottom:6px">All Lag &amp; Build-Up Windows ${G.renderInfoBtn('lag_window')} ${G.renderInfoBtn('cumulative_buildup', 'Build-Up')}</h3>
        ${renderLagProfileSVG(item.allLags, item.bestLag.lagKey)}
        <table class="lag-table">
          <thead><tr><th>Window ${G.renderInfoBtn('lag_window')}</th><th>Score r ${G.renderInfoBtn('r_value')}</th><th>p-val ${G.renderInfoBtn('p_value')}</th><th>n ${G.renderInfoBtn('sample_size')}</th></tr></thead>
          <tbody>
            ${item.allLags.map((l) => `<tr class="${l.lagKey === item.bestLag.lagKey ? 'best-row' : ''}"><td>${esc(l.label)}</td><td>${l.score >= 0 ? '+' : ''}${l.score.toFixed(2)}</td><td>${l.pValue < 0.001 ? '<.001' : l.pValue.toFixed(3)}</td><td>${l.sampleSize}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`
    );
  }

  function render() {
    ensureScheduledInsightsReady();
    const data = getActiveData();

    const titles = {
      today: ['FlareLens', 'Daily check-ins & triggers'],
      food: ['Food Lens', 'Snap a meal to log ingredients'],
      metrics: [`${data.activeCondition.icon} ${data.activeCondition.name}`, 'Triggers & what helps'],
      insights: [`${data.activeCondition.icon} ${data.activeCondition.name}`, 'Daily reports & patterns'],
      settings: ['Settings', 'Conditions, apps & schedule'],
    };
    document.getElementById('header-title').textContent = titles[state.activeTab][0];
    document.getElementById('header-sub').textContent = titles[state.activeTab][1];

    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === state.activeTab);
    });

    const main = document.getElementById('main-content');
    if (state.activeTab === 'today') main.innerHTML = renderToday(data);
    else if (state.activeTab === 'food') main.innerHTML = renderFood(data);
    else if (state.activeTab === 'metrics') main.innerHTML = renderMetrics(data);
    else if (state.activeTab === 'insights') main.innerHTML = renderInsights(data);
    else main.innerHTML = renderSettings();

    wireEvents();
  }

  function handleFileChosen(file) {
    if (!file) return;
    // Show immediate visual scanning feedback before image resize even finishes
    state.foodDraft.analyzing = true;
    state.foodDraft.errorMessage = '';
    state.foodDraft.statusMessage = 'Preparing photo…';
    render();
    const progEl = document.getElementById('food-scan-progress');
    if (progEl) progEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const reader = new FileReader();
    reader.onload = async () => {
      const rawDataUrl = String(reader.result || '');
      // Normalize & resize photo to clean <=1024px JPEG so large/HEIC phone photos never cause HTTP 400
      let finalDataUrl = rawDataUrl;
      try {
        finalDataUrl = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const maxDim = 1024;
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            if (w > maxDim || h > maxDim) {
              const ratio = Math.min(maxDim / w, maxDim / h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.onerror = () => resolve(rawDataUrl);
          img.src = rawDataUrl;
        });
      } catch (_) {}

      const match = /^data:([^;]+);base64,(.*)$/.exec(finalDataUrl);
      state.foodDraft.photoDataUrl = finalDataUrl;
      state.foodDraft.mimeType = match ? match[1] : 'image/jpeg';
      state.foodDraft.photoBase64 = match ? match[2] : '';
      await runFoodAnalyze();
    };
    reader.readAsDataURL(file);
  }

  async function runFoodAnalyze() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    state.foodDraft.analyzing = true;
    state.foodDraft.errorMessage = '';
    state.foodDraft.errorRetriable = false;
    state.foodDraft.statusMessage = state.foodDraft.photoBase64
      ? 'Analyzing meal photo & dishes…'
      : 'Parsing dishes & ingredients…';
    render();
    showToast('Scanning your meal…');
    const progEl = document.getElementById('food-scan-progress');
    if (progEl) progEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const res = await E.analyzeFoodWithGemini({
        apiKey: state.settings.geminiApiKey,
        proxyUrl: A.getProxyUrl(),
        proxyToken: A.getProxyToken(),
        model: state.settings.geminiModel,
        imageBase64: state.foodDraft.photoBase64 || undefined,
        mimeType: state.foodDraft.mimeType,
        textHint: state.foodDraft.textHint,
        onStatus: (msg) => {
          state.foodDraft.statusMessage = msg;
          if (state.activeTab === 'food') render();
        },
      });
      if (res.shouldPersistModel && res.resolvedModel && res.resolvedModel !== state.settings.geminiModel) {
        state.settings.geminiModel = res.resolvedModel;
        persist();
      }
      Object.assign(state.foodDraft, {
        dishName: res.dishName,
        dishes: Array.isArray(res.dishes) ? res.dishes : [],
        mealType: res.mealType,
        summary: res.summary,
        analyzedByGemini: res.analyzedByGemini,
        confidence: res.confidence,
        ingredients: res.ingredients,
        analyzing: false,
        statusMessage: '',
        errorMessage: '',
      });
      const dishPrefix = state.foodDraft.dishes.length > 1 ? `Parsed ${state.foodDraft.dishes.length} dishes · ` : '';
      showToast(`${dishPrefix}Found ${state.foodDraft.ingredients.length} ingredients`);
    } catch (err) {
      state.foodDraft.analyzing = false;
      state.foodDraft.statusMessage = '';
      state.foodDraft.errorMessage = err.message || 'Gemini analysis failed. You can retry or log ingredients manually.';
      state.foodDraft.errorRetriable = Boolean(err?.geminiError?.retriable);
      showToast('Scan failed — retry or log manually');
    }
    render();
    const reviewEl = document.getElementById('food-review-card') || document.getElementById('food-error-card');
    if (reviewEl) reviewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function wireEvents() {
    // Scale pills
    document.querySelectorAll('[data-scale-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.scaleKey;
        const val = Number(btn.dataset.scaleVal);
        if (key.startsWith('custom:')) state.form.customVals[key.slice(7)] = val;
        else state.form[key] = val;
        render();
      });
    });

    // Body area chips
    document.querySelectorAll('[data-area]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.area;
        state.form.areas = state.form.areas.includes(id)
          ? state.form.areas.filter((a) => a !== id)
          : [...state.form.areas, id];
        render();
      });
    });

    // Notes & numeric inputs
    const notesEl = document.getElementById('eczema-notes');
    if (notesEl) notesEl.addEventListener('input', (e) => (state.form.notes = e.target.value));
    const slpEl = document.getElementById('inp-sleep');
    if (slpEl) slpEl.addEventListener('input', (e) => (state.form.sleepHours = e.target.value));
    const scrEl = document.getElementById('inp-screen');
    if (scrEl) scrEl.addEventListener('input', (e) => (state.form.screenTime = e.target.value));
    const exeEl = document.getElementById('inp-exercise');
    if (exeEl) exeEl.addEventListener('input', (e) => (state.form.exercise = e.target.value));

    document.querySelectorAll('[data-custom-bool]').forEach((el) => {
      el.addEventListener('change', () => (state.form.customVals[el.dataset.customBool] = el.checked));
    });
    document.querySelectorAll('[data-custom-num]').forEach((el) => {
      el.addEventListener('input', () => (state.form.customVals[el.dataset.customNum] = el.value));
    });

    const toggleMoreLife = document.getElementById('toggle-more-lifestyle');
    if (toggleMoreLife) toggleMoreLife.addEventListener('click', () => { state.showMoreLifestyle = !state.showMoreLifestyle; render(); });
    const toggleTechStats = document.getElementById('toggle-tech-stats-btn');
    if (toggleTechStats) toggleTechStats.addEventListener('click', () => { state.showTechnicalStats = !state.showTechnicalStats; render(); });
    const toggleInsightLag = document.getElementById('toggle-insight-lag-btn');
    if (toggleInsightLag) toggleInsightLag.addEventListener('click', () => { state.showInsightLagChart = !state.showInsightLagChart; render(); });

    const gotoFood = document.getElementById('goto-food-btn');
    if (gotoFood) gotoFood.addEventListener('click', () => { state.activeTab = 'food'; window.scrollTo(0, 0); render(); });

    async function syncLiveMetadata({ silent = false } = {}) {
      if (state.syncingSensors) return null;
      state.syncingSensors = true;
      render();
      try {
        const snap = await E.fetchLiveWeatherAndPollen();
        state.lastMetadata = snap;
        const dk = E.toDateKey(new Date(snap.capturedAt));
        const addM = [];
        if (snap.humidityPct !== undefined) addM.push({ id: `w_h_${dk}`, variableId: 'var_humidity', variableName: 'Humidity', category: 'environment', timestamp: snap.capturedAt, dateKey: dk, numericValue: snap.humidityPct, unit: '%', source: 'auto_weather_api' });
        if (snap.temperatureC !== undefined) addM.push({ id: `w_t_${dk}`, variableId: 'var_temperature', variableName: 'Temperature', category: 'environment', timestamp: snap.capturedAt, dateKey: dk, numericValue: snap.temperatureC, unit: '°C', source: 'auto_weather_api' });
        if (snap.pollenIndex !== undefined) addM.push({ id: `w_p_${dk}`, variableId: 'var_local_allergens', variableName: 'Local Allergens (Pollen & AQI)', category: 'environment', timestamp: snap.capturedAt, dateKey: dk, numericValue: snap.pollenIndex, unit: 'idx', source: 'auto_pollen_api' });
        if (snap.uvIndex !== undefined) addM.push({ id: `w_uv_${dk}`, variableId: 'var_uv_index', variableName: 'UV Index', category: 'environment', timestamp: snap.capturedAt, dateKey: dk, numericValue: snap.uvIndex, unit: 'UV', source: 'auto_weather_api' });
        const ids = new Set(addM.map((m) => m.id));
        state.userMeasurements = [...addM, ...state.userMeasurements.filter((m) => !ids.has(m.id))];
        persist();
        if (!silent) showToast(`Synced weather & pollen for ${snap.locationName}`);
        return snap;
      } catch (err) {
        if (!silent) showToast(err.message || 'Unable to sync weather');
        return null;
      } finally {
        state.syncingSensors = false;
        render();
      }
    }

    function shouldAutoSyncLive() {
      if (!state.lastMetadata || !state.lastMetadata.capturedAt) return true;
      const ageMs = Date.now() - new Date(state.lastMetadata.capturedAt).getTime();
      return Number.isNaN(ageMs) || ageMs > 30 * 60 * 1000;
    }

    const syncBtn = document.getElementById('sync-env-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => syncLiveMetadata({ silent: false }));
    }

    // Multi-condition quick severity pills on Home landing page
    document.querySelectorAll('[data-cond-sev]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.form.conditionSeverities[btn.dataset.condSev] = Number(btn.dataset.val);
        render();
      });
    });

    document.querySelectorAll('[data-detail-cond]').forEach((btn) => {
      btn.addEventListener('click', () => openDetailedConditionModal(btn.dataset.detailCond));
    });

    document.querySelectorAll('[data-goto-metrics]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeConditionId = btn.dataset.gotoMetrics;
        state.activeTab = 'metrics';
        window.scrollTo(0, 0);
        render();
      });
    });

    document.querySelectorAll('[data-switch-cond]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeConditionId = btn.dataset.switchCond;
        state.selectedInsightVarId = null;
        render();
      });
    });

    document.querySelectorAll('[data-pick-cond-ivar]').forEach((el) => {
      el.addEventListener('click', () => {
        const [cid, vid] = el.dataset.pickCondIvar.split('|');
        state.activeConditionId = cid;
        state.selectedInsightVarId = vid;
        render();
      });
    });

    document.querySelectorAll('#open-manage-conds-btn').forEach((btn) => {
      btn.addEventListener('click', openManageConditionsModal);
    });

    const saveAllBtn = document.getElementById('save-all-conds-btn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', async () => {
        const now = new Date();
        const data = getActiveData();
        const noteText = state.form.notes.trim() || undefined;
        data.conditions.forEach((cond, idx) => {
          const sev = state.form.conditionSeverities[cond.id] !== undefined ? state.form.conditionSeverities[cond.id] : 2;
          state.userEczemaLogs.unshift({
            id: `log_${cond.id}_${Date.now()}_${idx}`,
            conditionId: cond.id,
            timestamp: now.toISOString(),
            dateKey: E.toDateKey(now),
            severity: sev,
            itchLevel: sev,
            rednessLevel: sev,
            drynessLevel: sev,
            affectedAreas: [],
            timeOfDay: E.getTimeOfDayBucket(now),
            season: E.getSeasonForLocation(now, state.lastMetadata?.latitude),
            notes: noteText,
          });
        });
        state.form.notes = '';
        persist();
        const needsSync = shouldAutoSyncLive();
        showToast(
          needsSync
            ? `Saved ${data.conditions.length} conditions · auto-syncing live weather & pollen…`
            : `Saved check-in for ${data.conditions.length} conditions`
        );
        render();
        if (needsSync) {
          const snap = await syncLiveMetadata({ silent: true });
          if (snap) {
            showToast(`Saved ${data.conditions.length} conditions + synced ${snap.locationName}`);
          }
        }
      });
    }

    const saveVars = document.getElementById('save-vars-btn');
    if (saveVars) {
      saveVars.addEventListener('click', async () => {
        const now = new Date();
        const dk = E.toDateKey(now);
        const batch = [
          { variableId: 'var_stress', variableName: 'Stress Level', category: 'lifestyle', numericValue: state.form.stress, unit: '/10' },
          { variableId: 'var_sleep_duration', variableName: 'Sleep Duration', category: 'lifestyle', numericValue: parseFloat(state.form.sleepHours) || 0, unit: 'hrs' },
          { variableId: 'var_sleep_quality', variableName: 'Sleep Quality', category: 'lifestyle', numericValue: state.form.sleepQuality, unit: '/10' },
          { variableId: 'var_screen_time', variableName: 'Screen Time', category: 'lifestyle', numericValue: parseFloat(state.form.screenTime) || 0, unit: 'hrs' },
          { variableId: 'var_exercise', variableName: 'Exercise Quantity', category: 'lifestyle', numericValue: parseFloat(state.form.exercise) || 0, unit: 'min' },
        ];
        getActiveData().customVariables.forEach((cv) => {
          const raw = state.form.customVals[cv.id];
          if (cv.valueType === 'boolean') batch.push({ variableId: cv.id, variableName: cv.name, category: 'custom', numericValue: raw ? 1 : 0 });
          else if (cv.valueType === 'scale') batch.push({ variableId: cv.id, variableName: cv.name, category: 'custom', numericValue: typeof raw === 'number' ? raw : 5, unit: '/10' });
          else if (raw !== undefined && String(raw).trim() !== '' && !Number.isNaN(Number(raw))) {
            batch.push({ variableId: cv.id, variableName: cv.name, category: 'custom', numericValue: Number(raw), unit: cv.unit });
          }
        });
        const repIds = new Set(batch.map((b) => b.variableId));
        const kept = state.userMeasurements.filter((m) => !(m.dateKey === dk && m.source === 'manual' && repIds.has(m.variableId)));
        const added = batch.map((b, i) => ({ ...b, id: `m_${Date.now()}_${i}`, timestamp: now.toISOString(), dateKey: dk, source: 'manual' }));
        state.userMeasurements = [...added, ...kept];
        persist();
        const needsSync = shouldAutoSyncLive();
        showToast(needsSync ? `Saved ${added.length} variables · auto-syncing live metadata…` : `Saved ${added.length} daily variables`);
        render();
        if (needsSync) {
          await syncLiveMetadata({ silent: true });
        }
      });
    }

    document.querySelectorAll('#open-add-var-btn').forEach((b) => b.addEventListener('click', openAddVariableModal));

    // Food events
    const gotoKey = document.getElementById('goto-settings-key');
    if (gotoKey) gotoKey.addEventListener('click', () => { state.activeTab = 'settings'; render(); });
    const camIn = document.getElementById('camera-input');
    if (camIn) camIn.addEventListener('change', (e) => handleFileChosen(e.target.files[0]));
    const libIn = document.getElementById('library-input');
    if (libIn) libIn.addEventListener('change', (e) => handleFileChosen(e.target.files[0]));
    const hintIn = document.getElementById('food-hint-input');
    if (hintIn) hintIn.addEventListener('input', (e) => (state.foodDraft.textHint = e.target.value));
    const analyzeBtn = document.getElementById('analyze-food-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => {
        if (!state.foodDraft.photoBase64 && !state.foodDraft.textHint.trim()) return showToast('Take a photo or describe your meal first');
        runFoodAnalyze();
      });
    }
    const dishIn = document.getElementById('draft-dish');
    if (dishIn) dishIn.addEventListener('input', (e) => (state.foodDraft.dishName = e.target.value));
    document.querySelectorAll('[data-meal-type]').forEach((b) => {
      b.addEventListener('click', () => { state.foodDraft.mealType = b.dataset.mealType; render(); });
    });
    document.querySelectorAll('[data-toggle-ing]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.toggleIng;
        state.foodDraft.ingredients = state.foodDraft.ingredients.map((i) => (i.id === id ? { ...i, included: !i.included } : i));
        render();
      });
    });
    const addIngBtn = document.getElementById('add-ing-btn');
    if (addIngBtn) {
      addIngBtn.addEventListener('click', () => {
        const name = (document.getElementById('add-ing-input').value || '').trim();
        if (!name) return;
        state.foodDraft.ingredients.push({
          id: `u_${Date.now()}`, name, normalizedKey: E.normalizeIngredientKey(name), category: 'User Added', commonEczemaTrigger: false, included: true,
        });
        render();
      });
    }
    const retryFoodBtn = document.getElementById('retry-food-btn');
    if (retryFoodBtn) retryFoodBtn.addEventListener('click', () => runFoodAnalyze());
    const manualFallbackBtn = document.getElementById('manual-fallback-btn');
    if (manualFallbackBtn) {
      manualFallbackBtn.addEventListener('click', () => {
        const draft = E.buildManualFallbackDraft(state.foodDraft.textHint);
        Object.assign(state.foodDraft, draft, { errorMessage: '', analyzing: false });
        render();
      });
    }
    const saveMealBtn = document.getElementById('save-meal-btn');
    if (saveMealBtn) {
      saveMealBtn.addEventListener('click', () => {
        const active = state.foodDraft.ingredients.filter((i) => i.included);
        if (!active.length) return showToast('Select at least one ingredient');
        const now = new Date();
        const dk = E.toDateKey(now);
        const fid = `food_${Date.now()}`;
        state.userFoodEntries.unshift({
          id: fid, timestamp: now.toISOString(), dateKey: dk, dishName: state.foodDraft.dishName || 'Logged Meal',
          mealType: state.foodDraft.mealType, analyzedByGemini: state.foodDraft.analyzedByGemini, confidence: state.foodDraft.confidence, ingredients: active,
        });
        active.forEach((ing, idx) => {
          state.userMeasurements.unshift({
            id: `ing_${fid}_${idx}`, variableId: `ingredient:${ing.normalizedKey}`, variableName: ing.name,
            category: 'food_ingredient', timestamp: now.toISOString(), dateKey: dk, numericValue: 1,
            source: state.foodDraft.analyzedByGemini ? 'gemini_vision' : 'manual', foodEntryId: fid,
          });
        });
        state.foodDraft = { photoDataUrl: '', photoBase64: '', mimeType: 'image/jpeg', textHint: '', dishName: '', dishes: [], mealType: 'lunch', summary: '', analyzedByGemini: false, confidence: 0, ingredients: [], analyzing: false, statusMessage: '', errorMessage: '', errorRetriable: false };
        persist();
        showToast(`Logged meal & ${active.length} ingredient variables`);
        render();
      });
    }

    // Metrics events
    document.querySelectorAll('[data-mcat]').forEach((b) => b.addEventListener('click', () => { state.metricsCategory = b.dataset.mcat; render(); }));
    document.querySelectorAll('[data-mdir]').forEach((b) => b.addEventListener('click', () => { state.metricsDirection = b.dataset.mdir; render(); }));
    document.querySelectorAll('[data-open-var]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-tooltip]')) return;
        openVariableDetailModal(el.dataset.openVar);
      })
    );

    // Insights events
    const refBtn = document.getElementById('refresh-insights-btn');
    if (refBtn) {
      refBtn.addEventListener('click', () => {
        const data = getActiveData();
        const rep = E.generateInsightsReport({
          eczemaLogs: data.eczemaLogs, measurements: data.measurements, variableDefinitions: data.allVariables,
          slot: 'manual', scheduledForLabel: 'Manual Refresh', now: new Date(),
        });
        state.reportHistory = [rep, ...state.reportHistory].slice(0, 30);
        state.selectedReportId = rep.id;
        persist();
        showToast('Insights refreshed');
        render();
      });
    }
    document.querySelectorAll('[data-pick-ivar]').forEach((el) => el.addEventListener('click', () => { state.selectedInsightVarId = el.dataset.pickIvar; render(); }));
    document.querySelectorAll('[data-pick-rep]').forEach((el) => el.addEventListener('click', () => { state.selectedReportId = el.dataset.pickRep; render(); }));
    const cumBtn = document.getElementById('toggle-cum-btn');
    if (cumBtn) cumBtn.addEventListener('click', () => { state.showCumulative = !state.showCumulative; render(); });

    // Settings events
    document.querySelectorAll('[data-set-model]').forEach((b) => b.addEventListener('click', () => { state.settings.geminiModel = b.dataset.setModel; persist(); render(); }));
    const saveProxyBtn = document.getElementById('save-proxy-btn');
    if (saveProxyBtn) {
      saveProxyBtn.addEventListener('click', () => {
        const url = A.saveLocalProxyUrl(document.getElementById('set-proxy-url').value);
        showToast(url ? 'Proxy URL saved — lock & sign in with Worker password' : 'Switched back to direct local mode');
        render();
      });
    }
    const saveKeyBtn = document.getElementById('save-apikey-btn');
    if (saveKeyBtn) {
      saveKeyBtn.addEventListener('click', async () => {
        await saveEncryptedGeminiKey(document.getElementById('set-apikey').value);
        showToast('Gemini API key encrypted & saved');
        render();
      });
    }
    const testGemBtn = document.getElementById('test-gemini-btn');
    if (testGemBtn) {
      testGemBtn.addEventListener('click', async () => {
        const proxyEl = document.getElementById('set-proxy-url');
        const proxyUrl = proxyEl ? A.saveLocalProxyUrl(proxyEl.value) : A.getProxyUrl();
        const keyEl = document.getElementById('set-apikey');
        const key = keyEl ? (keyEl.value || '').trim() : state.settings.geminiApiKey;
        if (!proxyUrl && keyEl) await saveEncryptedGeminiKey(key);
        showToast('Testing Gemini connection…');
        const res = await E.testGeminiConnection(key, state.settings.geminiModel, (msg) => showToast(msg), {
          proxyUrl,
          proxyToken: A.getProxyToken(),
        });
        if (res.shouldPersistModel && res.resolvedModel && res.resolvedModel !== state.settings.geminiModel) {
          state.settings.geminiModel = res.resolvedModel;
          persist();
        }
        showToast(res.message);
        render();
      });
    }
    const changePwBtn = document.getElementById('change-pw-btn');
    if (changePwBtn) {
      changePwBtn.addEventListener('click', async () => {
        const curPw = document.getElementById('chg-pw-cur').value || '';
        const newPw = document.getElementById('chg-pw-new').value || '';
        if (newPw.length < 8) return showToast('New password must be at least 8 characters');
        const check = await A.unlockWithPassword(curPw);
        if (!check.ok) return showToast('Current password is incorrect');
        const { config, aesKeyBytes } = await A.buildAuthConfig(newPw, state.settings.geminiApiKey);
        A.saveLocalAuthConfig(config);
        sessionAesKey = aesKeyBytes;
        A.saveSessionKey(aesKeyBytes);
        await saveEncryptedGeminiKey(state.settings.geminiApiKey);
        showToast('Password updated & API key re-encrypted!');
        render();
      });
    }
    const dlAuthBtn = document.getElementById('download-authcfg-btn');
    if (dlAuthBtn) {
      dlAuthBtn.addEventListener('click', async () => {
        const proxyUrl = A.getProxyUrl();
        const activeCfg = A.getActiveAuthConfig();
        if (!proxyUrl && !activeCfg.configured) return showToast('Configure a Proxy URL or password first');
        let encKey = activeCfg.encryptedGeminiKey || state.settings.encryptedGeminiKey || null;
        if (!proxyUrl && state.settings.geminiApiKey && sessionAesKey) {
          encKey = await A.encryptWithAesKey(state.settings.geminiApiKey, sessionAesKey);
        }
        const fileContent = A.formatAuthConfigFile({ ...activeCfg, proxyUrl, encryptedGeminiKey: proxyUrl ? null : encKey });
        const blob = new Blob([fileContent], { type: 'application/javascript' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'auth-config.js';
        a.click();
        showToast('Downloaded auth-config.js');
      });
    }
    const settingsLockBtn = document.getElementById('settings-lock-btn');
    if (settingsLockBtn) settingsLockBtn.addEventListener('click', lockApp);
    document.querySelectorAll('#open-health-apps-btn').forEach((b) =>
      b.addEventListener('click', openHealthAppsModal)
    );
    const replayTourBtn = document.getElementById('replay-tour-btn');
    if (replayTourBtn) replayTourBtn.addEventListener('click', () => startGuidedTour(0));
    const saveSchedBtn = document.getElementById('save-sched-btn');
    if (saveSchedBtn) {
      saveSchedBtn.addEventListener('click', () => {
        state.settings.morningInsightTime = document.getElementById('set-am').value.trim() || '09:00';
        state.settings.eveningInsightTime = document.getElementById('set-pm').value.trim() || '21:00';
        persist();
        showToast('9 AM / 9 PM schedule saved');
        render();
      });
    }
    const toggleDemo = document.getElementById('toggle-demo');
    if (toggleDemo) {
      toggleDemo.addEventListener('change', () => {
        state.settings.useDemoData = toggleDemo.checked;
        const data = getActiveData();
        const slotDesc = E.getMostRecentScheduledSlot(state.settings, new Date());
        const rep = E.generateInsightsReport({
          eczemaLogs: data.eczemaLogs, measurements: data.measurements, variableDefinitions: data.allVariables,
          slot: slotDesc.slot, scheduledForLabel: slotDesc.label, now: new Date(),
        });
        state.reportHistory = [rep, ...state.reportHistory].slice(0, 30);
        state.selectedReportId = rep.id;
        persist();
        showToast(toggleDemo.checked ? '21-day demo enabled' : 'Showing personal logs only');
        render();
      });
    }
    document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => { state.settings.temperatureUnit = b.dataset.unit; persist(); render(); }));
    const expBtn = document.getElementById('export-json-btn');
    if (expBtn) {
      expBtn.addEventListener('click', () => {
        const snapshot = loadPersisted();
        if (snapshot.settings) {
          delete snapshot.settings.geminiApiKey;
          delete snapshot.settings.encryptedGeminiKey;
        }
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `flarelens-export-${E.toDateKey(new Date())}.json`;
        a.click();
      });
    }
    const clrBtn = document.getElementById('clear-data-btn');
    if (clrBtn) {
      clrBtn.addEventListener('click', () => {
        if (!confirm('Clear all personal check-ins, meals, and custom variables?')) return;
        state.userEczemaLogs = [];
        state.userMeasurements = [];
        state.userFoodEntries = [];
        state.userCustomVariables = [];
        state.reportHistory = [];
        persist();
        showToast('Personal logs cleared');
        render();
      });
    }
  }

  // Tab navigation, lock & modal close
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      window.scrollTo(0, 0);
      render();
    });
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  function mergeHealthMeasurements(newList) {
    if (!newList || !newList.length) return;
    const newIds = new Set(newList.map((m) => m.id));
    state.userMeasurements = [...newList, ...state.userMeasurements.filter((m) => !newIds.has(m.id))];
    // Refresh insights report so new wearable metrics show up immediately
    const data = getActiveData();
    const slotDesc = E.getMostRecentScheduledSlot(state.settings, new Date());
    const rep = E.generateInsightsReport({
      eczemaLogs: data.eczemaLogs,
      measurements: data.measurements,
      variableDefinitions: data.allVariables,
      slot: slotDesc.slot,
      scheduledForLabel: slotDesc.label,
      now: new Date(),
    });
    state.reportHistory = [rep, ...state.reportHistory].slice(0, 30);
    state.selectedReportId = rep.id;
    persist();
  }

  function openHealthAppsModal() {
    const conns = H.loadConnections();
    const html = `
      <p class="card-sub" style="margin-bottom:12px">
        Connect or import from <b>Apple Health, WHOOP, Garmin Connect, or Strava</b> to extract <b>sleep quality, sleep duration, HRV, resting heart rate, and exercise minutes</b> directly into your correlation engine.
      </p>
      ${H.PROVIDERS.map((p) => {
        const st = conns[p.id];
        return `<div class="health-provider-card">
          <div class="health-provider-head">
            <div>
              <div style="font-size:15px;font-weight:800">${p.icon} ${esc(p.name)}</div>
              <div style="font-size:11.5px;color:var(--text-sec);margin-top:2px">${esc(p.setupHint)}</div>
            </div>
            <span class="badge ${st && st.connected ? 'badge-protective' : 'badge-neutral'}">${st && st.connected ? 'Connected' : 'Not linked'}</span>
          </div>
          <div class="wrap" style="margin-top:8px">
            ${p.metrics.map((m) => `<span class="badge badge-primary" style="font-size:10px">${esc(m)}</span>`).join('')}
          </div>
          ${st && st.lastSummary ? `<div style="font-size:11px;color:var(--primary-dark);font-weight:600;margin-top:6px">✓ ${esc(st.lastSummary)}</div>` : ''}
          ${p.supportsApiToken ? `
            <div class="row" style="margin-top:9px">
              <input class="input" type="password" id="token-${p.id}" placeholder="${esc(p.tokenPlaceholder)}" style="font-size:12.5px;padding:8px 10px" />
              <button class="btn btn-primary btn-sm" data-health-api="${p.id}">Sync API</button>
            </div>` : ''}
          <div class="health-actions">
            <label class="btn btn-secondary btn-sm" style="cursor:pointer">
              📂 Import File (${esc(p.acceptFiles)})
              <input type="file" accept="${esc(p.acceptFiles)}" data-health-file="${p.id}" style="display:none" />
            </label>
            <button class="btn btn-secondary btn-sm" data-health-demo="${p.id}">✨ 14d Sample Sync</button>
          </div>
        </div>`;
      }).join('')}`;

    openModal('Connect Health & Fitness Apps', html);

    document.querySelectorAll('[data-health-api]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.healthApi;
        const token = (document.getElementById(`token-${pid}`).value || '').trim();
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        try {
          const res = pid === 'strava' ? await H.syncStravaApi(token) : await H.syncWhoopApi(token);
          mergeHealthMeasurements(res.measurements);
          showToast(res.summary);
          openHealthAppsModal();
          render();
        } catch (err) {
          showToast(err.message || 'API sync failed');
          btn.disabled = false;
          btn.textContent = 'Sync API';
        }
      });
    });

    document.querySelectorAll('[data-health-file]').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const pid = inp.dataset.healthFile;
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const res = H.parseHealthExportFile(pid, file.name, String(reader.result || ''));
            mergeHealthMeasurements(res.measurements);
            showToast(res.summary);
            openHealthAppsModal();
            render();
          } catch (err) {
            showToast(err.message || 'Unable to parse health file');
          }
        };
        reader.readAsText(file);
      });
    });

    document.querySelectorAll('[data-health-demo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.healthDemo;
        const res = H.buildSampleProviderSync(pid);
        mergeHealthMeasurements(res.measurements);
        showToast(res.summary);
        openHealthAppsModal();
        render();
      });
    });
  }

  // Statistical Tooltip Popover
  function openStatTooltip(key) {
    const entry = G.STAT_GLOSSARY[key];
    if (!entry) return;
    const card = document.getElementById('tooltip-card');
    card.innerHTML = `
      <div class="row-between" style="margin-bottom:8px">
        <div>
          <span class="badge badge-primary">${esc(entry.badge)}</span>
          <h3 style="margin:6px 0 0;font-size:16px;font-weight:800">${esc(entry.title)}</h3>
        </div>
        <button class="icon-close" id="close-tooltip-btn" aria-label="Close">✕</button>
      </div>
      <p style="margin:6px 0 0;font-size:13px;color:var(--text);line-height:1.45">${esc(entry.summary)}</p>
      <ul class="tooltip-list">
        ${entry.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}
      </ul>
      <div class="tooltip-example"><b>In practice:</b> ${esc(entry.example)}</div>
      <button class="btn btn-primary" id="ok-tooltip-btn" style="margin-top:12px">Got it</button>`;

    document.getElementById('tooltip-backdrop').classList.remove('hidden');
    document.getElementById('close-tooltip-btn').addEventListener('click', closeStatTooltip);
    document.getElementById('ok-tooltip-btn').addEventListener('click', closeStatTooltip);
  }

  function closeStatTooltip() {
    document.getElementById('tooltip-backdrop').classList.add('hidden');
  }

  document.getElementById('tooltip-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'tooltip-backdrop') closeStatTooltip();
  });

  // Delegated click handler so any ⓘ pill works across all screens & modals
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-tooltip]') : null;
    if (btn) {
      e.stopPropagation();
      e.preventDefault();
      openStatTooltip(btn.dataset.tooltip);
    }
  });

  // Guided Tour Controller
  let tourStepIdx = 0;

  function startGuidedTour(startIdx = 0) {
    tourStepIdx = startIdx;
    renderTourStep();
  }

  function closeGuidedTour() {
    G.markTourCompleted();
    document.getElementById('tour-overlay').classList.add('hidden');
  }

  function renderTourStep() {
    const steps = G.TOUR_STEPS;
    const step = steps[tourStepIdx];
    if (!step) return closeGuidedTour();

    // Switch live tab behind the tour card so the user sees each feature as they learn
    if (step.tab && state.activeTab !== step.tab) {
      state.activeTab = step.tab;
      window.scrollTo(0, 0);
      render();
    }

    const card = document.getElementById('tour-card');
    card.innerHTML = `
      <div class="tour-dots">
        ${steps.map((_, idx) => `<div class="tour-dot ${idx <= tourStepIdx ? 'done' : ''}"></div>`).join('')}
      </div>
      <div class="row-between" style="align-items:flex-start">
        <div>
          <div style="font-size:11.5px;font-weight:700;color:var(--primary)">${esc(step.subtitle)}</div>
          <h2 style="margin:3px 0 0;font-size:18px;font-weight:800">${step.icon} ${esc(step.title)}</h2>
        </div>
        <button class="icon-close" id="tour-skip-x" aria-label="Skip tour">✕</button>
      </div>
      <p style="font-size:13.5px;color:var(--text-sec);line-height:1.5;margin:10px 0 0">${esc(step.body)}</p>
      <div class="tour-tip"><b>Tip:</b> ${esc(step.tip)}</div>
      <div class="row">
        ${tourStepIdx > 0 ? '<button class="btn btn-secondary" id="tour-prev-btn">← Back</button>' : '<button class="btn btn-secondary" id="tour-skip-btn">Skip Tour</button>'}
        <button class="btn btn-primary" id="tour-next-btn">${tourStepIdx === steps.length - 1 ? 'Start Using FlareLens ✓' : 'Next →'}</button>
      </div>`;

    document.getElementById('tour-overlay').classList.remove('hidden');
    document.getElementById('tour-skip-x').addEventListener('click', closeGuidedTour);
    const skipBtn = document.getElementById('tour-skip-btn');
    if (skipBtn) skipBtn.addEventListener('click', closeGuidedTour);
    const prevBtn = document.getElementById('tour-prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => { tourStepIdx--; renderTourStep(); });
    document.getElementById('tour-next-btn').addEventListener('click', () => {
      if (tourStepIdx >= steps.length - 1) closeGuidedTour();
      else { tourStepIdx++; renderTourStep(); }
    });
  }

  const headerTourBtn = document.getElementById('open-tour-btn');
  if (headerTourBtn) headerTourBtn.addEventListener('click', () => startGuidedTour(0));

  function showProtectedApp() {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    render();
    if (!G.hasCompletedTour()) {
      startGuidedTour(0);
    }
  }

  function lockApp() {
    sessionAesKey = null;
    state.settings.geminiApiKey = '';
    A.clearSession();
    closeModal();
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('hidden');
    renderAuthGate();
    showToast('FlareLens locked');
  }

  const headerLockBtn = document.getElementById('lock-app-btn');
  if (headerLockBtn) headerLockBtn.addEventListener('click', lockApp);

  function renderAuthGate(errorMsg = '') {
    const proxyUrl = A.getProxyUrl();
    const cfg = A.getActiveAuthConfig();
    const sub = document.getElementById('auth-subtitle');
    const container = document.getElementById('auth-form-container');

    if (proxyUrl) {
      sub.textContent = 'Sign in to continue.';
      container.innerHTML = `
        ${errorMsg ? `<div class="auth-error">${esc(errorMsg)}</div>` : ''}
        <form id="auth-proxy-form">
          <label class="field-label">Password</label>
          <input class="input" id="proxy-pw" type="password" autocomplete="current-password" placeholder="Enter your password" required />
          <button class="btn btn-primary" type="submit" style="margin-top:14px">Sign In</button>
        </form>`;

      document.getElementById('auth-proxy-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const now = Date.now();
        if (now < lockoutUntilMs) {
          const secs = Math.ceil((lockoutUntilMs - now) / 1000);
          return renderAuthGate(`Too many failed attempts. Try again in ${secs}s.`);
        }
        const pw = document.getElementById('proxy-pw').value || '';
        const btn = ev.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        const res = await A.loginViaProxy(pw, proxyUrl);
        if (!res.ok) {
          failedLoginAttempts += 1;
          if (failedLoginAttempts >= 3) {
            const penaltySec = Math.min(30, 5 * Math.pow(2, failedLoginAttempts - 3));
            lockoutUntilMs = Date.now() + penaltySec * 1000;
            return renderAuthGate(`${res.error || 'Incorrect password.'} Locked for ${penaltySec}s.`);
          }
          return renderAuthGate(res.error || 'Incorrect password.');
        }
        failedLoginAttempts = 0;
        lockoutUntilMs = 0;
        showProtectedApp();
      });
      return;
    }

    if (!cfg.configured) {
      sub.textContent = 'Create a password to get started.';
      container.innerHTML = `
        ${errorMsg ? `<div class="auth-error">${esc(errorMsg)}</div>` : ''}
        <form id="auth-setup-form">
          <label class="field-label">Create Password (min 8 characters)</label>
          <input class="input" id="setup-pw" type="password" autocomplete="new-password" placeholder="Enter password" required />
          <label class="field-label">Confirm Password</label>
          <input class="input" id="setup-pw2" type="password" autocomplete="new-password" placeholder="Re-enter password" required />
          <button class="btn btn-primary" type="submit" style="margin-top:14px">Create Password</button>
        </form>`;

      document.getElementById('auth-setup-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const pw = document.getElementById('setup-pw').value || '';
        const pw2 = document.getElementById('setup-pw2').value || '';
        if (pw.length < 8) return renderAuthGate('Password must be at least 8 characters.');
        if (pw !== pw2) return renderAuthGate('Passwords do not match.');
        const btn = ev.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Setting up…';
        try {
          const { config, aesKeyBytes } = await A.buildAuthConfig(pw, legacyPlainApiKey);
          A.saveLocalAuthConfig(config);
          await hydrateUnlockedSecrets(aesKeyBytes, '');
          showProtectedApp();
        } catch (err) {
          renderAuthGate(err.message || 'Setup failed.');
        }
      });
      return;
    }

    sub.textContent = 'Sign in to continue.';
    container.innerHTML = `
      ${errorMsg ? `<div class="auth-error">${esc(errorMsg)}</div>` : ''}
      <form id="auth-login-form">
        <label class="field-label">Password</label>
        <input class="input" id="login-pw" type="password" autocomplete="current-password" placeholder="Enter your password" required />
        <button class="btn btn-primary" type="submit" style="margin-top:14px">Sign In</button>
      </form>
      ${cfg.source === 'local_storage' ? '<button type="button" id="reset-local-pw-btn" class="btn btn-secondary" style="margin-top:10px;font-size:12.5px;padding:9px">Reset Local Password</button>' : ''}`;

    const resetBtn = document.getElementById('reset-local-pw-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('Reset the local password on this browser? Your saved logs stay intact, and you can set a new password.')) return;
        try {
          localStorage.removeItem('flarelens_local_auth_v1');
        } catch (_) {}
        A.clearSession();
        renderAuthGate();
      });
    }

    document.getElementById('auth-login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const now = Date.now();
      if (now < lockoutUntilMs) {
        const secs = Math.ceil((lockoutUntilMs - now) / 1000);
        return renderAuthGate(`Too many failed attempts. Try again in ${secs}s.`);
      }
      const pw = document.getElementById('login-pw').value || '';
      const btn = ev.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const res = await A.unlockWithPassword(pw);
        if (!res.ok) {
          failedLoginAttempts += 1;
          if (failedLoginAttempts >= 3) {
            const penaltySec = Math.min(30, 5 * Math.pow(2, failedLoginAttempts - 3));
            lockoutUntilMs = Date.now() + penaltySec * 1000;
            return renderAuthGate(`Incorrect password. Locked for ${penaltySec}s.`);
          }
          return renderAuthGate(res.error || 'Incorrect password.');
        }
        failedLoginAttempts = 0;
        lockoutUntilMs = 0;
        await hydrateUnlockedSecrets(res.aesKeyBytes, res.decryptedGeminiKey);
        showProtectedApp();
      } catch (err) {
        renderAuthGate(err.message || 'Authentication failed.');
      }
    });
  }

  // Bootstrap authentication gate (auto-resume within same unlocked tab session)
  (async function bootstrapAuth() {
    const proxyUrl = A.getProxyUrl();
    if (proxyUrl) {
      const valid = await A.verifyProxySession(proxyUrl);
      if (valid) {
        showProtectedApp();
        return;
      }
      renderAuthGate();
      return;
    }
    const cfg = A.getActiveAuthConfig();
    if (cfg.configured) {
      const existingSessionKey = A.loadSessionKey();
      if (existingSessionKey) {
        await hydrateUnlockedSecrets(existingSessionKey, '');
        showProtectedApp();
        return;
      }
    }
    renderAuthGate();
  })();
})();
