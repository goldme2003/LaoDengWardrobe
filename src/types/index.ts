/** 用户性别（用于属性预置过滤与尺码默认值，v0.5 可在「我的」页修改） */
export type Gender = 'male' | 'female';

/** 衣橱风格主题 id（v0.5：不同衣橱不同整体风格） */
export type ThemeId = 'warm' | 'ocean' | 'mint' | 'honey' | 'rose' | 'ink';

/** 衣橱（一位用户的独立衣物集合） */
export interface Wardrobe {
  id: string;
  /** 衣橱主人称呼（≤10 字），v0.7.0 起可在「我的」页修改；命名规则不含称呼，修改不影响已有衣物名称 */
  name: string;
  /** 衣橱主题色（取自所选风格主题的主色） */
  color: string;
  /** 用户性别（v0.5） */
  gender: Gender;
  /** 用户年龄（v0.5，null = 未填写） */
  age: number | null;
  /** 风格主题（v0.5） */
  themeId: ThemeId;
  createdAt: number;
}

/** 个人身体数据（v0.5：缝纫/尺码参考信息，均为选填） */
export interface BodyProfile {
  /** 身高 cm */
  height?: number;
  /** 体重 kg */
  weight?: number;
  /** 胸围 cm */
  bust?: number;
  /** 腰围 cm */
  waist?: number;
  /** 臀围 cm */
  hip?: number;
  /** 肩宽 cm */
  shoulderWidth?: number;
  /** 肩围 cm */
  shoulder?: number;
  /** 臂展 cm */
  armSpan?: number;
  /** 领围 cm（补充） */
  neck?: number;
  /** 裤长 cm（补充） */
  inseam?: number;
  /** 腿围 cm（补充） */
  thigh?: number;
  /** 脚长 mm（鞋码参考，补充） */
  footLength?: number;
  /** 常用上衣尺码（v0.7.0：如 170/175/M/L 等，字符串兼容字母码与数字码） */
  topSize?: string;
  /** 常用裤装尺码（v0.7.0：24–40 腰围档位） */
  pantsSize?: string;
  /** 常用鞋码（v0.7.0：如 38/40 等） */
  shoeSize?: string;
}

/** 购入信息（v0.5，均为选填） */
export interface PurchaseInfo {
  /** 购入时间 YYYY-MM-DD */
  date?: string;
  /** 购入地点/渠道 */
  place?: string;
  /** 价格（元） */
  price?: string;
  /** 购买凭证/小票照片（购买时可拍照） */
  photo?: string;
}

/** 备选条目（准备购入：购入前试穿/展示的图片与信息，v0.5） */
export interface TryoutItem {
  id: string;
  wardrobeId: string;
  /** 试穿/展示图片 */
  photos: string[];
  /** 备选名称 */
  name: string;
  /** 期望服装类型（转正式时预填） */
  type?: string;
  color?: string;
  brand?: string;
  size?: string;
  /** 期望价格（元） */
  price?: string;
  /** 试穿感受/备注 */
  note?: string;
  createdAt: number;
}

/** 衣物条目 */
export interface ClothingItem {
  id: string;
  wardrobeId: string;
  /** 照片组 1-9 张，第 1 张为主图 */
  photos: string[];
  /** 系统自动命名：服装类型-编号（v0.7.0 起不含称呼前缀）；允许手动修改 */
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
  /** 穿着季节（必填，1-4 项）：春/夏/秋/冬 */
  seasons: string[];
  /** 尺码（选填）：XS/S/M/L/XL/XXL 或自定义，可按个人信息给默认值 */
  size: string;
  /** 品牌（选填，≤20 字） */
  brand: string;
  /** 适用场合（选填，多选）：日常/通勤/运动/正式/居家/旅行 */
  occasions: string[];
  /** 购入信息（v0.5，选填） */
  purchase?: PurchaseInfo;
  /** 喜爱标记 */
  favorite: boolean;
  /** 备注 ≤200 字，可空 */
  remark: string;
  createdAt: number;
}

/** 自定义选项维度（v0.5：扩展至尺码与适用场合） */
export type CustomDimension = 'type' | 'color' | 'material' | 'size' | 'occasion';

/** 自定义选项 */
export interface CustomOption {
  dimension: CustomDimension;
  value: string;
}

/** 着装日记条目（v0.6：按日期记录当天着装照片） */
export interface DiaryEntry {
  id: string;
  wardrobeId: string;
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 当天着装照片 1-9 张 */
  photos: string[];
  createdAt: number;
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
  /** v1.2.1：true 表示云端不可用、回退的本地模拟数据（用于界面角标提示） */
  mock?: boolean;
  /** v1.2.1：云端不可用原因（仅 mock = true 时有值，供诊断展示） */
  notice?: string;
}

/** 新建衣物入参（必填属性在保存时校验；尺码/品牌/场合/购入信息为选填扩展属性） */
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
  purchase?: PurchaseInfo;
  remark: string;
}
