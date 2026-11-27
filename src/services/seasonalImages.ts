import Taro from '@tarojs/taro';
import { CLOUD_READY, SEASONAL_FN_NAME } from '@/config/cloud';
import type { Gender } from '@/types';
import type { MemberTier } from '@/services/entitlement';

/** 当季推荐云端生成（v1.14.0）
 * v1.13.0 为进页自动整组生成；v1.14.0 起改为成本受控的「点击后按需生成」——
 * 前端点击风格（默认风格 key）或填写自定义风格（custom 文本）后按张调用云函数生成，
 * 每日可生成张数由会员额度在前端 memberUsage 计数（上限不变：普通 0 / VIP 1 / SVIP 2）。
 * 云端按「当日 + 季节 + 性别 + 年龄段 + 风格」缓存到集合 seasonal_images（同组合全用户共享，不重复计费），
 * 本地按天缓存已生成图组，进入页面只读缓存、不自动发起云端请求。 */
export interface SeasonalImage {
  /** 云开发存储 fileID（cloud:// 前缀，可直接用于 <Image>） */
  fileID: string;
  /** 风格标签（默认风格 label 或自定义风格原文） */
  label: string;
}

const CACHE_VERSION = 2;
const storageKey = (parts: string): string => `ldw_seasonal_${CACHE_VERSION}_${parts}`;
const pad2 = (n: number): string => String(n).padStart(2, '0');

const dateKeyOf = (d = new Date()): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 季节 key（与云函数 SEASONS 一致）：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬 */
const seasonKeyOf = (month: number): string => {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
};

/** 年龄段 key（与云函数 ageGroupOf 一致） */
const ageGroupKeyOf = (age?: number | null): string => {
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

/** 本地缓存 key：按天 + 季节 + 性别 + 年龄段（不含档位——当天内升档后已生成图组保留展示） */
const cacheKeyOf = ({ gender, age }: Pick<Params, 'gender' | 'age'>): string =>
  storageKey(`${dateKeyOf()}_${seasonKeyOf(new Date().getMonth() + 1)}_${gender || 'other'}_${ageGroupKeyOf(age)}`);

/** 读取今日已生成的当季图组（本地缓存命中直接展示，不发起云端请求；跨天自动失效） */
export const loadCachedSeasonalImages = ({
  gender,
  age
}: Pick<Params, 'gender' | 'age'>): SeasonalImage[] => {
  if (!CLOUD_READY) return [];
  try {
    const cached = Taro.getStorageSync(cacheKeyOf({ gender, age })) as SeasonalImage[] | '';
    if (cached && Array.isArray(cached)) {
      return cached.filter((it) => it && typeof it.fileID === 'string' && it.fileID && it.label);
    }
  } catch (e) {
    // 读取缓存失败按无缓存处理
  }
  return [];
};

/** 生成成功后追加写入本地当日缓存（写入失败不影响展示） */
const appendCache = (params: Pick<Params, 'gender' | 'age'>, image: SeasonalImage): void => {
  const next = [...loadCachedSeasonalImages(params), image];
  try {
    Taro.setStorageSync(cacheKeyOf(params), next);
  } catch (e) {
    // 缓存写入失败不影响展示
  }
};

/** 生成单张当季图（v1.14.0：点击风格 style 或填写自定义风格 custom 后调用）
 * 云端同组合当日缓存命中时不重复计费；业务失败抛 Error（message 为错误码，由调用方转用户文案）。 */
export const generateSeasonalImage = async ({
  gender,
  age,
  tier,
  style,
  custom
}: Params & { style?: string; custom?: string }): Promise<SeasonalImage> => {
  if (!CLOUD_READY) throw new Error('GENERATE_FAILED');
  let result: { code?: string; images?: SeasonalImage[]; message?: string };
  try {
    const res = await Taro.cloud.callFunction({
      name: SEASONAL_FN_NAME,
      data: { action: 'generate', tier, gender, age: age ?? undefined, style, custom }
    });
    result = (res.result || {}) as { code?: string; images?: SeasonalImage[]; message?: string };
  } catch (e) {
    console.warn('[Seasonal] 云函数调用失败：', (e as Error).message);
    throw new Error('GENERATE_FAILED');
  }
  const image = Array.isArray(result.images)
    ? result.images.find((it) => it && typeof it.fileID === 'string' && it.fileID)
    : undefined;
  if (result.code === 'OK' && image && image.label) {
    appendCache({ gender, age }, image);
    console.info('[Seasonal] 当季图已生成：', image.label);
    return image;
  }
  console.warn('[Seasonal] 当季图生成不可用：', result.code, result.message);
  // v2.2.4：错误对象同时携带业务码与云端详情（上游 HTTP 状态 / error.code / content_filter），
  // 界面对已知码展示友好文案，未知原因直接展示详情便于定位（测试阶段）
  const err = new Error(result.message || result.code || 'GENERATE_FAILED') as Error & { code?: string };
  err.code = result.code || 'GENERATE_FAILED';
  throw err;
};

/** 生成结果可预览的 URL（v2.2.4）：cloud:// fileID 换取临时 https 链接，本地路径原样返回 */
export const resolveSlideUrl = async (src: string): Promise<string> => {
  if (!src.startsWith('cloud://')) return src;
  const res = await Taro.cloud.getTempFileURL({ fileList: [src] });
  const file = res.fileList && res.fileList[0];
  if (!file || !file.tempFileURL) throw new Error('TEMP_URL_FAILED');
  return file.tempFileURL;
};

/** 保存大图到相册（v2.2.4）：cloud:// 先下载为临时文件，本地路径直接保存；
 * 相册权限被拒时引导打开设置页，返回是否保存成功。 */
export const saveSlideToAlbum = async (src: string): Promise<boolean> => {
  let filePath = src;
  if (src.startsWith('cloud://')) {
    const dl = await Taro.cloud.downloadFile({ fileID: src });
    filePath = dl.tempFilePath;
  }
  try {
    await Taro.saveImageToPhotosAlbum({ filePath });
    return true;
  } catch (e) {
    const msg = ((e as Error) && (e as Error).message) || '';
    if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0 || msg.indexOf('permission') >= 0) {
      Taro.showModal({
        title: '需要相册权限',
        content: '请在设置中允许「保存图片到相册」后重试',
        confirmText: '去设置',
        success: (r) => {
          if (r.confirm) Taro.openSetting({});
        }
      });
      return false;
    }
    if (msg.indexOf('cancel') >= 0) return false;
    throw new Error('SAVE_FAILED');
  }
};
