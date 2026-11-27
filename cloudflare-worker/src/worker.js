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

const FOOD_PROMPT = `You are a health and nutrition assistant helping a user track food and beverage triggers for symptoms such as eczema, stomach pain/GI issues, acne, migraines, and allergies.
The user may provide a photo and/or text describing ONE OR MULTIPLE dishes, sides, and beverages eaten together (separated by commas, "and", or new lines).
1. Identify EVERY dish and beverage mentioned or pictured and list them in the "dishes" array.
2. Extract ALL typical & hidden ingredients across ALL dishes (dairy/milk/butter/cheese, wheat/gluten, soy, eggs, tree nuts, peanuts, shellfish, nightshades/tomato, citrus, high-FODMAP/garlic/onion, histamine-rich/fermented items, caffeine, alcohol, refined sugar, spicy peppers, cooking oils, additives).
3. DEDUPLICATE shared ingredients across dishes: if two dishes share an ingredient (e.g., butter/cheese in two dishes, or wheat in both pasta and garlic bread), output ONE normalized ingredient entry (e.g., "Dairy (Cow's Milk)", "Wheat / Gluten", "Tomato (Nightshade)", "Soy", "Eggs") instead of splitting by dish, and list the dish names in "foundIn" (e.g., "Tomato Pasta, Garlic Bread").
4. Set "dishName" to a concise combined title for all dishes (e.g., "Tomato Pasta, Garlic Bread & Iced Latte").
Return ONLY valid JSON with keys: dishName (string), dishes (string[]), mealType ("breakfast"|"lunch"|"dinner"|"snack"|"beverage"), confidence (number 0-1), summary (string), ingredients (array of { name, category, commonEczemaTrigger (boolean), triggerGroup (string), foundIn (string), notes (string) }).`;

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
function dedupeIngredients(rawList) {
  const byKey = new Map();
  const order = [];
  const mergeList = (a, b) => {
    const items = `${a || ''},${b || ''}`
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set();
    return items.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(', ');
  };
  (rawList || []).forEach((item, idx) => {
    const rawName = String(item?.name || '').trim();
    if (!rawName) return;
    const key = normalizeIngredientKey(rawName);
    const parenMatch = /\(([^)]+)\)/.exec(rawName);
    const baseName = rawName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (!byKey.has(key)) {
      const entry = {
        id: `gem_${Date.now()}_${idx}`,
        name: rawName,
        normalizedKey: key,
        category: item.category || 'Ingredient',
        commonEczemaTrigger: Boolean(item.commonEczemaTrigger),
        triggerGroup: item.triggerGroup || '',
        foundIn: String(item.foundIn || '').trim(),
        notes: item.notes || '',
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
      if (!existing.triggerGroup && item.triggerGroup) existing.triggerGroup = item.triggerGroup;
      // When duplicates like "Wheat / Gluten (Pasta)" & "Wheat / Gluten (Bread)" merge, use clean base name
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
        const relaxed = { ...activePayload, generationConfig: { responseMimeType: 'application/json' } };
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
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const apiKey = cleanSecret(env.GEMINI_API_KEY);
    const appPassword = cleanSecret(env.APP_PASSWORD);
    if (path === '/health' && request.method === 'GET') {
      return jsonResponse({ ok: true, service: 'flarelens-gemini-proxy', configured: Boolean(apiKey && appPassword) }, 200, request, env);
    }
    if (!appPassword || !apiKey) {
      return jsonResponse({ error: 'Worker secrets not configured yet. Set GEMINI_API_KEY and APP_PASSWORD.' }, 500, request, env);
    }
    if (path === '/auth/login' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) return jsonResponse({ error: 'Invalid JSON body.' }, 400, request, env);
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
      return jsonResponse({ error: 'Unauthorized or expired session. Please sign in again.' }, 401, request, env);
    }
    if (path === '/auth/verify' && request.method === 'POST') return jsonResponse({ ok: true }, 200, request, env);
    if (path === '/gemini/test' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const result = await callGeminiServerSide(apiKey, body?.model || DEFAULT_MODEL, { contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }] }, 1);
      if (!result.ok) {
        const detail = extractSafeGeminiError(result.errorBody, apiKey);
        return jsonResponse(
          {
            ok: false,
            code: result.status,
            model: result.model,
            error:
              result.status === 503
                ? 'Gemini is currently experiencing high demand (HTTP 503).'
                : `Gemini API HTTP ${result.status} (${result.model}): ${detail || 'Request failed'}`,
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
          message: result.usedBackupModel ? `Connected via backup model ${result.resolvedModel}!` : `Connected via ${result.resolvedModel}!`,
        },
        200,
        request,
        env
      );
    }
    if (path === '/gemini/food-analyze' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) return jsonResponse({ error: 'Invalid JSON payload.' }, 400, request, env);
      const { model, imageBase64, mimeType = 'image/jpeg', textHint } = body;
      if (!imageBase64 && !(textHint && String(textHint).trim())) {
        return jsonResponse({ error: 'Provide either a food photo or a description.' }, 400, request, env);
      }
      const safeMime = /^image\/(jpeg|png|webp|gif)$/i.test(String(mimeType)) ? String(mimeType) : 'image/jpeg';
      const parts = [{ text: FOOD_PROMPT }];
      if (textHint && String(textHint).trim()) parts.push({ text: `User description: ${String(textHint).trim()}` });
      if (imageBase64) parts.push({ inlineData: { mimeType: safeMime, data: String(imageBase64) } });
      const payload = {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: FOOD_RESPONSE_SCHEMA },
      };
      const result = await callGeminiServerSide(apiKey, model || DEFAULT_MODEL, payload, 2);
      if (!result.ok) {
        const detail = extractSafeGeminiError(result.errorBody, apiKey);
        const msg =
          result.status === 503
            ? 'Gemini is experiencing temporary high demand (HTTP 503). Retries and backup models were also busy—please retry or log ingredients manually.'
            : result.status === 429
            ? 'Gemini rate limit reached (HTTP 429). Please wait a moment and retry.'
            : `Gemini API HTTP ${result.status} (${result.model}): ${detail || 'Request failed'}`;
        return jsonResponse({ error: msg, code: result.status, retriable: RETRIABLE_STATUSES.has(result.status) }, result.status || 502, request, env);
      }
      const gemJson = await result.response.json();
      const rawText = gemJson?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return jsonResponse({ error: 'Gemini returned an empty response.' }, 502, request, env);
      const parsed = parseJsonFromGeminiText(rawText);
      const ingredients = dedupeIngredients(parsed.ingredients || []);
      const dishes = Array.isArray(parsed.dishes)
        ? parsed.dishes.map((d) => String(d || '').trim()).filter(Boolean)
        : [];
      const baseSummary = parsed.summary || 'Ingredients extracted securely.';
      return jsonResponse(
        {
          dishName: parsed.dishName || (dishes.length ? dishes.join(', ') : textHint) || 'Scanned Meal',
          dishes,
          mealType: parsed.mealType || 'lunch',
          confidence: parsed.confidence || 0.88,
          summary: result.usedBackupModel ? `${baseSummary} (Backup model ${result.resolvedModel})` : baseSummary,
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
  },
};
