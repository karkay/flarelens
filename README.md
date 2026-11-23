# FlareLens — Cross-Platform Eczema Trigger & Correlation App

**FlareLens** is a local-first, cross-platform **React Native (Expo)** app for iOS, Android, and Web that tracks daily eczema severity, automatically collects environmental and device variables, extracts food/beverage ingredients from meal photos using **Google Gemini Vision**, and discovers **immediate, delayed (24h–72h), and multi-day cumulative build-up correlations**.

## Key Features

1. **Daily Eczema Logging (`Today` tab)**
   - Log overall eczema severity (0–10), itch intensity, redness, skin dryness, affected body areas, and timestamped notes — supporting multiple check-ins per day to pinpoint exact exposure-to-flare timing.
2. **Automatic Device & Environmental Metadata (`services/deviceCollectors.ts`, `services/weatherPollenService.ts`)**
   - **GPS Location & Climate Shifts** (`expo-location` + reverse geocoding)
   - **Weather, Temperature, Humidity, UV Index & Barometric Pressure** (live free Open-Meteo API)
   - **Local Allergens** (birch, grass, ragweed, alder, mugwort pollen + PM2.5 / US AQI via Open-Meteo Air Quality API)
   - **Season & Time of Day** (automatic hemisphere-aware meteorological season + clock bucket)
   - **Exercise / Activity Quantity** (automatic step count via `expo-sensors` Pedometer)
   - **Lifestyle & Custom Variables**: Stress levels, Sleep duration & quality, Screen time, plus a **Custom Variable builder** (`app/add-variable.tsx`) supporting Yes/No exposures, 1–10 scales, and numeric units.
3. **Gemini Food & Beverage Photo Analysis (`Food Lens` tab, `services/geminiFoodService.ts`)**
   - Snap a photo (or select from photo library / enter description) and ask **Gemini (`gemini-2.5-flash` or `gemini-2.5-pro`)** to identify the food/beverage and extract its typical & hidden ingredients (e.g., Dairy/Casein, Wheat/Gluten, Nightshades/Tomato, Soy, Eggs, Peanuts, Histamine-rich foods).
   - Confirm, toggle, or add ingredients; each ingredient is persisted as an individual timestamped variable correlated against subsequent flare-ups.
4. **Lag-Aware & Multi-Day Build-Up Correlation Engine (`engine/correlationEngine.ts`, `Metrics` tab)**
   - Tests every variable (environmental, lifestyle, Gemini food ingredients, and custom variables) across **6 reaction windows**:
     - `Same Day (0–12h)`
     - `Next Day (~24h)`
     - `2 Days Later (~48h)`
     - `3 Days Later (~72h)`
     - `3-Day Cumulative Build-Up` (exponentially weighted multi-day accumulation)
     - `5-Day Cumulative Build-Up`
   - Computes blended Pearson *r* + Spearman *ρ*, Student-*t* two-tailed *p*-values, severity lift, flare risk ratio, and identifies both **Triggers (+)** and **Protective Factors (-)**.
5. **Scheduled 9:00 AM & 9:00 PM Insights + Exposure-to-Flare Graphs (`Insights` tab, `services/insightsScheduler.ts`)**
   - Automatically schedules and prepares your **Morning Brief (9:00 AM)** and **Evening Digest (9:00 PM)** via `expo-background-fetch`, `expo-task-manager`, `expo-notifications`, and foreground catch-up on app open (both times customizable in Settings).
   - **Exposure Time vs. Eczema Flare-Up SVG Graph (`components/ExposureFlareChart.tsx`)**: overlays eczema severity flare peaks against exposure timestamps, optional 3-day cumulative build-up curve, and exact **Exposure → Flare lag connectors** (`+28h`, `+4h`, `+48h`).
   - **Active Reaction Watchlist**: alerts you when a recent exposure in the past 72h is approaching your personal peak reaction window.
6. **Toggleable 21-Day Realistic Demo Dataset (`data/demoDataset.ts`)**
   - Enabled by default so you can explore delayed dairy triggers (~28h), immediate pollen flares, 3-day cumulative stress build-up, and low-humidity sensitivity right away — toggle off anytime in **Settings** to use strictly your own logs.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or v20 LTS recommended)
- Optional: Expo Go app on iOS/Android, or Xcode / Android Studio for native dev builds

### Install & Run
```bash
npm install
npm run typecheck
npm test
npx expo start
```

From the Expo CLI menu:
- Press `i` for iOS Simulator
- Press `a` for Android Emulator
- Press `w` to open immediately in your Web browser
- Or scan the QR code with **Expo Go** on your phone

### Enable Live Gemini Food Vision
1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Open the **Settings** tab in FlareLens, paste your key under **Gemini Vision API**, and tap **Save Key** → **Test Connection**.
   - Your key is stored privately on-device via `expo-secure-store` (iOS Keychain / Android Keystore).

### Native HealthKit / Health Connect Note
In Expo Go and Web, GPS location, Open-Meteo weather/pollen, camera food vision, and pedometer steps work immediately. To enable background Apple HealthKit (iOS sleep/HRV) or Android Health Connect / UsageStats screen time sync, build a native development client (`npx expo prebuild`) and connect the hook in `services/deviceCollectors.ts`.

---

## Deploying Online with GitHub Pages (Password-Protected)

The `web/` directory is a complete standalone PWA that deploys automatically to **GitHub Pages** via `.github/workflows/deploy-pages.yml`.

### 1. Set Your Login Password & Encrypt Your Gemini API Key (No Plaintext Secrets!)
Run the local interactive script (password & API key input is hidden):
```bash
ruby scripts/configure-auth.rb
```
This writes **only** a salted `PBKDF2-SHA256` (200,000 iterations) password verifier hash and an `AES-256-GCM` encrypted Gemini API key blob into `web/auth-config.js` — never any plaintext password or API key.

*(Alternatively, skip the CLI and create your password right in the app on first visit, then click **Settings → Download auth-config.js** and drop it into `web/auth-config.js`.)*

### 2. Push to GitHub & Enable Pages
```bash
git add .
git commit -m "Deploy FlareLens with password login and encrypted key vault"
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
git push -u origin main
```
Then on GitHub open **Repository Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. Your live site will publish at:
```text
https://<YOUR_USERNAME>.github.io/<YOUR_REPO>/
```

### Recommended Extra Hardening
In [Google AI Studio / Google Cloud Console](https://console.cloud.google.com/apis/credentials), restrict your Gemini API key by **HTTP referrer** to `https://<YOUR_USERNAME>.github.io/*` so the key can only be called from your own GitHub Pages domain.

