import { create } from 'zustand';
import Taro from '@tarojs/taro';
import {
  Wardrobe,
  Gender,
  ThemeId,
  ClothingItem,
  BodyProfile,
  TryoutItem,
  CustomDimension,
  CustomOption,
  NewItemInput
} from '@/types';
import { genId, pad3 } from '@/utils/format';
import {
  CUSTOM_MAX_LEN,
  WARDROBE_NAME_MAX_LEN,
  TYPE_PRESETS,
  COLOR_PRESETS,
  MATERIAL_PRESETS,
  SIZE_OPTIONS,
  OCCASION_OPTIONS,
  getThemeById,
  DEFAULT_THEME_ID
} from '@/data/presets';

const STORAGE_KEY = 'ldw_data_v1';

interface LdwData {
  wardrobes: Wardrobe[];
  currentWardrobeId: string;
  items: ClothingItem[];
  customOptions: CustomOption[];
  /** 编号计数器：key = 衣橱id__服装类型 */
  counters: Record<string, number>;
  /** 天气城市（空 = 未选择） */
  city: string;
  /** 个人身体数据（v0.5，缝纫基本信息） */
  bodyProfile: BodyProfile;
  /** 喜爱品牌（v0.5，品牌下拉中前置展示） */
  favoriteBrands: string[];
  /** 备选条目（v0.5，准备购入） */
  tryoutItems: TryoutItem[];
}

const initialData = (): LdwData => {
  const w: Wardrobe = {
    id: genId(),
    name: '我的',
    color: getThemeById(DEFAULT_THEME_ID).primary,
    gender: 'female',
    age: null,
    themeId: DEFAULT_THEME_ID,
    createdAt: Date.now()
  };
  return {
    wardrobes: [w],
    currentWardrobeId: w.id,
    items: [],
    customOptions: [],
    counters: {},
    city: '',
    bodyProfile: {},
    favoriteBrands: [],
    tryoutItems: []
  };
};

/** 旧数据迁移：补齐 v0.3 主题色与 v0.5 新字段 */
const migrateWardrobe = (w: Wardrobe): Wardrobe => {
  const themeId = w.themeId || DEFAULT_THEME_ID;
  return {
    ...w,
    themeId,
    color: w.color || getThemeById(themeId).primary,
    gender: w.gender || 'female',
    age: w.age === undefined ? null : w.age
  };
};

const loadData = (): LdwData => {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEY) as LdwData | '';
    if (stored && stored.wardrobes && stored.wardrobes.length > 0) {
      stored.wardrobes = stored.wardrobes.map(migrateWardrobe);
      stored.bodyProfile = stored.bodyProfile || {};
      stored.favoriteBrands = stored.favoriteBrands || [];
      stored.tryoutItems = stored.tryoutItems || [];
      console.info('[Store] 读取本地数据成功, 衣橱数 =', stored.wardrobes.length, '衣物数 =', stored.items.length);
      return stored;
    }
  } catch (e) {
    console.error('[Store] 读取本地数据失败', e);
  }
  return initialData();
};

const persistData = (data: LdwData): void => {
  try {
    Taro.setStorageSync(STORAGE_KEY, data);
  } catch (e) {
    console.error('[Store] 持久化失败', e);
  }
};

const counterKey = (wardrobeId: string, type: string): string => `${wardrobeId}__${type}`;

export interface NewTryoutInput {
  photos: string[];
  name: string;
  type?: string;
  color?: string;
  brand?: string;
  size?: string;
  price?: string;
  note?: string;
}

