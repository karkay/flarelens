/**
 * FlareLens Secure Backend Proxy (Cloudflare Worker)
 *
 * Security Guarantees:
 * - GEMINI_API_KEY and APP_PASSWORD live strictly in Cloudflare Worker Secrets
 *   (NEVER in GitHub, NEVER in browser code, NEVER in DevTools Network logs).
 * - Login passwords are verified server-side using constant-time SHA-256 comparison.
 * - Authenticated sessions use HMAC-SHA256 signed 12-hour bearer tokens.
 * - Built-in 503/429 exponential backoff retries + automatic backup Gemini model failover.
 */

const DEFAULT_MODEL = 'gemini-flash-latest';
const DEPRECATED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]);
const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const SESSION_TTL_SEC = 12 * 60 * 60;

const TRIGGER_GROUPS = [
  'None',
  'Dairy',
  'Gluten / Wheat',
  'Shellfish',
  'Fish',
  'Eggs',
  'Soy',
  'Nuts',
  'Nightshades',
  'Citrus',
  'Garlic / Onion',
  'Histamine / Fermented',
  'Caffeine',
  'Alcohol',
  'Sugar',
  'Spicy',
  'Cooking Oils',
  'Additives',
  'Other',
];

const FOOD_PROMPT = `You are a nutrition assistant helping track food and beverage ingredients.
The user may provide a photo and/or text describing ONE OR MULTIPLE dishes, sides, and beverages eaten together.
Rules:
1. List every dish/beverage in "dishes" (short names, 1-4 words each).
2. Extract ALL typical & hidden ingredients across ALL dishes (dairy, wheat/gluten, shellfish, fish, soy, eggs, nuts, nightshades/tomato, citrus, garlic/onion, fermented/histamine, caffeine, alcohol, sugar, spicy peppers, cooking oils).
3. DEDUPLICATE shared ingredients across dishes into ONE clean entry (e.g., "Dairy", "Wheat / Gluten", "Shrimp", "Tomato", "Soy", "Eggs").
4. Keep every string short and clean (under 5 words). Never repeat words.
5. Set "triggerGroup" strictly from the allowed enum list (use "None" if not a common trigger).
6. Set "foundIn" to an array of 1-3 short dish names from "dishes" where this ingredient appears.
7. Set "dishName" to a short combined meal title (under 8 words).
Return ONLY valid JSON.`;

const FOOD_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dishName: { type: 'STRING' },
    dishes: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    mealType: {
      type: 'STRING',
      enum: ['breakfast', 'lunch', 'dinner', 'snack', 'beverage'],
    },
    confidence: { type: 'NUMBER' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING' },
          commonEczemaTrigger: { type: 'BOOLEAN' },
          triggerGroup: { type: 'STRING', enum: TRIGGER_GROUPS },
          foundIn: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['name', 'category', 'commonEczemaTrigger', 'triggerGroup'],
      },
    },
  },
  required: ['dishName', 'mealType', 'ingredients'],
};

