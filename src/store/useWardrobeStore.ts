import { create } from 'zustand';
import Taro from '@tarojs/taro';
import {
  Wardrobe, ClothingItem, CustomDimension, CustomOption,
  NewItemInput, PurchaseInfo, TryoutItem, ThemeId
} from '@/types';
import { genId, pad3 } from '@/utils/format';
import {
  CUSTOM_MAX_LEN, WARDROBE_NAME_MAX_LEN, TYPE_PRESETS, COLOR_PRESETS,
  MATERIAL_PRESETS, SIZE_OPTIONS, OCCASION_OPTIONS, THEME_SETS, getTheme
} from '@/data/presets';

const STORAGE_KEY = 'ldw_data_v2';
interface LdwData {
  wardrobes: Wardrobe[]; currentWardrobeId: string;
  items: ClothingItem[]; tryouts: TryoutItem[]; customOptions: CustomOption[];
  favoriteBrands: string[]; counters: Record<string, number>;
  city: string; schemaVersion: number;
}
const counterKey = (wId: string, t: string) => `${wId}__${t}`;
const initialWardrobe = (): Wardrobe => {
  const t = THEME_SETS[0];
  return { id: genId(), name: '我的', color: t.color, themeId: t.id, gender: '', age: null, bodyInfo: {}, createdAt: Date.now() };
};
const initialData = (): LdwData => {
  const w = initialWardrobe();
  return { wardrobes: [w], currentWardrobeId: w.id, items: [], tryouts: [], customOptions: [], favoriteBrands: [], counters: {}, city: '', schemaVersion: 2 };
};
const migrate = (raw: any): LdwData => {
  raw.wardrobes = (raw.wardrobes || []).map((w: any) => {
    const color = w.color || THEME_SETS[0].color;
    const theme = THEME_SETS.find((t) => t.color === color) || THEME_SETS[0];
    return { ...w, color, themeId: w.themeId || theme.id, gender: (w.gender as any) || '', age: (w.age ?? null), bodyInfo: w.bodyInfo || {} };
  });
  raw.items = (raw.items || []).map((it: any) => ({ ...it, purchase: it.purchase || {} }));
  raw.tryouts = raw.tryouts || []; raw.favoriteBrands = raw.favoriteBrands || [];
  raw.customOptions = raw.customOptions || []; raw.counters = raw.counters || {};
  raw.city = raw.city || ''; raw.schemaVersion = 2;
  return raw;
};
const loadData = (): LdwData => {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY) as any;
    if (raw && raw.wardrobes && raw.wardrobes.length > 0) {
      return (raw.schemaVersion ?? 1) < 2 ? migrate(raw) : (raw as LdwData);
    }
  } catch {}
  return initialData();
};
const persistData = (data: LdwData) => { try { Taro.setStorageSync(STORAGE_KEY, data); } catch {} };

export interface WardrobeStore extends LdwData {
  currentWardrobe: () => Wardrobe | undefined;
  currentItems: () => ClothingItem[];
  currentTryouts: () => TryoutItem[];
  addWardrobe: (name: string, themeId?: ThemeId, gender?: Wardrobe['gender'], age?: number | null) => boolean;
  updateWardrobe: (id: string, patch: Partial<Omit<Wardrobe, 'id' | 'name' | 'createdAt'>>) => void;
  setCurrentWardrobe: (id: string) => void;
  deleteWardrobe: (id: string) => void;
  addItem: (input: NewItemInput) => ClothingItem;
  updateItem: (id: string, patch: Partial<NewItemInput> & { name?: string }) => void;
  toggleFavorite: (id: string) => void;
  deleteItem: (id: string) => void;
  addTryout: (photo: string, description: string, extraPhotos?: string[], source?: string) => TryoutItem;
  updateTryout: (id: string, patch: Partial<Omit<TryoutItem, 'id' | 'wardrobeId' | 'createdAt'>>) => void;
  deleteTryout: (id: string) => void;
  addCustomOption: (dimension: CustomDimension, value: string) => string | null;
  removeCustomOption: (dimension: CustomDimension, value: string) => void;
  isCustomOptionUsed: (dimension: CustomDimension, value: string) => boolean;
  toggleFavoriteBrand: (brand: string) => void;
  isFavoriteBrand: (brand: string) => boolean;
  setCity: (city: string) => void;
}

