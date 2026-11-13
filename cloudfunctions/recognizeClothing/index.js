/** 云函数 recognizeClothing（PRD 9.3 / v1.2 阶段1+2）
 * 编排：熔断检查 → 下载云存储图片 → 混元视觉（含衣判定/品类颜色/吊牌检测）
 *      →（含吊牌时）腾讯云 OCR → 规则解析 → 结构化返回 + 用量计数
 * 密钥仅存云函数环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY（方案 R3）
 * 熔断：环境变量 RECOGNIZE_BUDGET_YUAN（默认 50 元/月），数据库集合 recognize_usage 按月计数（方案 Q5） */
const cloud = require('wx-server-sdk');
const { callHunyuanVision } = require('./provider/hunyuan');
const { generalBasicOCR } = require('./provider/ocr');
const { buildAttributes } = require('./lib/parse');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MONTHLY_BUDGET = Number(process.env.RECOGNIZE_BUDGET_YUAN || 50);
/** 单次成功调用成本估算（大模型 0.05 + OCR 0.01，保守取值，与前端估算一致） */
const COST_PER_CALL = 0.06;

/** 熔断计数（集合 recognize_usage，doc id = usage_YYYY-M；无则初始化） */
async function getUsage(monthKey) {
  try {
    const res = await db.collection('recognize_usage').doc(`usage_${monthKey}`).get();
    return res.data && typeof res.data.calls === 'number' ? res.data : { calls: 0 };
  } catch (e) {
    return { calls: 0 };
  }
}

async function incrUsage(monthKey, ocrUsed) {
  const id = `usage_${monthKey}`;
  try {
    await db.collection('recognize_usage').doc(id).update({
      data: { calls: db.command.inc(1), ocrCalls: db.command.inc(ocrUsed ? 1 : 0), updatedAt: Date.now() }
    });
  } catch (e) {
    // doc 不存在则创建（权限：仅云函数可写）
    try {
      await db.collection('recognize_usage').doc(id).set({
        data: { calls: 1, ocrCalls: ocrUsed ? 1 : 0, updatedAt: Date.now() }
      });
    } catch (e2) {
      console.warn('[recognize] 用量计数写入失败（不阻塞返回）', e2 && e2.message);
    }
  }
}

/** 下载云存储文件并转 base64 */
async function downloadAsBase64(fileID) {
  const res = await cloud.downloadFile({ fileID });
  return Buffer.from(res.fileContent).toString('base64');
}

exports.main = async (event) => {
  const started = Date.now();
  // 连通性探测（部署联调用）
  if (event.action === 'ping') {
    return { code: 'OK', hasSecret: !!process.env.TENCENT_SECRET_ID, budget: MONTHLY_BUDGET };
  }

  if (!event.imageFileID) {
    return { code: 'BAD_PARAM', message: '缺少 imageFileID' };
  }

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

  // ① 熔断检查（50 元/月，Q5；硬校验以数据库计数为准）
  const usage = await getUsage(monthKey);
  const estCost = usage.calls * COST_PER_CALL;
  if (estCost >= MONTHLY_BUDGET) {
    return { code: 'BUDGET_EXCEEDED', message: '本月识别额度已用尽，下月自动恢复', usage: { month: monthKey, estCost } };
  }

  try {
    // ② 下载图片
    const imageBase64 = await downloadAsBase64(event.imageFileID);

    // ③ 混元视觉：含衣判定 + 品类/颜色/内外穿/季节 + 吊牌检测
    const vision = await callHunyuanVision(imageBase64);

    // ④ 非衣物 → 明确提示（验收：误报率 ≤5%）
    if (!vision.isClothing) {
      await incrUsage(monthKey, false);
      return { code: 'NO_CLOTHING', message: '未识别到衣物，请重新拍摄' };
    }

    // ⑤ 吊牌 → OCR → 规则解析（方案 S2 场景）
    // CAM 密钥（SecretId/Key）就绪时走腾讯云通用印刷体 OCR（Q2 正式链路）；
    // 未就绪时降级用混元直接读取的吊牌文字（tagText），避免链路中断
    let ocrText = '';
    let ocrUsed = false;
    if (vision.hasTag) {
      const hasCamSecret = !!process.env.TENCENT_SECRET_ID && !!process.env.TENCENT_SECRET_KEY;
      if (hasCamSecret) {
        try {
          const ocr = await generalBasicOCR(imageBase64);
          ocrText = ocr.text;
          ocrUsed = true;
        } catch (e) {
          console.warn('[recognize] OCR 失败，降级用模型读取的吊牌文字', e && e.message);
        }
      }
      if (!ocrText && vision.tagText) {
        ocrText = String(vision.tagText);
      }
    }

    // ⑥ 属性映射与置信度过滤（<0.6 的品类不预填）
    const attrs = buildAttributes(vision, ocrText, { minConfidence: 0.6, month: now.getMonth() + 1 });
    if (attrs.confidence < 0.6) attrs.category = '';

    // ⑦ 成功：计数 +1（OCR 单独计数用于免费额度监控）
    await incrUsage(monthKey, ocrUsed);

    return {
      code: 'OK',
      data: attrs,
      cost: { calls: usage.calls + 1, estCost: (usage.calls + 1) * COST_PER_CALL, budget: MONTHLY_BUDGET },
      elapsed: Date.now() - started
    };
  } catch (e) {
    console.error('[recognize] 识别失败', e && e.message);
    const msg = (e && e.message) || '';
    if (msg.startsWith('MISSING_SECRET')) {
      return { code: 'NOT_CONFIGURED', message: '识别服务未配置，请联系维护者' };
    }
    return { code: 'RECOGNIZE_FAILED', message: '识别失败，请手动填写' };
  }
};
