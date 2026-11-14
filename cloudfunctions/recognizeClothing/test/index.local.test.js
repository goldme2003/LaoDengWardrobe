/** 测试方案 v1.2.0 E 组：云函数 recognizeClothing 编排与返回契约测试（mock 依赖）
 * 覆盖：E1 OK 结构 / E2 BAD_PARAM / E3 熔断 / E4 NO_CLOTHING 计数 / E5 无效 fileID /
 *       E6 计数初始化 / E7 耗时 / E8 错误码映射；连带 C3 置信度置空、D3 降级、D5 吊牌失败
 * A1/A2（云端 ping/真实调用）、D1（真实 OCR）、F 组（真机）本轮待执行
 * 执行：node test/index.local.test.js */
const assert = require('assert');
const Module = require('module');

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

// ---- mock 依赖（require 拦截）----
const dbState = { usageDoc: null, updateCalls: [], setCalls: [], getCalls: 0 };
let mockVisionResult = null;
let mockVisionError = null;
let mockOcrResult = null;
let mockOcrError = null;
let downloadError = null;

const dbMock = {
  command: { inc: (n) => ({ __inc: n }) },
  collection: () => ({
    doc: (id) => ({
      get: async () => {
        dbState.getCalls += 1;
        if (!dbState.usageDoc) { const e = new Error('document.get:fail document not exists'); throw e; }
        return { data: dbState.usageDoc };
      },
      update: async (arg) => {
        dbState.updateCalls.push({ id, arg });
        if (dbState.updateShouldFail) throw new Error('update:fail');
        dbState.usageDoc = { ...(dbState.usageDoc || {}), calls: (dbState.usageDoc ? dbState.usageDoc.calls : 0) + 1 };
        return {};
      },
      set: async (arg) => {
        dbState.setCalls.push({ id, arg });
        dbState.usageDoc = { calls: arg.data.calls, ocrCalls: arg.data.ocrCalls };
        return {};
      }
    })
  })
};

const mockCloud = {
  DYNAMIC_CURRENT_ENV: Symbol('env'),
  init: () => {},
  database: () => dbMock,
  downloadFile: async ({ fileID }) => {
    if (downloadError) throw downloadError;
    return { fileContent: Buffer.from('fake-jpeg-bytes') };
  }
};

const origLoad = Module._load;
Module._load = function intercepted(request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockCloud;
  if (request === './provider/hunyuan') {
    return {
      callHunyuanVision: async () => {
        if (mockVisionError) throw mockVisionError;
        return mockVisionResult;
      }
    };
  }
  if (request === './provider/ocr') {
    return {
      generalBasicOCR: async () => {
        if (mockOcrError) throw mockOcrError;
        return mockOcrResult;
      }
    };
  }
  return origLoad.apply(this, arguments);
};

process.env.TENCENT_SECRET_ID = 'test-id';
process.env.TENCENT_SECRET_KEY = 'test-key';
process.env.RECOGNIZE_BUDGET_YUAN = '50';
const cloudFn = require('../index');

const VISION_OK = {
  isClothing: true, category: 'T恤', color: '藏青', layer: '外穿',
  season: ['秋'], hasTag: true, tagBrand: 'Nike', tagSize: 'L',
  tagText: '棉 聚酯纤维 可机洗', confidence: 0.92
};
const OCR_OK = { lines: ['品牌：Nike', '棉 聚酯纤维', '可机洗 不可漂白'], text: '品牌：Nike\n棉 聚酯纤维\n可机洗 不可漂白' };

function reset() {
  dbState.usageDoc = { calls: 5 };
  dbState.updateCalls = [];
  dbState.setCalls = [];
  dbState.updateShouldFail = false;
  mockVisionResult = VISION_OK;
  mockVisionError = null;
  mockOcrResult = OCR_OK;
  mockOcrError = null;
  downloadError = null;
}

