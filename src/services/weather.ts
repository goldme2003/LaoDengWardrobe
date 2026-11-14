import Taro from '@tarojs/taro';
import { WeatherInfo } from '@/types';
import { WEATHER_MOCK, DEFAULT_CITY } from '@/data/mockWeather';
import { CLOUD_READY, WEATHER_FN_NAME } from '@/config/cloud';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 云端失败原因归类为用户可读的短文案（真机角标展示用） */
const normalizeCloudError = (raw: string): string => {
  if (/NOT_CONFIGURED/i.test(raw)) return '云端未配置天气密钥';
  if (/FunctionName|could not be found|not found|INVALID/i.test(raw)) return '天气云函数未部署';
  if (/timeout|TIMEOUT|abort/i.test(raw)) return '云端请求超时';
  if (/WEATHER_UNAVAILABLE| Unsupported city/i.test(raw)) return '该城市暂不支持';
  if (!raw || raw === 'WEATHER_UNAVAILABLE') return '云端服务不可用';
  return raw.slice(0, 40);
};

/** 云端天气（PRD 9.4 / 9.1 阶段 A）：云函数 weatherProxy 归一化后直接返回 WeatherInfo */
const getFromCloud = async (city: string): Promise<WeatherInfo> => {
  const res = await Taro.cloud.callFunction({
    name: WEATHER_FN_NAME,
    data: { action: 'weather', city }
  });
  const result = (res.result || {}) as { code?: string; data?: WeatherInfo; message?: string };
  if (result.code !== 'OK' || !result.data) {
    throw new Error(result.message || 'WEATHER_UNAVAILABLE');
  }
  return result.data;
};

/**
 * 获取城市天气。
 * 微信端优先走云函数（腾讯位置服务 + 和风天气，密钥在云端）；
 * 云函数未部署 / 未配置密钥 / 失败时回退本地模拟数据，保证页面不阻塞（PRD 9.4 降级矩阵）。
 */
export const getWeather = async (city: string): Promise<WeatherInfo> => {
  console.log('[Weather] 请求天气, city =', city);
  if (CLOUD_READY) {
    try {
      return await getFromCloud(city);
    } catch (e) {
      const reason = normalizeCloudError((e as Error).message || 'UNKNOWN');
      console.warn('[Weather] 云端天气不可用，回退模拟数据：', reason);
      await delay(300);
      const target = WEATHER_MOCK[city] ? city : DEFAULT_CITY;
      const data = WEATHER_MOCK[target];
      if (!data) throw new Error('天气数据不可用');
      return { city: target, today: data.today, days: data.days, mock: true, notice: reason };
    }
  }
  await delay(300);
  const target = WEATHER_MOCK[city] ? city : DEFAULT_CITY;
  const data = WEATHER_MOCK[target];
  if (!data) {
    console.error('[Weather] 未找到城市天气数据, city =', city);
    throw new Error('天气数据不可用');
  }
  return { city: target, today: data.today, days: data.days, mock: true, notice: 'CLOUD_DISABLED' };
};

/** 逆地理：坐标 → 城市名（D-2 定位接口审核通过后启用；失败返回空串由调用方降级城市选择） */
export const cityFromLocation = async (lat: number, lon: number): Promise<string> => {
  if (!CLOUD_READY) return '';
  try {
    const res = await Taro.cloud.callFunction({
      name: WEATHER_FN_NAME,
      data: { action: 'city', lat, lon }
    });
    const result = (res.result || {}) as { code?: string; data?: { city?: string } };
    return result.code === 'OK' && result.data ? result.data.city || '' : '';
  } catch (e) {
    console.warn('[Weather] 逆地理失败：', (e as Error).message);
    return '';
  }
};
