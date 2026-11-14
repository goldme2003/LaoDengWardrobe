/** 空衣橱专属引导文案（PRD 9.1.2 / 专项计划 3.3）
 * 入参：{ action: 'ping' | 'guide', gender: 'male'|'female'|'other', age: number, wardrobeName?: string,
 *        weather?: { cond?: string, low?: number, high?: number } }
 * 出参：{ code: 'OK'|'BAD_PARAM', tips: string[], source: 'hunyuan'|'fallback', weatherUsed: boolean }
 * v1.4.0（C 模块天气增强）：空衣橱时前端传入当前天气，与性别/年龄共同构成请求上下文，
 * 生成适配当前天气的着装建议；缓存键含天气签名，天气变化后可生成新文案。
 * 稳定性：模型超时/鉴权失败/解析失败一律返回内置兜底文案，前端无感。 */
const { callHunyuanGuide } = require('./provider/hunyuan');

/** 单条建议上限（与 PRD 9.1.2 一致） */
const MAX_LEN = 50;
/** 实例内缓存 24 小时（云函数容器复用期间生效，前端另有本地缓存） */
const TTL = 24 * 60 * 60 * 1000;
const cache = new Map();

const FALLBACK = {
  teen: '先从校服之外的百搭单品开始：一件纯色T恤、一条直筒裤和一双运动鞋就够用。',
  young: '先备三件基础款：纯色T恤、直筒牛仔裤和一件轻便外套，通勤休闲都能搭。',
  middle: '建议先添置一件质感外套和两条合身长裤，日常通勤更利落耐穿。',
  senior: '优先选舒适透气的纯棉上衣和宽松长裤，再配一双缓震好走的鞋。'
};

function fallbackTip(gender, age, weather) {
  const base = age < 18 ? FALLBACK.teen : age <= 30 ? FALLBACK.young : age <= 50 ? FALLBACK.middle : FALLBACK.senior;
  // 有天气上下文时，按温度档位补充天气适配提示（拼接后仍 ≤50 字；
  // 先截断再去掉句尾标点，避免出现「都搭。，建议加件外套」式双标点）
  if (weather && typeof weather.avg === 'number') {
    const avg = weather.avg;
    const extra =
      avg < 5 ? '注意防寒保暖' : avg <= 15 ? '建议加件外套' : avg <= 22 ? '薄外套即可' : avg <= 28 ? '穿轻薄透气款' : '选清凉防晒穿搭';
    const head = base.slice(0, MAX_LEN - extra.length - 1).replace(/[。，、；,.\s]+$/, '');
    return `${head}，${extra}`;
  }
  return base.slice(0, MAX_LEN);
}

/** 天气签名（缓存键用）：现象 + 温度档位，同档内命中缓存，跨档生成新文案 */
function weatherSig(w) {
  if (!w) return 'none';
  const band = typeof w.avg === 'number' ? (w.avg < 5 ? 'cold' : w.avg <= 15 ? 'cool' : w.avg <= 22 ? 'mild' : w.avg <= 28 ? 'warm' : 'hot') : 'na';
  return `${w.cond || 'unknown'}-${band}`;
}

function normalize(event) {
  const gender = ['male', 'female', 'other'].includes(event.gender) ? event.gender : 'other';
  const n = Number(event.age);
  const age = Number.isFinite(n) ? Math.min(99, Math.max(10, Math.round(n))) : 30;
  const wardrobeName = typeof event.wardrobeName === 'string' && event.wardrobeName.trim()
    ? event.wardrobeName.trim().slice(0, 20)
    : '我的衣橱';
  // 天气上下文（可选）：仅接受规范字段，缺省/非法时视为无天气
  const w = event.weather && typeof event.weather === 'object' ? event.weather : {};
  const cond = typeof w.cond === 'string' && w.cond.trim() ? w.cond.trim().slice(0, 10) : '';
  const low = Number(w.low);
  const high = Number(w.high);
  const hasTemp = Number.isFinite(low) && Number.isFinite(high) && high >= low;
  const weather = cond || hasTemp
    ? { cond, low: hasTemp ? Math.round(low) : null, high: hasTemp ? Math.round(high) : null, avg: hasTemp ? Math.round((low + high) / 2) : null }
    : null;
  return { gender, age, wardrobeName, weather };
}

exports.main = async (event = {}) => {
  const action = event.action || 'guide';

  if (action === 'ping') {
    return {
      code: 'OK',
      hasHunyuanKey: !!process.env.HUNYUAN_API_KEY,
      model: process.env.HUNYUAN_MODEL || 'hy4',
      endpoint: 'tokenhub.tencentmaas.com/v1/chat/completions'
    };
  }

  if (action !== 'guide') {
    return { code: 'BAD_PARAM', message: '未知 action', tips: [] };
  }

  const { gender, age, wardrobeName, weather } = normalize(event);
  const cacheKey = `${gender}-${age}-${weatherSig(weather)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) {
    return { code: 'OK', tips: hit.tips, source: hit.source, weatherUsed: !!weather };
  }

  try {
    const tips = await callHunyuanGuide(gender, age, wardrobeName, weather);
    cache.set(cacheKey, { tips, source: 'hunyuan', ts: Date.now() });
    return { code: 'OK', tips, source: 'hunyuan', weatherUsed: !!weather };
  } catch (e) {
    console.error('[emptyGuide] 混元生成失败，使用兜底文案：', e.message);
    return { code: 'OK', tips: [fallbackTip(gender, age, weather)], source: 'fallback', weatherUsed: !!weather };
  }
};
