import { CustomDimension, Gender, ThemeId, BodyProfile } from '@/types';

/** 当前版本号（在「我的」页展示） */
export const APP_VERSION = 'v0.7.0';

/** 性别选项（v0.5） */
export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' }
];

export const AGE_MIN = 1;
export const AGE_MAX = 120;

/** 服装类型预设按性别过滤（v0.5：男性不展示裙装/连衣裙） */
export const getTypePresetsByGender = (gender?: Gender): string[] =>
  gender === 'male'
    ? TYPE_PRESETS.filter((t) => t !== '裙装' && t !== '连衣裙')
    : TYPE_PRESETS;

/** 按性别与身高推荐尺码默认值（v0.5：尺码选填，自动预填可修改） */
export const suggestSize = (gender?: Gender, height?: number): string => {
  if (!height || height <= 0) return '';
  if (gender === 'male') {
    if (height < 165) return 'S';
    if (height < 172) return 'M';
    if (height < 180) return 'L';
    return 'XL';
  }
  if (gender === 'female') {
    if (height < 155) return 'S';
    if (height < 163) return 'M';
    if (height < 170) return 'L';
    return 'XL';
  }
  return '';
};

/** 服装类型预设（PRD 6.1） */
export const TYPE_PRESETS = [
  '上装',
  '裤装',
  '裙装',
  '连衣裙',
  '外套',
  '内衣',
  '家居服',
  '鞋履',
  '配饰',
  '其他'
];

/** 内外穿（固定枚举） */
export const LAYER_OPTIONS = ['内穿', '外穿'];

/** 颜色预设（含展示用色值） */
export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: '黑色', hex: '#2B2B2B' },
  { name: '白色', hex: '#FFFFFF' },
  { name: '灰色', hex: '#9E9E9E' },
  { name: '红色', hex: '#D94141' },
  { name: '橙色', hex: '#F08C00' },
  { name: '黄色', hex: '#F5C542' },
  { name: '绿色', hex: '#4C9E5E' },
  { name: '蓝色', hex: '#3B6FB5' },
  { name: '紫色', hex: '#7E5BB5' },
  { name: '粉色', hex: '#EF9BB1' },
  { name: '棕色', hex: '#8B5E3C' },
  { name: '米色', hex: '#E8DCC8' },
  { name: '牛仔蓝', hex: '#5B7C99' }
];

export const COLOR_HEX_MAP: Record<string, string> = COLOR_PRESETS.reduce(
  (map, c) => ({ ...map, [c.name]: c.hex }),
  {} as Record<string, string>
);

/** 材质预设 */
export const MATERIAL_PRESETS = [
  '棉',
  '麻',
  '丝绸',
  '羊毛',
  '羊绒',
  '涤纶',
  '牛仔',
  '皮革',
  '羽绒',
  '醋酸',
  '其他'
];

/** 季节（固定枚举，多选） */
export const SEASON_OPTIONS = ['春', '夏', '秋', '冬'];

/** 尺码预设（选填扩展属性，PRD v0.3） */
export const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** 裤装腰围尺码档位（v0.7.0：24–40 英寸，共 17 档；服装类型为「裤装」时使用） */
export const WAIST_SIZE_OPTIONS: string[] = Array.from({ length: 17 }, (_, i) => String(24 + i));

/** 适用场合预设（选填扩展属性，多选） */
export const OCCASION_OPTIONS = ['日常', '通勤', '运动', '正式', '居家', '旅行'];

/** 品牌字数上限（选填扩展属性） */
export const BRAND_MAX_LEN = 20;

/** 常用品牌预设（选填，支持手动输入 + 联想提示） */
export const BRAND_PRESETS = [
  '优衣库',
  'ZARA',
  'H&M',
  '无印良品',
  'GAP',
  'COS',
  '耐克',
  '阿迪达斯',
  '李宁',
  '安踏',
  '波司登',
  '雅戈尔',
  '海澜之家',
  '七匹狼',
  '恒源祥',
  '太平鸟'
];

