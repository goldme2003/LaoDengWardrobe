/** 当季推荐图组云函数（v1.14.0；v2.2.1 GLM模型版：生图模型为智谱 GLM-IMAGE，替换原腾讯混元 Hy-Image-3.5-Preview）
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

/** 季节：仅保留季节标签（v2.2.11：移除固定搭配词库 pop 与固定色板 palette——
 * 搭配不再由提示词限定，改为在提示词中重点体现「明天天气 + 温度 + 季节」，由生图大模型自行搭配） */
const SEASONS = {
  spring: { label: '春季' },
  summer: { label: '夏季' },
  autumn: { label: '秋季' },
  winter: { label: '冬季' }
};

/** v2.2.11：风格描述改为气质向（移除具体单品枚举，避免固定搭配），单品选择完全交给生图模型 */
const STYLE_LIB = {
  daily: { label: '日常百搭', desc: '轻松自在、干净清爽的日常风格' },
  commute: { label: '通勤简约', desc: '简约利落、克制体面的通勤风格' },
  street: { label: '街头休闲', desc: '随性有型的街头风格' },
  sport: { label: '运动活力', desc: '轻盈元气的运动风格' },
  smart: { label: '轻正式', desc: '精致克制的轻正式风格' },
  weekend: { label: '周末出行', desc: '松弛舒适的周末出行风格' },
  couture: { label: '高定质感', desc: '高级考究、鲜明有层次的高定风格' },
  detail: { label: '配饰细节', desc: '重点呈现包袋、墨镜、腰带、首饰与鞋履呼应关系的风格' }
};

/** v2.2.2：各风格的穿着场景（与 outfitRecommend 的场景口径一致，提示词内明确点明场景，避免模型泛泛而谈）
 * v2.2.10：每个风格扩充 3 个候选拍摄背景，生成时随机抽取其一，丰富画面多样性 */
const STYLE_SCENES = {
  daily: ['日常出行与朋友见面', '城市街角', '林荫步道', '河畔公园小径'],
  commute: ['上下班通勤与办公场合', '玻璃幕墙写字楼前的街道', '地铁站出口的商务街区', '现代办公楼前的广场'],
  street: ['街头休闲与城市漫步', '涂鸦墙前的街头', '街铺橱窗旁的步道', '斑马线路口'],
  sport: ['运动健身与户外活动', '滨江跑道', '公园草坪', '体育公园球场旁'],
  smart: ['商务会面与半正式场合', '酒店大堂门前', '艺术画廊门口', '歌剧院门廊台阶'],
  weekend: ['周末逛街与短途出游', '咖啡馆外摆街区', '周末市集', '花店门前'],
  couture: ['晚宴、观展等正式场合', '剧院门廊', '美术馆展厅', '宴会厅长廊'],
  detail: ['日常与通勤场合', '浅色极简墙面', '都市天桥', '玻璃橱窗前']
};

/** v2.2.11：天气 → 画面光线/氛围映射（取代原固定 LIGHTS 光线池，画面天气与明天实际天气一致） */
function weatherLightOf(cond) {
  const c = String(cond || '');
  if (/雪/.test(c)) return '雪天明亮洁净的雪景光线，地面与建筑有积雪氛围';
  if (/雨/.test(c)) return '雨天湿润路面的清透光线，路面带水光反差';
  if (/雾|霾|沙|尘/.test(c)) return '雾天朦胧柔和的光线，远景若隐若现';
  if (/晴/.test(c)) return '阳光明媚的晴天光线，影子清晰';
  if (/阴/.test(c)) return '阴天柔和均匀的光线';
  if (/云/.test(c)) return '多云天气柔和明亮的光线';
  return '明亮通透的自然光';
}

/** v2.2.11：气温区间 → 体感描述（辅助生图模型把握薄厚） */
function tempDescOf(low, high) {
  if (high >= 30) return '炎热，着装轻薄透气';
  if (high >= 24) return '温暖偏热，着装轻便';
  if (low <= 0) return '寒冷，需保暖外套';
  if (low <= 8) return '偏冷，需厚外套';
  if (low <= 14) return '微凉，适合层次穿搭';
  return '温和舒适，着装灵活';
}

/** v2.2.11：经 weatherProxy 获取「明天」天气（cond + low/high），失败返回 null 不阻断生图
 * weatherProxy 内部含华风爱科 → 和风 → 中国天气网降级链路与 30 分钟缓存。 */
async function fetchTomorrowWeather(city) {
  if (!city) return null;
  try {
    const res = await cloud.callFunction({ name: 'weatherProxy', data: { action: 'weather', city } });
    const result = (res && res.result) || {};
    if (result.code !== 'OK' || !result.data) return null;
    const tomorrow = result.data.days && result.data.days[0];
    if (!tomorrow) return null;
    return { city, cond: tomorrow.cond, low: tomorrow.low, high: tomorrow.high };
  } catch (e) {
    console.warn('[seasonalImages] 获取明天天气失败（按无天气降级）：', e.message);
    return null;
  }
}

