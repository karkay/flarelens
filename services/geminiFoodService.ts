import { DetectedIngredient, FoodLogEntry } from '../types';

export interface GeminiFoodAnalysisResult {
  dishName: string;
  mealType: FoodLogEntry['mealType'];
  confidence: number;
  summary: string;
  analyzedByGemini: boolean;
  resolvedModel?: string;
  shouldPersistModel?: boolean;
  ingredients: DetectedIngredient[];
}

export interface GeminiErrorDetails {
  code: number;
  retriable: boolean;
  userMessage: string;
  detail: string;
  model?: string;
}

export class GeminiRequestError extends Error {
  details: GeminiErrorDetails;
  constructor(details: GeminiErrorDetails) {
    super(details.userMessage);
    this.name = 'GeminiRequestError';
    this.details = details;
  }
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEPRECATED_GEMINI_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]);
const RETRIABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function sanitizeGeminiModel(model?: string): string {
  if (!model || DEPRECATED_GEMINI_MODELS.has(model)) return DEFAULT_GEMINI_MODEL;
  return model;
}

export function normalizeIngredientKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown_ingredient'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGeminiErrorBody(status: number, rawText: string, model: string): GeminiErrorDetails {
  let apiMessage = '';
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string } };
    apiMessage = parsed?.error?.message ?? '';
  } catch {
    apiMessage = rawText.slice(0, 180);
  }

  if (status === 503) {
    return {
      code: 503,
      retriable: true,
      model,
      userMessage:
        'Gemini is currently experiencing high demand (HTTP 503). Automatic retries and backup models were also busy—please retry in a moment or log ingredients manually.',
      detail: apiMessage || 'Service temporarily overloaded.',
    };
  }
  if (status === 429) {
    return {
      code: 429,
      retriable: true,
      model,
      userMessage:
        'Gemini rate limit or quota temporarily reached (HTTP 429). Wait a few seconds and retry, or log ingredients manually.',
      detail: apiMessage || 'Too many requests.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: status,
      retriable: false,
      model,
      userMessage: `Gemini API key was rejected (HTTP ${status}). Please verify your API key in Settings.`,
      detail: apiMessage || 'Authentication error.',
    };
  }
  if (status === 404) {
    return {
      code: 404,
      retriable: false,
      model,
      userMessage:
        'Selected Gemini model is unavailable (HTTP 404). Open Settings → Test Connection to select an active model.',
      detail: apiMessage || 'Model not found.',
    };
  }
  if (status >= 500) {
    return {
      code: status,
      retriable: true,
      model,
      userMessage: `Gemini server error (HTTP ${status}). This is usually temporary—please retry or log ingredients manually.`,
      detail: apiMessage || 'Temporary server error.',
    };
  }
  return {
    code: status,
    retriable: false,
    model,
    userMessage: `Gemini request failed (HTTP ${status}): ${apiMessage || 'Unknown error'}`,
    detail: apiMessage,
  };
}

