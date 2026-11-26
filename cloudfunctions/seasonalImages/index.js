/** 当季推荐图组云函数（v1.14.0）
 * 入参：{ action: 'ping' | 'generate', tier?: 'free'|'vip'|'svip', gender?: 'male'|'female'|'other', age?: number,
 *        style?: string, custom?: string }
 * 出参：{ code: 'OK'|'BAD_PARAM'|'TIER_NOT_ALLOWED'|'BUDGET_EXCEEDED'|'GENERATE_FAILED',
 *        images: [{ fileID, label }], season, seasonLabel, dateKey, source: 'cloud' }
 * 说明：
 *   1. v1.14.0 起改为「点击后按需生成」：前端点击默认风格（style key）或填写自定义风格（custom 文本）后按张生成，
 *      每次生成 1 张；每日可生成张数由会员额度控制（普通 0 / VIP 1 / SVIP 2，在前端 memberUsage 计数），
 *      云端不再按档位固定整组生成；
 *   2. 按「当日 + 季节 + 性别 + 年龄段 + 风格」缓存到集合 seasonal_images，全用户共享同一天同组合的图片，避免重复计费；
 *      自定义风格以 c_<md5 前 10 位> 作为缓存风格键，label 保留原文；
 *   3. 生成的临时 URL 一律下载后转存云开发存储，返回 cloud fileID，绕开小程序图片域名白名单；
 *   4. 月度预算熔断：环境变量 SEASONAL_BUDGET_YUAN（默认 30 元）、SEASONAL_COST_PER_IMAGE（默认 0.2 元/张），
 *      超预算返回 BUDGET_EXCEEDED，前端不新增图片。
 *   5. 需在云开发控制台创建集合：seasonal_images、seasonal_usage（权限：仅管理端可读写）。 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { callGlmImage, downloadImage, MODEL } = require('./provider/glmImage');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTION = 'seasonal_images';
const USAGE_COLLECTION = 'seasonal_usage';
const MONTHLY_BUDGET = Number(process.env.SEASONAL_BUDGET_YUAN || 30);
const COST_PER_IMAGE = Number(process.env.SEASONAL_COST_PER_IMAGE || 0.2);

/** 季节：流行元素词库（每年可在此更新当季趋势） */
const SEASONS = {
  spring: { label: '春季', pop: '浅色系、轻薄风衣、针织开衫、碎花元素、直筒裤、小白鞋' },
  summer: { label: '夏季', pop: '棉麻与冰丝面料、短袖衬衫、阔腿短裤、渔夫帽、凉鞋' },
  autumn: { label: '秋季', pop: '大地色系、羊毛混纺、廓形西装、针织衫、短靴、斜挎包' },
  winter: { label: '冬季', pop: '羽绒与羊绒质感、大衣叠穿、深色系、围巾、手套、切尔西靴' }
};

/** 风格库（v1.14.0 扩充为点击选择风格池：默认风格 VIP/SVIP 可选，高级风格 SVIP 专属） */
const STYLE_LIB = {
  daily: { label: '日常百搭', desc: '基础款干净清爽的日常休闲穿搭，版型合身舒适' },
  commute: { label: '通勤简约', desc: '通勤造型，利落剪裁与克制的配色，衬衫、西裤与风衣的层次搭配' },
  street: { label: '街头休闲', desc: '街头休闲造型，廓形外套与宽松裤型，复古球鞋' },
  sport: { label: '运动活力', desc: '运动活力造型，速干面料与机能细节，轻盈有型的运动鞋履' },
  smart: { label: '轻正式', desc: '轻正式造型，垂坠面料与精致细节，简约皮质鞋履' },
  weekend: { label: '周末出行', desc: '周末出行造型，轻松随性的叠穿与舒适鞋履，适合逛街与短途出游' },
  couture: { label: '高定质感', desc: '高级定制质感造型，考究面料与剪裁，低饱和高级配色，配饰点缀' },
  detail: { label: '配饰细节', desc: '重点呈现配饰搭配：包袋、墨镜、腰带、首饰与鞋履的呼应关系' }
};

/** SVIP 专属高级风格（VIP 请求时返回 TIER_NOT_ALLOWED） */
const PREMIUM_STYLES = ['couture', 'detail'];

/** 自定义风格缓存键：c_<md5 前 10 位>（label 保留原文，同文本稳定映射） */
function customStyleKey(text) {
  return `c_${crypto.createHash('md5').update(text).digest('hex').slice(0, 10)}`;
}

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

