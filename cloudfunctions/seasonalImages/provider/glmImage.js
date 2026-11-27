/** 智谱 GLM-IMAGE 生图调用封装（GLM 分支：替换腾讯混元 Hy-Image-3.5-Preview）
 * 密钥：云函数环境变量 GLM_API_KEY（本地联调可放 cloudfunctions/seasonalImages/private.config.json 的
 * GLM_API_KEY 字段，已 gitignore）。
 * 接口（对齐智谱开放平台官方示例）：
 *   POST https://open.bigmodel.cn/api/paas/v4/images/generations
 *   Authorization: Bearer <token>
 *   { "model": "glm-image", "prompt": "...", "size": "1280x1280" }
 * 响应（同步 JSON）：{ created, data: [{ url }] }；兜底兼容 b64_json 载荷（转 data URI）。
 * 生成的图片由调用方下载并转存云开发存储，避免临时 URL 过期与小程序图片域名白名单限制。 */
const https = require('https');
const path = require('path');

const HOST = 'open.bigmodel.cn';
const IMAGE_PATH = '/api/paas/v4/images/generations';
const MODEL = 'glm-image';
/** GLM-IMAGE 支持的输出尺寸；当季卡为竖版展示，官方示例 1280x1280 兜底可用 */
const IMAGE_SIZE = '1280x1280';
/** 单张生图硬超时
 * v2.2.2：35s → 40s。v2.2.1 实测 GLM-IMAGE 同步生图常超 35s 未返回，被本地超时提前掐断。
 * v2.2.3：40s → 50s，与云函数实际超时（`cli cloud functions info` 查得 timeout=50，config.json
 * 的 60s 不随 CLI 部署生效）一致——生图最长可用满函数时长，即便超时也由本地定时器先返回
 * `GLM_IMAGE_TIMEOUT`，而不是被平台直接终止（平台终止时函数日志无业务错误信息）。
 * 注意：生图耗满 50s 时下载/转存会被平台裁掉，此时该次生成已计费但图片丢失。 */
const GEN_TIMEOUT = 50000;
const DOWNLOAD_TIMEOUT = 20000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function loadLocalKey() {
  try {
    // eslint-disable-next-line global-require
    const conf = require(path.join(__dirname, '..', 'private.config.json'));
    return conf.GLM_API_KEY || '';
  } catch (e) {
    return '';
  }
}

function resolveKey() {
  return process.env.GLM_API_KEY || loadLocalKey();
}

function requestRaw(apiKey, body, timeout) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    let settled = false;
    let timer = null;
    let gotHeaders = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const onTimeout = () => {
      req.destroy();
      console.warn(`[seasonalImages] GLM 生图超时：${timeout}ms 内未返回，已收到响应头=${gotHeaders}`);
      finish(new Error('GLM_IMAGE_TIMEOUT'));
    };
    let req;
    try {
      req = https.request(
        {
          hostname: HOST,
          path: IMAGE_PATH,
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
          gotHeaders = true;
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('error', (e) => finish(new Error('GLM_IMAGE_RESP_ERROR: ' + e.message)));
          res.on('aborted', () => finish(new Error('GLM_IMAGE_ABORTED')));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              finish(new Error(`GLM_IMAGE_HTTP_${res.statusCode}: ${buf.slice(0, 300)}`));
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
    timer = setTimeout(onTimeout, timeout);
    req.on('error', (e) => finish(e));
    req.on('timeout', onTimeout);
    req.write(data);
    req.end();
  });
}

/** 从响应 JSON 中递归查找图片载荷
 * 官方结构：data[0].url；兜底兼容 b64_json（转 data URI），避免上游返回 base64 时解析失败。 */
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
    if (typeof node.url === 'string' && node.url) return node.url;
    if (typeof node.image_url === 'string' && node.image_url) return node.image_url;
    if (node.image_url && typeof node.image_url.url === 'string') return node.image_url.url;
    if (typeof node.b64_json === 'string' && node.b64_json) return `data:image/png;base64,${node.b64_json}`;
    for (const key of Object.keys(node)) {
      const hit = findImageUrl(node[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** 归一化生成结果地址：http 统一升级 https；data URI 原样透传；其余视为无效 */
function normalizeImageUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed)) return 'https://' + trimmed.slice(7);
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  return null;
}

/** 解析一次性 JSON 响应（GLM-IMAGE 为同步接口，无 SSE） */
function parseImageResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return findImageUrl(JSON.parse(text));
  } catch (e) {
    return null;
  }
}

/** 文生图：返回图片 URL（请求结构对齐智谱开放平台官方示例：model + prompt + size） */
async function callGlmImage(prompt) {
  const apiKey = resolveKey();
  if (!apiKey) {
    throw new Error('MISSING_SECRET: 未配置 GLM_API_KEY（云函数环境变量或 private.config.json）');
  }
  const startedAt = Date.now();
  const body = { model: MODEL, prompt, size: IMAGE_SIZE };
  const raw = await requestRaw(apiKey, body, GEN_TIMEOUT);
  const found = parseImageResponse(raw);
  const url = normalizeImageUrl(found);
  if (!url) {
    throw new Error('BAD_IMAGE_URL: ' + String(found || raw).slice(0, 120));
  }
  console.log(`[seasonalImages] ${MODEL} 生图成功，耗时 ${Date.now() - startedAt}ms`);
  return url;
}

/** 下载图片为 Buffer（最多跟随 3 次重定向，限制体积；支持 data URI 直接解码） */
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

module.exports = { callGlmImage, downloadImage, findImageUrl, normalizeImageUrl, parseImageResponse, MODEL };
