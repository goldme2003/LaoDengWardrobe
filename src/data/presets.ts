import { CustomDimension, Gender, ThemeSet } from '@/types';

export const THEME_SETS: ThemeSet[] = [
  { id: 'warm',     label: '温暖砖红', color: '#E8684A', bgCard: '#FFF6F1', accent: '#C24A2E', shadow: '0 2rpx 12rpx rgba(232,104,74,.12)', warm: true },
  { id: 'ocean',    label: '海洋蓝',   color: '#3B6FB5', bgCard: '#F0F6FB', accent: '#274F87', shadow: '0 2rpx 12rpx rgba(59,111,181,.12)' },
  { id: 'mint',     label: '薄荷绿',   color: '#4C9E5E', bgCard: '#F2FAF4', accent: '#2F6F3F', shadow: '0 2rpx 12rpx rgba(76,158,94,.12)' },
  { id: 'lavender', label: '紫藤紫',   color: '#7E5BB5', bgCard: '#F4EFFA', accent: '#53368A', shadow: '0 2rpx 12rpx rgba(126,91,181,.12)' },
  { id: 'sunrise',  label: '蜜橙',     color: '#F5A623', bgCard: '#FFF7EB', accent: '#C67E14', shadow: '0 2rpx 12rpx rgba(245,166,35,.14)', warm: true },
  { id: 'sakura',   label: '樱花粉',   color: '#EF9BB1', bgCard: '#FFF2F5', accent: '#C66782', shadow: '0 2rpx 12rpx rgba(239,155,177,.14)', warm: true },
  { id: 'mono',     label: '简约黑',   color: '#2B2B2B', bgCard: '#F5F5F5', accent: '#000000', shadow: '0 2rpx 12rpx rgba(0,0,0,.10)' },
  { id: 'denim',    label: '牛仔蓝',   color: '#5B7C99', bgCard: '#F3F6F8', accent: '#3C5770', shadow: '0 2rpx 12rpx rgba(91,124,153,.12)' }
];
export const getTheme = (id: string): ThemeSet => THEME_SETS.find((t) => t.id === id) || THEME_SETS[0];

export const TYPE_PRESETS = ['上装', '裤装', '裙装', '连衣裙', '外套', '内衣', '家居服', '鞋履', '配饰', '其他'];
const EXCLUDE_BY_GENDER: Record<Gender, string[]> = { male: ['裙装', '连衣裙'], female: [], other: [], '': [] };
export const getTypePresetsByGender = (gender: Gender): string[] => {
  const excluded = EXCLUDE_BY_GENDER[gender] || [];
  return TYPE_PRESETS.filter((t) => !excluded.includes(t));
};
export const LAYER_OPTIONS = ['内穿', '外穿'];

export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: '黑色', hex: '#2B2B2B' }, { name: '白色', hex: '#FFFFFF' }, { name: '灰色', hex: '#9E9E9E' },
  { name: '红色', hex: '#D94141' }, { name: '橙色', hex: '#F08C00' }, { name: '黄色', hex: '#F5C542' },
  { name: '绿色', hex: '#4C9E5E' }, { name: '蓝色', hex: '#3B6FB5' }, { name: '紫色', hex: '#7E5BB5' },
  { name: '粉色', hex: '#EF9BB1' }, { name: '棕色', hex: '#8B5E3C' }, { name: '米色', hex: '#E8DCC8' },
  { name: '牛仔蓝', hex: '#5B7C99' }
];
export const COLOR_HEX_MAP: Record<string, string> = COLOR_PRESETS.reduce(
  (m, c) => ({ ...m, [c.name]: c.hex }), {} as Record<string, string>);

export const MATERIAL_PRESETS = ['棉', '麻', '丝绸', '羊毛', '羊绒', '涤纶', '牛仔', '皮革', '羽绒', '醋酸'];
export const SEASON_OPTIONS = ['春', '夏', '秋', '冬'];
export const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const OCCASION_OPTIONS = ['日常', '通勤', '运动', '正式', '居家', '旅行'];
export const BRAND_MAX_LEN = 20;
export const BRAND_PRESETS = [
  '优衣库', 'ZARA', 'H&M', '无印良品', 'GAP', 'COS',
  '耐克', '阿迪达斯', '李宁', '安踏', '波司登', '雅戈尔', '海澜之家', '七匹狼', '恒源祥', '太平鸟'
];
export const buildBrandOptions = (existingItemBrands: string[], favoriteBrands: string[]): string[] => {
  const seen = new Set<string>(); const out: string[] = [];
  for (const b of favoriteBrands) if (!seen.has(b)) { out.push(b); seen.add(b); }
  for (const b of existingItemBrands) if (!seen.has(b)) { out.push(b); seen.add(b); }
  for (const b of BRAND_PRESETS) if (!seen.has(b)) { out.push(b); seen.add(b); }
  return out;
};
export const WARDROBE_COLORS = THEME_SETS.map((t) => t.color);
export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: '男性' }, { value: 'female', label: '女性' },
  { value: 'other', label: '其他' }, { value: '', label: '暂不明确' }
];
export const BODY_FIELDS: { key: keyof import('@/types').BodyInfo; label: string; unit: string }[] = [
  { key: 'height', label: '身高', unit: 'cm' }, { key: 'weight', label: '体重', unit: 'kg' },
  { key: 'shoulderWidth', label: '肩宽', unit: 'cm' }, { key: 'bust', label: '胸围', unit: 'cm' },
  { key: 'waist', label: '腰围', unit: 'cm' }, { key: 'hip', label: '臀围', unit: 'cm' },
  { key: 'armSpan', label: '臂展', unit: 'cm' }, { key: 'inseam', label: '内缝长', unit: 'cm' },
  { key: 'neck', label: '颈围', unit: 'cm' }, { key: 'wrist', label: '手腕围', unit: 'cm' }
];
export const WEATHER_ICONS: Record<string, string> = {
  晴: '☀️', 多云: '⛅', 阴: '☁️', 小雨: '🌧️', 中雨: '🌧️', 大雨: '🌧️',
  阵雨: '🌦️', 雷阵雨: '⛈️', 雪: '❄️', 小雪: '🌨️', 雾: '🌫️', 霾: '😷'
};
export const weatherIcon = (cond: string): string => WEATHER_ICONS[cond] || '🌤️';
export const CUSTOM_MAX_LEN: Record<CustomDimension, number> = { type: 10, color: 6, material: 10, size: 6, occasion: 10 };
export const MAX_PHOTOS = 9;
export const REMARK_MAX_LEN = 200;
export const WARDROBE_NAME_MAX_LEN = 10;
export const ITEM_NAME_MAX_LEN = 20;
export const AGE_MIN = 1;
export const AGE_MAX = 120;
export const SAMPLE_PHOTO_IDS = [103, 119, 220, 225, 230, 250];
export const samplePhoto = (index: number): string =>
  `https://picsum.photos/id/${SAMPLE_PHOTO_IDS[index % SAMPLE_PHOTO_IDS.length]}/300/300`;
export const getSizePresetsByGender = (_g: Gender): string[] => SIZE_OPTIONS;