export const useWardrobeStore = create<WardrobeStore>((set, get) => {
  const commit = (partial: Partial<LdwData>) => {
    set(partial); const s = get();
    persistData({
      wardrobes: s.wardrobes, currentWardrobeId: s.currentWardrobeId,
      items: s.items, tryouts: s.tryouts, customOptions: s.customOptions,
      favoriteBrands: s.favoriteBrands, counters: s.counters, city: s.city, schemaVersion: s.schemaVersion
    });
  };
  return {
    ...loadData(),
    currentWardrobe: () => get().wardrobes.find((w) => w.id === get().currentWardrobeId),
    currentItems: () => get().items.filter((it) => it.wardrobeId === get().currentWardrobeId).sort((a, b) => b.createdAt - a.createdAt),
    currentTryouts: () => get().tryouts.filter((t) => t.wardrobeId === get().currentWardrobeId).sort((a, b) => b.createdAt - a.createdAt),

    addWardrobe: (name, themeId, gender, age) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > WARDROBE_NAME_MAX_LEN) return false;
      if (get().wardrobes.some((w) => w.name === trimmed)) return false;
      const theme = getTheme(themeId || THEME_SETS[0].id);
      const w: Wardrobe = { id: genId(), name: trimmed, color: theme.color, themeId: theme.id, gender: gender || '', age: age ?? null, bodyInfo: {}, createdAt: Date.now() };
      commit({ wardrobes: [...get().wardrobes, w], currentWardrobeId: w.id });
      return true;
    },

    updateWardrobe: (id, patch) => {
      const s = get(); const w = s.wardrobes.find((x) => x.id === id); if (!w) return;
      const merged: Wardrobe = { ...w, ...patch };
      if (patch.themeId && !patch.color) merged.color = getTheme(patch.themeId).color;
      commit({ wardrobes: s.wardrobes.map((x) => (x.id === id ? merged : x)) });
    },

    setCurrentWardrobe: (id) => { if (get().wardrobes.some((w) => w.id === id)) commit({ currentWardrobeId: id }); },

    deleteWardrobe: (id) => {
      const s = get(); if (s.wardrobes.length <= 1) return;
      const wardrobes = s.wardrobes.filter((w) => w.id !== id);
      const items = s.items.filter((it) => it.wardrobeId !== id);
      const tryouts = s.tryouts.filter((t) => t.wardrobeId !== id);
      const counters = { ...s.counters }; Object.keys(counters).forEach((k) => { if (k.startsWith(`${id}__`)) delete counters[k]; });
      const currentWardrobeId = s.currentWardrobeId === id ? wardrobes[0].id : s.currentWardrobeId;
      commit({ wardrobes, items, tryouts, counters, currentWardrobeId });
    },

    addItem: (input) => {
      const wardrobe = get().currentWardrobe(); if (!wardrobe) throw new Error('当前衣橱不存在');
      const key = counterKey(wardrobe.id, input.type); const no = (get().counters[key] || 0) + 1;
      const item: ClothingItem = {
        id: genId(), wardrobeId: wardrobe.id, photos: input.photos,
        name: `${wardrobe.name}-${input.type}-${pad3(no)}`, renamed: false,
        type: input.type, layer: input.layer, color: input.color, material: input.material,
        seasons: input.seasons, size: input.size || '', brand: (input.brand || '').trim(),
        occasions: input.occasions || [], purchase: input.purchase || {},
        favorite: false, remark: input.remark, createdAt: Date.now()
      };
      commit({ items: [item, ...get().items], counters: { ...get().counters, [key]: no } });
      return item;
    },

    updateItem: (id, patch) => {
      const s = get(); const item = s.items.find((it) => it.id === id); if (!item) return;
      const { name: patchName, ...rest } = patch;
      const updated: ClothingItem = { ...item, ...rest as any, ...(patchName !== undefined ? { name: patchName } : {}) };
      if (patchName !== undefined && patchName !== item.name) updated.renamed = true;
      if (patch.type && patch.type !== item.type && !updated.renamed) {
        const wardrobe = s.wardrobes.find((w) => w.id === item.wardrobeId);
        if (wardrobe) {
          const key = counterKey(wardrobe.id, patch.type); const no = (s.counters[key] || 0) + 1;
          updated.name = `${wardrobe.name}-${patch.type}-${pad3(no)}`;
          commit({ items: s.items.map((it) => (it.id === id ? updated : it)), counters: { ...s.counters, [key]: no } });
          return;
        }
      }
      commit({ items: s.items.map((it) => (it.id === id ? updated : it)) });
    },

    toggleFavorite: (id) => {
      const item = get().items.find((it) => it.id === id); if (!item) return;
      commit({ items: get().items.map((it) => (it.id === id ? { ...it, favorite: !it.favorite } : it)) });
    },
    deleteItem: (id) => commit({ items: get().items.filter((it) => it.id !== id) }),

    addTryout: (photo, description, extraPhotos, source) => {
      const wardrobe = get().currentWardrobe(); if (!wardrobe) throw new Error('当前衣橱不存在');
      const t: TryoutItem = { id: genId(), wardrobeId: wardrobe.id, photo, extraPhotos: extraPhotos || [], description, source, createdAt: Date.now() };
      commit({ tryouts: [t, ...get().tryouts] }); return t;
    },
    updateTryout: (id, patch) => commit({ tryouts: get().tryouts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
    deleteTryout: (id) => commit({ tryouts: get().tryouts.filter((t) => t.id !== id) }),

    addCustomOption: (dimension, value) => {
      const trimmed = value.trim(); if (!trimmed) return '选项内容不能为空';
      if (trimmed.length > CUSTOM_MAX_LEN[dimension]) return `最多 ${CUSTOM_MAX_LEN[dimension]} 个字`;
      const s = get();
      const exists = s.customOptions.some((o) => o.dimension === dimension && o.value === trimmed) || getDimensionPreset(dimension).includes(trimmed);
      if (exists) return '该选项已存在';
      commit({ customOptions: [...s.customOptions, { dimension, value: trimmed }] }); return null;
    },
    removeCustomOption: (dimension, value) => {
      if (get().isCustomOptionUsed(dimension, value)) return;
      commit({ customOptions: get().customOptions.filter((o) => !(o.dimension === dimension && o.value === value)) });
    },
    isCustomOptionUsed: (dimension, value) => {
      if (dimension === 'occasion') return get().items.some((it) => (it.occasions || []).includes(value));
      const field: keyof ClothingItem = dimension === 'type' ? 'type' : dimension === 'color' ? 'color' : dimension === 'material' ? 'material' : dimension === 'size' ? 'size' : 'type';
      return get().items.some((it) => (it as any)[field] === value);
    },

    toggleFavoriteBrand: (brand) => {
      const b = brand.trim(); if (!b) return;
      const fav = get().favoriteBrands.includes(b) ? get().favoriteBrands.filter((x) => x !== b) : [...get().favoriteBrands, b];
      commit({ favoriteBrands: fav });
    },
    isFavoriteBrand: (brand) => get().favoriteBrands.includes(brand),

    setCity: (city) => commit({ city })
  };
});

export const getDimensionPreset = (dimension: CustomDimension): string[] => {
  if (dimension === 'type') return TYPE_PRESETS;
  if (dimension === 'color') return COLOR_PRESETS.map((c) => c.name);
  if (dimension === 'material') return MATERIAL_PRESETS;
  if (dimension === 'size') return SIZE_OPTIONS;
  if (dimension === 'occasion') return OCCASION_OPTIONS;
  return [];
};