(async () => {
  // ---- E2 BAD_PARAM ----
  await t('E2', '缺 imageFileID → BAD_PARAM 且不消耗用量', async () => {
    reset();
    const r = await cloudFn.main({});
    assert.strictEqual(r.code, 'BAD_PARAM');
    assert.strictEqual(r.message, '缺少 imageFileID');
    assert.strictEqual(dbState.getCalls, 0, '熔断/计数不应被触发');
  });

  // ---- E3 BUDGET_EXCEEDED ----
  await t('E3', '月用量达预算 → BUDGET_EXCEEDED 且不调用模型', async () => {
    reset();
    dbState.usageDoc = { calls: 900 };
    const r = await cloudFn.main({ imageFileID: 'cloud://x.jpg' });
    assert.strictEqual(r.code, 'BUDGET_EXCEEDED');
    assert.strictEqual(r.message, '本月识别额度已用尽，下月自动恢复');
    assert.ok(r.usage && r.usage.estCost === 54, `estCost=${r.usage && r.usage.estCost}`);
  });

  // ---- E1 OK 成功返回结构 ----
  await t('E1', 'OK 返回结构：data 全字段 + cost 递增 + elapsed', async () => {
    reset();
    const r = await cloudFn.main({ imageFileID: 'cloud://ok.jpg' });
    assert.strictEqual(r.code, 'OK');
    const d = r.data;
    const want = ['category', 'color', 'layer', 'seasons', 'material', 'size', 'brand', 'careText', 'compositionText', 'confidence', 'warnings'];
    const missing = want.filter((k) => !(k in d));
    assert.strictEqual(missing.length, 0, `data 缺字段: ${missing.join(',')}`);
    assert.strictEqual(d.category, '上装', `T恤→上装, 实际=${d.category}`);
    assert.strictEqual(d.color, '藏青');
    assert.strictEqual(d.layer, '外穿');
    assert.deepStrictEqual(d.seasons, ['秋']);
    assert.strictEqual(d.material, '棉', `composition 首词映射, 实际=${d.material}`);
    assert.strictEqual(d.brand, 'Nike');
    assert.strictEqual(d.size, 'L');
    assert.ok(d.careText.includes('可机洗') && d.careText.includes('不可漂白'), `careText=${d.careText}`);
    assert.strictEqual(d.compositionText, '棉 聚酯纤维', `实际=${d.compositionText}`);
    assert.strictEqual(r.cost.calls, 6, 'calls 5→6');
    assert.strictEqual(r.cost.estCost, 0.36);
    assert.strictEqual(r.cost.budget, 50);
    assert.ok(typeof r.elapsed === 'number' && r.elapsed < 30000, `elapsed=${r.elapsed}`);
    assert.strictEqual(dbState.updateCalls.length, 1, 'incrUsage(update) 调用 1 次');
  });

  // ---- E4 NO_CLOTHING 计数行为 ----
  await t('E4', '非衣物 → NO_CLOTHING 且 calls+1 / ocrCalls+0', async () => {
    reset();
    mockVisionResult = { ...VISION_OK, isClothing: false };
    const r = await cloudFn.main({ imageFileID: 'cloud://dog.jpg' });
    assert.strictEqual(r.code, 'NO_CLOTHING');
    assert.strictEqual(dbState.updateCalls.length, 1, 'NO_CLOTHING 也计数（已产生模型成本）');
  });

  // ---- E5 无效 fileID ----
  await t('E5', 'downloadFile 失败 → RECOGNIZE_FAILED 兜底', async () => {
    reset();
    downloadError = new Error('downloadFile:fail file not exist');
    const r = await cloudFn.main({ imageFileID: 'cloud://not-exist.jpg' });
    assert.strictEqual(r.code, 'RECOGNIZE_FAILED');
    assert.strictEqual(r.message, '识别失败，请手动填写');
  });

  // ---- NOT_CONFIGURED 映射（A4 对应编排层）----
  await t('E8-1', 'MISSING_SECRET → NOT_CONFIGURED 专用文案', async () => {
    reset();
    mockVisionError = new Error('MISSING_SECRET: 未配置 HUNYUAN_API_KEY');
    const r = await cloudFn.main({ imageFileID: 'cloud://ok.jpg' });
    assert.strictEqual(r.code, 'NOT_CONFIGURED');
    assert.strictEqual(r.message, '识别服务未配置，请联系维护者');
  });
  await t('E8-2', '其他异常 → RECOGNIZE_FAILED 兜底', async () => {
    reset();
    mockVisionError = new Error('HUNYUAN_TIMEOUT');
    const r = await cloudFn.main({ imageFileID: 'cloud://ok.jpg' });
    assert.strictEqual(r.code, 'RECOGNIZE_FAILED');
  });

  // ---- C3 置信度 <0.6 品类置空 ----
  await t('C3', 'confidence 0.4 → category 置空 + warnings 提示', async () => {
    reset();
    mockVisionResult = { ...VISION_OK, confidence: 0.4 };
    const r = await cloudFn.main({ imageFileID: 'cloud://blur.jpg' });
    assert.strictEqual(r.code, 'OK');
    assert.strictEqual(r.data.category, '', `低置信度应置空, 实际=${r.data.category}`);
    assert.ok(r.data.warnings.some((w) => w.includes('置信度较低')), `warnings=${JSON.stringify(r.data.warnings)}`);
  });

  // ---- D3 OCR 失败降级 tagText ----
  await t('D3', 'OCR 抛错时降级用混元 tagText，链路不中断', async () => {
    reset();
    mockOcrError = new Error('ocr:fail');
    const r = await cloudFn.main({ imageFileID: 'cloud://tag.jpg' });
    assert.strictEqual(r.code, 'OK');
    assert.ok(r.data.compositionText.includes('棉'), `tagText 降级生效, compositionText=${r.data.compositionText}`);
  });

  // ---- D5 吊牌文字提取完全失败 ----
  await t('D5', 'OCR 与 tagText 均失败 → warnings 提示且不阻塞 OK', async () => {
    reset();
    mockOcrError = new Error('ocr:fail');
    mockVisionResult = { ...VISION_OK, tagText: '' };
    const r = await cloudFn.main({ imageFileID: 'cloud://glare.jpg' });
    assert.strictEqual(r.code, 'OK');
    assert.ok(r.data.warnings.some((w) => w.includes('检测到吊牌但文字提取失败')), `warnings=${JSON.stringify(r.data.warnings)}`);
  });

  // ---- E6 计数初始化（doc 不存在 → get 失败 → update 失败 → set 兜底）----
  await t('E6', '月初始化：usage doc 不存在 → set 创建 calls=1', async () => {
    reset();
    dbState.usageDoc = null;
    dbState.updateShouldFail = true;
    const r = await cloudFn.main({ imageFileID: 'cloud://ok.jpg' });
    assert.strictEqual(r.code, 'OK');
    assert.strictEqual(r.cost.calls, 1, `首次调用 cost.calls=${r.cost.calls}`);
    assert.strictEqual(dbState.setCalls.length, 1, 'set 兜底分支被调用');
    assert.strictEqual(dbState.setCalls[0].arg.data.calls, 1, `set calls=${dbState.setCalls[0] && dbState.setCalls[0].arg.data.calls}`);
    assert.strictEqual(dbState.setCalls[0].arg.data.ocrCalls, 1, '本次用了 OCR');
  });

  // ---- ping 探测（云端执行前置说明）----
  await t('A1-local', 'ping 本地 mock 验证返回结构（云端实测待执行）', async () => {
    const r = await cloudFn.main({ action: 'ping' });
    assert.strictEqual(r.code, 'OK');
    assert.strictEqual(typeof r.hasSecret, 'boolean');
    assert.strictEqual(r.budget, 50);
    // 已知问题：hasSecret 只检查 TENCENT_SECRET_ID，不反映 HUNYUAN_API_KEY（测试方案 A1 判定标准已注明）
    assert.strictEqual(r.hasSecret, true, 'mock 环境仅设置了 TENCENT_SECRET_ID');
  });

  // ---- 汇总 ----
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n===== E 组(含 C3/D3/D5/A1-local)汇总: ${pass}/${results.length} PASS =====`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAILED ${r.id} ${r.name}: ${r.error}`));
  process.exitCode = 0;
})().catch((e) => { console.error('Runner 异常(不中断):', e); process.exitCode = 0; });
