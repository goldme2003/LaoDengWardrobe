/** 腾讯混元文本模型调用封装（PRD 9.1.2 空衣橱引导）
 * 密钥从云函数环境变量 HUNYUAN_API_KEY 读取，本地联调可放 cloudfunctions/emptyGuide/private.config.json（已 gitignore）。
 * 端点与模型与 recognizeClothing 保持一致，复用同一套密钥配置（专项计划 D-4）。 */
const https = require('https');
const path = require('path');

const HOST = 'tokenhub.tencentmaas.com';

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
    const req = https.request(
      {
        hostname: HOST,
        path: urlPath,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 25000
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HUNYUAN_HTTP_${res.statusCode}: ${buf.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error('HUNYUAN_BAD_JSON: ' + buf.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('HUNYUAN_TIMEOUT')));
    req.write(data);
    req.end();
  });
}

const GENDER_TEXT = { male: '男性', female: '女性', other: '未指定' };

/** 天气描述（v1.4.0 C 模块）：有温度用「x~y℃」+ 现象，仅有现象只给现象 */
function weatherText(w) {
  if (!w) return '';
  const parts = [];
  if (typeof w.low === 'number' && typeof w.high === 'number') parts.push(`${w.low}~${w.high}℃`);
  if (w.cond) parts.push(w.cond);
  return parts.join(' ');
}

function buildPrompt(gender, age, wardrobeName, weather) {
  const wt = weatherText(weather);
  const weatherLine = wt ? `\n当前天气：${wt}，建议需适配该天气（温度档位决定厚薄与品类，雨天优先防水/带伞，低温侧重保暖）。`
    : '';
  return `你是一位专业穿搭顾问。用户性别：${GENDER_TEXT[gender] || '未指定'}，年龄：${age} 岁，衣橱「${wardrobeName}」目前为空。${weatherLine}
请给出 1 条简短、具体、可执行的开启衣橱建议（着装方向），不超过 50 字，并按年龄段调整品类侧重（18 岁以下偏校园，18-30 岁偏通勤/休闲，31-50 岁偏通勤/质感，50 岁以上偏舒适/保暖）。
只输出 JSON，不要输出其他文字，格式：{"tips":["建议内容"]}`;
}

/**
 * 生成空衣橱引导文案
 * @returns {Promise<string[]>} 1 条建议（解析失败抛错，由调用方降级）
 */
async function callHunyuanGuide(gender, age, wardrobeName, weather) {
  const apiKey = process.env.HUNYUAN_API_KEY || loadLocalKey();
  if (!apiKey) {
    throw new Error('MISSING_SECRET: 未配置 HUNYUAN_API_KEY（环境变量或 private.config.json）');
  }
  const startedAt = Date.now();
  const res = await httpsPostJson('/v1/chat/completions', apiKey, {
    model: process.env.HUNYUAN_MODEL || 'hy4',
    messages: [
      { role: 'system', content: '你只输出严格 JSON，不输出解释性文字。' },
      { role: 'user', content: buildPrompt(gender, age, wardrobeName, weather) }
    ],
    temperature: 0.7
    // 不设 max_tokens：与 recognizeClothing 保持一致；实测限制 200 时 hy4 可能
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