/** 衣橱主题色板（用户意见 4：不同人衣橱用自定义颜色区分） */
export const WARDROBE_COLORS = [
  '#B07D50',
  '#3B6FB5',
  '#4C9E5E',
  '#7E5BB5',
  '#D94141',
  '#E8684A',
  '#5B7C99',
  '#2B2B2B'
];

/** 天气现象 → 图标映射（用户意见 6） */
export const WEATHER_ICONS: Record<string, string> = {
  晴: '☀️',
  多云: '⛅',
  阴: '☁️',
  小雨: '🌧️',
  中雨: '🌧️',
  大雨: '🌧️',
  阵雨: '🌦️',
  雷阵雨: '⛈️',
  雪: '❄️',
  小雪: '🌨️',
  雾: '🌫️',
  霾: '😷'
};

/** 天气现象图标 */
export const weatherIcon = (cond: string): string => WEATHER_ICONS[cond] || '🌤️';

/** 自定义选项字数上限（PRD 6.1；v0.5 扩展尺码/场合维度） */
export const CUSTOM_MAX_LEN: Record<CustomDimension, number> = {
  type: 10,
  color: 6,
  material: 10,
  size: 6,
  occasion: 10
};

/** ============================================
 * 风格主题集（v0.5：不同衣橱选择不同整体风格主题，
 * 含页面底色/主色/卡片底色/文本色/卡片圆角风格，而非仅控件颜色）
 * v0.7.0：提高底色/主色饱和度与对比度，并新增天气卡片用变量（weatherBg/weatherAccent）
 * ============================================ */
export interface ThemeStyle {
  id: ThemeId;
  name: string;
  /** 页面底色 */
  bg: string;
  /** 主色（同时作为衣橱主题色 color） */
  primary: string;
  /** 主色浅（渐变/次级按钮） */
  primaryLight: string;
  /** 卡片底色 */
  card: string;
  /** 主文本色 */
  text: string;
  /** 次文本色 */
  textSecondary: string;
  /** 卡片圆角（不同主题圆角风格不同） */
  radius: string;
  /** 主题图标 */
  emoji: string;
  /** 天气卡片底色（v0.7.0） */
  weatherBg: string;
  /** 天气卡片强调色（v0.7.0） */
  weatherAccent: string;
}

export const THEME_SETS: ThemeStyle[] = [
  {
    id: 'warm',
    name: '焦糖暖棕',
    bg: '#F7EFDF',
    primary: '#A96B32',
    primaryLight: '#D69758',
    card: '#FFFFFF',
    text: '#271E14',
    textSecondary: '#6E5B45',
    radius: '16rpx',
    emoji: '🧺',
    weatherBg: '#F3E6CC',
    weatherAccent: '#A96B32'
  },
  {
    id: 'ocean',
    name: '海雾蓝',
    bg: '#E7F0FA',
    primary: '#2E64B8',
    primaryLight: '#6B97D6',
    card: '#FFFFFF',
    text: '#182740',
    textSecondary: '#4F647E',
    radius: '16rpx',
    emoji: '🌊',
    weatherBg: '#D8E9F9',
    weatherAccent: '#2E64B8'
  },
  {
    id: 'mint',
    name: '薄荷奶绿',
    bg: '#E9F5EC',
    primary: '#35944A',
    primaryLight: '#77BC8A',
    card: '#FFFFFF',
    text: '#182B1E',
    textSecondary: '#54705F',
    radius: '32rpx',
    emoji: '🌿',
    weatherBg: '#D9EFE0',
    weatherAccent: '#35944A'
  },
  {
    id: 'honey',
    name: '蜜橙拿铁',
    bg: '#FCF0E0',
    primary: '#E45530',
    primaryLight: '#F19167',
    card: '#FFFDF8',
    text: '#2E1F15',
    textSecondary: '#7D604E',
    radius: '16rpx',
    emoji: '🍊',
    weatherBg: '#FAE3CB',
    weatherAccent: '#E45530'
  },
  {
    id: 'rose',
    name: '豆沙玫瑰',
    bg: '#F9ECEF',
    primary: '#B25268',
    primaryLight: '#D488A0',
    card: '#FFFCFC',
    text: '#2E1E26',
    textSecondary: '#7D5865',
    radius: '32rpx',
    emoji: '🌸',
    weatherBg: '#F5DDE2',
    weatherAccent: '#B25268'
  },
  {
    id: 'ink',
    name: '黑胡桃墨调',
    bg: '#ECEBE7',
    primary: '#2F2F2B',
    primaryLight: '#6B6B63',
    card: '#FFFFFF',
    text: '#1B1B18',
    textSecondary: '#64645C',
    radius: '8rpx',
    emoji: '🖤',
    weatherBg: '#E1E0DA',
    weatherAccent: '#4E4E46'
  }
];

