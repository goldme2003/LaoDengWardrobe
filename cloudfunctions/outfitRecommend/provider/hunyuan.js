/** 腾讯混元文本模型调用封装（v1.5.0 明日穿搭推荐）
 * 密钥从云函数环境变量 HUNYUAN_API_KEY 读取，本地联调可放 cloudfunctions/outfitRecommend/private.config.json（已 gitignore）。
 * 端点与 emptyGuide / recognizeClothing 一致（文本任务使用模型 hy4），复用同一套密钥配置。 */
const https = require('https');
const path = require('path');

const HOST = 'tokenhub.tencentmaas.com';
/** 单次请求硬超时：socket 空闲超时 + 总耗时上限（避免上游慢回包拖到平台 60s 强杀） */
const TOTAL_TIMEOUT = 12000;
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function loadLocalKey() {
  try {
    // eslint-disable-next-line global-require
    const conf = require(path.join(__dirname, '..', 'private.config.json'));
    return conf.HUNYUAN_API_KEY || '';
  } catch (e) {
    return '';
  }
}

function httpsPostJson(urlPath, apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    let settled = false;
    let timer = null;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    let req;
    try {
      req = https.request(
        {
          hostname: HOST,
          path: urlPath,
          method: 'POST',
          agent,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          },
          timeout: TOTAL_TIMEOUT
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('error', (e) => finish(new Error('HUNYUAN_RESP_ERROR: ' + e.message)));
          res.on('aborted', () => finish(new Error('HUNYUAN_ABORTED')));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              finish(new Error(`HUNYUAN_HTTP_${res.statusCode}: ${buf.slice(0, 300)}`));
              return;
            }
            try {
              finish(null, JSON.parse(buf));
            } catch (e) {
              finish(new Error('HUNYUAN_BAD_JSON: ' + buf.slice(0, 300)));
            }
          });
        }
      );
    } catch (e) {
      finish(e);
      return;
    }
    timer = setTimeout(() => {
      req.destroy();
      finish(new Error('HUNYUAN_TIMEOUT'));
    }, TOTAL_TIMEOUT);
    req.on('error', (e) => finish(e));
    req.on('timeout', () => {
      req.destroy();
      finish(new Error('HUNYUAN_TIMEOUT'));
    });
    req.write(data);
    req.end();
  });
}

const GENDER_TEXT = { male: '男', female: '女', other: '不限' };
const SCENES = ['日常', '通勤', '运动', '正式', '居家', '旅行'];

/** v1.13.0：场景着装要求（提示词内明确点明场景，避免模型泛泛而谈） */
const SCENE_GUIDE = {
  日常: '舒适百搭、松弛自然，适合日常出行与朋友见面',
  通勤: '利落专业、色彩克制，兼顾通勤走动与办公场合',
  运动: '透气速干、便于活动，鞋履以运动性能优先',
  正式: '挺括得体、细节干净，符合商务或典礼场合礼仪',
  居家: '柔软宽松、亲肤透气，活动自在',
  旅行: '轻便易打理、层次可增减，鞋子好走耐穿'
};

/** 年龄段描述（与空衣橱引导、当季推荐口径一致） */
function ageGroupText(age) {
  if (age < 18) return '青少年';
  if (age <= 30) return '青年';
  if (age <= 50) return '中年';
  return '熟龄';
}

function weatherText(w) {
  if (!w) return '天气未知';
  const parts = [];
  if (typeof w.low === 'number' && typeof w.high === 'number') parts.push(`${w.low}~${w.high}℃`);
  if (w.cond) parts.push(w.cond);
  return parts.join(' ') || '天气未知';
}

