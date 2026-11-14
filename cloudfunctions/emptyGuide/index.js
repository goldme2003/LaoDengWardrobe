/** 空衣橱专属引导文案（PRD 9.1.2）
 * 入参：{ action: 'ping' | 'guide', gender: 'male'|'female'|'other', age: number, wardrobeName?: string }
 * 出参：{ code: 'OK'|'BAD_PARAM', tips: string[], source: 'hunyuan'|'fallback' }
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

function fallbackTip(gender, age) {
  const base = age < 18 ? FALLBACK.teen : age <= 30 ? FALLBACK.young : age <= 50 ? FALLBACK.middle : FALLBACK.senior;
  return base.slice(0, MAX_LEN);
}

function normalize(event) {
  const gender = ['male', 'female', 'other'].includes(event.gender) ? event.gender : 'other';
  const n = Number(event.age);
  const age = Number.isFinite(n) ? Math.min(99, Math.max(10, Math.round(n))) : 30;
  const wardrobeName = typeof event.wardrobeName === 'string' && event.wardrobeName.trim()
    ? event.wardrobeName.trim().slice(0, 20)
    : '我的衣橱';
  return { gender, age, wardrobeName };
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

  const { gender, age, wardrobeName } = normalize(event);
  const cacheKey = `${gender}-${age}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) {
    return { code: 'OK', tips: hit.tips, source: hit.source };
  }

  try {
    const tips = await callHunyuanGuide(gender, age, wardrobeName);
    cache.set(cacheKey, { tips, source: 'hunyuan', ts: Date.now() });
    return { code: 'OK', tips, source: 'hunyuan' };
  } catch (e) {
    console.error('[emptyGuide] 混元生成失败，使用兜底文案：', e.message);
    return { code: 'OK', tips: [fallbackTip(gender, age)], source: 'fallback' };
  }
};
