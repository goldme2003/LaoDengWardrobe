import type { ClothingItem, WeatherInfo } from '@/types';

/** B 阶段推荐引擎（专项计划 3.2）：纯规则函数，不调用大模型，保证 ≤2s 与可解释性。
 * 排序：季节匹配优先 → 材质温度适配 → 外穿/喜爱加权 → 同类型取最近新增。
 * 说明：文档中「近 30 天未穿优先」依赖日记与衣物的关联数据，当前 DiaryEntry 仅有
 * 照片、无衣物引用，暂不参与排序；待日记支持关联衣物后补齐（不阻塞本期）。
 * 降级：天气不可用 / 衣物为空 / 无可匹配槽位 → 返回空数组，不展示推荐卡片。 */

export interface RecommendOutfit {
  items: ClothingItem[];
  reason: string;
}

type Band = 'cold' | 'cool' | 'mild' | 'warm' | 'hot';

/** 温度档位（体感均值 = (low+high)/2）：<5 / 5–15 / 15–22 / 22–28 / >28℃ */
const bandOf = (avg: number): Band =>
  avg < 5 ? 'cold' : avg <= 15 ? 'cool' : avg <= 22 ? 'mild' : avg <= 28 ? 'warm' : 'hot';

const BAND_META: Record<Band, { seasons: string[]; label: string; tip: string }> = {
  cold: { seasons: ['冬'], label: '气温很低', tip: '重点保暖，外套选厚款' },
  cool: { seasons: ['秋', '春', '冬'], label: '天气偏凉', tip: '外套防风，早晚注意添衣' },
  mild: { seasons: ['春', '秋'], label: '温度舒适', tip: '薄外套备用，应对早晚温差' },
  warm: { seasons: ['春', '夏'], label: '天气偏热', tip: '透气轻薄面料更舒适' },
  hot: { seasons: ['夏'], label: '高温天气', tip: '清凉防晒，避免闷热材质' }
};

/** 品类关键词（衣物类型为用户可自定义字符串，按包含关系模糊匹配） */
const OUTER_KW = ['外套', '羽绒', '棉服', '夹克', '风衣', '大衣', '开衫', '披肩', '马甲', '西服', '西装', '罩衫'];
const TOP_KW = ['上装', '上衣', 'T恤', '恤', '衬衫', '毛衣', '卫衣', '针织', '背心', 'polo', '吊带', '打底', '长袖', '短袖', '衫'];
const BOTTOM_KW = ['裤'];
const SKIRT_KW = ['裙'];
const SHOES_KW = ['鞋'];

/** 保暖材质 / 透气材质（材质同为自定义字符串，模糊匹配） */
const WARM_MATERIALS = ['羽绒', '羊毛', '羊绒', '毛呢', '呢', '针织', '毛衣', '绒', '加厚', '棉服'];
const COOL_MATERIALS = ['麻', '丝', '雪纺', '冰丝', '网眼', '凉', '薄'];

interface SlotDef {
  key: string;
  keywords: string[];
  required: boolean;
  preferWarm?: boolean;
  preferCool?: boolean;
  preferOuterLayer?: boolean;
}

/** 各温度档位的搭配槽位计划（required = 缺该品类时仍推荐其余槽位，但组合至少 1 件） */
const PLANS: Record<Band, SlotDef[]> = {
  cold: [
    { key: '外套', keywords: OUTER_KW, required: true, preferWarm: true, preferOuterLayer: true },
    { key: '上装', keywords: TOP_KW, required: true, preferWarm: true },
    { key: '下装', keywords: BOTTOM_KW, required: true },
    { key: '鞋履', keywords: SHOES_KW, required: false, preferWarm: true }
  ],
  cool: [
    { key: '外套', keywords: OUTER_KW, required: true, preferOuterLayer: true },
    { key: '上装', keywords: TOP_KW, required: true },
    { key: '下装', keywords: BOTTOM_KW, required: true },
    { key: '鞋履', keywords: SHOES_KW, required: false }
  ],
  mild: [
    { key: '外套', keywords: OUTER_KW, required: false },
    { key: '上装', keywords: TOP_KW, required: true },
    { key: '下装', keywords: [...BOTTOM_KW, ...SKIRT_KW], required: true },
    { key: '鞋履', keywords: SHOES_KW, required: false }
  ],
  warm: [
    { key: '上装', keywords: TOP_KW, required: true, preferCool: true },
    { key: '下装', keywords: [...BOTTOM_KW, ...SKIRT_KW], required: true, preferCool: true },
    { key: '鞋履', keywords: SHOES_KW, required: false }
  ],
  hot: [
    { key: '上装', keywords: TOP_KW, required: true, preferCool: true },
    { key: '下装', keywords: [...BOTTOM_KW, ...SKIRT_KW], required: true, preferCool: true },
    { key: '鞋履', keywords: SHOES_KW, required: false, preferCool: true }
  ]
};

