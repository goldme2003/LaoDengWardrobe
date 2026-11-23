import Taro from '@tarojs/taro';
import { CLOUD_READY, SEASONAL_FN_NAME } from '@/config/cloud';
import type { Gender } from '@/types';
import type { MemberTier } from '@/services/entitlement';

/** 当季推荐云端图组（v1.13.0）
 * 云函数 seasonalImages 按「当日 + 季节 + 性别 + 年龄段 + 会员档位」生成并缓存图片（云开发存储 fileID），
 * 前端按天缓存结果，失败/不可用时返回空数组，由 SeasonalCard 回退本地图组。 */
export interface SeasonalImage {
  /** 云开发存储 fileID（cloud:// 前缀，可直接用于 <Image>） */
  fileID: string;
  /** 风格标签（日常百搭 / 通勤简约 / 街头休闲 / 轻正式 / 高定质感 / 配饰细节） */
  label: string;
}

const CACHE_VERSION = 1;
const storageKey = (parts: string): string => `ldw_seasonal_${CACHE_VERSION}_${parts}`;
const pad2 = (n: number): string => String(n).padStart(2, '0');

const dateKeyOf = (d = new Date()): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 季节 key（与云函数 SEASONS 一致）：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬 */
export const seasonKeyOf = (month: number): string => {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

/** 年龄段 key（与云函数 ageGroupOf 一致） */
export const ageGroupKeyOf = (age?: number | null): string => {
  if (!age || age <= 0) return 'young';
  if (age < 18) return 'teen';
  if (age <= 30) return 'young';
  if (age <= 50) return 'middle';
  return 'senior';
};

interface Params {
  gender?: Gender;
  age?: number | null;
  tier: MemberTier;
}

/** 拉取当季云端图组；当日同组合命中本地缓存直接返回，失败返回空数组（调用方用本地图兜底） */
export const requestSeasonalImages = async ({ gender, age, tier }: Params): Promise<SeasonalImage[]> => {
  if (!CLOUD_READY) return [];
  const key = storageKey(
    `${dateKeyOf()}_${seasonKeyOf(new Date().getMonth() + 1)}_${gender || 'other'}_${ageGroupKeyOf(age)}_${tier}`
  );
  try {
    const cached = Taro.getStorageSync(key) as SeasonalImage[] | '';
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;
  } catch (e) {
    // 读取缓存失败不阻断云端请求
  }
  try {
    const res = await Taro.cloud.callFunction({
      name: SEASONAL_FN_NAME,
      data: { action: 'generate', tier, gender, age: age ?? undefined }
    });
    const result = (res.result || {}) as { code?: string; images?: SeasonalImage[] };
    const images = Array.isArray(result.images)
      ? result.images.filter((it) => it && typeof it.fileID === 'string' && it.fileID)
      : [];
    if (result.code === 'OK' && images.length > 0) {
      try {
        Taro.setStorageSync(key, images);
      } catch (e) {
        // 缓存写入失败不影响展示
      }
      console.info('[Seasonal] 云端图组已就绪：', images.length, '张');
      return images;
    }
    console.warn('[Seasonal] 云端图组不可用：', result.code);
    return [];
  } catch (e) {
    console.warn('[Seasonal] 云函数调用失败：', (e as Error).message);
    return [];
  }
};