export const DEFAULT_THEME_ID: ThemeId = 'warm';

export const getThemeById = (id?: ThemeId): ThemeStyle =>
  THEME_SETS.find((t) => t.id === id) || THEME_SETS[0];

/** 由衣橱生成 CSS 变量（页面根节点 style 注入，实现整体风格主题） */
export const themeVarsOf = (w?: { themeId?: ThemeId; color?: string } | null): Record<string, string> => {
  const t = getThemeById(w?.themeId);
  return {
    '--w-color': w?.color || t.primary,
    '--w-primary': t.primary,
    '--w-primary-light': t.primaryLight,
    '--w-bg': t.bg,
    '--w-card': t.card,
    '--w-text': t.text,
    '--w-text2': t.textSecondary,
    '--w-radius': t.radius,
    '--w-weather-bg': t.weatherBg,
    '--w-weather-accent': t.weatherAccent
  };
};

/** ============================================
 * 个人身体数据字段定义（v0.5：缝纫基本信息，均在「我的」页维护）
 * ============================================ */
export interface BodyFieldDef {
  key: keyof BodyProfile;
  label: string;
  unit: string;
  /** 合理区间，用于输入校验 */
  min: number;
  max: number;
}

export const BODY_FIELD_DEFS: BodyFieldDef[] = [
  { key: 'height', label: '身高', unit: 'cm', min: 50, max: 250 },
  { key: 'weight', label: '体重', unit: 'kg', min: 10, max: 300 },
  { key: 'bust', label: '胸围', unit: 'cm', min: 40, max: 200 },
  { key: 'waist', label: '腰围', unit: 'cm', min: 40, max: 200 },
  { key: 'hip', label: '臀围', unit: 'cm', min: 40, max: 200 },
  { key: 'shoulderWidth', label: '肩宽', unit: 'cm', min: 20, max: 80 },
  { key: 'shoulder', label: '肩围', unit: 'cm', min: 40, max: 200 },
  { key: 'armSpan', label: '臂展', unit: 'cm', min: 60, max: 250 },
  { key: 'neck', label: '领围', unit: 'cm', min: 20, max: 80 },
  { key: 'inseam', label: '裤长', unit: 'cm', min: 40, max: 130 },
  { key: 'thigh', label: '腿围', unit: 'cm', min: 20, max: 120 },
  { key: 'footLength', label: '脚长', unit: 'mm', min: 120, max: 350 }
];

/** 购入地点/渠道预设（v0.5） */
export const PURCHASE_PLACE_PRESETS = [
  '淘宝',
  '京东',
  '拼多多',
  '线下商场',
  '品牌门店',
  '免税店',
  '海淘',
  '二手平台',
  '朋友赠送',
  '其他'
];

/** 照片组上限（PRD FR-02） */
export const MAX_PHOTOS = 9;

/** 备注上限（PRD FR-05） */
export const REMARK_MAX_LEN = 200;

/** 衣橱名称上限（PRD FR-01） */
export const WARDROBE_NAME_MAX_LEN = 10;

/** 名称长度上限 */
export const ITEM_NAME_MAX_LEN = 20;

/** 示例照片（预览辅助，电商/服饰类） */
export const SAMPLE_PHOTO_IDS = [103, 119, 220, 225, 230, 250];

export const samplePhoto = (index: number): string =>
  `https://picsum.photos/id/${SAMPLE_PHOTO_IDS[index % SAMPLE_PHOTO_IDS.length]}/300/300`;
