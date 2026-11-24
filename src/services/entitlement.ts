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
  /** 服装批量导入/批量添加（次/月），0 = 无（v1.11.0 已上线：单次批量任务 = 1 次，写 memberUsage.batchImportUsed） */
  batchImportPerMonth: number;
  /** 当季推荐图组（张/天）：普通 0（不生图，展示本地示例）/ VIP 1 / SVIP 2（v1.13.1 调整；v1.14.0 起为每日可生成张数——点击风格或自定义风格后按张生成） */
  seasonalPerDay: number;
  /** 天气穿搭推荐档位 */
  weatherLevel: WeatherLevel;
  /** 出差推荐（次/月），0 = 无，null = 无限次 */
  tripPerMonth: number | null;
  /** 时尚穿搭推荐（次/月），0 = 无，null = 无限次（功能待开发，仅登记权益） */
  fashionPerMonth: number | null;
  /** 云同步：local = 本地存储，cloud = 云端（待开发，仅登记权益） */
  cloudSync: 'local' | 'cloud';
  /** v1.10.0：明日穿搭推荐每日可生成套数（生成后当天缓存，次日重新生成；套数用尽只展示缓存） */
  dailyOutfits: number;
}

export const TIERS: Record<MemberTier, TierConfig> = {
  free: {
    id: 'free',
    label: '普通版',
    price: null,
    wardrobes: 1,
    batchImportPerMonth: 0,
    seasonalPerDay: 0,
    weatherLevel: 'basic',
    tripPerMonth: 0,
    fashionPerMonth: 0,
    cloudSync: 'local',
    dailyOutfits: 1
  },
  vip: {
    id: 'vip',
    label: 'VIP',
    price: 18,
    wardrobes: 2,
    batchImportPerMonth: 5,
    seasonalPerDay: 1,
    weatherLevel: 'plus',
    tripPerMonth: 5,
    fashionPerMonth: 5,
    cloudSync: 'cloud',
    dailyOutfits: 2
  },
  svip: {
    id: 'svip',
    label: 'SVIP',
    price: 48,
    wardrobes: 5,
    batchImportPerMonth: 15,
    seasonalPerDay: 2,
    weatherLevel: 'full',
    tripPerMonth: null,
    fashionPerMonth: null,
    cloudSync: 'cloud',
    dailyOutfits: 5
  }
};

export const TIER_ORDER: MemberTier[] = ['free', 'vip', 'svip'];

export const tierOf = (tier: MemberTier | undefined | ''): TierConfig =>
  TIERS[tier || 'free'] || TIERS.free;

/** v1.10.0：推荐档位文案修正——VIP 档不再称「中间档」；
 * 普通版 = 按性别/年龄/明日天气的精简推荐；VIP = AI 详细推荐；SVIP = 综合全衣橱深度推荐 */
export const weatherLevelLabel: Record<WeatherLevel, string> = {
  basic: '精简推荐',
  plus: 'AI 详细推荐',
  full: '综合衣橱深度推荐'
};

/** 会员权益计数（按天/按月窗口滚动重置） */
export interface MemberUsage {
  /** 当前天（YYYY-MM-DD），与当日不符则日额度重置 */
  day: string;
  /** 当季图组今日已生成张数（v1.14.0：点击风格生成 1 张记 1 次，恢复展示已生成图组不重复计数） */
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

/** v1.11.0：批量添加（批量导入）额度状态——blocked = 无权益（普通版），counted = 按月限次 */
export const batchImportQuota = (
  tier: MemberTier
): { kind: 'blocked' | 'counted'; limit: number } => {
  const v = tierOf(tier).batchImportPerMonth;
  if (v <= 0) return { kind: 'blocked', limit: 0 };
  return { kind: 'counted', limit: v };
};

/** v1.11.0（重点变更）：衣物属性自动识别为 VIP 及以上专属能力，普通版不自动识别 */
export const canAutoRecognize = (tier: MemberTier): boolean => tier === 'vip' || tier === 'svip';

/** v1.10.0：明日穿搭推荐单套缓存条目（当天有效，次日清空重新生成） */
export interface DailyOutfitEntry {
  id: string;
  scene: string;
  sceneLabel: string;
  /** 推荐理由（含档位差异化建议文案，生成时固化，当天内不再变化） */
  reason: string;
  itemIds: string[];
  source: 'hunyuan' | 'fallback';
}

/** v1.10.0：明日推荐当天缓存（key = 衣橱id），day 与当日不符视为过期（空列表） */
export interface DailyOutfitCache {
  day: string;
  list: DailyOutfitEntry[];
}

/** 读取某衣橱今日有效的明日推荐缓存（day 过期返回空数组） */
export const dailyOutfitsOf = (
  cache: Record<string, DailyOutfitCache> | undefined,
  wardrobeId: string
): DailyOutfitEntry[] => {
  const entry = cache && cache[wardrobeId];
  if (!entry || entry.day !== todayKey()) return [];
  return entry.list || [];
};
