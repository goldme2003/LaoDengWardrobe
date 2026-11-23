/** 腾讯混元生图调用封装（v1.13.2 当季推荐图组）
 * 密钥复用云函数环境变量 HUNYUAN_API_KEY（与 emptyGuide / outfitRecommend 一致）；
 * 模型：Hy-Image-3.5-Preview（`hy-image-v3.5-preview`），Chat/Messages 协议，同步流式返回图片 URL。
 * 接口：POST https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v35-generation
 * v1.13.2：上游可能返回 http:// 图片地址（官方样例即 http 的 TOB COS 桶），
 * normalizeImageUrl 统一升级 https 后再下载，并兼容 data URI / b64_json 载荷。
 * 生成的图片由调用方下载并转存云开发存储，避免临时 URL 过期与小程序图片域名白名单限制。 */
const https = require('https');
const path = require('path');

const HOST = 'tokenhub.tencentmaas.com';
const IMAGE_PATH = '/v1/wand/hunyuan-image/v35-generation';
const MODEL = 'hy-image-v3.5-preview';
/** 输出竖版 1024×1536（宽高均 ∈ [256,8192]，面积 ≤ 16777216），适配当季卡 4:3 竖版展示 */
const IMAGE_SIZE = '1024x1536';
/** 单张生图硬超时（3.5 预览版较慢，云函数总超时 60s，并发 3 分两轮完成） */
const GEN_TIMEOUT = 35000;
const DOWNLOAD_TIMEOUT = 20000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

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

function resolveKey() {
  return process.env.HUNYUAN_API_KEY || loadLocalKey();
}

function requestRaw(urlPath, apiKey, body, timeout) {
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
          timeout
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('error', (e) => finish(new Error('HUNYUAN_IMAGE_RESP_ERROR: ' + e.message)));
          res.on('aborted', () => finish(new Error('HUNYUAN_IMAGE_ABORTED')));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              finish(new Error(`HUNYUAN_IMAGE_HTTP_${res.statusCode}: ${buf.slice(0, 300)}`));
              return;
            }
            finish(null, buf);
          });
        }
      );
    } catch (e) {
      finish(e);
      return;
    }
    timer = setTimeout(() => {
      req.destroy();
      finish(new Error('HUNYUAN_IMAGE_TIMEOUT'));
    }, timeout);
    req.on('error', (e) => finish(e));
    req.on('timeout', () => {
      req.destroy();
      finish(new Error('HUNYUAN_IMAGE_TIMEOUT'));
    });
    req.write(data);
    req.end();
  });
}

/** 从响应（普通 JSON 或 SSE chunk）中递归查找图片载荷
 * 文档结构：choices[0].delta = {"type":"image","image":{"url":"...", width, height,...}}
 * 兜底兼容 b64_json 载荷（转 data URI），避免上游返回 base64 时解析失败。 */
function findImageUrl(node, depth = 0) {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findImageUrl(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === 'object') {
    if (node.image && typeof node.image === 'object' && typeof node.image.url === 'string') return node.image.url;
    if (node.image_url && typeof node.image_url.url === 'string') return node.image_url.url;
    if (typeof node.b64_json === 'string' && node.b64_json) return `data:image/png;base64,${node.b64_json}`;
    for (const key of Object.keys(node)) {
      const hit = findImageUrl(node[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** v1.13.2：归一化生成结果地址。
 * 根因修复：v3.5-preview 上游返回的图片 URL 可能为 http://（官方文档样例即为
 * http://hunyuan-image-result-tob-*.cos.ap-guangzhou.myqcloud.com/...），
 * 此前 downloadImage 强制要求 https 导致 IMAGE_URL_NOT_HTTPS。
 * COS 同域名支持 HTTPS，统一升级为 https；data URI 原样透传；其余视为无效。 */
function normalizeImageUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed)) return 'https://' + trimmed.slice(7);
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  return null;
}

/** v3.5-preview 返回流式 chunk（`data: {...}` SSE），兼容一次性 JSON 响应 */
function parseImageResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const hit = findImageUrl(JSON.parse(text));
    if (hit) return hit;
  } catch (e) {
    // 非单段 JSON，按 SSE 逐行解析
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!payload || payload === '[DONE]') continue;
    try {
      const hit = findImageUrl(JSON.parse(payload));
      if (hit) return hit;
    } catch (e) {
      // 忽略不可解析的帧
    }
  }
  return null;
}

/** 文生图：返回图片 URL（请求结构对齐官方文档样例：
 * model + session + messages[]，messages[n] = { role:'user', content:[{ type:'text', text }] }） */
async function callHunyuanImage(prompt, session) {
  const apiKey = resolveKey();
  if (!apiKey) {
    throw new Error('MISSING_SECRET: 未配置 HUNYUAN_API_KEY（环境变量或 private.config.json）');
  }
  const startedAt = Date.now();
  const body = {
    model: MODEL,
    size: IMAGE_SIZE,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  };
  // 官方文档：session 用于一致性哈希调度（同 session 路由到同一推理实例，提高 KV-cache 命中）
  if (session) body.session = session;
  const raw = await requestRaw(IMAGE_PATH, apiKey, body, GEN_TIMEOUT);
  const found = parseImageResponse(raw);
  const url = normalizeImageUrl(found);
  if (!url) {
    throw new Error('BAD_IMAGE_URL: ' + String(found || raw).slice(0, 120));
  }
  console.log(`[seasonalImages] ${MODEL} 生图成功，耗时 ${Date.now() - startedAt}ms`);
  return url;
}

/** 下载图片为 Buffer（最多跟随 3 次重定向，限制体积；v1.13.2 支持 data URI 直接解码） */
function downloadImage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const dataMatch = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(String(url || ''));
    if (dataMatch) {
      finish(null, Buffer.from(dataMatch[1], 'base64'));
      return;
    }
    if (!/^https:\/\//i.test(url)) {
      // v1.13.2：带上地址前缀便于云端日志定位（正常流程已在 normalizeImageUrl 升级为 https）
      finish(new Error('IMAGE_URL_NOT_HTTPS: ' + String(url).slice(0, 80)));
      return;
    }
    const req = https.get(url, { timeout: DOWNLOAD_TIMEOUT }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects < 3) {
        res.resume();
        downloadImage(res.headers.location, redirects + 1).then((b) => finish(null, b), (e) => finish(e));
        return;
      }
      if (status !== 200) {
        res.resume();
        finish(new Error(`IMAGE_DOWNLOAD_HTTP_${status}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_IMAGE_BYTES) {
          req.destroy();
          finish(new Error('IMAGE_TOO_LARGE'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => finish(null, Buffer.concat(chunks)));
      res.on('error', (e) => finish(new Error('IMAGE_DOWNLOAD_ERROR: ' + e.message)));
    });
    req.on('timeout', () => {
      req.destroy();
      finish(new Error('IMAGE_DOWNLOAD_TIMEOUT'));
    });
    req.on('error', (e) => finish(e));
  });
}

module.exports = { callHunyuanImage, downloadImage, findImageUrl, normalizeImageUrl, parseImageResponse, MODEL };
