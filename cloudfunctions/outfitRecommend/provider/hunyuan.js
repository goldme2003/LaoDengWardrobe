/** 腾讯混元文本模型调用封装（v1.5.0 明日穿搭推荐）
 * 密钥从云函数环境变量 HUNYUAN_API_KEY 读取，本地联调可放 cloudfunctions/outfitRecommend/private.config.json（已 gitignore）。
 * 端点与 emptyGuide / recognizeClothing 一致（文本任务使用模型 hy4），复用同一套密钥配置。 */
const https = require('https');
const path = require('path');

const HOST = 'tokenhub.tencentmaas.com';
/** 单次请求硬超时：socket 空闲超时 + 总耗时上限（避免上游慢回包拖到平台 60s 强杀） */
const TOTAL_TIMEOUT = 25000;
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

function weatherText(w) {
  if (!w) return '天气未知';
  const parts = [];
  if (typeof w.low === 'number' && typeof w.high === 'number') parts.push(`${w.low}~${w.high}℃`);
  if (w.cond) parts.push(w.cond);
  return parts.join(' ') || '天气未知';
}

/** 压缩衣物清单：每行「id|名称|类型|内外穿|颜色|材质|适用场合」，控制 token */
function buildPrompt({ gender, age, weather, scene, items, excludeIds }) {
  const list = items
    .map(
      (it) =>
        `${it.id}|${it.name || '未命名'}|${it.type || ''}|${it.layer || ''}|${it.color || ''}|${it.material || ''}|${(it.occasions || []).join('/')}`
    )
    .join('\n');
  const sceneText =
    !scene || scene === 'all'
      ? `场景不限，请从「${SCENES.join('、')}」中选择最适合当前衣物与天气的一个`
      : `场景：${scene}`;
  const exclude = excludeIds && excludeIds.length ? `不要与上次完全相同（上次 id：${excludeIds.join(',')}）。` : '';
  return `你是穿搭顾问。主人${GENDER_TEXT[gender] || '不限'}，${age}岁。天气：${weatherText(weather)}。${sceneText}。从衣物清单中选 1–4 件组成一套协调穿搭，尽量覆盖上装+下装+鞋履，只能使用清单内 id。${exclude}只输出JSON：{"itemIds":["id"],"scene":"场景","advice":"不超过30字的搭配建议"}。衣物清单：\n${list}`;
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
    model: 'hy4',
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
