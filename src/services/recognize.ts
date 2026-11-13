/** 衣物图片识别服务（PRD 9.3 / 方案 v1.1）
 * 职责：云函数调用封装、结果本地缓存（同图不重复调用）、隐私确认、
 *      熔断预算本地估算（50 元/月，40 元预警；云端另有硬校验）、自动识别开关 */
import Taro from '@tarojs/taro';
import {
  RECOGNIZE_AVAILABLE,
  RECOGNIZE_FN_NAME,
  RECOGNIZE_BUDGET_YUAN,
  RECOGNIZE_WARN_YUAN,
  RECOGNIZE_COST_PER_CALL,
  CLOUD_ENV_ID
} from '@/config/cloud';

export interface RecognizeResult {
  category: string;
  color: string;
  layer: string;
  seasons: string[];
  material: string;
  size: string;
  brand: string;
  careText: string;
  compositionText: string;
  confidence: number;
  warnings: string[];
  remarkExtra?: string;
}

type FailureCode =
  | 'NO_CLOTHING'
  | 'BUDGET_EXCEEDED'
  | 'NOT_CONFIGURED'
  | 'RECOGNIZE_FAILED'
  | 'UNAVAILABLE'
  | 'PRIVACY_DENIED';

type RecognizeOutcome = { code: 'OK'; data: RecognizeResult } | { code: FailureCode; message: string };

const USAGE_KEY = 'ldw_recognize_usage';
const CACHE_KEY = 'ldw_recognize_cache';
const AUTO_SWITCH_KEY = 'ldw_recognize_auto';
const PRIVACY_KEY = 'ldw_recognize_privacy_ok';
const CACHE_MAX = 20;

let cloudInited = false;
function initCloud(): boolean {
  if (!RECOGNIZE_AVAILABLE) return false;
  if (cloudInited) return true;
  try {
    Taro.cloud.init({ env: CLOUD_ENV_ID, traceUser: false });
    cloudInited = true;
    return true;
  } catch (e) {
    console.error('[Recognize] cloud.init 失败', e);
    return false;
  }
}

/** 识别功能是否可用（配置 + 平台） */
export const recognizeAvailable = (): boolean => RECOGNIZE_AVAILABLE && initCloud();

/** 自动识别开关（用户可关闭，关闭后仅手动触发；默认开） */
export const isAutoRecognizeOn = (): boolean => Taro.getStorageSync(AUTO_SWITCH_KEY) !== false;
export const setAutoRecognize = (on: boolean): void => {
  Taro.setStorageSync(AUTO_SWITCH_KEY, on);
  console.info('[Recognize] 自动识别开关 =', on);
};

/** 首次识别前隐私确认；拒绝则关闭自动识别且本次不识别 */
export async function ensurePrivacyOk(): Promise<boolean> {
  if (Taro.getStorageSync(PRIVACY_KEY) === true) return true;
  try {
    const res = await Taro.showModal({
      title: '照片识别说明',
      content: '照片将压缩后上传用于识别衣物属性（经云函数中转，不上传公开网络）。是否开启自动识别？',
      confirmText: '同意',
      cancelText: '拒绝'
    });
    const ok = !!res.confirm;
    Taro.setStorageSync(PRIVACY_KEY, ok);
    if (!ok) setAutoRecognize(false);
    return ok;
  } catch (e) {
    return false;
  }
}

interface MonthUsage {
  month: string;
  calls: number;
}

