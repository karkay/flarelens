/**
 * FlareLens Secure Backend Proxy (Cloudflare Worker)
 *
 * Security Guarantees:
 * - GEMINI_API_KEY and APP_PASSWORD live strictly in Cloudflare Worker Secrets
 *   (NEVER in GitHub, NEVER in browser code, NEVER in DevTools Network logs).
 * - Login passwords are verified server-side using constant-time SHA-256 comparison.
 * - Authenticated sessions use HMAC-SHA256 signed 12-hour bearer tokens.
 * - Built-in 503/429 exponential backoff retries + automatic backup Gemini model failover.
 *
 * Required Worker Secrets (set in Cloudflare Dashboard -> Settings -> Variables & Secrets,
 * or via `wrangler secret put`):
 *   - GEMINI_API_KEY   (your Google AI Studio Gemini API key)
 *   - APP_PASSWORD     (your login password for FlareLens)
 *
 * Optional Environment Variables / Secrets:
 *   - SESSION_SECRET   (random string for signing tokens; defaults to HMAC of APP_PASSWORD)
 *   - ALLOWED_ORIGIN   (e.g. "https://yourusername.github.io" — restricts CORS to your GitHub Pages site)
 */

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEPRECATED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]);
const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const SESSION_TTL_SEC = 12 * 60 * 60; // 12 hours

const FOOD_PROMPT = `You are a health and nutrition assistant helping a user track food and beverage triggers for symptoms such as eczema, stomach pain/GI issues, acne, migraines, and allergies.
Identify the food or beverage shown (or described) and list ALL typical & hidden ingredients (dairy/milk/butter/cheese, wheat/gluten, soy, eggs, tree nuts, peanuts, shellfish, nightshades/tomato, citrus, high-FODMAP/garlic/onion, histamine-rich/fermented items, caffeine, alcohol, refined sugar, spicy peppers, cooking oils, additives).
Normalize recurring ingredient names (e.g., "Dairy (Cow's Milk)", "Wheat / Gluten", "Tomato (Nightshade)", "Soy", "Eggs").
Return ONLY valid JSON matching the schema.`;

