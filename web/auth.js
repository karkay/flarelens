(function (global) {
  'use strict';

  const AUTH_STORAGE_KEY = 'flarelens_local_auth_v1';
  const SESSION_KEY = 'flarelens_unlocked_session_v1';
  const PROXY_TOKEN_KEY = 'flarelens_proxy_token_v1';
  const PROXY_URL_STORAGE_KEY = 'flarelens_proxy_url_v1';
  const DEFAULT_ITERATIONS = 200000;

  function normalizeProxyUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function getProxyUrl() {
    const siteUrl = normalizeProxyUrl(global.FLARELENS_AUTH_CONFIG && global.FLARELENS_AUTH_CONFIG.proxyUrl);
    if (siteUrl) return siteUrl;
    try {
      return normalizeProxyUrl(localStorage.getItem(PROXY_URL_STORAGE_KEY));
    } catch (_) {
      return '';
    }
  }

  function saveLocalProxyUrl(url) {
    const clean = normalizeProxyUrl(url);
    try {
      if (clean) localStorage.setItem(PROXY_URL_STORAGE_KEY, clean);
      else localStorage.removeItem(PROXY_URL_STORAGE_KEY);
    } catch (_) {}
    return clean;
  }

  function getProxyToken() {
    try {
      return sessionStorage.getItem(PROXY_TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function saveProxyToken(token) {
    try {
      if (token) sessionStorage.setItem(PROXY_TOKEN_KEY, token);
      else sessionStorage.removeItem(PROXY_TOKEN_KEY);
    } catch (_) {}
  }

  async function loginViaProxy(password, proxyUrl) {
    const base = normalizeProxyUrl(proxyUrl || getProxyUrl());
    if (!base) return { ok: false, error: 'Proxy URL is not configured.' };
    try {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        return { ok: false, error: data.error || `Login failed (HTTP ${res.status}).` };
      }
      saveProxyToken(data.token);
      return { ok: true, token: data.token, expiresAt: data.expiresAt };
    } catch (_) {
      return { ok: false, error: 'Unable to reach FlareLens proxy server. Check your connection or Worker URL.' };
    }
  }

  async function verifyProxySession(proxyUrl) {
    const base = normalizeProxyUrl(proxyUrl || getProxyUrl());
    const token = getProxyToken();
    if (!base || !token) return false;
    try {
      const res = await fetch(`${base}/auth/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        saveProxyToken('');
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function bytesToB64(bytes) {
    let bin = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(len) {
    const out = new Uint8Array(len);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(out);
    } else {
      for (let i = 0; i < len; i++) out[i] = Math.floor(Math.random() * 256);
    }
    return out;
  }

  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }

  function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function hasWebCrypto() {
    return Boolean(global.crypto && global.crypto.subtle && global.isSecureContext !== false);
  }

  // --- Pure-JS SHA-256 / HMAC-SHA256 / PBKDF2 fallback for plain HTTP LAN testing ---
  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256Fallback(data) {
    const msg = data instanceof Uint8Array ? data : new Uint8Array(data);
    const bitLen = msg.length * 8;
    const paddedLen = Math.ceil((msg.length + 9) / 64) * 64;
    const buf = new Uint8Array(paddedLen);
    buf.set(msg);
    buf[msg.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(paddedLen - 4, bitLen >>> 0, false);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let i = 0; i < paddedLen; i += 64) {
      for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
      for (let j = 16; j < 64; j++) {
        const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let j = 0; j < 64; j++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K256[j] + w[j]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const dv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, idx) => dv.setUint32(idx * 4, v, false));
    return out;
  }

  function hmacSha256Fallback(keyBytes, msgBytes) {
    const k = keyBytes.length > 64 ? sha256Fallback(keyBytes) : keyBytes;
    const ipad = new Uint8Array(64 + msgBytes.length);
    const opad = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) {
      const kb = i < k.length ? k[i] : 0;
      ipad[i] = kb ^ 0x36;
      opad[i] = kb ^ 0x5c;
    }
    ipad.set(msgBytes, 64);
    opad.set(sha256Fallback(ipad), 64);
    return sha256Fallback(opad);
  }

  function pbkdf2Sha256Fallback(passwordBytes, saltBytes, iterations, dkLen) {
    const blocks = Math.ceil(dkLen / 32);
    const out = new Uint8Array(blocks * 32);
    for (let b = 1; b <= blocks; b++) {
      const saltBlock = new Uint8Array(saltBytes.length + 4);
      saltBlock.set(saltBytes);
      saltBlock[saltBytes.length] = (b >>> 24) & 0xff;
      saltBlock[saltBytes.length + 1] = (b >>> 16) & 0xff;
      saltBlock[saltBytes.length + 2] = (b >>> 8) & 0xff;
      saltBlock[saltBytes.length + 3] = b & 0xff;
      let u = hmacSha256Fallback(passwordBytes, saltBlock);
      const t = new Uint8Array(u);
      for (let i = 1; i < iterations; i++) {
        u = hmacSha256Fallback(passwordBytes, u);
        for (let j = 0; j < 32; j++) t[j] ^= u[j];
      }
      out.set(t, (b - 1) * 32);
    }
    return out.slice(0, dkLen);
  }

  /**
   * Derives 64 bytes via PBKDF2-HMAC-SHA256:
   * - bytes 0..31: AES-256-GCM encryption key (never stored)
   * - bytes 32..63: Password verifier hash (stored in auth-config.js)
   */
  async function deriveKeyMaterial(password, saltBytes, iterations = DEFAULT_ITERATIONS) {
    const passBytes = utf8Encode(password);
    if (hasWebCrypto()) {
      const baseKey = await global.crypto.subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits']);
      const bits = await global.crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
        baseKey,
        512
      );
      const all = new Uint8Array(bits);
      return {
        aesKeyBytes: all.slice(0, 32),
        verifierB64: bytesToB64(all.slice(32, 64)),
      };
    }

    // Fallback when served over non-localhost HTTP LAN (cap iterations for UI responsiveness on mobile CPU)
    const all = pbkdf2Sha256Fallback(passBytes, saltBytes, iterations, 64);
    return {
      aesKeyBytes: all.slice(0, 32),
      verifierB64: bytesToB64(all.slice(32, 64)),
    };
  }

  async function encryptWithAesKey(plaintext, aesKeyBytes) {
    const plainBytes = utf8Encode(plaintext);
    const iv = randomBytes(12);
    if (hasWebCrypto()) {
      const key = await global.crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
      const cipherBuf = await global.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
      return {
        alg: 'AES-256-GCM',
        ivB64: bytesToB64(iv),
        ciphertextB64: bytesToB64(new Uint8Array(cipherBuf)),
      };
    }

    // Fallback stream cipher + HMAC-SHA256 (only used on plain HTTP LAN when Web Crypto is unavailable)
    const keystream = new Uint8Array(plainBytes.length);
    for (let offset = 0, ctr = 0; offset < plainBytes.length; offset += 32, ctr++) {
      const block = hmacSha256Fallback(aesKeyBytes, new Uint8Array([...iv, ctr & 0xff]));
      keystream.set(block.slice(0, Math.min(32, plainBytes.length - offset)), offset);
    }
    const ct = new Uint8Array(plainBytes.length);
    for (let i = 0; i < plainBytes.length; i++) ct[i] = plainBytes[i] ^ keystream[i];
    const mac = hmacSha256Fallback(aesKeyBytes, new Uint8Array([...iv, ...ct]));
    return {
      alg: 'HMAC-STREAM-FALLBACK',
      ivB64: bytesToB64(iv),
      ciphertextB64: bytesToB64(ct),
      macB64: bytesToB64(mac),
    };
  }

  async function decryptWithAesKey(vault, aesKeyBytes) {
    if (!vault || !vault.ciphertextB64 || !vault.ivB64) return '';
    const iv = b64ToBytes(vault.ivB64);
    const ct = b64ToBytes(vault.ciphertextB64);

    if (vault.alg === 'AES-256-GCM') {
      if (!hasWebCrypto()) {
        throw new Error('AES-256-GCM decryption requires HTTPS (GitHub Pages) or localhost.');
      }
      const key = await global.crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      const plainBuf = await global.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return utf8Decode(new Uint8Array(plainBuf));
    }

    if (vault.alg === 'HMAC-STREAM-FALLBACK') {
      const expectedMac = bytesToB64(hmacSha256Fallback(aesKeyBytes, new Uint8Array([...iv, ...ct])));
      if (!constantTimeEqual(expectedMac, vault.macB64 || '')) {
        throw new Error('Invalid password or tampered vault.');
      }
      const keystream = new Uint8Array(ct.length);
      for (let offset = 0, ctr = 0; offset < ct.length; offset += 32, ctr++) {
        const block = hmacSha256Fallback(aesKeyBytes, new Uint8Array([...iv, ctr & 0xff]));
        keystream.set(block.slice(0, Math.min(32, ct.length - offset)), offset);
      }
      const plain = new Uint8Array(ct.length);
      for (let i = 0; i < ct.length; i++) plain[i] = ct[i] ^ keystream[i];
      return utf8Decode(plain);
    }

    throw new Error('Unsupported encryption vault format.');
  }

  function getActiveAuthConfig() {
    const siteCfg = global.FLARELENS_AUTH_CONFIG;
    if (siteCfg && siteCfg.configured && siteCfg.saltB64 && siteCfg.passwordHashB64) {
      return { ...siteCfg, source: 'site_config' };
    }
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.configured && parsed.saltB64 && parsed.passwordHashB64) {
          return { ...parsed, source: 'local_storage' };
        }
      }
    } catch (_) {}
    return { configured: false, source: 'none' };
  }

  function saveLocalAuthConfig(cfg) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...cfg, configured: true }));
  }

  async function buildAuthConfig(password, geminiApiKey = '') {
    const iterations = hasWebCrypto() ? DEFAULT_ITERATIONS : 25000;
    const salt = randomBytes(16);
    const { aesKeyBytes, verifierB64 } = await deriveKeyMaterial(password, salt, iterations);
    const encryptedGeminiKey = geminiApiKey && geminiApiKey.trim()
      ? await encryptWithAesKey(geminiApiKey.trim(), aesKeyBytes)
      : null;

    return {
      config: {
        configured: true,
        iterations,
        saltB64: bytesToB64(salt),
        passwordHashB64: verifierB64,
        encryptedGeminiKey,
      },
      aesKeyBytes,
    };
  }

  async function unlockWithPassword(password) {
    const cfg = getActiveAuthConfig();
    if (!cfg.configured) return { ok: false, error: 'No password configured yet.' };
    const salt = b64ToBytes(cfg.saltB64);
    const { aesKeyBytes, verifierB64 } = await deriveKeyMaterial(password, salt, cfg.iterations || DEFAULT_ITERATIONS);
    if (!constantTimeEqual(verifierB64, cfg.passwordHashB64)) {
      return { ok: false, error: 'Incorrect password.' };
    }

    let decryptedGeminiKey = '';
    if (cfg.encryptedGeminiKey) {
      try {
        decryptedGeminiKey = await decryptWithAesKey(cfg.encryptedGeminiKey, aesKeyBytes);
      } catch (_) {
        decryptedGeminiKey = '';
      }
    }

    return {
      ok: true,
      aesKeyBytes,
      decryptedGeminiKey,
      config: cfg,
    };
  }

  function saveSessionKey(aesKeyBytes) {
    try {
      sessionStorage.setItem(SESSION_KEY, bytesToB64(aesKeyBytes));
    } catch (_) {}
  }

  function loadSessionKey() {
    try {
      const b64 = sessionStorage.getItem(SESSION_KEY);
      return b64 ? b64ToBytes(b64) : null;
    } catch (_) {
      return null;
    }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(PROXY_TOKEN_KEY);
    } catch (_) {}
  }

  function formatAuthConfigFile(cfg) {
    const proxyUrl = normalizeProxyUrl(cfg.proxyUrl || getProxyUrl());
    return (
      '// FlareLens Authentication & Backend Proxy Configuration\n' +
      '// Safe to commit to GitHub Pages (zero plaintext passwords or API keys).\n' +
      'window.FLARELENS_AUTH_CONFIG = ' +
      JSON.stringify(
        proxyUrl
          ? {
              proxyUrl,
              configured: true,
              iterations: 200000,
              saltB64: '',
              passwordHashB64: '',
              encryptedGeminiKey: null,
            }
          : {
              proxyUrl: '',
              configured: true,
              iterations: cfg.iterations,
              saltB64: cfg.saltB64,
              passwordHashB64: cfg.passwordHashB64,
              encryptedGeminiKey: cfg.encryptedGeminiKey || null,
            },
        null,
        2
      ) +
      ';\n'
    );
  }

  global.FlareAuth = {
    hasWebCrypto,
    getProxyUrl,
    saveLocalProxyUrl,
    getProxyToken,
    saveProxyToken,
    loginViaProxy,
    verifyProxySession,
    getActiveAuthConfig,
    saveLocalAuthConfig,
    buildAuthConfig,
    unlockWithPassword,
    encryptWithAesKey,
    decryptWithAesKey,
    saveSessionKey,
    loadSessionKey,
    clearSession,
    formatAuthConfigFile,
  };
})(window);