export interface WardrobeStore extends LdwData {
  /** 当前衣橱对象 */
  currentWardrobe: () => Wardrobe | undefined;
  /** 当前衣橱下的衣物（录入时间倒序） */
  currentItems: () => ClothingItem[];
  /** 新建衣橱（v0.5：含风格主题/性别/年龄），重名返回 false（PRD FR-01） */
  addWardrobe: (name: string, themeId: ThemeId, gender: Gender, age: number | null) => boolean;
  /** 切换衣橱 */
  setCurrentWardrobe: (id: string) => void;
  /** 更新衣橱设置（v0.5：性别/年龄/风格主题，可在「我的」页修改） */
  updateWardrobe: (id: string, patch: Partial<Pick<Wardrobe, 'gender' | 'age' | 'themeId'>>) => void;
  /** 删除衣橱（连带删除衣物），最后一个衣橱不可删除 */
  deleteWardrobe: (id: string) => void;
  /** 新增衣物，自动命名（PRD 6.2） */
  addItem: (input: NewItemInput) => ClothingItem;
  /** 更新衣物（含改名/改类型的命名联动） */
  updateItem: (id: string, patch: Partial<NewItemInput> & { name?: string }) => void;
  /** 切换喜爱（PRD FR-04） */
  toggleFavorite: (id: string) => void;
  /** 删除衣物，编号不回收（PRD FR-08） */
  deleteItem: (id: string) => void;
  /** 新增自定义选项（类型/颜色/材质/尺码/场合），失败返回错误文案 */
  addCustomOption: (dimension: CustomDimension, value: string) => string | null;
  /** 删除未被使用的自定义选项 */
  removeCustomOption: (dimension: CustomDimension, value: string) => void;
  /** 自定义选项是否已被衣物使用 */
  isCustomOptionUsed: (dimension: CustomDimension, value: string) => boolean;
  /** 更新个人身体数据（v0.5） */
  updateBodyProfile: (patch: Partial<BodyProfile>) => void;
  /** 切换喜爱品牌（v0.5） */
  toggleFavoriteBrand: (brand: string) => void;
  /** 新增备选条目（v0.5） */
  addTryout: (input: NewTryoutInput) => TryoutItem;
  /** 更新备选条目 */
  updateTryout: (id: string, patch: Partial<NewTryoutInput>) => void;
  /** 删除备选条目（转正式或手动删除） */
  deleteTryout: (id: string) => void;
  /** 设置天气城市 */
  setCity: (city: string) => void;
}