/** 当月用量（本地估算；云端数据库计数为准） */
export function getMonthUsage(): { month: string; calls: number; estCost: number } {
  const month = currentMonth();
  try {
    const u = Taro.getStorageSync(USAGE_KEY) as MonthUsage | '';
    if (u && u.month === month && typeof u.calls === 'number') {
      return { month, calls: u.calls, estCost: u.calls * RECOGNIZE_COST_PER_CALL };
    }
  } catch (e) {
    // 忽略
  }
  return { month, calls: 0, estCost: 0 };
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function incrLocalUsage(): void {
  const u = getMonthUsage();
  Taro.setStorageSync(USAGE_KEY, { month: u.month, calls: u.calls + 1 } as MonthUsage);
}

export type BudgetState = 'ok' | 'warn' | 'exceeded';

/** 熔断状态：ok / 预警（≥40 元，仅手动）/ 熔断（≥50 元，停止调用） */
export function checkBudget(): BudgetState {
  const { estCost } = getMonthUsage();
  if (estCost >= RECOGNIZE_BUDGET_YUAN) return 'exceeded';
  if (estCost >= RECOGNIZE_WARN_YUAN) return 'warn';
  return 'ok';
}

// ---- 结果缓存（同一张照片不重复调用；仅存成功结果） ----
function cacheGet(key: string): RecognizeResult | null {
  try {
    const map = Taro.getStorageSync(CACHE_KEY) as Record<string, RecognizeResult> | '';
    return (map && map[key]) || null;
  } catch (e) {
    return null;
  }
}

function cacheSet(key: string, data: RecognizeResult): void {
  try {
    const map = (Taro.getStorageSync(CACHE_KEY) as Record<string, RecognizeResult>) || {};
    const entries = Object.entries(map);
    if (entries.length >= CACHE_MAX) entries.shift();
    entries.push([key, data]);
    Taro.setStorageSync(CACHE_KEY, Object.fromEntries(entries));
  } catch (e) {
    // 忽略
  }
}

function cacheKeyOf(path: string): string {
  // 临时路径含随机段，取文件名（wxfile://tmp_xxx.jpg → tmp_xxx.jpg）；http(s) URL 取全路径
  if (/^https?:/.test(path)) return path;
  return path.split('/').pop() || path;
}

/**
 * 识别单张照片（微信端）：上传云存储 → 云函数 → 结构化结果
 * 失败不抛异常，返回带 code 的结果对象，由调用方决定提示方式（方案 2.4-3）
 */
export async function recognizePhoto(photoPath: string): Promise<RecognizeOutcome> {
  if (!recognizeAvailable()) {
    return { code: 'UNAVAILABLE', message: '识别服务不可用（未配置或当前平台不支持）' };
  }
  const budget = checkBudget();
  if (budget === 'exceeded') {
    return { code: 'BUDGET_EXCEEDED', message: '本月识别额度已用尽，下月自动恢复' };
  }
  const key = cacheKeyOf(photoPath);
  const cached = cacheGet(key);
  if (cached) {
    console.info('[Recognize] 命中缓存, key =', key);
    return { code: 'OK', data: cached };
  }
  const privacyOk = await ensurePrivacyOk();
  if (!privacyOk) {
    return { code: 'PRIVACY_DENIED', message: '已取消自动识别' };
  }
  try {
    // 上传压缩图至云存储（临时文件 → cloud://）
    const cloudPath = `recognize/${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`;
    const up = await Taro.cloud.uploadFile({ cloudPath, filePath: photoPath });
    if (!up.fileID) throw new Error('upload failed');

    const res = await Taro.cloud.callFunction({
      name: RECOGNIZE_FN_NAME,
      data: { imageFileID: up.fileID }
    });
    const result = (res.result || {}) as { code: string; message?: string; data?: RecognizeResult };
    console.info('[Recognize] 云函数返回, code =', result.code, 'elapsed =', (res as unknown as { elapsed?: number }).elapsed);

    if (result.code === 'OK' && result.data) {
      incrLocalUsage();
      cacheSet(key, result.data);
      return { code: 'OK', data: result.data };
    }
    return {
      code: result.code as FailureCode,
      message: result.message || '识别失败，请手动填写'
    };
  } catch (e) {
    console.error('[Recognize] 识别调用失败', e);
    return { code: 'RECOGNIZE_FAILED', message: '识别失败，请手动填写' };
  }
}