/** 压缩衣物清单：每行「id|名称|类型|内外穿|颜色|材质|适用场合」，控制 token */
function buildPrompt({ gender, age, weather, scene, items, excludeIds, level }) {
  const list = items
    .map(
      (it) =>
        `${it.id}|${it.name || '未命名'}|${it.type || ''}|${it.layer || ''}|${it.color || ''}|${it.material || ''}|${(it.occasions || []).join('/')}`
    )
    .join('\n');
  const sceneText =
    !scene || scene === 'all'
      ? `场景不限，请从「${SCENES.join('、')}」中选择最适合当前衣物与天气的一个，并说明选择理由`
      : SCENES.includes(scene)
        ? `场景：${scene}（要求：${SCENE_GUIDE[scene]}）`
        : `场景：${scene}（用户自定义场景，请按该场景的着装礼仪与氛围搭配，并说明场景适配逻辑）`;
  const exclude = excludeIds && excludeIds.length ? `不要与上次完全相同（上次 id：${excludeIds.join(',')}）。` : '';
  // v1.9.0（F-19）：会员推荐档位——full = 综合全衣橱（更多件数 + 按全衣橱互补给建议）
  // v1.10.0：advice 文案按档位差异化——plus 更详细；full 最详细且结合衣橱整体与主人信息
  const levelText =
    level === 'full'
      ? '请综合主人的全部衣物做整体搭配（最多 5 件，可含配饰），建议结合衣橱整体结构给出互补性提示（如缺件可备注）。advice 为 100~150 字的深度搭配建议：结合主人性别年龄与明日天气，说明整套穿搭思路、单品之间的颜色/材质/版型配合关系、适用场合与可替换项。'
      : '选 1–4 件组成一套协调穿搭，尽量覆盖上装+下装+鞋履。advice 为 60~80 字的详细搭配建议：说明天气适配逻辑、颜色与材质搭配理由、穿着注意事项。';
  const adviceRule =
    level === 'full'
      ? '{"itemIds":["id"],"scene":"场景","advice":"100~150字深度搭配建议"}'
      : '{"itemIds":["id"],"scene":"场景","advice":"60~80字详细搭配建议"}';
  // v1.13.0：强化角色设定与场景/人物约束——以时尚穿搭达人口吻给建议，明确结合性别、年龄与场景
  return `你是一位资深时尚穿搭达人、私人造型师，擅长根据人物特征、天气与场合做整体造型。
搭配对象：${GENDER_TEXT[gender] || '不限'}性，${age}岁（${ageGroupText(age)}）。天气：${weatherText(weather)}。
${sceneText}。
搭配原则：① 配色不超过三种，明确主色与点缀色；② 尽量覆盖上装+下装+鞋履，按天气增减外套或配饰；③ 说明版型与层次的配合逻辑；④ 以时尚达人的口吻给出可执行的建议，避免品牌广告。
${levelText}只能使用清单内 id。${exclude}只输出JSON：${adviceRule}。衣物清单：\n${list}`;
}

/**
 * 生成明日穿搭推荐
 * @returns {Promise<{itemIds:string[], scene:string, advice:string}>}
 */
async function callHunyuanOutfit(params) {
  const apiKey = process.env.HUNYUAN_API_KEY || loadLocalKey();
  if (!apiKey) {
    throw new Error('MISSING_SECRET: 未配置 HUNYUAN_API_KEY（环境变量或 private.config.json）');
  }
  const startedAt = Date.now();
  const res = await httpsPostJson('/v1/chat/completions', apiKey, {
    model: 'hy4-flash',
    messages: [{ role: 'user', content: buildPrompt(params) }],
    temperature: 0.7
    // 不设 max_tokens：限制过小会导致输出被截断或写入 reasoning 字段
  });
  const message =
    res && res.choices && res.choices[0] && res.choices[0].message ? res.choices[0].message : null;
  const text = String((message && message.content) || (message && message.reasoning_content) || '');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    const raw = text ? text.slice(0, 200) : JSON.stringify(res).slice(0, 300);
    throw new Error('BAD_MODEL_OUTPUT: ' + raw);
  }
  const parsed = JSON.parse(m[0]);
  console.log(`[outfitRecommend] 混元生成成功，耗时 ${Date.now() - startedAt}ms`);
  return {
    itemIds: Array.isArray(parsed.itemIds) ? parsed.itemIds.filter((id) => typeof id === 'string') : [],
    scene: typeof parsed.scene === 'string' ? parsed.scene.trim() : '',
    advice: typeof parsed.advice === 'string' ? parsed.advice.replace(/\s+/g, ' ').trim() : ''
  };
}

module.exports = { callHunyuanOutfit, buildPrompt };
