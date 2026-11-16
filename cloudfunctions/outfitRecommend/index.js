/** 明日穿搭推荐（v1.5.0）
 * 入参：{ action: 'ping' | 'recommend', scene: 'all'|'日常'|'通勤'|'运动'|'正式'|'居家'|'旅行',
 *        weather?: { cond?, low?, high? }, gender?: 'male'|'female'|'other', age?: number,
 *        items: [{ id, name, type, layer, color, material, occasions: string[] }],
 *        excludeIds?: string[] }
 * 出参：{ code: 'OK'|'BAD_PARAM', source: 'hunyuan'|'fallback',
 *        itemIds: string[], scene: string, advice: string, weatherUsed: boolean }
 * 说明：混元按所选场景从「当前衣橱衣物清单」中挑一套搭配；模型超时/鉴权/输出非法时
 *       由本函数按同一场景做确定性兜底，前端仍可拿到可用结果并以色标区分来源。 */
const crypto = require('crypto');
const { callHunyuanOutfit } = require('./provider/hunyuan');

const SCENES = ['日常', '通勤', '运动', '正式', '居家', '旅行'];
const MAX_ITEMS = 40;
const MAX_LEN = 60;
const TTL = 10 * 60 * 1000;
const FALLBACK_TTL = 2 * 60 * 1000;
const cache = new Map();

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isScene = (v) => SCENES.includes(v);

function normalize(event) {
  const scene = event.scene === 'all' || isScene(event.scene) ? event.scene : 'all';
  const gender = ['male', 'female', 'other'].includes(event.gender) ? event.gender : 'other';
  const n = Number(event.age);
  const age = Number.isFinite(n) ? Math.min(99, Math.max(10, Math.round(n))) : 30;
  const w = event.weather && typeof event.weather === 'object' ? event.weather : {};
  const cond = str(w.cond, 10);
  const low = Number(w.low);
  const high = Number(w.high);
  const hasTemp = Number.isFinite(low) && Number.isFinite(high) && high >= low;
  const weather = cond || hasTemp
    ? { cond, low: hasTemp ? Math.round(low) : null, high: hasTemp ? Math.round(high) : null, avg: hasTemp ? Math.round((low + high) / 2) : null }
    : null;

  const items = (Array.isArray(event.items) ? event.items : [])
    .slice(0, MAX_ITEMS)
    .map((it) => ({
      id: str(it && it.id, 64),
      name: str(it && it.name, 20),
      type: str(it && it.type, 12),
      layer: str(it && it.layer, 8),
      color: str(it && it.color, 12),
      material: str(it && it.material, 12),
      occasions: (Array.isArray(it && it.occasions) ? it.occasions : []).map((o) => str(o, 10)).filter(Boolean).slice(0, 6)
    }))
    .filter((it) => it.id);

  const excludeIds = (Array.isArray(event.excludeIds) ? event.excludeIds : [])
    .map((id) => str(id, 64))
    .filter(Boolean)
    .slice(0, 8);
  return { scene, gender, age, weather, items, excludeIds };
}

function weatherSig(w) {
  if (!w) return 'none';
  const band = typeof w.avg === 'number' ? (w.avg < 5 ? 'cold' : w.avg <= 15 ? 'cool' : w.avg <= 22 ? 'mild' : w.avg <= 28 ? 'warm' : 'hot') : 'na';
  return `${w.cond || 'unknown'}-${band}`;
}

function cacheKey({ scene, gender, age, weather, items, excludeIds }) {
  const ids = items.map((it) => it.id).sort().join(',');
  const raw = `${scene}|${gender}|${age}|${weatherSig(weather)}|${ids}|${excludeIds.join(',')}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

/** 兜底选搭：优先匹配场景场合，按上装/外套/连衣裙→下装→鞋履补齐 */
function fallbackOutfit(scene, items) {
  let chosenScene = isScene(scene) ? scene : '';
  if (!chosenScene) {
    let best = '日常';
    let bestScore = 0;
    SCENES.forEach((s) => {
      const score = items.reduce((n, it) => n + (it.occasions.includes(s) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    });
    chosenScene = best;
  }
  const matched = items.filter((it) => it.occasions.includes(chosenScene));
  const pool = matched.length > 0 ? matched : items;
  const order = ['上装', '外套', '连衣裙', '裤装', '裙装', '鞋履', '配饰'];
  const picked = [];
  order.forEach((t) => {
    const hit = pool.find((it) => it.type === t && !picked.includes(it));
    if (hit) picked.push(hit);
  });
  if (!picked.length) picked.push(pool[0]);
  const adviceByScene = {
    日常: '以舒适百搭为主，注意早晚温差',
    通勤: '版型利落，颜色不超过三种',
    运动: '优先透气速干，方便活动',
    正式: '整体简洁挺括，细节干净',
    居家: '宽松柔软，活动自在',
    旅行: '轻便易打理，鞋子好走'
  };
  return {
    itemIds: picked.slice(0, 4).map((it) => it.id),
    scene: chosenScene,
    advice: adviceByScene[chosenScene] || '根据天气增减外层'
  };
}

exports.main = async (event = {}) => {
  const action = event.action || 'recommend';
  if (action === 'ping') {
    return {
      code: 'OK',
      hasHunyuanKey: !!process.env.HUNYUAN_API_KEY,
      model: 'hy3',
      endpoint: 'tokenhub.tencentmaas.com/v1/chat/completions'
    };
  }
  if (action !== 'recommend') {
    return { code: 'BAD_PARAM', message: '未知 action', itemIds: [] };
  }

  const params = normalize(event);
  if (!params.items.length) {
    return { code: 'BAD_PARAM', message: '衣物清单为空', itemIds: [], source: 'fallback', scene: '日常', advice: '' };
  }

  const key = cacheKey(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < hit.ttl) {
    return { code: 'OK', ...hit.value, source: hit.source, weatherUsed: !!params.weather };
  }

  const startedAt = Date.now();
  try {
    const result = await callHunyuanOutfit(params);
    const validIds = new Set(params.items.map((it) => it.id));
    const itemIds = [...new Set(result.itemIds)].filter((id) => validIds.has(id)).slice(0, 4);
    if (!itemIds.length) throw new Error('INVALID_ITEM_IDS');
    const scene = isScene(result.scene) ? result.scene : params.scene === 'all' ? fallbackOutfit(params.scene, params.items).scene : params.scene;
    const advice = (result.advice || '').slice(0, MAX_LEN);
    const value = { itemIds, scene, advice };
    cache.set(key, { value, source: 'hunyuan', ts: Date.now(), ttl: TTL });
    return { code: 'OK', ...value, source: 'hunyuan', weatherUsed: !!params.weather };
  } catch (e) {
    const value = fallbackOutfit(params.scene, params.items);
    cache.set(key, { value, source: 'fallback', ts: Date.now(), ttl: FALLBACK_TTL });
    console.error(`[outfitRecommend] 混元生成失败（耗时 ${Date.now() - startedAt}ms），使用兜底选搭：`, e.message);
    return { code: 'OK', ...value, source: 'fallback', weatherUsed: !!params.weather };
  }
};
