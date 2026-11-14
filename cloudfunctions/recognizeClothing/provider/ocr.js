/** 腾讯云通用印刷体 OCR 封装（PRD 9.3 阶段2：吊牌/水洗唛文字提取）
 * 每月 1,000 次免费额度；仅在混元判定图片含吊牌时调用（方案 Q2 确认） */
const tencentcloud = require('tencentcloud-sdk-nodejs-ocr');

const OcrClient = tencentcloud.ocr.v20181119.Client;

function getClient() {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('MISSING_SECRET: 云函数环境变量未配置 TENCENT_SECRET_ID/TENCENT_SECRET_KEY');
  }
  return new OcrClient({
    credential: { secretId, secretKey },
    region: process.env.TENCENT_REGION || 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'ocr.tencentcloudapi.com', reqTimeout: 10 } }
  });
}

/**
 * 通用印刷体识别（吊牌/水洗唛照片）
 * @param {string} imageBase64 图片 base64（不含 data: 前缀）
 * @returns {Promise<{text: string, lines: string[]}>} 全文与逐行文本
 */
async function generalBasicOCR(imageBase64) {
  const client = getClient();
  const res = await client.GeneralBasicOCR({ ImageBase64: imageBase64 });
  const lines = ((res && res.TextDetections) || [])
    .map((d) => (d.DetectedText || '').trim())
    .filter(Boolean);
  return { lines, text: lines.join('\n') };
}

module.exports = { generalBasicOCR };
