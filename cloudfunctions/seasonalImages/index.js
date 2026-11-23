/** 当季推荐图组云函数（v1.13.1）
 * 入参：{ action: 'ping' | 'generate', tier?: 'free'|'vip'|'svip', gender?: 'male'|'female'|'other', age?: number }
 * 出参：{ code: 'OK'|'BAD_PARAM'|'TIER_NOT_ALLOWED'|'BUDGET_EXCEEDED'|'GENERATE_FAILED',
 *        images: [{ fileID, label }], season, seasonLabel, dateKey, source: 'cloud' }
 * 说明：
 *   1. 按「当日 + 季节 + 性别 + 年龄段 + 风格」缓存到集合 seasonal_images，全用户共享同一天同组合的图片，避免重复计费；
 *   2. 生成的临时 URL 一律下载后转存云开发存储，返回 cloud fileID，绕开小程序图片域名白名单；
 *   3. 会员档位决定张数与风格组：普通版不支持生图（0 张，前端展示本地示例并引导升级）、VIP 1 张（通勤简约）、
 *      SVIP 2 张（高定质感 + 配饰细节）；
 *   4. 月度预算熔断：环境变量 SEASONAL_BUDGET_YUAN（默认 30 元）、SEASONAL_COST_PER_IMAGE（默认 0.2 元/张），
 *      超预算返回 BUDGET_EXCEEDED，前端使用本地图组兜底。
 *   5. 需在云开发控制台创建集合：seasonal_images、seasonal_usage（权限：仅管理端可读写）。 */
const cloud = require('wx-server-sdk');
const { callHunyuanImage, downloadImage, MODEL } = require('./provider/hunyuanImage');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTION = 'seasonal_images';
const USAGE_COLLECTION = 'seasonal_usage';
const MONTHLY_BUDGET = Number(process.env.SEASONAL_BUDGET_YUAN || 30);
const COST_PER_IMAGE = Number(process.env.SEASONAL_COST_PER_IMAGE || 0.2);
/** 生图并发（云函数总超时 60s，5 张分两轮完成） */
const CONCURRENCY = 3;

/** 季节：流行元素词库（每年可在此更新当季趋势） */
const SEASONS = {
  spring: { label: '春季', pop: '浅色系、轻薄风衣、针织开衫、碎花元素、直筒裤、小白鞋' },
  summer: { label: '夏季', pop: '棉麻与冰丝面料、短袖衬衫、阔腿短裤、渔夫帽、凉鞋' },
  autumn: { label: '秋季', pop: '大地色系、羊毛混纺、廓形西装、针织衫、短靴、斜挎包' },
  winter: { label: '冬季', pop: '羽绒与羊绒质感、大衣叠穿、深色系、围巾、手套、切尔西靴' }
};

/** 风格库（云端缓存与会员档位共用：同一风格跨档位复用，只按张数与风格组合区分） */
const STYLE_LIB = {
  daily: { label: '日常百搭', desc: '基础款干净清爽的日常休闲穿搭，版型合身舒适' },
  commute: { label: '通勤简约', desc: '通勤造型，利落剪裁与克制的配色，衬衫、西裤与风衣的层次搭配' },
  street: { label: '街头休闲', desc: '街头休闲造型，廓形外套与宽松裤型，复古球鞋' },
  smart: { label: '轻正式', desc: '轻正式造型，垂坠面料与精致细节，简约皮质鞋履' },
  couture: { label: '高定质感', desc: '高级定制质感造型，考究面料与剪裁，低饱和高级配色，配饰点缀' },
  detail: { label: '配饰细节', desc: '重点呈现配饰搭配：包袋、墨镜、腰带、首饰与鞋履的呼应关系' }
};

/** 会员档位 → 风格组与张数（普通不支持 / VIP 1 / SVIP 2，内容与数量双差异） */
const TIER_STYLES = {
  free: [],
  vip: ['commute'],
  svip: ['couture', 'detail']
};

