/** 衣橱（一位用户的独立衣物集合） */
export interface Wardrobe {
  id: string;
  /** 用户名称，即命名规则中的「用户」，创建后不可修改 */
  name: string;
  /** 衣橱主题色（切换衣橱时联动界面主题） */
  color: string;
  createdAt: number;
}

/** 衣物条目 */
export interface ClothingItem {
  id: string;
  wardrobeId: string;
  /** 照片组 1-9 张，第 1 张为主图 */
  photos: string[];
  /** 系统自动命名：用户-服装类型-编号；允许手动修改 */
  name: string;
  /** 用户是否手动修改过名称 */
  renamed: boolean;
  /** 服装类型（必填） */
  type: string;
  /** 内外穿（必填）：内穿 / 外穿 */
  layer: string;
  /** 颜色（必填） */
  color: string;
  /** 材质（必填） */
  material: string;
  /** 季节（必填，1-4 项）：春/夏/秋/冬 */
  seasons: string[];
  /** 尺码（选填）：XS/S/M/L/XL/XXL 或自定义 */
  size: string;
  /** 品牌（选填，≤20 字） */
  brand: string;
  /** 适用场合（选填，多选）：日常/通勤/运动/正式/居家/旅行 */
  occasions: string[];
  /** 喜爱标记 */
  favorite: boolean;
  /** 备注 ≤200 字，可空 */
  remark: string;
  createdAt: number;
}

/** 自定义选项维度 */
export type CustomDimension = 'type' | 'color' | 'material';

/** 自定义选项 */
export interface CustomOption {
  dimension: CustomDimension;
  value: string;
}

/** 天气单日信息 */
export interface WeatherDay {
  date: string;
  cond: string;
  low: number;
  high: number;
}

/** 天气信息（MVP 为模拟数据，数据源见 PRD Q-1） */
export interface WeatherInfo {
  city: string;
  today: WeatherDay;
  days: WeatherDay[];
}

/** 新建衣物入参（必填属性在保存时校验；尺码/品牌/场合为选填扩展属性） */
export interface NewItemInput {
  photos: string[];
  type: string;
  layer: string;
  color: string;
  material: string;
  seasons: string[];
  size: string;
  brand: string;
  occasions: string[];
  remark: string;
}
