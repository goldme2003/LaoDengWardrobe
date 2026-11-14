import Taro from '@tarojs/taro';
import { CLOUD_READY, EMPTY_GUIDE_FN_NAME } from '@/config/cloud';

/** 空衣橱引导文案（PRD 9.1.2）：云函数按性别/年龄动态生成，失败时用内置兜底文案 */

const CACHE_TTL = 24 * 60 * 60 * 1000;
const storageKey = (gender: string, age: number) => `ldw_empty_guide_${gender}_${age}`;

const FALLBACK = {
  teen: '先从校服之外的百搭单品开始：一件纯色T恤、一条直筒裤和一双运动鞋就够用。',
  young: '先备三件基础款：纯色T恤、直筒牛仔裤和一件轻便外套，通勤休闲都能搭。',
  middle: '建议先添置一件质感外套和两条合身长裤，日常通勤更利落耐穿。',
  senior: '优先选舒适透气的纯棉上衣和宽松长裤，再配一双缓震好走的鞋。'
};

const fallbackTip = (age: number): string =>
  (age < 18 ? FALLBACK.teen : age <= 30 ? FALLBACK.young : age <= 50 ? FALLBACK.middle : FALLBACK.senior).slice(0, 50);

/**
 * 获取当前衣橱的空态引导建议（1 条，≤50 字）
 * @param gender 衣橱主人性别（male/female/other）
 * @param age 衣橱主人年龄，缺省按 30 处理
 */
export const getEmptyGuide = async (gender?: string, age?: number | null): Promise<string> => {
  const g = gender === 'male' || gender === 'female' || gender === 'other' ? gender : 'other';
  const a = typeof age === 'number' && age > 0 ? Math.round(age) : 30;

  try {
    const cached = Taro.getStorageSync(storageKey(g, a));
    if (cached && cached.tip && Date.now() - cached.ts < CACHE_TTL) return cached.tip as string;
  } catch (e) {
    // 缓存读取失败忽略
  }

  if (CLOUD_READY) {
    try {
      const res = await Taro.cloud.callFunction({
        name: EMPTY_GUIDE_FN_NAME,
        data: { action: 'guide', gender: g, age: a }
      });
      const result = (res.result || {}) as { code?: string; tips?: string[] };
      const tip = result.code === 'OK' && result.tips && result.tips[0] ? result.tips[0] : '';
      if (tip) {
        Taro.setStorageSync(storageKey(g, a), { tip, ts: Date.now() });
        return tip;
      }
    } catch (e) {
      console.warn('[EmptyGuide] 云端生成失败，使用兜底文案：', (e as Error).message);
    }
  }

  return fallbackTip(a);
};
