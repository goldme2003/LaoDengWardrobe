/** 腾讯混元视觉大模型调用封装（PRD 9.3 阶段1）
 * 密钥从云函数环境变量读取，绝不打包进前端（方案 R3 强约束）
 * Provider 层抽象：如需切换千问 VL 等供应商，仅替换本文件（方案 R6） */
const tencentcloud = require('tencentcloud-sdk-nodejs-hunyuan');

const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

/** 识别用结构化输出 Prompt（要求严格 JSON，便于云函数解析） */
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
  "confidence": 0.0~1.0              // 品类判断置信度
}`;

function getClient() {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('MISSING_SECRET: 云函数环境变量未配置 TENCENT_SECRET_ID/TENCENT_SECRET_KEY');
  }
  return new HunyuanClient({
    credential: { secretId, secretKey },
    region: process.env.TENCENT_REGION || 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'hunyuan.tencentcloudapi.com', reqTimeout: 20 } }
  });
}

/**
 * 调用混元视觉模型识别图片
 * @param {string} imageBase64 图片 base64（不含 data: 前缀）
 * @returns {Promise<object>} 模型输出的结构化 JSON（解析失败抛错）
 */
async function callHunyuanVision(imageBase64) {
  const client = getClient();
  const res = await client.ChatCompletions({
    Model: process.env.HUNYUAN_MODEL || 'hunyuan-vision',
    Messages: [
      {
        Role: 'user',
        Content: [
          { Type: 'text', Text: PROMPT },
          { Type: 'image_url', ImageUrl: { Url: `data:image/jpeg;base64,${imageBase64}` } }
        ]
      }
    ],
    Temperature: 0.1
  });
  const text = res && res.Choices && res.Choices[0] && res.Choices[0].Message
    ? res.Choices[0].Message.Content
    : '';
  // 提取 JSON（容忍模型输出包裹 ```json 等）
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('BAD_MODEL_OUTPUT: ' + String(text).slice(0, 200));
  return JSON.parse(m[0]);
}

module.exports = { callHunyuanVision };
