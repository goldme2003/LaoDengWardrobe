/** 属性规则解析与预设映射（PRD 9.3 阶段2）
 * ① 面料成分宽松正则抽取；② 清洗说明关键词表抽取；③ 品类/颜色/季节映射至 6.1 预设 */

/** 与前端 src/data/presets.ts 保持同步的预设表（避免云函数引用前端模块） */
const TYPE_PRESETS = ['上装', '裤装', '裙装', '连衣裙', '外套', '内衣', '家居服', '鞋履', '配饰', '其他'];
const MATERIAL_PRESETS = ['棉', '麻', '丝绸', '羊毛', '涤纶', '牛仔', '皮革', '羽绒', '雪纺', '其他'];
const LAYER_OPTIONS = ['外穿', '内穿'];

/** 成分正则：「60%棉」「棉60%」「涤纶/聚酯纤维」等
 * 修复 BUG-PARSE-01：名称捕获组排除数字，避免「60%棉」被错拆为「6」「0%」（输出乱码 0%6） */
const COMP_RATIO_RE = /(?:([^\s，,。；;：:%\d]{1,4})\s*含?量?\s*(\d{1,3})\s*%)|(?:含?\s*(\d{1,3})\s*%\s*([^\s，,。；;：:%\d]{1,4}))/g;
const COMP_KEYWORDS = ['棉', '聚酯纤维', '涤纶', '锦纶', '腈纶', '氨纶', '莱卡', '麻', '蚕丝', '桑蚕丝', '羊毛', '羊绒', '粘纤', '莫代尔', '莱赛尔', '牛皮', '羊皮', '羽绒'];

/** 清洗说明关键词（≥10 类，验收标准） */
const CARE_KEYWORDS = [
  { k: '机洗', label: '可机洗' },
  { k: '不可机洗', label: '不可机洗' },
  { k: '手洗', label: '宜手洗' },
  { k: '不可漂白', label: '不可漂白' },
  { k: '漂白', label: '可漂白' },
  { k: '不可熨', label: '不可熨烫' },
  { k: '熨烫', label: '可熨烫' },
  { k: '干洗', label: '可干洗' },
  { k: '不可干洗', label: '不可干洗' },
  { k: '阴干', label: '阴干' },
  { k: '不可拧干', label: '不可拧干' },
  { k: '温水', label: '温水洗涤' },
  { k: '冷水', label: '冷水洗涤' }
];

/** 从 OCR 原文抽取面料成分摘要 */
function extractComposition(text) {
  const found = [];
  let m;
  COMP_RATIO_RE.lastIndex = 0;
  while ((m = COMP_RATIO_RE.exec(text)) !== null) {
    const name = (m[1] || m[4] || '').trim();
    const pct = m[2] || m[3] || '';
    if (name && pct) found.push(`${pct}%${name}`);
  }
  // 无比例时抽取出现过的成分关键词（去重，最多 3 个）
  if (found.length === 0) {
    for (const kw of COMP_KEYWORDS) {
      if (text.includes(kw) && found.length < 3) found.push(kw);
    }
  }
  return found.join(' ');
}

/** 从 OCR 原文抽取清洗说明（关键词拼接，去重） */
function extractCare(text) {
  const labels = [];
  for (const { k, label } of CARE_KEYWORDS) {
    if (text.includes(k) && !labels.includes(label)) labels.push(label);
  }
  return labels.join('；');
}

/** 品类名映射至预设（「卫衣/衬衫/T恤」→ 上装；「运动鞋」→ 鞋履 等） */
function mapCategory(raw) {
  const t = (raw || '').trim();
  if (TYPE_PRESETS.includes(t)) return t;
  const rules = [
    [/T恤|衬衫|卫衣|毛衣|针织|背心|吊带|Polo|polo|上衣|罩衫/, '上装'],
    [/羽绒服|风衣|大衣|夹克|西装|外套|披肩|开衫/, '外套'],
    [/牛仔裤|休闲裤|西裤|运动裤|短裤|打底裤|长裤|裤子/, '裤装'],
    [/半身裙|短裙|长裙|A字裙/, '裙装'],
    [/连衣裙|长袍|礼服/, '连衣裙'],
    [/内裤|文胸|胸罩|秋衣|秋裤|保暖内衣|打底/, '内衣'],
    [/睡衣|睡裙|家居服|浴袍|居家/, '家居服'],
    [/鞋|靴|拖鞋|凉鞋|板鞋|运动鞋|高跟鞋/, '鞋履'],
    [/帽|围巾|手套|腰带|皮带|袜|包|饰品|项链|手表|墨镜|眼镜/, '配饰']
  ];
  for (const [re, mapped] of rules) {
    if (re.test(t)) return mapped;
  }
  return '其他';
}

