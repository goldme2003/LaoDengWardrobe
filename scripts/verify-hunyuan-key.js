/** 混元 API 密钥可用性与有效性校验（无需第三方依赖）
 *
 * 密钥来源（优先级）：
 *   1) 环境变量 HUNYUAN_API_KEY
 *   2) cloudfunctions/recognizeClothing/private.config.json 的 HUNYUAN_API_KEY（已 gitignore）
 * 说明：密钥仅在本机内存中参与请求，输出中一律掩码，不打印完整密钥。
 *
 * 执行：
 *   node scripts/verify-hunyuan-key.js              # 有密钥则做全部检查
 *   node scripts/verify-hunyuan-key.js --no-vision  # 跳过视觉调用（省费用）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');

const HOST = process.env.HUNYUAN_HOST || 'tokenhub.tencentmaas.com';
const MODEL = process.env.HUNYUAN_MODEL || 'hy4';
const KEY_FILE = path.join(__dirname, '..', 'cloudfunctions', 'recognizeClothing', 'private.config.json');
const SKIP_VISION = process.argv.includes('--no-vision');

const out = { checkedAt: new Date().toISOString(), host: HOST, model: MODEL, checks: {} };

function loadKey() {
  const envKey = (process.env.HUNYUAN_API_KEY || '').trim();
  if (envKey) return { key: envKey, source: '环境变量 HUNYUAN_API_KEY' };
  try {
    const conf = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    const k = String(conf.HUNYUAN_API_KEY || '').trim();
    if (k) return { key: k, source: 'private.config.json' };
  } catch (e) {
    /* 文件不存在或 JSON 非法 */
  }
  return { key: '', source: '未找到' };
}

