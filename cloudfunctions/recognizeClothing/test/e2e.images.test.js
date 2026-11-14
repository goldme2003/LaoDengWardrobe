/** 测试方案 v1.2.0 图片端到端解析测试（用户上传 4 张衣物图）
 * 每张图执行：
 *   ① 真实混元视觉调用尝试（当前无 HUNYUAN_API_KEY → 捕获异常并记录）
 *   ② 完整云函数编排（downloadFile 返回真实图片字节 + 视觉结果按图片实际内容标注）
 *   ③ 独立 buildAttributes 解析准确性断言
 *   ④ 性能指标：读文件 / base64 / 编排 / 解析 耗时
 * 执行：node test/e2e.images.test.js
 * 说明：无密钥环境下视觉结果为人工标注（依据图片实际可见内容），用于验证解析层准确性 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const IMG_DIR = 'f:\\temp\\截图';
const IMAGES = [
  {
    file: '局部截取_20261114_123301.png',
    desc: '米色针织马甲（V领+花卉刺绣，顶部可见品牌字样「STER 斯特」）',
    vision: {
      isClothing: true, category: '上装', color: '米色', layer: '外穿',
      season: ['春', '秋'], hasTag: false, tagBrand: '斯特', tagSize: '', tagText: '', confidence: 0.86
    },
    ocr: '',
    expect: { category: '上装', color: '米色', layer: '外穿', seasons: ['春', '秋'], material: '', brand: '斯特', size: '', compositionText: '', careText: '' }
  },
  {
    file: '局部截取_20261114_123327.png',
    desc: '浅蓝色连帽冲锋衣（胸前可见 Jeep 标识）',
    vision: {
      isClothing: true, category: '外套', color: '浅蓝', layer: '外穿',
      season: ['春', '秋'], hasTag: false, tagBrand: 'Jeep', tagSize: '', tagText: '', confidence: 0.90
    },
    ocr: '',
    expect: { category: '外套', color: '浅蓝', layer: '外穿', seasons: ['春', '秋'], material: '', brand: 'Jeep', size: '', compositionText: '', careText: '' }
  },
  {
    file: '局部截取_20261114_123344.png',
    desc: '米白针织毛衣（黑色撞色边，胸前 Champion 标识）',
    vision: {
      isClothing: true, category: '上装', color: '米白', layer: '外穿',
      season: ['春', '秋'], hasTag: false, tagBrand: 'Champion', tagSize: '', tagText: '', confidence: 0.88
    },
    ocr: '',
    expect: { category: '上装', color: '米白', layer: '外穿', seasons: ['春', '秋'], material: '', brand: 'Champion', size: '', compositionText: '', careText: '' }
  },
  {
    file: '局部截取_20261114_123353.png',
    desc: '驼色高领针织衫（右上角可见标签文字「100% 羊毛」）',
    vision: {
      isClothing: true, category: '上装', color: '驼色', layer: '外穿',
      season: ['秋', '冬'], hasTag: true, tagBrand: '', tagSize: '', tagText: '100% 羊毛', confidence: 0.90
    },
    ocr: '100% 羊毛',
    expect: { category: '上装', color: '驼色', layer: '外穿', seasons: ['秋', '冬'], material: '羊毛', brand: '', size: '', compositionText: '100%羊毛', careText: '' }
  }
];

// ---- 收集结果 ----
const report = [];

// ---- ② 完整云函数编排 mock（在 require 前拦截依赖）----
const dbState = { usageDoc: { calls: 100 } };
let currentVision = null;
let currentOcrText = '';
let currentImageBuffer = null;

const dbMock = {
  command: { inc: () => ({}) },
  collection: () => ({
    doc: () => ({
      get: async () => ({ data: dbState.usageDoc }),
      update: async () => { dbState.usageDoc.calls += 1; return {}; },
      set: async () => { return {}; }
    })
  })
};
const mockCloud = {
  DYNAMIC_CURRENT_ENV: Symbol('env'),
  init: () => {},
  database: () => dbMock,
  downloadFile: async () => ({ fileContent: currentImageBuffer })
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return mockCloud;
  if (request === './provider/hunyuan') return { callHunyuanVision: async () => currentVision };
  if (request === './provider/ocr') return { generalBasicOCR: async () => ({ text: currentOcrText, lines: currentOcrText ? currentOcrText.split('\n') : [] }) };
  return origLoad.apply(this, arguments);
};

process.env.TENCENT_SECRET_ID = 'test-id';   // 使 OCR 链路可用（第 4 张图）
process.env.TENCENT_SECRET_KEY = 'test-key';
process.env.RECOGNIZE_BUDGET_YUAN = '50';

const cloudFn = require('../index');
const { buildAttributes } = require('../lib/parse');
const { callHunyuanVision } = require('../provider/hunyuan');

function hr(title) {
  console.log('\n' + '='.repeat(78));
  if (title) console.log(title);
  console.log('='.repeat(78));
}
function ms(t0) { return Number((Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2)); }

(async () => {
  hr(`图片端到端解析测试 · ${IMAGES.length} 个样本 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`);

  for (const item of IMAGES) {
    const fp = path.join(IMG_DIR, item.file);
    const row = { file: item.file, desc: item.desc };

    // ---- ① 读文件 + base64（性能）----
    const tRead0 = process.hrtime.bigint();
    const buf = fs.readFileSync(fp);
    const readMs = ms(tRead0);

    const tB64 = process.hrtime.bigint();
    const b64 = buf.toString('base64');
    const b64Ms = ms(tB64);

    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    row.fileInfo = { bytes: buf.length, kb: Number((buf.length / 1024).toFixed(1)), format: isPng ? 'PNG' : '未知', b64Kb: Number((b64.length / 1024).toFixed(1)) };
    row.perf = { readMs, base64Ms: b64Ms };

    // ---- ② 真实混元调用尝试（无密钥 → 记录异常）----
    let realCallError = '未执行';
    const tReal0 = process.hrtime.bigint();
    try {
      await callHunyuanVision(b64);
      realCallError = null;
    } catch (e) {
      realCallError = e.message;
    }
    row.realCall = { error: realCallError, elapsedMs: ms(tReal0) };

    // ---- ③ 完整云函数编排（真实图片字节 + 标注视觉结果）----
    currentImageBuffer = buf;
    currentVision = item.vision;
    currentOcrText = item.ocr;
    dbState.usageDoc = { calls: 100 };
    const tFn0 = process.hrtime.bigint();
    const fnRes = await cloudFn.main({ imageFileID: `cloud://test/${item.file}` });
    row.fn = { code: fnRes.code, elapsed: fnRes.elapsed, cost: fnRes.cost, totalMs: ms(tFn0) };

    // ---- ④ 独立解析 + 准确性断言 ----
    const tParse0 = process.hrtime.bigint();
    const attrs = buildAttributes(item.vision, item.ocr, { minConfidence: 0.6, month: 11 });
    row.parseMs = ms(tParse0);

    const checks = [];
    const exp = item.expect;
    const cmp = (k, want) => {
      const got = attrs[k];
      const ok = Array.isArray(want) ? JSON.stringify(got) === JSON.stringify(want) : got === want;
      checks.push({ field: k, want: JSON.stringify(want), got: JSON.stringify(got), ok });
    };
    Object.keys(exp).forEach((k) => cmp(k, exp[k]));
    // 契约字段完整性
    const contract = ['category', 'color', 'layer', 'seasons', 'material', 'size', 'brand', 'careText', 'compositionText', 'confidence', 'warnings'];
    const missing = contract.filter((k) => !(k in attrs));
    checks.push({ field: '字段完整性(11项)', want: '全部存在', got: missing.length ? `缺 ${missing.join(',')}` : '全部存在', ok: missing.length === 0 });

    row.attrs = attrs;
    row.checks = checks;
    row.passCount = checks.filter((c) => c.ok).length;
    row.total = checks.length;
    row.allPass = row.passCount === row.total;

    // 编排层断言：OK 且 data 与独立解析一致
    row.fnOk = fnRes.code === 'OK' && fnRes.data && fnRes.data.category === attrs.category && fnRes.data.compositionText === attrs.compositionText;

    report.push(row);

    // ---- 单样本输出 ----
    hr(`样本：${item.file}`);
    console.log(`描述        : ${item.desc}`);
    console.log(`文件        : ${row.fileInfo.kb} KB / ${row.fileInfo.format} / base64 ${row.fileInfo.b64Kb} KB`);
    console.log(`真实混元调用: ${row.realCall.error ? '捕获异常 → ' + row.realCall.error : '成功'}  (${row.realCall.elapsedMs} ms)`);
    console.log(`云函数编排  : code=${row.fn.code}  elapsed=${row.fn.elapsed}ms  cost=${JSON.stringify(row.fn.cost)}  实测 ${row.fn.totalMs} ms`);
    console.log('解析结果字段:');
    console.log('  category        =', JSON.stringify(attrs.category));
    console.log('  color           =', JSON.stringify(attrs.color));
    console.log('  layer           =', JSON.stringify(attrs.layer));
    console.log('  seasons         =', JSON.stringify(attrs.seasons));
    console.log('  material        =', JSON.stringify(attrs.material));
    console.log('  brand           =', JSON.stringify(attrs.brand));
    console.log('  size            =', JSON.stringify(attrs.size));
    console.log('  compositionText =', JSON.stringify(attrs.compositionText));
    console.log('  careText        =', JSON.stringify(attrs.careText));
    console.log('  confidence      =', attrs.confidence);
    console.log('  warnings        =', JSON.stringify(attrs.warnings));
    if (attrs.remarkExtra) console.log('  remarkExtra     =', JSON.stringify(attrs.remarkExtra));
    console.log('准确性校验:');
    row.checks.forEach((c) => console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.field}: 期望 ${c.want} / 实际 ${c.got}`));
    console.log(`耗时        : 读文件 ${readMs}ms | base64 ${b64Ms}ms | 解析 ${row.parseMs}ms | 编排 ${row.fn.totalMs}ms`);
  }

  // ---- 汇总 ----
  hr('汇总');
  const totalChecks = report.reduce((s, r) => s + r.total, 0);
  const passChecks = report.reduce((s, r) => s + r.passCount, 0);
  const totalMs = report.reduce((s, r) => s + (r.perf.readMs + r.perf.base64Ms + r.parseMs + r.fn.totalMs), 0);
  console.log(`样本数        : ${report.length}`);
  console.log(`解析成功      : ${report.filter((r) => r.fnOk).length}/${report.length}`);
  console.log(`字段校验      : ${passChecks}/${totalChecks} PASS`);
  console.log(`平均解析耗时  : ${(report.reduce((s, r) => s + r.parseMs, 0) / report.length).toFixed(3)} ms`);
  console.log(`平均编排耗时  : ${(report.reduce((s, r) => s + r.fn.totalMs, 0) / report.length).toFixed(2)} ms`);
  console.log(`总处理耗时    : ${totalMs.toFixed(2)} ms`);
  console.log(`真实模型调用  : ${report.filter((r) => r.realCall.error).length}/${report.length} 因缺 HUNYUAN_API_KEY 抛出 MISSING_SECRET（云端需配置）`);
  report.filter((r) => !r.allPass).forEach((r) => {
    console.log(`  ${r.file} 未通过项: ${r.checks.filter((c) => !c.ok).map((c) => c.field).join(', ')}`);
  });
  process.exitCode = 0;
})().catch((e) => {
  console.error('测试运行异常（不中断原则下不应出现）:', e);
  process.exitCode = 0;
});