async function discoverAvailableGeminiModels(
  apiKey: string,
  excludeSet: Set<string>
): Promise<string[]> {
  const knownBackups = [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-3.5-flash-lite',
  ].filter((id) => !excludeSet.has(id));

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
        apiKey.trim()
      )}`
    );
    if (!res.ok) return knownBackups;
    const data = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const candidates = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => String(m.name ?? '').replace(/^models\//, ''))
      .filter(
        (id) =>
          id.startsWith('gemini-') &&
          !excludeSet.has(id) &&
          !DEPRECATED_GEMINI_MODELS.has(id) &&
          !/(embedding|tts|imagen|veo|aqa|audio|robotics|1\.0|1\.5|2\.0|2\.5)/i.test(id)
      );

    if (candidates.length === 0) return knownBackups;

    const scoreModel = (id: string) => {
      let score = 0;
      if (id === 'gemini-flash-latest') score += 50;
      if (id.includes('flash') && !id.includes('lite')) score += 40;
      else if (id.includes('flash')) score += 35;
      else if (id.includes('pro')) score += 20;
      if (!id.includes('preview') && !id.includes('exp')) score += 15;
      const ver = /gemini-(\d+(?:\.\d+)?)/.exec(id);
      if (ver) score += parseFloat(ver[1]) * 10;
      return score;
    };

    candidates.sort((a, b) => scoreModel(b) - scoreModel(a));
    return candidates;
  } catch {
    return knownBackups;
  }
}

async function postGeminiGenerate(
  apiKey: string,
  model: string,
  payload: Record<string, unknown>,
  timeoutMs = 25000
): Promise<Response> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callGeminiWithResilience(params: {
  apiKey: string;
  model: string;
  payload: Record<string, unknown>;
  onStatus?: (message: string) => void;
  maxRetriesPrimary?: number;
}): Promise<{
  response: Response;
  resolvedModel: string;
  usedBackupModel: boolean;
  shouldPersistModel: boolean;
}> {
  const { apiKey, model, payload, onStatus, maxRetriesPrimary = 2 } = params;
  const primaryModel = sanitizeGeminiModel(model);
  const triedModels = new Set<string>([primaryModel]);
  let lastError: GeminiErrorDetails | null = null;
  let shouldPersistModel = false;

  const attemptModel = async (
    targetModel: string,
    maxRetries: number
  ): Promise<
    | { ok: true; response: Response }
    | { ok: false; status: number; error: GeminiErrorDetails; fatal?: boolean }
  > => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const baseDelay = attempt === 1 ? 1200 : 2800;
        const waitMs = baseDelay + Math.round(Math.random() * 450);
        onStatus?.(
          `${targetModel} is busy (high demand) — retrying in ${(waitMs / 1000).toFixed(
            1
          )}s (attempt ${attempt + 1}/${maxRetries + 1})…`
        );
        await sleep(waitMs);
      }

      try {
        const res = await postGeminiGenerate(apiKey, targetModel, payload);
        if (res.ok) return { ok: true, response: res };

        const rawText = await res.text().catch(() => '');
        const parsedErr = parseGeminiErrorBody(res.status, rawText, targetModel);
        lastError = parsedErr;

        if (res.status === 404) {
          shouldPersistModel = true;
          return { ok: false, status: 404, error: parsedErr };
        }
        if (!RETRIABLE_HTTP_STATUSES.has(res.status)) {
          return { ok: false, status: res.status, error: parsedErr, fatal: true };
        }

        const retryAfterSec = parseInt(res.headers.get('retry-after') ?? '', 10);
        if (!Number.isNaN(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 6 && attempt < maxRetries) {
          onStatus?.(`Server asked to wait ${retryAfterSec}s before retrying ${targetModel}…`);
          await sleep(retryAfterSec * 1000);
        }
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        lastError = {
          code: 0,
          retriable: true,
          model: targetModel,
          userMessage: isTimeout
            ? 'Request to Gemini timed out. Check your connection and retry, or log ingredients manually.'
            : 'Network error reaching Gemini. Check your connection or log ingredients manually.',
          detail: err instanceof Error ? err.message : 'Network failure',
        };
      }
    }
    return {
      ok: false,
      status: lastError?.code ?? 503,
      error:
        lastError ?? {
          code: 503,
          retriable: true,
          model: targetModel,
          userMessage: 'Gemini is temporarily overloaded. Please retry or log ingredients manually.',
          detail: 'Service unavailable',
        },
    };
  };

  onStatus?.(`Analyzing with ${primaryModel}…`);
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
    throw new GeminiRequestError(primaryRes.error);
  }

  onStatus?.(
    primaryRes.status === 404
      ? `${primaryModel} unavailable — discovering an active Gemini model…`
      : `${primaryModel} is experiencing high demand — trying a backup Gemini model…`
  );

  const backups = (await discoverAvailableGeminiModels(apiKey, triedModels)).slice(0, 2);
  for (const backupModel of backups) {
    triedModels.add(backupModel);
    onStatus?.(`Trying backup model ${backupModel}…`);
    const backupRes = await attemptModel(backupModel, 1);
    if (backupRes.ok) {
      return {
        response: backupRes.response,
        resolvedModel: backupModel,
        usedBackupModel: true,
        shouldPersistModel,
      };
    }
    if (backupRes.fatal) {
      throw new GeminiRequestError(backupRes.error);
    }
  }

  throw new GeminiRequestError(
    lastError ?? {
      code: 503,
      retriable: true,
      userMessage: 'Gemini is temporarily unavailable. Please retry or log ingredients manually.',
      detail: 'All retries and backup models exhausted.',
    }
  );
}

const FOOD_ANALYSIS_PROMPT = `You are a dermatology nutrition assistant helping a patient with atopic dermatitis (eczema) track food and beverage triggers.
Identify the food or beverage shown (or described) and list ALL typical ingredients — including commonly hidden ingredients such as cooking oils, dairy/butter/cream, soy sauce, wheat/gluten, eggs, tree nuts, peanuts, shellfish, nightshades (tomato/peppers/eggplant), citrus, histamine-rich/fermented items, caffeine, alcohol, refined sugar, or food additives.

