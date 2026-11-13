/** 腾讯混元视觉大模型调用封装（PRD 9.3 阶段1）
 * 密钥从云函数环境变量 HUNYUAN_API_KEY 读取（兼容 sk- 开头的 OpenAI 兼容密钥），
 * 本地联调可放同目录 private.config.json（已 gitignore，方案 R3：绝不打包进前端）
 * 走混元 OpenAI 兼容端点 api.hunyuan.cloud.tencent.com/v1/chat/completions（无需 CAM 签名）
 * Provider 层抽象：如需切换千问 VL 等供应商，仅替换本文件（方案 R6） */
const https = require('https');
const path = require('path');

/** 本地联调密钥兜底（环境变量优先；文件不入库） */
function loadLocalKey() {
  try {
    // eslint-disable-next-line global-require
    const conf = require(path.join(__dirname, '..', 'private.config.json'));
    return conf.HUNYUAN_API_KEY || '';
  } catch (e) {
    return '';
  }
}

/** 识别用结构化输出 Prompt（要求严格 JSON；吊牌文字由模型直接读取，
 * 在腾讯云 OCR 密钥（CAM SecretId/Key）就绪前作为降级链路，就绪后 index.js 优先走 OCR） */
const PROMPT = `你是衣物识别助手。分析图片并输出严格的 JSON（不要输出任何其他文字）：
{
  "isClothing": true/false,          // 图中主体是否为衣物（衣服/裤/裙/鞋/配饰等）
  "category": "上装|外套|裤装|裙装|连衣裙|内衣|家居服|鞋履|配饰|其他",  // 最接近的品类
  "color": "颜色名（中文，2-4字，如 黑色/藏青/米白）",
  "layer": "内穿|外穿",              // 内外穿建议
  "season": ["春","夏","秋","冬"],   // 适合季节（1-2项）
  "hasTag": true/false,              // 图中是否可见吊牌/水洗唛/成分标签
  "tagBrand": "吊牌上可见的品牌名，无则空字符串",
  "tagSize": "吊牌上可见的尺码，无则空字符串",
  "tagText": "吊牌/水洗唛上全部可见文字原样转录（面料成分、清洗说明等），无吊牌则空字符串",
  "confidence": 0.0~1.0              // 品类判断置信度
}`;

function httpsPostJson(urlPath, apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.hunyuan.cloud.tencent.com',
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

/**
 * 调用混元视觉模型识别图片
 * @param {string} imageBase64 图片 base64（不含 data: 前缀）
 * @returns {Promise<object>} 模型输出的结构化 JSON（解析失败抛错）
 */
async function callHunyuanVision(imageBase64) {
  const apiKey = process.env.HUNYUAN_API_KEY || loadLocalKey();
  if (!apiKey) {
    throw new Error('MISSING_SECRET: 未配置 HUNYUAN_API_KEY（环境变量或 private.config.json）');
  }
  const res = await httpsPostJson('/v1/chat/completions', apiKey, {
    model: process.env.HUNYUAN_MODEL || 'hunyuan-turbos-vision',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
        ]
      }
    ],
    temperature: 0.1
  });
  const text =
    res && res.choices && res.choices[0] && res.choices[0].message
      ? res.choices[0].message.content
      : '';
  // 提取 JSON（容忍模型输出包裹 ```json 等）
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('BAD_MODEL_OUTPUT: ' + String(text).slice(0, 200));
  return JSON.parse(m[0]);
}

module.exports = { callHunyuanVision };
