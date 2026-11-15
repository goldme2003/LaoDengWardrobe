import Taro from '@tarojs/taro';
import { WeatherInfo } from '@/types';
import { CLOUD_READY, EMPTY_GUIDE_FN_NAME } from '@/config/cloud';

/** 空衣橱引导文案（PRD 9.1.2 / 专项计划 3.3）
 * v1.4.0（C 模块天气增强）：空衣橱时传入天气，云函数按性别/年龄/天气动态生成，失败时用内置兜底文案
 * v1.4.1：返回来源标识（hunyuan = 云函数生成 / fallback = 内置兜底），供界面调试角标区分
 * v1.4.2：天气上下文与推荐统一取明天（days[0]），无明日数据回退今日 */

export type EmptyGuideSource = 'hunyuan' | 'fallback';

export interface EmptyGuideResult {
  tip: string;
  source: EmptyGuideSource;
}

const CACHE_TTL = 24 * 60 * 60 * 1000;

/** 建议所用的天气上下文（统一按「明天」计算） */
interface DayContext {
  cond: string;
  low: number;
  high: number;
  avg: number;
}

/** days[0] = 明天（weatherProxy / mockWeather 的 days 顺序为 明天/后天/大后天） */
const dayContext = (weather?: WeatherInfo | null): DayContext | null => {
  if (!weather) return null;
  const d = (weather.days && weather.days[0]) || weather.today;
  if (!d) return null;
  return { cond: d.cond, low: d.low, high: d.high, avg: Math.round((d.low + d.high) / 2) };
};

/** 天气签名（缓存键用）：现象 + 温度档位，与云函数 weatherSig 口径一致 */
const weatherSig = (w: DayContext | null): string => {
  if (!w) return 'none';
  const band =
    w.avg < 5 ? 'cold' : w.avg <= 15 ? 'cool' : w.avg <= 22 ? 'mild' : w.avg <= 28 ? 'warm' : 'hot';
  return `${w.cond || 'unknown'}-${band}`;
};

const storageKey = (gender: string, age: number, sig: string) => `ldw_empty_guide_${gender}_${age}_${sig}`;

const FALLBACK = {
  teen: '先从校服之外的百搭单品开始：一件纯色T恤、一条直筒裤和一双运动鞋就够用。',
  young: '先备三件基础款：纯色T恤、直筒牛仔裤和一件轻便外套，通勤休闲都能搭。',
  middle: '建议先添置一件质感外套和两条合身长裤，日常通勤更利落耐穿。',
  senior: '优先选舒适透气的纯棉上衣和宽松长裤，再配一双缓震好走的鞋。'
};

const fallbackTip = (age: number, day: DayContext | null): string => {
  const base = age < 18 ? FALLBACK.teen : age <= 30 ? FALLBACK.young : age <= 50 ? FALLBACK.middle : FALLBACK.senior;
  if (day) {
    const avg = day.avg;
    const extra =
      avg < 5 ? '注意防寒保暖' : avg <= 15 ? '建议加件外套' : avg <= 22 ? '薄外套即可' : avg <= 28 ? '穿轻薄透气款' : '选清凉防晒穿搭';
    // 先截断再去掉句尾标点，避免「都搭。，建议加件外套」式双标点
    const head = base.slice(0, 50 - extra.length - 1).replace(/[。，、；,.\s]+$/, '');
    return `${head}，${extra}`;
  }
  return base.slice(0, 50);
};

/**
 * 获取当前衣橱的空态引导建议（1 条，≤50 字，适配明天天气/性别/年龄）
 * @param gender 衣橱主人性别（male/female/other）
 * @param age 衣橱主人年龄，缺省按 30 处理
 * @param weather 天气信息（可选；按明天计，天气加载失败时传 null 走无天气上下文流程）
 * @returns tip + source（hunyuan = 云函数生成，fallback = 内置兜底）
 */
export const getEmptyGuide = async (
  gender?: string,
  age?: number | null,
  weather?: WeatherInfo | null
): Promise<EmptyGuideResult> => {
  const g = gender === 'male' || gender === 'female' || gender === 'other' ? gender : 'other';
  const a = typeof age === 'number' && age > 0 ? Math.round(age) : 30;
  const day = dayContext(weather);
  const sig = weatherSig(day);

  try {
    const cached = Taro.getStorageSync(storageKey(g, a, sig));
    if (cached && cached.tip && Date.now() - cached.ts < CACHE_TTL) {
      const source: EmptyGuideSource = cached.source === 'hunyuan' ? 'hunyuan' : 'fallback';
      console.info(`[EmptyGuide] 命中本地缓存，source = ${source}`);
      return { tip: cached.tip as string, source };
    }
  } catch (e) {
    // 缓存读取失败忽略
  }

  if (CLOUD_READY) {
    try {
      const res = await Taro.cloud.callFunction({
        name: EMPTY_GUIDE_FN_NAME,
        data: { action: 'guide', gender: g, age: a, weather: day || undefined }
      });
      const result = (res.result || {}) as { code?: string; tips?: string[]; source?: string };
      const tip = result.code === 'OK' && result.tips && result.tips[0] ? result.tips[0] : '';
      if (tip) {
        const source: EmptyGuideSource = result.source === 'hunyuan' ? 'hunyuan' : 'fallback';
        console.info(`[EmptyGuide] 建议来源 = ${source}，明日天气 = ${day ? `${day.cond}/${day.avg}℃` : '无'}`);
        Taro.setStorageSync(storageKey(g, a, sig), { tip, source, ts: Date.now() });
        return { tip, source };
      }
    } catch (e) {
      console.warn('[EmptyGuide] 云端生成失败，使用兜底文案：', (e as Error).message);
    }
  }

  console.info('[EmptyGuide] 建议来源 = fallback（内置兜底文案）');
  return { tip: fallbackTip(a, day), source: 'fallback' };
};