/** 北京时间（云函数默认时区可能为 UTC，显式换算保证「今日」口径一致） */
function beijingNow() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}

const pad2 = (v) => String(v).padStart(2, '0');

function dateKeyOf(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function monthKeyOf(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** 季节（按北京时间月份）：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬 */
function seasonKeyOf(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/** 年龄段（与空衣橱引导、推荐提示词口径一致） */
function ageGroupOf(age) {
  if (age < 18) return { key: 'teen', text: '青少年' };
  if (age <= 30) return { key: 'young', text: '青年' };
  if (age <= 50) return { key: 'middle', text: '中年' };
  return { key: 'senior', text: '熟龄' };
}

function buildPrompt({ seasonKey, gender, ageGroup, styleKey }) {
  const season = SEASONS[seasonKey];
  const genderText = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '中性';
  const style = STYLE_LIB[styleKey];
  return `专业时尚摄影，竖版全身构图。${ageGroup.text}${genderText}模特，${season.label}当季流行穿搭：${style.desc}。
当季流行元素参考：${season.pop}。
写实街拍风格，自然光，背景简洁，服装面料与版型细节清晰，画面中不出现文字、水印、品牌 logo，不出现真实名人。`;
}

function docIdOf(dateKey, seasonKey, gender, ageGroupKey, styleKey) {
  return `${dateKey}_${seasonKey}_${gender}_${ageGroupKey}_${styleKey}`;
}

async function getDoc(id) {
  try {
    const res = await db.collection(COLLECTION).doc(id).get();
    return res && res.data ? res.data : null;
  } catch (e) {
    return null;
  }
}

async function saveDoc(id, data) {
  try {
    await db.collection(COLLECTION).doc(id).set({ data });
  } catch (e) {
    console.error('[seasonalImages] 写缓存记录失败：', e.message);
  }
}

/** 月度预算：读取已消耗张数，判断本次生成是否超预算（统计异常时不阻断业务） */
async function overBudget(monthKey, count) {
  try {
    const res = await db.collection(USAGE_COLLECTION).doc(monthKey).get();
    const used = res && res.data ? Number(res.data.images) || 0 : 0;
    return (used + count) * COST_PER_IMAGE > MONTHLY_BUDGET;
  } catch (e) {
    return false;
  }
}

async function recordUsage(monthKey, count) {
  try {
    await db.collection(USAGE_COLLECTION).doc(monthKey).update({ data: { images: _.inc(count), updatedAt: Date.now() } });
  } catch (e) {
    try {
      await db.collection(USAGE_COLLECTION).doc(monthKey).set({
        data: { images: count, budget: MONTHLY_BUDGET, costPerImage: COST_PER_IMAGE, updatedAt: Date.now() }
      });
    } catch (e2) {
      console.error('[seasonalImages] 用量记录失败：', e2.message);
    }
  }
}

/** 限并发映射 */
async function mapWithLimit(list, limit, fn) {
  const results = new Array(list.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (cursor < list.length) {
      const idx = cursor++;
      results[idx] = await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function generateStyle({ dateKey, seasonKey, gender, ageGroup, styleKey }) {
  const prompt = buildPrompt({ seasonKey, gender, ageGroup, styleKey });
  const url = await callHunyuanImage(prompt);
  const buffer = await downloadImage(url);
  const cloudPath = `seasonal/${dateKey}/${seasonKey}-${gender}-${ageGroup.key}-${styleKey}.jpg`;
  const uploaded = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  if (!uploaded || !uploaded.fileID) throw new Error('UPLOAD_FAILED');
  const record = {
    fileID: uploaded.fileID,
    status: 'ready',
    dateKey,
    season: seasonKey,
    gender,
    ageGroup: ageGroup.key,
    style: styleKey,
    label: STYLE_LIB[styleKey].label,
    prompt,
    updatedAt: Date.now()
  };
  await saveDoc(docIdOf(dateKey, seasonKey, gender, ageGroup.key, styleKey), record);
  return { fileID: uploaded.fileID, label: STYLE_LIB[styleKey].label };
}

exports.main = async (event = {}) => {
  const action = event.action || 'generate';

  if (action === 'ping') {
    return {
      code: 'OK',
      hasHunyuanKey: !!process.env.HUNYUAN_API_KEY,
      model: MODEL,
      endpoint: 'tokenhub.tencentmaas.com/v1/api/image/lite',
      budgetPerMonth: MONTHLY_BUDGET
    };
  }

  if (action !== 'generate') {
    return { code: 'BAD_PARAM', message: '未知 action', images: [] };
  }

  const tier = TIER_STYLES[event.tier] ? event.tier : 'free';
  const gender = ['male', 'female'].includes(event.gender) ? event.gender : 'other';
  const rawAge = Number(event.age);
  const age = Number.isFinite(rawAge) ? Math.min(99, Math.max(10, Math.round(rawAge))) : 30;
  const ageGroup = ageGroupOf(age);

  // 普通版不支持 AI 生图：直接拒绝，避免无效调用与计费
  if (tier === 'free') {
    return {
      code: 'TIER_NOT_ALLOWED',
      images: [],
      message: '普通版不支持 AI 当季图组，开通 VIP 后可查看'
    };
  }

  const d = beijingNow();
  const dateKey = dateKeyOf(d);
  const seasonKey = seasonKeyOf(d.getUTCMonth() + 1);
  const styleKeys = TIER_STYLES[tier];

  // 1. 命中缓存直接返回（同一天同组合全用户共享）
  const images = [];
  const missing = [];
  for (const styleKey of styleKeys) {
    const hit = await getDoc(docIdOf(dateKey, seasonKey, gender, ageGroup.key, styleKey));
    if (hit && hit.status === 'ready' && hit.fileID) {
      images.push({ fileID: hit.fileID, label: hit.label || STYLE_LIB[styleKey].label });
    } else {
      missing.push(styleKey);
    }
  }

  if (missing.length === 0) {
    return {
      code: 'OK',
      images,
      season: seasonKey,
      seasonLabel: SEASONS[seasonKey].label,
      dateKey,
      source: 'cloud'
    };
  }

  // 2. 预算熔断
  if (await overBudget(monthKeyOf(d), missing.length)) {
    console.warn('[seasonalImages] 本月生图预算已用尽，返回已缓存结果');
    return {
      code: images.length > 0 ? 'OK' : 'BUDGET_EXCEEDED',
      images,
      season: seasonKey,
      seasonLabel: SEASONS[seasonKey].label,
      dateKey,
      source: 'cloud',
      message: '本月当季图组生成额度已用尽'
    };
  }

  // 3. 生成缺失风格（限并发），单个失败不影响其余图片
  let okCount = 0;
  const generated = await mapWithLimit(missing, CONCURRENCY, async (styleKey) => {
    try {
      const out = await generateStyle({ dateKey, seasonKey, gender, ageGroup, styleKey });
      okCount += 1;
      return out;
    } catch (e) {
      console.error(`[seasonalImages] 风格 ${styleKey} 生成失败：`, e.message);
      return null;
    }
  });

  generated.forEach((it) => {
    if (it) images.push(it);
  });
  if (okCount > 0) await recordUsage(monthKeyOf(d), okCount);

  // 按档位风格顺序输出，保证跑马灯顺序稳定
  const order = new Map(styleKeys.map((k, i) => [STYLE_LIB[k].label, i]));
  images.sort((a, b) => (order.get(a.label) || 0) - (order.get(b.label) || 0));

  if (images.length === 0) {
    return {
      code: 'GENERATE_FAILED',
      images: [],
      season: seasonKey,
      seasonLabel: SEASONS[seasonKey].label,
      dateKey,
      source: 'cloud'
    };
  }

  return {
    code: 'OK',
    images,
    season: seasonKey,
    seasonLabel: SEASONS[seasonKey].label,
    dateKey,
    source: 'cloud',
    generated: okCount
  };
};