Normalize ingredient names so recurring ingredients match across meals (for example, always use "Dairy (Cow's Milk)" for milk/cream/butter/cheese, "Wheat / Gluten" for wheat flour/bread/pasta, "Tomato (Nightshade)" for tomato sauce/tomatoes, "Soy" for soy sauce/tofu/edamame, "Eggs" for eggs/mayonnaise).

Return ONLY valid JSON matching the requested schema.`;

const RESPONSE_SCHEMA = {
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

interface RawGeminiFoodResponse {
  dishName?: string;
  mealType?: FoodLogEntry['mealType'];
  confidence?: number;
  summary?: string;
  ingredients?: {
    name: string;
    category?: string;
    commonEczemaTrigger?: boolean;
    triggerGroup?: string;
    notes?: string;
  }[];
}

export async function analyzeFoodWithGemini(params: {
  apiKey: string;
  model: string;
  imageBase64?: string;
  mimeType?: string;
  textHint?: string;
  onStatus?: (message: string) => void;
}): Promise<GeminiFoodAnalysisResult> {
  const { apiKey, model, imageBase64, mimeType = 'image/jpeg', textHint, onStatus } = params;

  if (!apiKey.trim()) {
    return buildOfflinePreviewAnalysis(textHint);
  }

  const parts: Record<string, unknown>[] = [{ text: FOOD_ANALYSIS_PROMPT }];
  if (textHint && textHint.trim()) {
    parts.push({ text: `Additional context from user: ${textHint.trim()}` });
  }
  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBase64,
      },
    });
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const callResult = await callGeminiWithResilience({
    apiKey,
    model,
    payload,
    onStatus,
    maxRetriesPrimary: 2,
  });

  const json = await callResult.response.json();
  const rawText: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response. Please retry or log ingredients manually.');
  }

  const parsed = JSON.parse(rawText) as RawGeminiFoodResponse;
  const ingredients: DetectedIngredient[] = (parsed.ingredients ?? []).map((item, idx) => ({
    id: `gem_ing_${Date.now()}_${idx}`,
    name: item.name,
    normalizedKey: normalizeIngredientKey(item.name),
    category: item.category || 'Ingredient',
    commonEczemaTrigger: Boolean(item.commonEczemaTrigger),
    triggerGroup: item.triggerGroup || undefined,
    notes: item.notes || undefined,
    included: true,
  }));

  const baseSummary =
    parsed.summary ||
    `Identified ${ingredients.length} typical ingredients for eczema trigger tracking.`;

  return {
    dishName: parsed.dishName || textHint || 'Scanned Meal',
    mealType: parsed.mealType || 'snack',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
    summary: callResult.usedBackupModel
      ? `${baseSummary} (Analyzed via backup model ${callResult.resolvedModel})`
      : baseSummary,
    analyzedByGemini: true,
    resolvedModel: callResult.resolvedModel,
    shouldPersistModel: callResult.shouldPersistModel,
    ingredients,
  };
}

export async function testGeminiConnection(
  apiKey: string,
  model: string,
  onStatus?: (message: string) => void
): Promise<{ ok: boolean; resolvedModel?: string; shouldPersistModel?: boolean; message: string }> {
  if (!apiKey.trim()) {
    return { ok: false, message: 'Please enter a Gemini API key first.' };
  }
  try {
    const result = await callGeminiWithResilience({
      apiKey,
      model,
      payload: {
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
      },
      onStatus,
      maxRetriesPrimary: 1,
    });
    return {
      ok: true,
      resolvedModel: result.resolvedModel,
      shouldPersistModel: result.shouldPersistModel || result.usedBackupModel,
      message: result.usedBackupModel
        ? `Connected using backup model ${result.resolvedModel}!`
        : `Connected successfully to ${result.resolvedModel}!`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Network error connecting to Gemini.',
    };
  }
}

export function buildManualFallbackDraft(textHint?: string): GeminiFoodAnalysisResult {
  const mk = (name: string, category: string, triggerGroup: string): DetectedIngredient => ({
    id: `man_${normalizeIngredientKey(name)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    normalizedKey: normalizeIngredientKey(name),
    category,
    commonEczemaTrigger: true,
    triggerGroup,
    notes: 'Tap to include if present in this meal.',
    included: false,
  });

  return {
    dishName: textHint?.trim() || 'My Meal',
    mealType: 'lunch',
    confidence: 0,
    analyzedByGemini: false,
    summary: 'Manual entry mode — check any ingredients present or add your own below.',
    ingredients: [
      mk("Dairy (Cow's Milk)", 'Dairy', 'Dairy / Casein'),
      mk('Wheat / Gluten', 'Grain', 'Gluten'),
      mk('Eggs', 'Protein', 'Eggs'),
      mk('Soy', 'Legume', 'Soy'),
      mk('Tomato (Nightshade)', 'Produce', 'Nightshades'),
      mk('Tree Nuts / Peanuts', 'Nuts', 'Nuts'),
      mk('Caffeine', 'Beverage', 'Stimulant'),
    ],
  };
}