function cleanSecret(val) {
  let s = String(val || '').trim().replace(/^["']|["']$/g, '').trim();
  s = s.replace(/^(GEMINI_API_KEY|API_KEY|KEY)\s*=\s*/i, '').replace(/^Bearer\s+/i, '').trim();
  s = s.replace(/^["']|["']$/g, '').trim();
  return s;
}
function sanitizeModel(model) {
  if (!model || DEPRECATED_MODELS.has(model)) return DEFAULT_MODEL;
  return String(model).replace(/^models\//, '');
}
function normalizeIngredientKey(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown_ingredient'
  );
}
function sanitizeShortLabel(text, maxLen = 40) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Detect and discard LLM structured-output repetition loops / schema-keyword leaks
  const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length >= 6) {
    const uniqueRatio = new Set(words).size / words.length;
    if (uniqueRatio < 0.58) return '';
    const leakHits = words.filter((w) =>
      /^(trigger|group|setup|key|standard|reference|identifier|logic|schema|enum|field|property|object|array|string|boolean|track|value)$/.test(w)
    ).length;
    if (leakHits >= 3) return '';
  }
  // Remove immediate adjacent repeated words
  s = s.replace(/\b([a-z0-9]+)(?:[\s,/.-]+\1\b)+/gi, '$1').trim();
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen).replace(/\s+\S*$/, '').trim();
    s = cut || s.slice(0, maxLen).trim();
  }
  return s;
}
function sanitizeTriggerGroup(val) {
  const s = sanitizeShortLabel(val, 24);
  if (!s || /^none$/i.test(s) || /^other$/i.test(s)) return '';
  return s;
}
function normalizeFoundIn(val) {
  const arr = Array.isArray(val) ? val : String(val || '').split(',');
  const seen = new Set();
  const clean = [];
  for (const part of arr) {
    const item = sanitizeShortLabel(part, 28);
    if (!item) continue;
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push(item);
    if (clean.length >= 3) break;
  }
  return clean.join(', ');
}
function dedupeIngredients(rawList) {
  const byKey = new Map();
  const order = [];
  const mergeList = (a, b) => normalizeFoundIn(`${a || ''},${b || ''}`);
  (rawList || []).forEach((item, idx) => {
    const rawName = sanitizeShortLabel(item?.name || '', 44);
    if (!rawName) return;
    const key = normalizeIngredientKey(rawName);
    const parenMatch = /\(([^)]+)\)/.exec(rawName);
    const baseName = rawName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const cleanGroup = sanitizeTriggerGroup(item?.triggerGroup);
    const cleanFoundIn = normalizeFoundIn(item?.foundIn);
    if (!byKey.has(key)) {
      const entry = {
        id: `gem_${Date.now()}_${idx}`,
        name: rawName,
        normalizedKey: key,
        category: sanitizeShortLabel(item.category || 'Ingredient', 24) || 'Ingredient',
        commonEczemaTrigger: Boolean(item.commonEczemaTrigger),
        triggerGroup: cleanGroup,
        foundIn: cleanFoundIn,
        notes: '',
        included: true,
        _mergedCount: 1,
        _baseName: baseName,
      };
      byKey.set(key, entry);
      order.push(entry);
    } else {
      const existing = byKey.get(key);
      existing._mergedCount += 1;
      existing.commonEczemaTrigger = existing.commonEczemaTrigger || Boolean(item.commonEczemaTrigger);
      if (!existing.triggerGroup && cleanGroup) existing.triggerGroup = cleanGroup;
      if (existing._baseName && existing.name.includes('(') && rawName.includes('(')) {
        const prevParen = /\(([^)]+)\)/.exec(existing.name);
        if (prevParen) existing.foundIn = mergeList(existing.foundIn, prevParen[1]);
        if (parenMatch) existing.foundIn = mergeList(existing.foundIn, parenMatch[1]);
        existing.name = existing._baseName;
      }
      if (cleanFoundIn) existing.foundIn = mergeList(existing.foundIn, cleanFoundIn);
    }
  });
  return order.map(({ _mergedCount, _baseName, ...clean }) => clean);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function toBase64Url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
function constantTimeBytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function verifyPasswordConstantTime(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !expected) return false;
  const [h1, h2] = await Promise.all([sha256Bytes(candidate), sha256Bytes(expected)]);
  return constantTimeBytesEqual(h1, h2);
}
async function getSigningKey(env) {
  const secretSource = env.SESSION_SECRET || `flarelens-derived-secret:${cleanSecret(env.APP_PASSWORD)}`;
  const raw = await sha256Bytes(secretSource);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function issueSessionToken(env) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'flarelens-worker',
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SEC,
    nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(8))),
  };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getSigningKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return {
    token: `${payloadB64}.${toBase64Url(new Uint8Array(sig))}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}
async function verifySessionToken(token, env) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return false;
  try {
    const key = await getSigningKey(env);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    return payload.iss === 'flarelens-worker' && typeof payload.exp === 'number' && payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
function corsHeaders(request, env) {
  const reqOrigin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').trim();
  let allowOrigin = '*';
  if (allowed) {
    const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
    allowOrigin =
      list.includes(reqOrigin) ||
      reqOrigin.startsWith('http://localhost:') ||
      reqOrigin.startsWith('http://127.0.0.1:')
        ? reqOrigin
        : list[0];
  } else if (reqOrigin) {
    allowOrigin = reqOrigin;
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function jsonResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}
function extractSafeGeminiError(rawBody, apiKey) {
  let msg = '';
  try {
    const j = JSON.parse(rawBody);
    msg = j?.error?.message || '';
  } catch {
    msg = String(rawBody || '').slice(0, 180);
  }
  if (apiKey) msg = msg.split(apiKey).join('[REDACTED]');
  return msg.slice(0, 220);
}
async function discoverBackupModels(apiKey, excludeSet) {
  const fallbacks = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'].filter(
    (m) => !excludeSet.has(m)
  );
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) return fallbacks;
    const data = await res.json();
    const list = (data.models || [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((id) => id.startsWith('gemini-') && !excludeSet.has(id) && !/(embedding|tts|imagen|veo|aqa|audio|robotics|1\.0|1\.5)/i.test(id));
    if (!list.length) return fallbacks;
    const score = (id) => {
      let s = 0;
      if (id === 'gemini-flash-latest') s += 60;
      if (id.includes('flash') && !id.includes('lite')) s += 40;
      else if (id.includes('flash')) s += 35;
      else if (id.includes('pro')) s += 20;
      if (!id.includes('preview') && !id.includes('exp')) s += 15;
      if (DEPRECATED_MODELS.has(id)) s -= 40;
      const ver = /gemini-(\d+(?:\.\d+)?)/.exec(id);
      if (ver) s += parseFloat(ver[1]) * 10;
      return s;
    };
    list.sort((a, b) => score(b) - score(a));
    return list;
  } catch {
    return fallbacks;
  }
}
async function callGeminiServerSide(apiKey, requestedModel, payload, maxRetriesPrimary = 2) {
  const primary = sanitizeModel(requestedModel);
  const tried = new Set([primary]);
  let lastStatus = 503;
  let lastBody = '';
  const tryModel = async (model, retries, activePayload) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep((attempt === 1 ? 1100 : 2500) + Math.floor(Math.random() * 350));
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(activePayload) });
      if (res.ok) return { ok: true, response: res, model };
      lastStatus = res.status;
      lastBody = await res.text().catch(() => '');
      if (res.status === 400 && activePayload?.generationConfig?.responseSchema && /schema/i.test(lastBody)) {
        const relaxed = { ...activePayload, generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 } };
        const res2 = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(relaxed) });
        if (res2.ok) return { ok: true, response: res2, model };
        lastStatus = res2.status;
        lastBody = await res2.text().catch(() => '');
      }
      if (res.status === 404) return { ok: false, status: 404 };
      if (res.status === 400 && /api key/i.test(lastBody)) return { ok: false, status: 400, fatal: true };
      if (!RETRIABLE_STATUSES.has(res.status)) return { ok: false, status: res.status, fatal: true };
    }
    return { ok: false, status: lastStatus };
  };
  const first = await tryModel(primary, maxRetriesPrimary, payload);
  if (first.ok) return { ok: true, response: first.response, resolvedModel: primary, usedBackupModel: false };
  if (first.fatal) return { ok: false, status: first.status, errorBody: lastBody, model: primary };
  const backups = (await discoverBackupModels(apiKey, tried)).slice(0, 3);
  for (const backup of backups) {
    tried.add(backup);
    const res = await tryModel(backup, 1, payload);
    if (res.ok) return { ok: true, response: res.response, resolvedModel: backup, usedBackupModel: true };
    if (res.fatal) return { ok: false, status: res.status, errorBody: lastBody, model: backup };
  }
  return { ok: false, status: lastStatus, errorBody: lastBody, model: primary };
}
function parseJsonFromGeminiText(rawText) {
  const cleaned = String(rawText || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      const apiKey = cleanSecret(env.GEMINI_API_KEY);
      const appPassword = cleanSecret(env.APP_PASSWORD);
      if (path === '/health' && request.method === 'GET') {
        return jsonResponse({ ok: true, service: 'flarelens-gemini-proxy', configured: Boolean(apiKey && appPassword) }, 200, request, env);
      }
      if (!appPassword || !apiKey) {
        return jsonResponse({ error: 'Meal scanner is not configured yet.' }, 500, request, env);
      }
      if (path === '/auth/login' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ error: 'Invalid request.' }, 400, request, env);
        const ok = await verifyPasswordConstantTime(body.password || '', appPassword);
        if (!ok) {
          await sleep(450);
          return jsonResponse({ error: 'Incorrect password.' }, 401, request, env);
        }
        const session = await issueSessionToken(env);
        return jsonResponse({ ok: true, ...session }, 200, request, env);
      }
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!(await verifySessionToken(token, env))) {
        return jsonResponse({ error: 'Your session expired. Please sign in again.' }, 401, request, env);
      }
      if (path === '/auth/verify' && request.method === 'POST') return jsonResponse({ ok: true }, 200, request, env);
      if (path === '/gemini/test' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const result = await callGeminiServerSide(apiKey, body?.model || DEFAULT_MODEL, { contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }] }, 1);
        if (!result.ok) {
          return jsonResponse(
            {
              ok: false,
              code: result.status,
              error:
                result.status === 503
                  ? 'Meal scanner is busy right now. Try again in a moment.'
                  : 'Unable to reach the meal scanner right now.',
            },
            result.status || 502,
            request,
            env
          );
        }
        return jsonResponse(
          {
            ok: true,
            resolvedModel: result.resolvedModel,
            usedBackupModel: result.usedBackupModel,
            message: 'Meal scanner is connected and ready!',
          },
          200,
          request,
          env
        );
      }
      if (path === '/gemini/food-analyze' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ error: 'Invalid request.' }, 400, request, env);
        const { model, imageBase64, mimeType = 'image/jpeg', textHint } = body;
        if (!imageBase64 && !(textHint && String(textHint).trim())) {
          return jsonResponse({ error: 'Add a photo or describe what you ate first.' }, 400, request, env);
        }
        const safeMime = /^image\/(jpeg|png|webp|gif)$/i.test(String(mimeType)) ? String(mimeType) : 'image/jpeg';
        const parts = [{ text: FOOD_PROMPT }];
        if (textHint && String(textHint).trim()) parts.push({ text: `User description: ${String(textHint).trim()}` });
        if (imageBase64) parts.push({ inlineData: { mimeType: safeMime, data: String(imageBase64) } });
        const payload = {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: FOOD_RESPONSE_SCHEMA,
            maxOutputTokens: 4096,
          },
        };
        const result = await callGeminiServerSide(apiKey, model || DEFAULT_MODEL, payload, 2);
        if (!result.ok) {
          const msg =
            result.status === 503 || result.status === 524
              ? 'Meal scanning is busy right now. Please try again in a moment, or log manually.'
              : result.status === 429
              ? 'Too many scans at once. Please wait a moment and try again.'
              : 'Unable to scan right now. Please try again or log manually.';
          return jsonResponse({ error: msg, code: result.status, retriable: RETRIABLE_STATUSES.has(result.status) }, result.status || 502, request, env);
        }
        const gemJson = await result.response.json().catch(() => null);
        const rawText = gemJson?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return jsonResponse({ error: 'Could not read that meal. Please try again or log manually.' }, 502, request, env);
        let parsed;
        try {
          parsed = parseJsonFromGeminiText(rawText);
        } catch {
          return jsonResponse({ error: 'Could not read that meal cleanly. Please try again or log manually.', retriable: true }, 502, request, env);
        }
        const ingredients = dedupeIngredients(parsed.ingredients || []);
        const dishes = Array.isArray(parsed.dishes)
          ? parsed.dishes.map((d) => sanitizeShortLabel(d, 36)).filter(Boolean).slice(0, 8)
          : [];
        const cleanDishName =
          sanitizeShortLabel(parsed.dishName, 64) ||
          (dishes.length ? sanitizeShortLabel(dishes.join(', '), 64) : sanitizeShortLabel(textHint, 64)) ||
          'Scanned Meal';
        return jsonResponse(
          {
            dishName: cleanDishName,
            dishes,
            mealType: parsed.mealType || 'lunch',
            confidence: parsed.confidence || 0.88,
            summary: 'Ingredients detected.',
            analyzedByGemini: true,
            resolvedModel: result.resolvedModel,
            usedBackupModel: result.usedBackupModel,
            ingredients,
          },
          200,
          request,
          env
        );
      }
      return jsonResponse({ error: 'Not found' }, 404, request, env);
    } catch {
      return jsonResponse({ error: 'Unable to scan right now. Please try again or log manually.' }, 500, request, env);
    }
  },
};
