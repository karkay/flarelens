export interface WeatherAndPollenResult {
  temperatureC?: number;
  humidityPct?: number;
  uvIndex?: number;
  barometricPressureHpa?: number;
  weatherCondition?: string;
  pollenIndex?: number;
  birchPollen?: number;
  grassPollen?: number;
  ragweedPollen?: number;
  pm25?: number;
  usAqi?: number;
}

const WMO_WEATHER_LABELS: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime Fog',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Dense Drizzle',
  61: 'Light Rain',
  63: 'Moderate Rain',
  65: 'Heavy Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  80: 'Rain Showers',
  95: 'Thunderstorm',
};

/**
 * Fetches live local weather, humidity, UV, air quality, and pollen levels
 * using Open-Meteo's free public APIs (no API key required).
 */
export async function fetchWeatherAndPollen(
  latitude: number,
  longitude: number
): Promise<WeatherAndPollenResult> {
  const result: WeatherAndPollenResult = {};

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,surface_pressure,uv_index&timezone=auto`;

  const airQualityUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
    `&current=us_aqi,pm2_5,birch_pollen,grass_pollen,ragweed_pollen,alder_pollen,mugwort_pollen&timezone=auto`;

  const [weatherRes, aqRes] = await Promise.allSettled([
    fetch(weatherUrl).then((r) => (r.ok ? r.json() : null)),
    fetch(airQualityUrl).then((r) => (r.ok ? r.json() : null)),
  ]);

  if (weatherRes.status === 'fulfilled' && weatherRes.value?.current) {
    const cur = weatherRes.value.current;
    if (typeof cur.temperature_2m === 'number') {
      result.temperatureC = Number(cur.temperature_2m.toFixed(1));
    }
    if (typeof cur.relative_humidity_2m === 'number') {
      result.humidityPct = Math.round(cur.relative_humidity_2m);
    }
    if (typeof cur.uv_index === 'number') {
      result.uvIndex = Number(cur.uv_index.toFixed(1));
    }
    if (typeof cur.surface_pressure === 'number') {
      result.barometricPressureHpa = Math.round(cur.surface_pressure);
    }
    if (typeof cur.weather_code === 'number') {
      result.weatherCondition = WMO_WEATHER_LABELS[cur.weather_code] ?? 'Variable';
    }
  }

  if (aqRes.status === 'fulfilled' && aqRes.value?.current) {
    const aq = aqRes.value.current;
    const birch = typeof aq.birch_pollen === 'number' ? aq.birch_pollen : 0;
    const grass = typeof aq.grass_pollen === 'number' ? aq.grass_pollen : 0;
    const ragweed = typeof aq.ragweed_pollen === 'number' ? aq.ragweed_pollen : 0;
    const alder = typeof aq.alder_pollen === 'number' ? aq.alder_pollen : 0;
    const mugwort = typeof aq.mugwort_pollen === 'number' ? aq.mugwort_pollen : 0;
    const pm25 = typeof aq.pm2_5 === 'number' ? aq.pm2_5 : undefined;
    const usAqi = typeof aq.us_aqi === 'number' ? Math.round(aq.us_aqi) : undefined;

    result.birchPollen = Number(birch.toFixed(1));
    result.grassPollen = Number(grass.toFixed(1));
    result.ragweedPollen = Number(ragweed.toFixed(1));
    result.pm25 = pm25 !== undefined ? Number(pm25.toFixed(1)) : undefined;
    result.usAqi = usAqi;

    // Normalize composite local allergen index to 0–100 combining pollen grains/m³ + AQI irritants
    const totalPollen = birch + grass + ragweed + alder + mugwort;
    const pollenComponent = Math.min(75, (totalPollen / 120) * 75);
    const aqiComponent = usAqi !== undefined ? Math.min(25, (usAqi / 150) * 25) : 0;
    result.pollenIndex = Math.round(Math.min(100, pollenComponent + aqiComponent));
  }

  return result;
}