function buildOfflinePreviewAnalysis(textHint?: string): GeminiFoodAnalysisResult {
  const lower = (textHint || '').toLowerCase();

  if (lower.includes('coffee') || lower.includes('latte') || lower.includes('cappuccino')) {
    return {
      dishName: textHint || 'Iced Vanilla Latte',
      mealType: 'beverage',
      confidence: 0.78,
      summary:
        'Demo preview (add your Gemini API key in Settings for live photo vision). Typical latte ingredients extracted below.',
      analyzedByGemini: false,
      ingredients: [
        makePreviewIng("Dairy (Cow's Milk)", 'Dairy', true, 'Dairy / Casein', 'Steamed or cold cow milk.'),
        makePreviewIng('Caffeine', 'Beverage', false, undefined, 'Espresso base.'),
        makePreviewIng('Refined Sugar', 'Sweetener', true, 'Inflammatory / Sugar', 'Flavored syrup.'),
      ],
    };
  }

  if (lower.includes('pasta') || lower.includes('pizza') || lower.includes('tomato')) {
    return {
      dishName: textHint || 'Tomato Basil Pasta',
      mealType: 'dinner',
      confidence: 0.8,
      summary:
        'Demo preview (add your Gemini API key in Settings for live photo vision). Common pasta & marinara ingredients extracted.',
      analyzedByGemini: false,
      ingredients: [
        makePreviewIng('Wheat / Gluten', 'Grain', true, 'Gluten', 'Standard durum wheat pasta.'),
        makePreviewIng('Tomato (Nightshade)', 'Produce', true, 'Nightshades / Histamine', 'Cooked tomato sauce.'),
        makePreviewIng("Dairy (Cow's Milk)", 'Dairy', true, 'Dairy / Casein', 'Parmesan / butter garnish.'),
        makePreviewIng('Garlic & Olive Oil', 'Seasoning', false),
      ],
    };
  }

  return {
    dishName: textHint || 'Captured Meal (Preview Mode)',
    mealType: 'lunch',
    confidence: 0.72,
    summary:
      'Preview mode active — add a Gemini API key in Settings to analyze food photos with Gemini Vision. You can edit or add ingredients below.',
    analyzedByGemini: false,
    ingredients: [
      makePreviewIng("Dairy (Cow's Milk)", 'Dairy', true, 'Dairy / Casein', 'Common in sauces, butter, or cheese.'),
      makePreviewIng('Wheat / Gluten', 'Grain', true, 'Gluten', 'Bread, batter, or pasta.'),
      makePreviewIng('Soy', 'Legume', true, 'Soy / Histamine', 'Frequently present in marinades & dressings.'),
      makePreviewIng('Eggs', 'Protein', true, 'Eggs', 'Common binding agent or protein.'),
    ],
  };
}

function makePreviewIng(
  name: string,
  category: string,
  commonEczemaTrigger: boolean,
  triggerGroup?: string,
  notes?: string
): DetectedIngredient {
  return {
    id: `prev_${normalizeIngredientKey(name)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    normalizedKey: normalizeIngredientKey(name),
    category,
    commonEczemaTrigger,
    triggerGroup,
    notes,
    included: true,
  };
}
