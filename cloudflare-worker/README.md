# FlareLens Cloudflare Worker Proxy (Zero-Exposure API Key)

This tiny serverless Cloudflare Worker keeps your **`GEMINI_API_KEY`** and **`APP_PASSWORD`** 100% server-side—they never exist in your GitHub repository, never reach the browser, and never appear in DevTools.

## Deploy in 2 Minutes (No Node.js or CLI Required!)

1. Sign in to [dash.cloudflare.com](https://dash.cloudflare.com/) (the free tier includes **100,000 requests/day**).
2. In the left sidebar, click **Compute (Workers) → Workers & Pages → Create → Create Worker**.
3. Name it `flarelens-gemini-proxy` and click **Deploy**.
4. Click **Edit code**, delete the sample code, paste the entire contents of `cloudflare-worker/src/worker.js`, and click **Deploy**.
5. Go to your Worker's **Settings → Variables and Secrets** and add **Secrets** (encrypted):
   - `GEMINI_API_KEY` = your Google AI Studio Gemini API key
   - `APP_PASSWORD` = your chosen login password for FlareLens
   - *(Optional)* `ALLOWED_ORIGIN` = `https://<YOUR_GITHUB_USERNAME>.github.io` (locks CORS strictly to your GitHub Pages domain)
6. Copy your Worker URL (e.g., `https://flarelens-gemini-proxy.<your-subdomain>.workers.dev`).
7. Set `proxyUrl` in `web/auth-config.js`:
   ```js
   window.FLARELENS_AUTH_CONFIG = {
     proxyUrl: 'https://flarelens-gemini-proxy.<your-subdomain>.workers.dev',
     configured: true,
     iterations: 200000,
     saltB64: '',
     passwordHashB64: '',
     encryptedGeminiKey: null,
   };
   ```
8. Commit & push to GitHub Pages! Your login password is now verified server-side and your Gemini API key never leaves Cloudflare.

## Or Deploy via Wrangler CLI (if Node.js is installed)
```bash
cd cloudflare-worker
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put APP_PASSWORD
npx wrangler deploy
```
