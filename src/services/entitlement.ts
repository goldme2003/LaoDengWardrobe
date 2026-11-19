/** F-19 会员权益配置（v1.9.0）
 * 三档会员：普通（free，免费）/ VIP / SVIP；VIP 与 SVIP 仅功能与价格不同，
 * 均为一次性买断（无月/季/年卡等基于时间的价格）。
 * 本文件为权益的唯一定义处：门控、会员中心页、额度计数均从这里取值。
 * 定价为占位值（支付未开通），上线前由需求方最终确认。 */

export type MemberTier = 'free' | 'vip' | 'svip';

/** 天气穿搭推荐档位：精简（本地规则引擎单套）/ 中间（混元生成）/ 综合（混元按全衣橱综合推荐） */
export type WeatherLevel = 'basic' | 'plus' | 'full';

export interface TierConfig {
  id: MemberTier;
  label: string;
  /** 一次性买断价（元）；null = 免费 */
  price: number | null;
  /** 衣橱数量上限 */
  wardrobes: number;
  /** 服装批量导入/分类（次/月），0 = 无（功能待开发，仅登记权益） */
  batchImportPerMonth: number;
  /** 当季推荐图组（张/天） */
  seasonalPerDay: number;
  /** 天气穿搭推荐档位 */
  weatherLevel: WeatherLevel;
  /** 出差推荐（次/月），0 = 无，null = 无限次 */
  tripPerMonth: number | null;
  /** 时尚穿搭推荐（次/月），0 = 无，null = 无限次（功能待开发，仅登记权益） */
  fashionPerMonth: number | null;
  /** 云同步：local = 本地存储，cloud = 云端（待开发，仅登记权益） */
  cloudSync: 'local' | 'cloud';
}

export const TIERS: Record<MemberTier, TierConfig> = {
  free: {
    id: 'free',
    label: '普通版',
    price: null,
    wardrobes: 1,
    batchImportPerMonth: 0,
    seasonalPerDay: 2,
    weatherLevel: 'basic',
    tripPerMonth: 0,
    fashionPerMonth: 0,
    cloudSync: 'local'
  },
  vip: {
    id: 'vip',
    label: 'VIP',
    price: 18,
    wardrobes: 2,
    batchImportPerMonth: 5,
    seasonalPerDay: 5,
    weatherLevel: 'plus',
    tripPerMonth: 5,
    fashionPerMonth: 5,
    cloudSync: 'cloud'
  },
  svip: {
    id: 'svip',
    label: 'SVIP',
    price: 48,
    wardrobes: 5,
    batchImportPerMonth: 15,
    seasonalPerDay: 10,
    weatherLevel: 'full',
    tripPerMonth: null,
    fashionPerMonth: null,
    cloudSync: 'cloud'
  }
};

export const TIER_ORDER: MemberTier[] = ['free', 'vip', 'svip'];

export const tierOf = (tier: MemberTier | undefined | ''): TierConfig =>
  TIERS[tier || 'free'] || TIERS.free;

export const weatherLevelLabel: Record<WeatherLevel, string> = {
  basic: '精简推荐',
  plus: '中间档',
  full: '综合已有衣物'
};

/** 会员权益计数（按天/按月窗口滚动重置） */
export interface MemberUsage {
  /** 当前天（YYYY-MM-DD），与当日不符则日额度重置 */
  day: string;
  /** 当季推荐图组今日已看张数 */
  seasonalViewed: number;
  /** 当前月（YYYY-MM），与当月不符则月额度重置 */
  month: string;
  /** 本月出差推荐已用次数 */
  tripUsed: number;
  /** 本月批量导入已用次数 */
  batchImportUsed: number;
  /** 本月时尚穿搭推荐已用次数 */
  fashionUsed: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export const todayKey = (d = new Date()): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const monthKey = (d = new Date()): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

export const initialUsage = (): MemberUsage => ({
  day: todayKey(),
  seasonalViewed: 0,
  month: monthKey(),
  tripUsed: 0,
  batchImportUsed: 0,
  fashionUsed: 0
});

/** 窗口滚动：day/month 与当前不符时重置对应计数（读取/写入前调用） */
export const rolledUsage = (usage: MemberUsage | undefined): MemberUsage => {
  const base = usage || initialUsage();
  const day = todayKey();
  const month = monthKey();
  const next: MemberUsage = { ...base };
  if (base.day !== day) {
    next.day = day;
    next.seasonalViewed = 0;
  }
  if (base.month !== month) {
    next.month = month;
    next.tripUsed = 0;
    next.batchImportUsed = 0;
    next.fashionUsed = 0;
  }
  return next;
};

/** 出差推荐额度状态：limit = 次数上限，unlimited = 无限次，blocked = 无权益 */
export const tripQuota = (
  tier: MemberTier
): { kind: 'blocked' | 'counted' | 'unlimited'; limit: number } => {
  const v = tierOf(tier).tripPerMonth;
  if (v === null) return { kind: 'unlimited', limit: Infinity };
  if (v <= 0) return { kind: 'blocked', limit: 0 };
  return { kind: 'counted', limit: v };
};
