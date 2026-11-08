// v0.5 数据模型 —— 衣物管理小程序
export const APP_VERSION = 'v0.5.0';
export const APP_BUILD = 500;

export type Gender = 'male' | 'female' | 'other' | '';
export type ThemeId = 'warm' | 'ocean' | 'mint' | 'lavender' | 'sunrise' | 'sakura' | 'mono' | 'denim';

export interface ThemeSet {
  id: ThemeId; label: string; color: string; bgCard: string; accent: string; shadow: string; warm?: boolean;
}

export interface BodyInfo {
  height?: number; weight?: number; bust?: number; waist?: number; hip?: number;
  shoulderWidth?: number; armSpan?: number; inseam?: number; neck?: number; wrist?: number;
}

export interface Wardrobe {
  id: string; name: string; color: string; themeId: ThemeId;
  gender: Gender; age: number | null; bodyInfo: BodyInfo; createdAt: number;
}

export interface PurchaseInfo {
  date?: string; location?: string; photo?: string; channel?: string; price?: number;
}

export interface ClothingItem {
  id: string; wardrobeId: string; photos: string[];
  name: string; renamed: boolean;
  type: string; layer: string; color: string; material: string;
  seasons: string[]; size: string; brand: string; occasions: string[];
  purchase: PurchaseInfo; favorite: boolean; remark: string; createdAt: number;
}

export interface TryoutItem {
  id: string; wardrobeId: string; photo: string; extraPhotos: string[];
  description: string; source?: string; createdAt: number;
}

export type CustomDimension = 'type' | 'color' | 'material' | 'size' | 'occasion';

export interface CustomOption { dimension: CustomDimension; value: string; }

export interface WeatherDay { date: string; cond: string; low: number; high: number; }
export interface WeatherInfo { city: string; today: WeatherDay; days: WeatherDay[]; }

export interface NewItemInput {
  photos: string[]; type: string; layer: string; color: string; material: string;
  seasons: string[]; size: string; brand: string; occasions: string[]; remark: string; purchase?: PurchaseInfo;
}
