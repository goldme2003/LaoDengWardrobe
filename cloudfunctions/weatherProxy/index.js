/** 天气代理云函数（PRD 9.4 / 9.1 阶段 A）
 * 职责：逆地理（腾讯位置服务）+ 天气（和风天气）+ 归一化 + 缓存限流。
 * 入参：{ action: 'city', lat, lon } | { action: 'weather', city } | { action: 'ping' }
 * 出参：{ code: 'OK', data } | { code: 'NOT_CONFIGURED'|'BAD_PARAM'|'WEATHER_UNAVAILABLE', message }
 * 密钥仅存云函数环境变量：TENCENT_MAP_KEY、QWEATHER_KEY（不落前端，D-1/D-2）。 */
const https = require('https');

const MAP_HOST = 'apis.map.qq.com';
const GEO_HOST = 'geoapi.qweather.com';
const WEATHER_HOST = 'devapi.qweather.com';
/** 缓存 30 分钟（容器内复用；前端另有 10 分钟本地缓存） */
const TTL = 30 * 60 * 1000;
const cache = new Map();

const COND_RULES = [
  [/雷|阵雨|暴雨|大雨|中雨|小雨|雨/, '小雨'],
  [/雪|冰雹|冻雨/, '雪'],
  [/雾|霾|沙|尘/, '雾'],
  [/阴/, '阴'],
  [/云/, '多云'],
  [/晴/, '晴']
];

function mapCond(text) {
  const t = String(text || '');
  if (/大雨|暴雨|中雨/.test(t)) return '中雨';
  for (const [re, cond] of COND_RULES) {
    if (re.test(t)) return cond;
  }
  return '多云';
}

function getJson(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', timeout: 8000 },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`${hostname.toUpperCase()}_HTTP_${res.statusCode}: ${buf.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error(`${hostname.toUpperCase()}_BAD_JSON`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${hostname.toUpperCase()}_TIMEOUT`)));
    req.end();
  });
}

function httpGet(hostname, path) {
  return getJson(hostname, path);
}

/** 逆地理：坐标 → 城市名 */
async function reverseCity(lat, lon) {
  const key = process.env.TENCENT_MAP_KEY;
  if (!key) throw new Error('MISSING_SECRET: TENCENT_MAP_KEY');
  const res = await httpGet(
    MAP_HOST,
    `/ws/geocoder/v1/?location=${lat},${lon}&key=${key}&get_poi=0`
  );
  if (res.status !== 0) throw new Error(`MAP_API_${res.status}: ${res.message || ''}`);
  const comp = (res.result && res.result.address_component) || {};
  const city = comp.city || comp.province || '';
  if (!city) throw new Error('MAP_EMPTY_CITY');
  return city.replace(/市$/, '');
}

/** 城市名 → 和风 LocationID */
async function lookupLocation(city) {
  const key = process.env.QWEATHER_KEY;
  if (!key) throw new Error('MISSING_SECRET: QWEATHER_KEY');
  const res = await httpGet(
    GEO_HOST,
    `/v2/city/lookup?location=${encodeURIComponent(city)}&key=${key}&number=1&lang=zh`
  );
  if (res.code !== '200' || !res.location || !res.location.length) {
    throw new Error(`QWEATHER_CITY_${res.code || 'EMPTY'}`);
  }
  return { id: res.location[0].id, name: (res.location[0].name || city).replace(/市$/, '') };
}

/** 和风 3 天预报 → 前端 WeatherInfo */
function normalize(city, daily) {
  const pick = (d) => ({
    cond: mapCond(d.textDay),
    low: Math.round(Number(d.tempMin)),
    high: Math.round(Number(d.tempMax))
  });
  const d0 = pick(daily[0]);
  return {
    city,
    today: { date: '今天', ...d0 },
    days: [
      { date: '明天', ...pick(daily[1]) },
      { date: '后天', ...pick(daily[2]) },
      { date: '大后天', ...pick(daily[3] || daily[2]) }
    ]
  };
}

async function fetchWeather(city) {
  const cached = cache.get(city);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const loc = await lookupLocation(city);
  const key = process.env.QWEATHER_KEY;
  const res = await httpGet(
    WEATHER_HOST,
    `/v7/weather/3d?location=${loc.id}&key=${key}&lang=zh`
  );
  if (res.code !== '200' || !res.daily || res.daily.length < 3) {
    throw new Error(`QWEATHER_API_${res.code || 'EMPTY'}`);
  }
  const data = normalize(loc.name || city, res.daily);
  cache.set(city, { data, ts: Date.now() });
  return data;
}

exports.main = async (event = {}) => {
  const action = event.action || 'weather';

  if (action === 'ping') {
    return {
      code: 'OK',
      hasMapKey: !!process.env.TENCENT_MAP_KEY,
      hasWeatherKey: !!process.env.QWEATHER_KEY,
      provider: 'tencent-lbs + qweather'
    };
  }

  if (action === 'city') {
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { code: 'BAD_PARAM', message: '缺少有效 lat/lon' };
    }
    try {
      const city = await reverseCity(lat, lon);
      return { code: 'OK', data: { city } };
    } catch (e) {
      if (/MISSING_SECRET/.test(e.message)) {
        return { code: 'NOT_CONFIGURED', message: '未配置 TENCENT_MAP_KEY', detail: e.message };
      }
      console.error('[weatherProxy] 逆地理失败：', e.message);
      return { code: 'WEATHER_UNAVAILABLE', message: '定位解析失败', detail: e.message };
    }
  }

  if (action !== 'weather') {
    return { code: 'BAD_PARAM', message: '未知 action' };
  }

  const city = typeof event.city === 'string' ? event.city.trim().slice(0, 20) : '';
  if (!city) return { code: 'BAD_PARAM', message: '缺少城市名' };

  try {
    const data = await fetchWeather(city);
    return { code: 'OK', data };
  } catch (e) {
    if (/MISSING_SECRET/.test(e.message)) {
      return { code: 'NOT_CONFIGURED', message: '未配置 QWEATHER_KEY', detail: e.message };
    }
    console.error('[weatherProxy] 天气获取失败：', e.message);
    return { code: 'WEATHER_UNAVAILABLE', message: '天气服务暂不可用', detail: e.message };
  }
};