const seasonScore = (item: ClothingItem, seasons: string[]): number =>
  item.seasons.reduce((n, s) => n + (seasons.includes(s) ? 3 : 0), 0);

const materialScore = (item: ClothingItem, slot: SlotDef): number => {
  const m = item.material || '';
  const warm = WARM_MATERIALS.some((k) => m.includes(k));
  const cool = COOL_MATERIALS.some((k) => m.includes(k));
  if (slot.preferWarm && warm) return 2;
  if (slot.preferCool && cool) return 2;
  if (slot.preferWarm && cool) return -1;
  if (slot.preferCool && warm) return -1;
  return 0;
};

const scoreOf = (item: ClothingItem, slot: SlotDef, band: Band): number =>
  seasonScore(item, BAND_META[band].seasons) +
  materialScore(item, slot) +
  (slot.preferOuterLayer && item.layer === '外穿' ? 2 : 0) +
  (item.favorite ? 1 : 0);

const buildReason = (weather: WeatherInfo, meta: { label: string; tip: string }, items: ClothingItem[]): string =>
  `${weather.city}今日 ${weather.today.low}~${weather.today.high}℃ ${weather.today.cond}，${meta.label}；${items
    .map((i) => i.name)
    .join(' + ')}，${meta.tip}`;

/**
 * 生成今日穿搭推荐（1–3 套）
 * @param weather 当前天气（含 today.low/high/cond）
 * @param items 当前衣橱衣物列表（非空）
 * @returns 1–3 套推荐，每套含衣物与模板生成的推荐理由；不可推荐时返回空数组
 */
export const buildOutfits = (weather: WeatherInfo | null, items: ClothingItem[]): RecommendOutfit[] => {
  if (!weather || !weather.today || !items || items.length === 0) return [];

  const avg = Math.round((weather.today.low + weather.today.high) / 2);
  const band = bandOf(avg);
  const meta = BAND_META[band];

  // 每个槽位：按关键词筛出候选并打分排序（分数高在前，同分取最近新增）
  const picked = PLANS[band].map((slot) => ({
    slot,
    candidates: items
      .filter((it) => slot.keywords.some((k) => (it.type || '').includes(k)))
      .sort((a, b) => scoreOf(b, slot, band) - scoreOf(a, slot, band) || b.createdAt - a.createdAt)
      .slice(0, 6)
  }));

  const hasAny = picked.some((p) => p.candidates.length > 0);
  if (!hasAny) return [];

  // 生成最多 3 套：第 k 套在每个槽位取第 k 顺位候选（候选不足时循环取），按衣物 id 去重
  const outfits: RecommendOutfit[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < 3; k++) {
    const combo: ClothingItem[] = [];
    for (const { candidates } of picked) {
      if (candidates.length === 0) continue;
      const it = candidates[k % candidates.length];
      if (!combo.some((c) => c.id === it.id)) combo.push(it);
    }
    const sig = combo.map((c) => c.id).sort().join(',');
    if (combo.length > 0 && !seen.has(sig)) {
      seen.add(sig);
      outfits.push({ items: combo, reason: buildReason(weather, meta, combo) });
    }
  }
  return outfits;
};
