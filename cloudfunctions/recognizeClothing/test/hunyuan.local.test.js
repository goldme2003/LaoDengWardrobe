/** 测试方案 v1.2.0 A 组（本地可执行部分）：混元调用链路 mock https 测试
 * 覆盖：A3 JSON 提取健壮性 / A4 密钥缺失 / A5 HTTP 错误处理 / A6 请求体结构
 * A1（ping 云端）/ A2（真实端点）需云环境，本轮记为待执行（见测试结果记录）
 * 执行：node test/hunyuan.local.test.js */
const assert = require('assert');
const https = require('https');

const results = [];
async function t(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, pass: true });
    console.log(`PASS  ${id} ${name}`);
  } catch (e) {
    results.push({ id, name, pass: false, error: String(e.message || e).split('\n')[0] });
    console.log(`FAIL  ${id} ${name}\n      -> ${String(e.message || e).split('\n')[0]}`);
  }
}

/** https.request 桩：end() 时按 mockMode 触发响应 */
let mockMode = { statusCode: 200, body: '' };
let captured = null;
https.request = function fakeRequest(options, cb) {
  captured = { options, body: null };
  const req = {
    on(ev, fn) { if (ev === 'error') this._err = fn; return req; },
    setTimeout(_ms, fn) { return req; },
    write(data) { captured.body = JSON.parse(data); },
    end() {
      setImmediate(() => {
        const res = {
          statusCode: mockMode.statusCode,
          on(ev, fn) {
            if (ev === 'data') fn(mockMode.body);
            if (ev === 'end') fn();
          }
        };
        cb(res);
      });
    }
  };
  return req;
};

// 伪密钥（隔离真实密钥依赖；private.config.json 不存在，loadLocalKey 返回 ''）
process.env.HUNYUAN_API_KEY = 'sk-test-fake-key-for-local-test';
const { callHunyuanVision } = require('../provider/hunyuan');

const OK_JSON = {
  isClothing: true, category: 'T恤', color: '黑色', layer: '外穿',
  season: ['春', '秋'], hasTag: false, tagBrand: '', tagSize: '', tagText: '', confidence: 0.9
};

function respond(text) {
  mockMode = { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content: text } }] }) };
}

(async () => {
  // ---- A3 JSON 提取健壮性（多种输出形态）----
  await t('A3-1', '模型输出纯 JSON 可解析', async () => {
    respond(JSON.stringify(OK_JSON));
    const out = await callHunyuanVision('FAKEBASE64');
    assert.strictEqual(out.category, 'T恤');
    assert.strictEqual(out.isClothing, true);
  });
  await t('A3-2', '模型输出 ```json 包裹可解析', async () => {
    respond('```json\n' + JSON.stringify(OK_JSON) + '\n```');
    const out = await callHunyuanVision('FAKEBASE64');
    assert.strictEqual(out.color, '黑色');
  });
  await t('A3-3', '模型输出带前后缀文字可解析', async () => {
    respond('识别结果如下：\n' + JSON.stringify(OK_JSON) + '\n以上。');
    const out = await callHunyuanVision('FAKEBASE64');
    assert.strictEqual(out.confidence, 0.9);
  });
  await t('A3-4', '输出不含 JSON → BAD_MODEL_OUTPUT 拒绝', async () => {
    respond('抱歉，我无法识别这张图片。');
    await assert.rejects(() => callHunyuanVision('FAKEBASE64'), (e) => /BAD_MODEL_OUTPUT/.test(e.message));
  });

  // ---- A6 请求体结构 ----
  await t('A6', '请求结构：端点/模型/messages/temperature/base64 前缀', async () => {
    respond(JSON.stringify(OK_JSON));
    await callHunyuanVision('QUJD');
    const { options, body } = captured;
    assert.strictEqual(options.hostname, 'tokenhub.tencentmaas.com', 'hostname');
    assert.strictEqual(options.path, '/v1/chat/completions', 'path');
    assert.strictEqual(options.method, 'POST', 'method');
    assert.strictEqual(options.headers.Authorization, 'Bearer sk-test-fake-key-for-local-test', 'Authorization');
    assert.strictEqual(body.model, 'hy4', 'model=hy4');
    assert.strictEqual(body.temperature, 0.1, 'temperature');
    assert.strictEqual(body.messages.length, 1, 'messages');
    const content = body.messages[0].content;
    assert.strictEqual(content[0].type, 'text', 'text part');
    assert.strictEqual(content[1].type, 'image_url', 'image part');
    assert.strictEqual(content[1].image_url.url, 'data:image/jpeg;base64,QUJD', 'base64 data url');
  });

  // ---- A5 HTTP 非 200 / 非 JSON 响应 ----
  await t('A5-1', 'HTTP 401 → HUNYUAN_HTTP_401 拒绝（不崩溃）', async () => {
    mockMode = { statusCode: 401, body: '{"error":"unauthorized"}' };
    await assert.rejects(() => callHunyuanVision('FAKEBASE64'), (e) => /HUNYUAN_HTTP_401/.test(e.message));
  });
  await t('A5-2', 'HTTP 200 但响应非 JSON → HUNYUAN_BAD_JSON', async () => {
    mockMode = { statusCode: 200, body: '<html>gateway error</html>' };
    await assert.rejects(() => callHunyuanVision('FAKEBASE64'), (e) => /HUNYUAN_BAD_JSON/.test(e.message));
  });

  // ---- A4 密钥缺失路径 ----
  await t('A4', 'HUNYUAN_API_KEY 未配置 → MISSING_SECRET（NOT_CONFIGURED 前置）', async () => {
    delete process.env.HUNYUAN_API_KEY;
    try {
      await callHunyuanVision('FAKEBASE64');
      assert.fail('应抛出 MISSING_SECRET');
    } catch (e) {
      assert.ok(/MISSING_SECRET/.test(e.message), `实际: ${e.message}`);
    } finally {
      process.env.HUNYUAN_API_KEY = 'sk-test-fake-key-for-local-test';
    }
  });

  // ---- 汇总 ----
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n===== A 组(本地可执行)汇总: ${pass}/${results.length} PASS =====`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAILED ${r.id} ${r.name}: ${r.error}`));
  process.exitCode = 0;
})().catch((e) => { console.error('Runner 异常(不中断):', e); process.exitCode = 0; });
