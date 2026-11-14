import Taro from '@tarojs/taro';
import { WeatherInfo } from '@/types';
import { CLOUD_READY, EMPTY_GUIDE_FN_NAME } from '@/config/cloud';

/** 空衣橱引导文案（PRD 9.1.2 / 专项计划 3.3）
 * v1.4.0（C 模块天气增强）：空衣橱时传入当前天气，云函数按性别/年龄/天气动态生成，失败时用内置兜底文案 */

const CACHE_TTL = 24 * 60 * 60 * 1000;

/** 天气签名（缓存键用）：现象 + 温度档位，与云函数 weatherSig 口径一致 */
const weatherSig = (w?: WeatherInfo | null): string => {
  if (!w || !w.today) return 'none';
  const avg = Math.round((w.today.low + w.today.high) / 2);
  const band =
    avg < 5 ? 'cold' : avg <= 15 ? 'cool' : avg <= 22 ? 'mild' : avg <= 28 ? 'warm' : 'hot';
  return `${w.today.cond || 'unknown'}-${band}`;
};

const storageKey = (gender: string, age: number, sig: string) => `ldw_empty_guide_${gender}_${age}_${sig}`;

const FALLBACK = {
  teen: '先从校服之外的百搭单品开始：一件纯色T恤、一条直筒裤和一双运动鞋就够用。',
  young: '先备三件基础款：纯色T恤、直筒牛仔裤和一件轻便外套，通勤休闲都能搭。',
  middle: '建议先添置一件质感外套和两条合身长裤，日常通勤更利落耐穿。',
  senior: '优先选舒适透气的纯棉上衣和宽松长裤，再配一双缓震好走的鞋。'
};

const fallbackTip = (age: number, weather?: WeatherInfo | null): string => {
  const base = age < 18 ? FALLBACK.teen : age <= 30 ? FALLBACK.young : age <= 50 ? FALLBACK.middle : FALLBACK.senior;
  if (weather && weather.today) {
    const avg = Math.round((weather.today.low + weather.today.high) / 2);
    const extra =
      avg < 5 ? '注意防寒保暖' : avg <= 15 ? '建议加件外套' : avg <= 22 ? '薄外套即可' : avg <= 28 ? '穿轻薄透气款' : '选清凉防晒穿搭';
    // 先截断再去掉句尾标点，避免「都搭。，建议加件外套」式双标点
    const head = base.slice(0, 50 - extra.length - 1).replace(/[。，、；,.\s]+$/, '');
    return `${head}，${extra}`;
  }
  return base.slice(0, 50);
};

/**
 * 获取当前衣橱的空态引导建议（1 条，≤50 字，适配当前天气/性别/年龄）
 * @param gender 衣橱主人性别（male/female/other）
 * @param age 衣橱主人年龄，缺省按 30 处理
 * @param weather 当前天气信息（可选；天气加载失败时传 null，走无天气上下文流程）
 */
export const getEmptyGuide = async (
  gender?: string,
  age?: number | null,
  weather?: WeatherInfo | null
): Promise<string> => {
  const g = gender === 'male' || gender === 'female' || gender === 'other' ? gender : 'other';
  const a = typeof age === 'number' && age > 0 ? Math.round(age) : 30;
  const sig = weatherSig(weather);

  try {
    const cached = Taro.getStorageSync(storageKey(g, a, sig));
    if (cached && cached.tip && Date.now() - cached.ts < CACHE_TTL) return cached.tip as string;
  } catch (e) {
    // 缓存读取失败忽略
  }

  if (CLOUD_READY) {
    try {
      const cloudWeather = weather && weather.today ? { cond: weather.today.cond, low: weather.today.low, high: weather.today.high } : undefined;
      const res = await Taro.cloud.callFunction({
        name: EMPTY_GUIDE_FN_NAME,
        data: { action: 'guide', gender: g, age: a, weather: cloudWeather }
      });
      const result = (res.result || {}) as { code?: string; tips?: string[] };
      const tip = result.code === 'OK' && result.tips && result.tips[0] ? result.tips[0] : '';
      if (tip) {
        Taro.setStorageSync(storageKey(g, a, sig), { tip, ts: Date.now() });
        return tip;
      }
    } catch (e) {
      console.warn('[EmptyGuide] 云端生成失败，使用兜底文案：', (e as Error).message);
    }
  }

  return fallbackTip(a, weather);
};
