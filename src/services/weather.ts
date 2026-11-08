import Taro from '@tarojs/taro';
import { WeatherInfo } from '@/types';
import { WEATHER_MOCK, DEFAULT_CITY } from '@/data/mockWeather';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 获取城市天气。
 * MVP 阶段使用模拟数据（PRD 开放问题 Q-1：数据来源待选型），
 * 接口签名与真实天气 API 保持一致，后续仅需替换本实现。
 */
export const getWeather = async (city: string): Promise<WeatherInfo> => {
  console.log('[Weather] 请求天气, city =', city);
  await delay(300);
  const target = WEATHER_MOCK[city] ? city : DEFAULT_CITY;
  const data = WEATHER_MOCK[target];
  if (!data) {
    console.error('[Weather] 未找到城市天气数据, city =', city);
    throw new Error('天气数据不可用');
  }
  return { city: target, today: data.today, days: data.days };
};