/** v2.2.10：随机抽样工具——Fisher-Yates 洗牌后取前 n 项（不重复） */
function pickRandom(list, n) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

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

/** 生图提示词：v2.2.11 重构——不限定固定搭配，重点体现「明天天气 + 温度 + 季节 + 场景」，
 * 服装单品、面料与配色由生图大模型根据天气自行决定；场景背景仍随机抽取保证多样性 */
function buildPrompt({ seasonKey, gender, age, ageGroup, styleKey, customText, weather }) {
  const seasonLabel = SEASONS[seasonKey].label;
  const genderText = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '中性';
  const scenes = STYLE_SCENES[styleKey] || ['日常场合', '明亮的城市街景'];
  const sceneText = customText
    ? `以「${customText}」风格出现的场合，贴合该风格惯常的穿着情境`
    : scenes[0];
  const background = customText ? '明亮的城市街景或户外场景' : pickRandom(scenes.slice(1), 1)[0];
  const weatherText = weather
    ? `${weather.city ? `${weather.city}，` : ''}${weather.cond}，气温${weather.low}~${weather.high}℃（${tempDescOf(weather.low, weather.high)}）`
    : `按${seasonLabel}典型天气自行把握`;
  const light = weatherLightOf(weather && weather.cond);
  return `专业时尚摄影，竖版全身构图。为${age}岁${genderText}（${ageGroup.text}，五官、发型、妆容与气质贴合该年龄）推荐一套适合明天天气的${seasonLabel}${sceneText}的时尚穿搭：${styleDescOf(styleKey, customText)}。
明天天气：${weatherText}。
请根据上述季节、温度与天气自行搭配服装单品、面料与配色（如低温选保暖外套、雨天可出现撑伞细节），体现${seasonLabel}当季流行趋势；整体配色明快丰富、鲜而不艳，避免整体偏黄、发灰或单一色调。
拍摄背景：${background}，画面天气氛围与明天实际天气保持一致。
写实街拍风格，${light}，背景干净有层次，服装面料与版型细节清晰，画面中不出现文字、水印、品牌 logo，不出现真实名人。`;
}

/** 风格描述段：自定义风格用原文，默认风格用风格库 desc（拆出以保证 buildPrompt 简洁） */
function styleDescOf(styleKey, customText) {
  if (customText) return `以「${customText}」为主题的当季流行造型，风格特征贴合文字描述`;
  return STYLE_LIB[styleKey].desc;
}

/** 提示词版本：参与缓存记录 id，提示词调整后当天旧图不再命中（v2.2.11 p4 → p5） */
const PROMPT_VERSION = 'p5';

function docIdOf(dateKey, seasonKey, gender, ageGroupKey, styleKey) {
  return `${dateKey}_${seasonKey}_${gender}_${ageGroupKey}_${styleKey}_${PROMPT_VERSION}`;
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
 * v2.2.1 GLM模型版：生图模型切换为智谱 GLM-IMAGE（glm-image，provider/glmImage.js），原混元生图 provider 已移除
 * v2.2.2：修复 GLM 生图 35s 硬超时导致的 GLM_IMAGE_TIMEOUT；提示词补充具体年龄与穿着场景
 * v2.2.4：上游错误透传（error 对象 / content_filter 拦截显式识别并返回给前端）
 * v2.2.8：生图尺寸 1280x1280 → 768x1024（竖版 3:4，像素量约减半以缩短生图等待）
 * v2.2.9：修复生成图偏黄发灰——移除「大地色系 / 深色系」词，新增每季流行色板与多色搭配指令；场景补充具体背景
 * v2.2.10：色板扩容至 10 色/季；主色、点缀色、背景、光线改为生成时随机抽取，修复全部生成酒红的单一色问题
 * v2.2.11：接入天气——经 weatherProxy 获取「明天」天气（cond + 气温区间），提示词移除固定搭配词库（pop/palette）
 *          与固定光线池，重点体现季节 + 温度 + 天气，服装搭配完全交给生图大模型；入参新增可选 city */
const VERSION = 'v2.2.11-glm';

async function generateStyle({ dateKey, seasonKey, gender, age, ageGroup, styleKey, label, customText, weather }) {
  const prompt = buildPrompt({ seasonKey, gender, age, ageGroup, styleKey, customText, weather });
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
    weather: weather || null,
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
  // v2.2.11：城市（可选，用于获取明天天气；与 weatherProxy 的 city 口径一致，去尾部「市」）
  const city = typeof event.city === 'string' ? event.city.trim().slice(0, 20).replace(/市$/, '') : '';
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

  // 3. 获取「明天」天气（可选 city，失败按无天气降级不阻断），再生成单张并转存云存储
  try {
    const weather = await fetchTomorrowWeather(city);
    if (weather) console.log(`[seasonalImages] 明天天气：${weather.city} ${weather.cond} ${weather.low}~${weather.high}℃`);
    const image = await generateStyle({
      dateKey,
      seasonKey,
      gender,
      age,
      ageGroup,
      styleKey,
      label,
      customText: customText || undefined,
      weather
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
