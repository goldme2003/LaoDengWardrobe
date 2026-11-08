import { CustomDimension } from '@/types';

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

/** 自定义选项字数上限（PRD 6.1） */
export const CUSTOM_MAX_LEN: Record<CustomDimension, number> = {
  type: 10,
  color: 6,
  material: 10
};

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
