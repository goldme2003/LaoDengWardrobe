/** 腾讯混元文本模型调用封装（PRD 9.1.2 空衣橱引导）
 * 密钥从云函数环境变量 HUNYUAN_API_KEY 读取，本地联调可放 cloudfunctions/emptyGuide/private.config.json（已 gitignore）。
 * 端点与 recognizeClothing 一致（文本任务使用模型 hy3），复用同一套密钥配置（专项计划 D-4）。 */
const https = require('https');
const path = require('path');

const HOST = 'tokenhub.tencentmaas.com';
/** 单次请求硬超时：socket 空闲超时 + 总耗时上限（避免上游慢速回包拖到平台 60s 强杀，表现为 ret=-3） */
const TOTAL_TIMEOUT = 25000;
/** 连接复用：容器热启动期间复用 TLS 连接，减少重复建连开销 */
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
    /** 唯一出口：成功/失败/超时都走这里，保证 Promise 必定落定、定时器被清理 */
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
          // 响应流异常必须捕获：无监听时 'error' 会抛未捕获异常，云函数直接崩溃（ret=-3）
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
    // Node 的 timeout 只约束 socket 空闲；上游若持续缓慢回包，总耗时仍可能超过平台超时
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

/** 年龄段风格侧重（单次输出，压缩提示词用） */
function ageStyle(age) {
  return age < 18 ? '校园' : age <= 30 ? '通勤/休闲' : age <= 50 ? '通勤/质感' : '舒适/保暖';
}

/** 天气描述（v1.4.0 C 模块）：有温度用「x~y℃」+ 现象，仅有现象只给现象 */
function weatherText(w) {
  if (!w) return '';
  const parts = [];
  if (typeof w.low === 'number' && typeof w.high === 'number') parts.push(`${w.low}~${w.high}℃`);
  if (w.cond) parts.push(w.cond);
  return parts.join(' ');
}

/** 精简提示词：单条消息承载全部上下文与输出约束，尽量降低 token 消耗 */
function buildPrompt(gender, age, weather) {
  const wt = weatherText(weather);
  return `穿搭顾问。${GENDER_TEXT[gender] || '不限'}，${age}岁，衣橱为空。${wt ? `天气${wt}。` : ''}给1条≤150字的入门单品建议，侧重${ageStyle(age)}。只输出JSON：{"tips":["建议"]}`;
}

/**
 * 生成空衣橱引导文案
 * @returns {Promise<string[]>} 1 条建议（解析失败抛错，由调用方降级）
 */
async function callHunyuanGuide(gender, age, weather) {
  const apiKey = process.env.HUNYUAN_API_KEY || loadLocalKey();
  if (!apiKey) {
    throw new Error('MISSING_SECRET: 未配置 HUNYUAN_API_KEY（环境变量或 private.config.json）');
  }
  const startedAt = Date.now();
  const res = await httpsPostJson('/v1/chat/completions', apiKey, {
    model: process.env.HUNYUAN_MODEL || 'hy3',
    messages: [{ role: 'user', content: buildPrompt(gender, age, weather) }],
    temperature: 0.7
    // 不设 max_tokens：与 recognizeClothing 保持一致；实测限制 200 时模型可能
    // 将输出写入 reasoning 字段或被截断，导致 content 为空（BAD_MODEL_OUTPUT）
  });
  const message =
    res && res.choices && res.choices[0] && res.choices[0].message ? res.choices[0].message : null;
  // content 为空时兜底取 reasoning_content（部分模型档位会把结果写进思考字段）
  const text = String((message && message.content) || (message && message.reasoning_content) || '');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    // 带上原始响应片段，便于云端日志定位（此前仅输出空串无法诊断）
    const raw = text ? text.slice(0, 200) : JSON.stringify(res).slice(0, 300);
    throw new Error('BAD_MODEL_OUTPUT: ' + raw);
  }
  const parsed = JSON.parse(m[0]);
  const tips = Array.isArray(parsed.tips) ? parsed.tips.filter((t) => typeof t === 'string' && t.trim()) : [];
  if (!tips.length) throw new Error('EMPTY_TIPS');
  console.log(`[emptyGuide] 混元生成成功，耗时 ${Date.now() - startedAt}ms`);
  return tips.slice(0, 1).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 50));
}

module.exports = { callHunyuanGuide };
