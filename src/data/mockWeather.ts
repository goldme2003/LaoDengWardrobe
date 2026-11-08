import { WeatherInfo } from '@/types';

/**
 * 天气模拟数据（MVP：天气数据来源为开放问题 Q-1，待技术选型后接入真实 API）
 */
export const CITY_OPTIONS = [
  '北京',
  '上海',
  '广州',
  '深圳',
  '杭州',
  '成都',
  '武汉',
  '西安',
  '重庆',
  '南京'
];

export const WEATHER_MOCK: Record<string, { today: WeatherInfo['today']; days: WeatherInfo['days'] }> = {
  北京: {
    today: { date: '今天', cond: '晴', low: 6, high: 16 },
    days: [
      { date: '明天', cond: '多云', low: 5, high: 15 },
      { date: '后天', cond: '阴', low: 4, high: 13 },
      { date: '大后天', cond: '小雨', low: 3, high: 11 }
    ]
  },
  上海: {
    today: { date: '今天', cond: '多云', low: 14, high: 21 },
    days: [
      { date: '明天', cond: '阴', low: 13, high: 19 },
      { date: '后天', cond: '小雨', low: 12, high: 18 },
      { date: '大后天', cond: '多云', low: 13, high: 20 }
    ]
  },
  广州: {
    today: { date: '今天', cond: '晴', low: 20, high: 28 },
    days: [
      { date: '明天', cond: '晴', low: 21, high: 29 },
      { date: '后天', cond: '多云', low: 20, high: 27 },
      { date: '大后天', cond: '阵雨', low: 19, high: 26 }
    ]
  },
  深圳: {
    today: { date: '今天', cond: '晴', low: 21, high: 29 },
    days: [
      { date: '明天', cond: '多云', low: 21, high: 28 },
      { date: '后天', cond: '阵雨', low: 20, high: 27 },
      { date: '大后天', cond: '多云', low: 21, high: 28 }
    ]
  },
  杭州: {
    today: { date: '今天', cond: '多云', low: 13, high: 20 },
    days: [
      { date: '明天', cond: '晴', low: 12, high: 21 },
      { date: '后天', cond: '多云', low: 13, high: 22 },
      { date: '大后天', cond: '小雨', low: 12, high: 19 }
    ]
  },
  成都: {
    today: { date: '今天', cond: '阴', low: 12, high: 18 },
    days: [
      { date: '明天', cond: '小雨', low: 11, high: 17 },
      { date: '后天', cond: '阴', low: 11, high: 18 },
      { date: '大后天', cond: '多云', low: 12, high: 19 }
    ]
  },
  武汉: {
    today: { date: '今天', cond: '多云', low: 11, high: 19 },
    days: [
      { date: '明天', cond: '晴', low: 10, high: 20 },
      { date: '后天', cond: '多云', low: 11, high: 21 },
      { date: '大后天', cond: '阴', low: 10, high: 18 }
    ]
  },
  西安: {
    today: { date: '今天', cond: '晴', low: 8, high: 17 },
    days: [
      { date: '明天', cond: '多云', low: 7, high: 16 },
      { date: '后天', cond: '阴', low: 6, high: 14 },
      { date: '大后天', cond: '小雨', low: 5, high: 12 }
    ]
  },
  重庆: {
    today: { date: '今天', cond: '阴', low: 14, high: 20 },
    days: [
      { date: '明天', cond: '小雨', low: 13, high: 19 },
      { date: '后天', cond: '阴', low: 13, high: 20 },
      { date: '大后天', cond: '多云', low: 14, high: 21 }
    ]
  },
  南京: {
    today: { date: '今天', cond: '晴', low: 12, high: 20 },
    days: [
      { date: '明天', cond: '多云', low: 11, high: 19 },
      { date: '后天', cond: '晴', low: 12, high: 21 },
      { date: '大后天', cond: '多云', low: 11, high: 20 }
    ]
  }
};

export const DEFAULT_CITY = '杭州';