export const useWardrobeStore = create<WardrobeStore>((set, get) => {
  const commit = (partial: Partial<LdwData>) => {
    set(partial);
    const s = get();
    persistData({
      wardrobes: s.wardrobes,
      currentWardrobeId: s.currentWardrobeId,
      items: s.items,
      customOptions: s.customOptions,
      counters: s.counters,
      city: s.city,
      bodyProfile: s.bodyProfile,
      favoriteBrands: s.favoriteBrands,
      tryoutItems: s.tryoutItems
    });
  };

  return {
    ...loadData(),

    currentWardrobe: () => get().wardrobes.find((w) => w.id === get().currentWardrobeId),

    currentItems: () =>
      get()
        .items.filter((it) => it.wardrobeId === get().currentWardrobeId)
        .sort((a, b) => b.createdAt - a.createdAt),

    addWardrobe: (name, themeId, gender, age) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > WARDROBE_NAME_MAX_LEN) {
        return false;
      }
      if (get().wardrobes.some((w) => w.name === trimmed)) {
        console.warn('[Store] 衣橱重名, name =', trimmed);
        return false;
      }
      const w: Wardrobe = {
        id: genId(),
        name: trimmed,
        color: getThemeById(themeId).primary,
        themeId,
        gender,
        age,
        createdAt: Date.now()
      };
      console.info('[Store] 新建衣橱, name =', trimmed, 'theme =', themeId);
      commit({
        wardrobes: [...get().wardrobes, w],
        currentWardrobeId: w.id
      });
      return true;
    },

    setCurrentWardrobe: (id) => {
      if (!get().wardrobes.some((w) => w.id === id)) {
        console.warn('[Store] 衣橱不存在, id =', id);
        return;
      }
      commit({ currentWardrobeId: id });
    },

    updateWardrobe: (id, patch) => {
      const s = get();
      const target = s.wardrobes.find((w) => w.id === id);
      if (!target) {
        console.warn('[Store] 衣橱不存在, id =', id);
        return;
      }
      const next: Wardrobe = { ...target, ...patch };
      // 主题变更时联动更新主题色
      if (patch.themeId && patch.themeId !== target.themeId) {
        next.color = getThemeById(patch.themeId).primary;
      }
      console.info('[Store] 更新衣橱设置, id =', id, 'patch =', JSON.stringify(patch));
      commit({ wardrobes: s.wardrobes.map((w) => (w.id === id ? next : w)) });
    },

    deleteWardrobe: (id) => {
      const s = get();
      if (s.wardrobes.length <= 1) {
        console.warn('[Store] 最后一个衣橱不可删除');
        return;
      }
      if (!s.wardrobes.some((w) => w.id === id)) {
        return;
      }
      const wardrobes = s.wardrobes.filter((w) => w.id !== id);
      const items = s.items.filter((it) => it.wardrobeId !== id);
      const tryoutItems = s.tryoutItems.filter((t) => t.wardrobeId !== id);
      const counters = { ...s.counters };
      Object.keys(counters).forEach((key) => {
        if (key.startsWith(`${id}__`)) {
          delete counters[key];
        }
      });
      const currentWardrobeId = s.currentWardrobeId === id ? wardrobes[0].id : s.currentWardrobeId;
      console.info('[Store] 删除衣橱, id =', id, '剩余衣橱 =', wardrobes.length);
      commit({ wardrobes, items, tryoutItems, counters, currentWardrobeId });
    },

    addItem: (input) => {
      const s = get();
      const wardrobe = s.currentWardrobe();
      if (!wardrobe) {
        console.error('[Store] 当前衣橱不存在，无法保存衣物');
        throw new Error('当前衣橱不存在');
      }
      const key = counterKey(wardrobe.id, input.type);
      const no = (s.counters[key] || 0) + 1;
      const item: ClothingItem = {
        id: genId(),
        wardrobeId: wardrobe.id,
        photos: input.photos,
        name: `${wardrobe.name}-${input.type}-${pad3(no)}`,
        renamed: false,
        type: input.type,
        layer: input.layer,
        color: input.color,
        material: input.material,
        seasons: input.seasons,
        size: input.size || '',
        brand: (input.brand || '').trim(),
        occasions: input.occasions || [],
        ...(input.purchase ? { purchase: input.purchase } : {}),
        favorite: false,
        remark: input.remark,
        createdAt: Date.now()
      };
      console.info('[Store] 新增衣物, name =', item.name);
      commit({
        items: [item, ...s.items],
        counters: { ...s.counters, [key]: no }
      });
      return item;
    },

    updateItem: (id, patch) => {
      const s = get();
      const item = s.items.find((it) => it.id === id);
      if (!item) {
        console.warn('[Store] 衣物不存在, id =', id);
        return;
      }
      const { name: patchName, ...rest } = patch;
      // 不把 undefined 合并进条目，避免空值覆盖已有字段（如名称）
      const updated: ClothingItem = {
        ...item,
        ...rest,
        ...(patchName !== undefined ? { name: patchName } : {})
      };

      // 用户手动改名（PRD 6.2 第 5 条）
      if (patchName !== undefined && patchName !== item.name) {
        updated.renamed = true;
      }

      // 修改服装类型且未手动改名时，名称联动更新
      if (patch.type && patch.type !== item.type && !updated.renamed) {
        const wardrobe = s.wardrobes.find((w) => w.id === item.wardrobeId);
        if (wardrobe) {
          const key = counterKey(wardrobe.id, patch.type);
          const no = (s.counters[key] || 0) + 1;
          updated.name = `${wardrobe.name}-${patch.type}-${pad3(no)}`;
          commit({
            items: s.items.map((it) => (it.id === id ? updated : it)),
            counters: { ...s.counters, [key]: no }
          });
          console.info('[Store] 类型变更联动改名, name =', updated.name);
          return;
        }
      }

      console.info('[Store] 更新衣物, id =', id);
      commit({ items: s.items.map((it) => (it.id === id ? updated : it)) });
    },

    toggleFavorite: (id) => {
      const s = get();
      const item = s.items.find((it) => it.id === id);
      if (!item) return;
      commit({ items: s.items.map((it) => (it.id === id ? { ...it, favorite: !it.favorite } : it)) });
    },

    deleteItem: (id) => {
      console.info('[Store] 删除衣物, id =', id);
      commit({ items: get().items.filter((it) => it.id !== id) });
    },

    addCustomOption: (dimension, value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return '选项内容不能为空';
      }
      if (trimmed.length > CUSTOM_MAX_LEN[dimension]) {
        return `最多 ${CUSTOM_MAX_LEN[dimension]} 个字`;
      }
      const s = get();
      const exists =
        s.customOptions.some((o) => o.dimension === dimension && o.value === trimmed) ||
        getDimensionPreset(dimension).includes(trimmed);
      if (exists) {
        return '该选项已存在';
      }
      commit({ customOptions: [...s.customOptions, { dimension, value: trimmed }] });
      return null;
    },

    removeCustomOption: (dimension, value) => {
      if (get().isCustomOptionUsed(dimension, value)) {
        console.warn('[Store] 自定义选项已被使用，不可删除');
        return;
      }
      commit({
        customOptions: get().customOptions.filter(
          (o) => !(o.dimension === dimension && o.value === value)
        )
      });
    },

    isCustomOptionUsed: (dimension, value) => {
      if (dimension === 'type') return get().items.some((it) => it.type === value);
      if (dimension === 'color') return get().items.some((it) => it.color === value);
      if (dimension === 'material') return get().items.some((it) => it.material === value);
      if (dimension === 'size') return get().items.some((it) => it.size === value);
      return get().items.some((it) => (it.occasions || []).includes(value));
    },

    updateBodyProfile: (patch) => {
      const s = get();
      const next: BodyProfile = { ...s.bodyProfile };
      Object.keys(patch).forEach((k) => {
        const key = k as keyof BodyProfile;
        const v = patch[key];
        // 空值删除字段，避免无效数据
        if (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) {
          delete next[key];
        } else {
          next[key] = v;
        }
      });
      commit({ bodyProfile: next });
    },

    toggleFavoriteBrand: (brand) => {
      const trimmed = brand.trim();
      if (!trimmed) return;
      const list = get().favoriteBrands;
      const next = list.includes(trimmed)
        ? list.filter((b) => b !== trimmed)
        : [...list, trimmed];
      console.info('[Store] 喜爱品牌切换, brand =', trimmed, '喜爱 =', next.includes(trimmed));
      commit({ favoriteBrands: next });
    },

    addTryout: (input) => {
      const s = get();
      const item: TryoutItem = {
        id: genId(),
        wardrobeId: s.currentWardrobeId,
        photos: input.photos,
        name: (input.name || '').trim() || '未命名备选',
        type: input.type,
        color: input.color,
        brand: (input.brand || '').trim(),
        size: input.size,
        price: input.price,
        note: input.note,
        createdAt: Date.now()
      };
      console.info('[Store] 新增备选, name =', item.name);
      commit({ tryoutItems: [item, ...s.tryoutItems] });
      return item;
    },

    updateTryout: (id, patch) => {
      const s = get();
      const item = s.tryoutItems.find((t) => t.id === id);
      if (!item) {
        console.warn('[Store] 备选不存在, id =', id);
        return;
      }
      const updated: TryoutItem = { ...item, ...patch };
      if (patch.name !== undefined && patch.name.trim()) {
        updated.name = patch.name.trim();
      }
      commit({ tryoutItems: s.tryoutItems.map((t) => (t.id === id ? updated : t)) });
    },

    deleteTryout: (id) => {
      console.info('[Store] 删除备选, id =', id);
      commit({ tryoutItems: get().tryoutItems.filter((t) => t.id !== id) });
    },

    setCity: (city) => {
      commit({ city });
    }
  };
});

/** 各维度预设选项名列表 */
export const getDimensionPreset = (dimension: CustomDimension): string[] => {
  if (dimension === 'type') return TYPE_PRESETS;
  if (dimension === 'color') return COLOR_PRESETS.map((c) => c.name);
  if (dimension === 'size') return SIZE_OPTIONS;
  if (dimension === 'occasion') return OCCASION_OPTIONS;
  return MATERIAL_PRESETS;
};
