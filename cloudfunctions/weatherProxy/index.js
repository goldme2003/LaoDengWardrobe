/** 天气代理云函数（PRD 9.4 / 9.1 阶段 A）
 * 职责：逆地理（腾讯位置服务）+ 天气（和风天气）+ 归一化 + 缓存限流。
 * 入参：{ action: 'city', lat, lon } | { action: 'weather', city } | { action: 'ping' }
 * 出参：{ code: 'OK', data } | { code: 'NOT_CONFIGURED'|'BAD_PARAM'|'WEATHER_UNAVAILABLE', message }
 * 密钥仅存云函数环境变量：TENCENT_MAP_KEY、QWEATHER_KEY（不落前端，D-1/D-2）。 */
const https = require('https');

const MAP_HOST = 'apis.map.qq.com';
const GEO_HOST = 'geoapi.qweather.com';
const WEATHER_HOST = 'devapi.qweather.com';
const CN_HOST = 'd1.weather.com.cn';
/** 中国天气网城市编码（免密钥数据源，v1.3.0 扩充至 45 城，与前端 src/data/cities.ts 保持一致） */
const CITY_CODE = {
  保定: '101090201', 北京: '101010100', 包头: '101080201',
  常州: '101191101', 长春: '101060101', 成都: '101270101', 重庆: '101040100',
  大连: '101070201', 东莞: '101281601',
  佛山: '101280800',
  广州: '101280101', 桂林: '101300501', 贵阳: '101260101',
  哈尔滨: '101050101', 海口: '101310101', 杭州: '101210101', 合肥: '101220101',
  呼和浩特: '101080101', 惠州: '101280301',
  嘉兴: '101210301', 济南: '101120101', 金华: '101210901',
  昆明: '101290101',
  拉萨: '101140101', 兰州: '101160101', 洛阳: '101180901',
  南京: '101190101', 南昌: '101240101', 南宁: '101300101', 南通: '101190501', 宁波: '101210401',
  青岛: '101120201', 泉州: '101230501',
  三亚: '101310201', 上海: '101020100', 深圳: '101280601', 沈阳: '101070101',
  苏州: '101190401', 石家庄: '101090101',
  天津: '101030100', 太原: '101100101', 唐山: '101090501',
  温州: '101210701', 乌鲁木齐: '101130101', 无锡: '101190201', 武汉: '101200101',
  西安: '101110101', 厦门: '101230201', 西宁: '101150101', 徐州: '101190801',
  银川: '101170101', 烟台: '101120501',
  郑州: '101180101', 中山: '101281701', 珠海: '101280701'
};
/** 中国天气网天气现象编码 → 展示文案 */
const CN_WEATHER = {
  '00': '晴', '01': '多云', '02': '阴', '03': '阵雨', '04': '雷阵雨', '05': '雷阵雨',
  '06': '雨夹雪', '07': '小雨', '08': '中雨', '09': '大雨', '10': '暴雨', '11': '大暴雨',
  '12': '特大暴雨', '13': '阵雪', '14': '小雪', '15': '中雪', '16': '大雪', '17': '暴雪',
  '18': '雾', '19': '冻雨', '20': '沙尘暴', '29': '浮尘', '30': '扬沙', '31': '强沙尘暴',
  '32': '浓雾', '53': '霾'
};
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

function getRaw(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', timeout: 8000, headers: headers || {} },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`${hostname.toUpperCase()}_HTTP_${res.statusCode}: ${buf.slice(0, 200)}`));
            return;
          }
          resolve(buf);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${hostname.toUpperCase()}_TIMEOUT`)));
    req.end();
  });
}

function getJson(hostname, path, headers) {
  return getRaw(hostname, path, headers).then((buf) => {
    try {
      return JSON.parse(buf);
    } catch (e) {
      throw new Error(`${hostname.toUpperCase()}_BAD_JSON`);
    }
  });
}

function httpGet(hostname, path, headers) {
  return getJson(hostname, path, headers);
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

/** 和风天气：城市 → LocationID → 3 天预报 */
async function fetchFromQWeather(city) {
  const loc = await lookupLocation(city);
  const key = process.env.QWEATHER_KEY;
  const res = await httpGet(WEATHER_HOST, `/v7/weather/3d?location=${loc.id}&key=${key}&lang=zh`);
  if (res.code !== '200' || !res.daily || res.daily.length < 3) {
    throw new Error(`QWEATHER_API_${res.code || 'EMPTY'}`);
  }
  return normalize(loc.name || city, res.daily);
}

/** 中国天气网（免密钥兜底数据源）：weather_index 页面内嵌 JSON */
async function fetchFromWeatherCn(city) {
  const code = CITY_CODE[city];
  if (!code) throw new Error('CN_CITY_UNSUPPORTED');
  const text = await getRaw(CN_HOST, `/weather_index/${code}.html`, {
    Referer: 'https://www.weather.com.cn/',
    'User-Agent': 'Mozilla/5.0'
  });
  const m = String(text).match(/var\s+fc\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error('CN_BAD_PAYLOAD');
  const fc = JSON.parse(m[1]);
  const list = (fc.f || []).slice(0, 4);
  if (list.length < 4) throw new Error('CN_EMPTY_FC');
  const toItem = (d, label) => ({
    date: label,
    cond: CN_WEATHER[d.fa] || '多云',
    low: Math.round(Number(d.fd)),
    high: Math.round(Number(d.fc))
  });
  return {
    city,
    today: toItem(list[0], '今天'),
    days: [toItem(list[1], '明天'), toItem(list[2], '后天'), toItem(list[3], '大后天')]
  };
}

/** 数据源链路：和风（有 Key 时）→ 中国天气网（免密钥）→ 失败抛错交由上层降级 */
async function fetchWeather(city) {
  const cached = cache.get(city);
  if (cached && Date.now() - cached.ts < TTL) return cached;

  const errors = [];
  if (process.env.QWEATHER_KEY) {
    try {
      const data = await fetchFromQWeather(city);
      const hit = { data, source: 'qweather', ts: Date.now() };
      cache.set(city, hit);
      return hit;
    } catch (e) {
      errors.push(`qweather:${e.message}`);
      console.error('[weatherProxy] 和风失败，尝试中国天气网：', e.message);
    }
  }

  try {
    const data = await fetchFromWeatherCn(city);
    const hit = { data, source: 'weather.com.cn', ts: Date.now() };
    cache.set(city, hit);
    return hit;
  } catch (e) {
    errors.push(`cn:${e.message}`);
  }

  throw new Error(errors.join(' | '));
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

  const rawCity = typeof event.city === 'string' ? event.city.trim().slice(0, 20) : '';
  const city = rawCity.replace(/市$/, '');
  if (!city) return { code: 'BAD_PARAM', message: '缺少城市名' };

  try {
    const hit = await fetchWeather(city);
    return { code: 'OK', data: hit.data, source: hit.source };
  } catch (e) {
    if (/MISSING_SECRET/.test(e.message)) {
      return { code: 'NOT_CONFIGURED', message: '未配置 QWEATHER_KEY', detail: e.message };
    }
    console.error('[weatherProxy] 天气获取失败：', e.message);
    return { code: 'WEATHER_UNAVAILABLE', message: '天气服务暂不可用', detail: e.message };
  }
};