const FOOD_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dishName: { type: 'STRING' },
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
          notes: { type: 'STRING' },
        },
        required: ['name', 'category', 'commonEczemaTrigger'],
      },
    },
  },
  required: ['dishName', 'mealType', 'confidence', 'summary', 'ingredients'],
};

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
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(buf);
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
  const secretSource = env.SESSION_SECRET || `flarelens-derived-secret:${env.APP_PASSWORD || ''}`;
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
    const sigBytes = fromBase64Url(sigB64);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    if (payload.iss !== 'flarelens-worker') return false;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function corsHeaders(request, env) {
  const reqOrigin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').trim();
  let allowOrigin = '*';
  if (allowed) {
    // Allow configured GitHub Pages origin + localhost for local testing
    const allowedList = allowed.split(',').map((s) => s.trim()).filter(Boolean);
    if (
      allowedList.includes(reqOrigin) ||
      reqOrigin.startsWith('http://localhost:') ||
      reqOrigin.startsWith('http://127.0.0.1:')
    ) {
      allowOrigin = reqOrigin;
    } else {
      allowOrigin = allowedList[0];
    }
  } else if (reqOrigin) {
    allowOrigin = reqOrigin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
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

async function discoverBackupModels(apiKey, excludeSet) {
  const fallbacks = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite']
    .filter((m) => !excludeSet.has(m));
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return fallbacks;
    const data = await res.json();
    const list = (data.models || [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter(
        (id) =>
          id.startsWith('gemini-') &&
          !excludeSet.has(id) &&
          !DEPRECATED_MODELS.has(id) &&
          !/(embedding|tts|imagen|veo|aqa|audio|robotics|1\.0|1\.5|2\.0|2\.5)/i.test(id)
      );
    if (!list.length) return fallbacks;
    const score = (id) => {
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

  const tryModel = async (model, retries) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delay = (attempt === 1 ? 1100 : 2500) + Math.floor(Math.random() * 350);
        await sleep(delay);
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true, response: res, model };

      lastStatus = res.status;
      lastBody = await res.text().catch(() => '');
      if (res.status === 404) return { ok: false, status: 404 };
      if (!RETRIABLE_STATUSES.has(res.status)) return { ok: false, status: res.status, fatal: true };
    }
    return { ok: false, status: lastStatus };
  };

  const first = await tryModel(primary, maxRetriesPrimary);
  if (first.ok) {
    return { ok: true, response: first.response, resolvedModel: primary, usedBackupModel: false };
  }
  if (first.fatal) {
    return { ok: false, status: first.status, errorBody: lastBody, model: primary };
  }

  const backups = (await discoverBackupModels(apiKey, tried)).slice(0, 2);
  for (const backup of backups) {
    tried.add(backup);
    const res = await tryModel(backup, 1);
    if (res.ok) {
      return { ok: true, response: res.response, resolvedModel: backup, usedBackupModel: true };
    }
    if (res.fatal) {
      return { ok: false, status: res.status, errorBody: lastBody, model: backup };
    }
  }

  return { ok: false, status: lastStatus, errorBody: lastBody, model: primary };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (path === '/health' && request.method === 'GET') {
      return jsonResponse(
        {
          ok: true,
          service: 'flarelens-gemini-proxy',
          configured: Boolean(env.GEMINI_API_KEY && env.APP_PASSWORD),
        },
        200,
        request,
        env
      );
    }

    if (!env.APP_PASSWORD || !env.GEMINI_API_KEY) {
      return jsonResponse(
        {
          error:
            'Worker secrets not configured. Set GEMINI_API_KEY and APP_PASSWORD in Cloudflare Worker Settings -> Variables & Secrets.',
        },
        500,
        request,
        env
      );
    }

    // 1. Server-side password login
    if (path === '/auth/login' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body.' }, 400, request, env);
      }

      const ok = await verifyPasswordConstantTime(body?.password || '', env.APP_PASSWORD);
      if (!ok) {
        // Mild constant slowdown to deter brute force
        await sleep(450);
        return jsonResponse({ error: 'Incorrect password.' }, 401, request, env);
      }

      const session = await issueSessionToken(env);
      return jsonResponse({ ok: true, ...session }, 200, request, env);
    }

    // All routes below require a valid signed session bearer token
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const authorized = await verifySessionToken(token, env);
    if (!authorized) {
      return jsonResponse({ error: 'Unauthorized or expired session. Please sign in again.' }, 401, request, env);
    }

    if (path === '/auth/verify' && request.method === 'POST') {
      return jsonResponse({ ok: true }, 200, request, env);
    }

    // 2. Test Gemini connection server-side
    if (path === '/gemini/test' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const result = await callGeminiServerSide(
        env.GEMINI_API_KEY,
        body?.model || DEFAULT_MODEL,
        { contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }] },
        1
      );
      if (!result.ok) {
        return jsonResponse(
          {
            ok: false,
            code: result.status,
            error:
              result.status === 503
                ? 'Gemini is currently experiencing high demand (HTTP 503). Please try again shortly.'
                : `Gemini API returned HTTP ${result.status}.`,
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
          message: result.usedBackupModel
            ? `Proxy connected via backup model ${result.resolvedModel}!`
            : `Proxy connected via ${result.resolvedModel}!`,
        },
        200,
        request,
        env
      );
    }

    // 3. Multimodal Food & Beverage Ingredient Analysis
    if (path === '/gemini/food-analyze' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON payload.' }, 400, request, env);
      }

      const { model, imageBase64, mimeType = 'image/jpeg', textHint } = body || {};
      if (!imageBase64 && !(textHint && String(textHint).trim())) {
        return jsonResponse({ error: 'Provide either a food photo or a description.' }, 400, request, env);
      }

      const parts = [{ text: FOOD_PROMPT }];
      if (textHint && String(textHint).trim()) {
        parts.push({ text: `User description: ${String(textHint).trim()}` });
      }
      if (imageBase64) {
        parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
      }

      const payload = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: FOOD_RESPONSE_SCHEMA,
        },
      };

      const result = await callGeminiServerSide(env.GEMINI_API_KEY, model || DEFAULT_MODEL, payload, 2);
      if (!result.ok) {
        const msg =
          result.status === 503
            ? 'Gemini is experiencing temporary high demand (HTTP 503). Retries and backup models were also busy—please retry in a moment or log ingredients manually.'
            : result.status === 429
            ? 'Gemini rate limit reached (HTTP 429). Please wait a moment and retry.'
            : `Gemini API returned HTTP ${result.status}.`;
        return jsonResponse(
          { error: msg, code: result.status, retriable: RETRIABLE_STATUSES.has(result.status) },
          result.status || 502,
          request,
          env
        );
      }

      const gemJson = await result.response.json();
      const rawText = gemJson?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        return jsonResponse({ error: 'Gemini returned an empty response.' }, 502, request, env);
      }

      const parsed = JSON.parse(rawText);
      const ingredients = (parsed.ingredients || []).map((item, idx) => ({
        id: `gem_${Date.now()}_${idx}`,
        name: item.name,
        normalizedKey: normalizeIngredientKey(item.name),
        category: item.category || 'Ingredient',
        commonEczemaTrigger: Boolean(item.commonEczemaTrigger),
        triggerGroup: item.triggerGroup || '',
        notes: item.notes || '',
        included: true,
      }));

      const baseSummary = parsed.summary || 'Ingredients extracted securely via FlareLens Proxy.';
      return jsonResponse(
        {
          dishName: parsed.dishName || textHint || 'Scanned Meal',
          mealType: parsed.mealType || 'lunch',
          confidence: parsed.confidence || 0.88,
          summary: result.usedBackupModel
            ? `${baseSummary} (Backup model ${result.resolvedModel})`
            : baseSummary,
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
