/** 腾讯混元生图（极速版）调用封装（v1.13.0 当季推荐图组）
 * 密钥复用云函数环境变量 HUNYUAN_API_KEY（与 emptyGuide / outfitRecommend 一致）；
 * 接口：POST https://tokenhub.tencentmaas.com/v1/api/image/lite（OpenAI 兼容，同步返回图片 URL）。
 * 生成的图片由调用方下载并转存云开发存储，避免临时 URL 过期与小程序图片域名白名单限制。 */
const https = require('https');
const path = require('path');

const HOST = 'tokenhub.tencentmaas.com';
const IMAGE_PATH = '/v1/api/image/lite';
const MODEL = 'hy-image-lite';
/** 单张生图硬超时（生图比文本慢，留足 30s；云函数总超时 60s） */
const GEN_TIMEOUT = 25000;
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

function requestJson(urlPath, apiKey, body, timeout) {
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
            try {
              finish(null, JSON.parse(buf));
            } catch (e) {
              finish(new Error('HUNYUAN_IMAGE_BAD_JSON: ' + buf.slice(0, 300)));
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

/** 文生图：返回图片 URL */
async function callHunyuanImage(prompt) {
  const apiKey = resolveKey();
  if (!apiKey) {
    throw new Error('MISSING_SECRET: 未配置 HUNYUAN_API_KEY（环境变量或 private.config.json）');
  }
  const startedAt = Date.now();
  const res = await requestJson(
    IMAGE_PATH,
    apiKey,
    { model: MODEL, prompt, rsp_img_type: 'url' },
    GEN_TIMEOUT
  );
  const url = res && Array.isArray(res.data) && res.data[0] && res.data[0].url;
  if (!url || typeof url !== 'string') {
    throw new Error('BAD_IMAGE_OUTPUT: ' + JSON.stringify(res).slice(0, 300));
  }
  console.log(`[seasonalImages] 混元生图成功，耗时 ${Date.now() - startedAt}ms`);
  return url;
}

/** 下载图片为 Buffer（最多跟随 3 次重定向，限制体积） */
function downloadImage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    if (!/^https:\/\//i.test(url)) {
      finish(new Error('IMAGE_URL_NOT_HTTPS'));
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

module.exports = { callHunyuanImage, downloadImage, MODEL };