/** 材质映射至预设（未命中返回原文交由前端降级入备注） */
function mapMaterial(raw) {
  const t = (raw || '').trim();
  if (MATERIAL_PRESETS.includes(t)) return t;
  const rules = [
    [/棉|Cotton/i, '棉'],
    [/麻|Linen|亚麻/i, '麻'],
    [/丝|Silk/i, '丝绸'],
    [/羊毛|羊绒|Wool/i, '羊毛'],
    [/涤纶|聚酯|涤|Polyester/i, '涤纶'],
    [/牛仔|Denim|丹宁/i, '牛仔'],
    [/皮|Leather/i, '皮革'],
    [/羽绒|Down/i, '羽绒'],
    [/雪纺|Chiffon/i, '雪纺']
  ];
  for (const [re, mapped] of rules) {
    if (re.test(t)) return mapped;
  }
  return '';
}

/** 季节建议：模型输出 + 端侧规则兜底（月份 + 品类） */
function suggestSeasons(modelSeasons, category, month) {
  const valid = (modelSeasons || []).filter((s) => ['春', '夏', '秋', '冬'].includes(s));
  if (valid.length > 0) return valid.slice(0, 2);
  const m = month || new Date().getMonth() + 1;
  const cold = ['外套', '内衣', '家居服'].includes(category) || m <= 2 || m >= 11;
  const hot = ['裙装', '连衣裙'].includes(category) || (m >= 6 && m <= 8);
  if (cold) return ['秋', '冬'];
  if (hot) return ['春', '夏'];
  return ['春', '秋'];
}

/**
 * 汇总混元输出 + OCR 文本 → 结构化属性（置信度过滤由调用方传入阈值）
 * @returns {{category,color,layer,seasons,material,size,brand,careText,compositionText,warnings[]}}
 */
function buildAttributes(vision, ocrText, opts) {
  const opts_ = opts || {};
  const minConf = typeof opts_.minConfidence === 'number' ? opts_.minConfidence : 0.6;
  const warnings = [];
  const conf = Number(vision.confidence || 0);

  const category = mapCategory(vision.category);
  const color = (vision.color || '').trim().slice(0, 6);
  const layer = LAYER_OPTIONS.includes(vision.layer) ? vision.layer : '';
  const seasons = suggestSeasons(vision.season, category, opts_.month);

  // 吊牌文字类属性：优先 OCR，混元读取的 tagBrand/tagSize 兜底
  const compositionText = extractComposition(ocrText || '');
  const careText = extractCare(ocrText || '');
  const material = compositionText ? mapMaterial(compositionText.split(' ')[0]) : '';
  const brand = ((ocrText && parseBrand(ocrText)) || vision.tagBrand || '').trim().slice(0, 20);
  const size = (vision.tagSize || parseSize(ocrText || '') || '').trim().slice(0, 6);

  if (conf < minConf) warnings.push(`品类置信度较低（${conf.toFixed(2)}），建议手动确认`);
  if (vision.hasTag && !ocrText) warnings.push('检测到吊牌但文字提取失败，建议拍平整的吊牌正面');
  if (!material && compositionText) warnings.push(`材质「${compositionText}」不在预设中，已写入备注`);

  const result = {
    category,
    color,
    // 方案 2.3 返回结构要求 colors[]；保留单值 color 兼容既有表单控件
    colors: color ? [color] : [],
    layer,
    seasons,
    material,
    size,
    brand,
    careText,
    compositionText,
    confidence: conf,
    // 方案 2.3 返回结构要求 confidence{}（分字段置信度；当前模型仅给出品类整体置信度）
    confidenceMap: {
      category: conf,
      color: conf,
      layer: conf,
      overall: conf
    },
    warnings
  };
  // 材质未映射成功时把成分原文交给备注
  if (!material && compositionText) {
    result.remarkExtra = `面料成分：${compositionText}`;
  }
  return result;
}

/** 从 OCR 文本猜品牌：首个全大写英文词或「品牌：xxx」 */
function parseBrand(text) {
  const labeled = text.match(/品\s*牌[：:]\s*([^\s，,。;；]{1,20})/);
  if (labeled) return labeled[1];
  const en = text.match(/\b([A-Z][A-Za-z]{2,15}(?:\s[A-Z][A-Za-z]{2,15})?)\b/);
  return en ? en[1] : '';
}

/** 从 OCR 文本猜尺码：S/M/L/XL/XXL 或 160/165 等常见码 */
function parseSize(text) {
  const m = text.match(/\b(XXS|XS|XXL|XL|[SML])\b/) || text.match(/\b(1[5-9]\d|2[0-2]\d)\/\d{2,3}[A-Z]?\b/);
  return m ? m[1] : '';
}

module.exports = { buildAttributes, mapCategory, mapMaterial, extractComposition, extractCare, suggestSeasons };