function mask(key) {
  if (!key) return '(空)';
  if (key.length <= 10) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 5)}****${key.slice(-4)} (长度 ${key.length})`;
}

function request({ method = 'POST', path: p, key, body, timeout = 20000 }) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const started = Date.now();
    const req = https.request(
      {
        hostname: HOST,
        port: 443,
        path: p,
        method,
        headers: Object.assign(
          { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          key ? { Authorization: `Bearer ${key}` } : {}
        )
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
            ms: Date.now() - started
          });
        });
      }
    );
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - started }));
    req.setTimeout(timeout, () => { req.destroy(new Error('TIMEOUT')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function tcpConnect(host, port, timeout = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    const done = (r) => { socket.destroy(); resolve(Object.assign({ ms: Date.now() - started }, r)); };
    socket.setTimeout(timeout, () => done({ ok: false, error: 'TIMEOUT' }));
    socket.on('connect', () => done({ ok: true }));
    socket.on('error', (e) => done({ ok: false, error: e.message }));
  });
}

function tlsHandshake(host, timeout = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate() || {};
      const r = {
        ok: true,
        ms: Date.now() - started,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher() && socket.getCipher().name,
        validTo: cert.valid_to,
        issuer: cert.issuer && cert.issuer.O,
        subject: cert.subject && cert.subject.CN
      };
      socket.destroy();
      resolve(r);
    });
    socket.setTimeout(timeout, () => { socket.destroy(); resolve({ ok: false, error: 'TIMEOUT' }); });
    socket.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

/** 1×1 白色 PNG（验证视觉/多模态能力，成本最低） */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function summarizeRateLimit(headers) {
  const hits = {};
  Object.keys(headers || {}).forEach((k) => {
    if (/rate|quota|limit|remaining|retry|reset/i.test(k)) hits[k] = headers[k];
  });
  return hits;
}

(async () => {
  const { key, source } = loadKey();
  out.keySource = source;
  out.keyMasked = mask(key);

  // ---------- 1. 密钥格式 ----------
  const fmt = { present: !!key, source, masked: mask(key), valid: false, issues: [] };
  if (!key) {
    fmt.issues.push('未找到密钥（环境变量 HUNYUAN_API_KEY 或 private.config.json 均无）');
  } else {
    if (!/^sk-/.test(key)) fmt.issues.push('未以 sk- 开头（混元 OpenAI 兼容密钥通常为 sk- 前缀）');
    if (/[\s"'`]/.test(key)) fmt.issues.push('包含空白/引号等非法字符（可能复制时带入）');
    if (!/^[A-Za-z0-9._-]+$/.test(key)) fmt.issues.push('包含非预期字符');
    if (key.length < 20) fmt.issues.push(`长度 ${key.length} 偏短，疑似不完整`);
    if (key.length > 200) fmt.issues.push(`长度 ${key.length} 偏长，疑似拼接了多余内容`);
    fmt.length = key.length;
    fmt.valid = fmt.issues.length === 0;
  }
  out.checks.format = fmt;

  // ---------- 2. 服务端可达性（无需密钥）----------
  const reach = {};
  try {
    const addrs = await dns.lookup(HOST, { all: true });
    reach.dns = { ok: true, addresses: addrs.map((a) => `${a.address}/${a.family === 6 ? 'IPv6' : 'IPv4'}`) };
  } catch (e) {
    reach.dns = { ok: false, error: e.message };
  }
  reach.tcp443 = await tcpConnect(HOST, 443);
  reach.tls = await tlsHandshake(HOST);
  const unauth = await request({ method: 'GET', path: '/v1/models' });
  reach.unauthGet = {
    status: unauth.status,
    ms: unauth.ms,
    error: unauth.error,
    bodyPreview: (unauth.body || '').slice(0, 200)
  };
  reach.endpointAlive = !unauth.error && typeof unauth.status === 'number';
  reach.authEnforced = [400, 401, 403].includes(unauth.status);
  out.checks.reachability = reach;

  if (!key) {
    out.summary = '未找到密钥，仅完成端点可达性检查；请提供密钥后重跑以完成认证/权限/视觉能力检查';
    print(out);
    return;
  }

  // ---------- 3. 基础调用（认证 + 模型权限）----------
  const basic = await request({
    path: '/v1/chat/completions',
    key,
    body: {
      model: MODEL,
      messages: [{ role: 'user', content: '只回复两个字：正常' }],
      max_tokens: 8,
      temperature: 0
    }
  });
  const basicJson = parseJson(basic.body);
  const basicOk = basic.status === 200 && basicJson && Array.isArray(basicJson.choices);
  out.checks.basicCall = {
    status: basic.status,
    ms: basic.ms,
    ok: !!basicOk,
    model: basicJson && basicJson.model,
    reply: basicOk ? basicJson.choices[0].message.content : undefined,
    usage: basicJson && basicJson.usage,
    error: basic.error || (basicJson && basicJson.error) || (basicOk ? undefined : (basic.body || '').slice(0, 300)),
    rateLimitHeaders: summarizeRateLimit(basic.headers),
    serverHeaders: {
      'x-request-id': basic.headers && basic.headers['x-request-id'],
      'x-tc-trace-id': basic.headers && basic.headers['x-tc-trace-id']
    }
  };

  // ---------- 4. 权限范围（模型列表）----------
  const models = await request({ method: 'GET', path: '/v1/models', key });
  const modelsJson = parseJson(models.body);
  const ids = modelsJson && Array.isArray(modelsJson.data) ? modelsJson.data.map((m) => m.id) : null;
  out.checks.scope = {
    status: models.status,
    ms: models.ms,
    modelCount: ids ? ids.length : 0,
    hasTargetModel: ids ? ids.includes(MODEL) : null,
    sample: ids ? ids.slice(0, 15) : undefined,
    error: models.error || (modelsJson && modelsJson.error) || (ids ? undefined : (models.body || '').slice(0, 200))
  };

  // ---------- 5. 视觉/多模态能力（识别功能真正依赖）----------
  if (SKIP_VISION) {
    out.checks.vision = { skipped: true };
  } else {
    const vision = await request({
      path: '/v1/chat/completions',
      key,
      body: {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '只回复两个字：可见' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` } }
            ]
          }
        ],
        max_tokens: 8,
        temperature: 0
      }
    });
    const vJson = parseJson(vision.body);
    const vOk = vision.status === 200 && vJson && Array.isArray(vJson.choices);
    out.checks.vision = {
      status: vision.status,
      ms: vision.ms,
      ok: !!vOk,
      reply: vOk ? vJson.choices[0].message.content : undefined,
      usage: vJson && vJson.usage,
      error: vision.error || (vJson && vJson.error) || (vOk ? undefined : (vision.body || '').slice(0, 300))
    };
  }

  // ---------- 6. 限制与过期说明 ----------
  out.checks.limits = {
    rateLimitHeaders: out.checks.basicCall.rateLimitHeaders,
    note: '混元/腾讯云 MaaS 密钥为不透明字符串，无法从密钥本身解析过期时间；有效期、QPS/并发与额度需在腾讯云控制台（TokenHub/MaaS 密钥管理）查看。'
  };

  const allOk =
    fmt.valid &&
    basicOk &&
    (!out.checks.vision || out.checks.vision.skipped || out.checks.vision.ok);
  out.summary = allOk ? '密钥可用：格式合规、认证通过、目标模型可调用、视觉能力正常' : '存在未通过项，请见 checks 明细';
  print(out);
})().catch((e) => {
  console.error('校验脚本异常：', e);
  process.exitCode = 1;
});

function print(o) {
  console.log(JSON.stringify(o, null, 2));
}