/** 生图提示词：默认风格用风格库描述，自定义风格用原文拼接 */
function buildPrompt({ seasonKey, gender, ageGroup, styleKey, customText }) {
  const season = SEASONS[seasonKey];
  const genderText = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '中性';
  const styleDesc = customText
    ? `以「${customText}」为主题的当季流行造型，风格特征贴合文字描述，整体配色与版型协调统一`
    : STYLE_LIB[styleKey].desc;
  return `专业时尚摄影，竖版全身构图。${ageGroup.text}${genderText}模特，${season.label}当季流行穿搭：${styleDesc}。
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

/** v1.14.0：版本标识（启动日志与 ping 均输出，用于确认云端部署的是否为最新代码）
 * GLM 分支：生图模型由混元 Hy-Image-3.5-Preview 切换为智谱 GLM-IMAGE（glm-image） */
const VERSION = 'v2.0.0-glm';

async function generateStyle({ dateKey, seasonKey, gender, ageGroup, styleKey, label, customText }) {
  const prompt = buildPrompt({ seasonKey, gender, ageGroup, styleKey, customText });
  // GLM-IMAGE 为同步接口，无需 session 一致性调度参数
  const url = await callGlmImage(prompt);
  // v1.13.2：生图已计费（单张 10s+），下载失败重试 1 次，避免偶发网络错误浪费已生成的结果
  let buffer;
  try {
    buffer = await downloadImage(url);
  } catch (e) {
    console.warn(`[seasonalImages] ${label} 下载失败（${e.message}），1s 后重试`);
    await new Promise((r) => setTimeout(r, 1000));
    buffer = await downloadImage(url);
  }
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
    label,
    custom: !!customText,
    prompt,
    updatedAt: Date.now()
  };
  await saveDoc(docIdOf(dateKey, seasonKey, gender, ageGroup.key, styleKey), record);
  return { fileID: uploaded.fileID, label };
}

exports.main = async (event = {}) => {
  const action = event.action || 'generate';
  console.log(`[seasonalImages] ${VERSION} 启动，action=${action}`);

  if (action === 'ping') {
    return {
      code: 'OK',
      version: VERSION,
      hasGlmKey: !!process.env.GLM_API_KEY,
      model: MODEL,
      endpoint: 'open.bigmodel.cn/api/paas/v4/images/generations',
      budgetPerMonth: MONTHLY_BUDGET
    };
  }

  if (action !== 'generate') {
    return { code: 'BAD_PARAM', message: '未知 action', images: [] };
  }

  const tier = ['vip', 'svip'].includes(event.tier) ? event.tier : 'free';
  const gender = ['male', 'female'].includes(event.gender) ? event.gender : 'other';
  const rawAge = Number(event.age);
  const age = Number.isFinite(rawAge) ? Math.min(99, Math.max(10, Math.round(rawAge))) : 30;
  const ageGroup = ageGroupOf(age);

  // 普通版不支持 AI 生图：直接拒绝，避免无效调用与计费
  if (tier === 'free') {
    return {
      code: 'TIER_NOT_ALLOWED',
      images: [],
      message: '普通版不支持 AI 当季图组，开通 VIP 后可生成'
    };
  }

  // v1.14.0：按需生成——单次调用只生成一个风格（默认风格 key 或自定义风格文本，custom 优先）
  const customText = typeof event.custom === 'string' ? event.custom.trim().slice(0, 12) : '';
  const styleKey = customText ? customStyleKey(customText) : String(event.style || '');
  const label = customText || (STYLE_LIB[styleKey] ? STYLE_LIB[styleKey].label : '');

  if (!label) {
    return { code: 'BAD_PARAM', message: '缺少风格（style 或 custom）', images: [] };
  }
  if (!customText && PREMIUM_STYLES.includes(styleKey) && tier !== 'svip') {
    return { code: 'TIER_NOT_ALLOWED', images: [], message: '高定风格为 SVIP 专属，升级后可生成' };
  }

  const d = beijingNow();
  const dateKey = dateKeyOf(d);
  const seasonKey = seasonKeyOf(d.getUTCMonth() + 1);
  const docId = docIdOf(dateKey, seasonKey, gender, ageGroup.key, styleKey);

  // 1. 命中缓存直接返回（同一天同组合全用户共享，不重复计费）
  const hit = await getDoc(docId);
  if (hit && hit.status === 'ready' && hit.fileID) {
    return {
      code: 'OK',
      images: [{ fileID: hit.fileID, label: hit.label || label }],
      season: seasonKey,
      seasonLabel: SEASONS[seasonKey].label,
      dateKey,
      source: 'cloud',
      cached: true
    };
  }

  // 2. 预算熔断
  if (await overBudget(monthKeyOf(d), 1)) {
    console.warn('[seasonalImages] 本月生图预算已用尽');
    return {
      code: 'BUDGET_EXCEEDED',
      images: [],
      season: seasonKey,
      seasonLabel: SEASONS[seasonKey].label,
      dateKey,
      source: 'cloud',
      message: '本月当季图组生成额度已用尽'
    };
  }

  // 3. 生成单张并转存云存储
  try {
    const image = await generateStyle({
      dateKey,
      seasonKey,
      gender,
      ageGroup,
      styleKey,
      label,
      customText: customText || undefined
    });
    await recordUsage(monthKeyOf(d), 1);
    return {
      code: 'OK',
      images: [image],
      season: seasonKey,
      seasonLabel: SEASONS[seasonKey].label,
      dateKey,
      source: 'cloud',
      generated: 1
    };
  } catch (e) {
    console.error(`[seasonalImages] 风格「${label}」生成失败：`, e.message);
    return {
      code: 'GENERATE_FAILED',
      images: [],
      season: seasonKey,
      seasonLabel: SEASONS[seasonKey].label,
      dateKey,
      source: 'cloud',
      message: e.message
    };
  }
};
