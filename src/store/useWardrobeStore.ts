import { create } from 'zustand';
import Taro from '@tarojs/taro';
import {
  Wardrobe,
  Gender,
  ThemeId,
  ClothingItem,
  BodyProfile,
  TryoutItem,
  DiaryEntry,
  CustomDimension,
  CustomOption,
  NewItemInput,
  CitySource,
  SyncMeta
} from '@/types';
import { genId, pad3 } from '@/utils/format';
import {
  MemberTier,
  MemberUsage,
  DailyOutfitCache,
  DailyOutfitEntry,
  initialUsage,
  rolledUsage,
  todayKey
} from '@/services/entitlement';
import { SCENE_OPTIONS } from '@/services/recommend';
import {
  CUSTOM_MAX_LEN,
  WARDROBE_NAME_MAX_LEN,
  TYPE_PRESETS,
  COLOR_PRESETS,
  MATERIAL_PRESETS,
  SIZE_OPTIONS,
  OCCASION_OPTIONS,
  LAYER_OPTIONS,
  SEASON_OPTIONS,
  getThemeById,
  DEFAULT_THEME_ID
} from '@/data/presets';

const STORAGE_KEY = 'ldw_data_v1';

/** v1.12.0：预设场景名（自定义场景与预设去重用） */
const SCENE_PRESET_NAMES = SCENE_OPTIONS.map((s) => s.id as string);

export interface LdwData {
  wardrobes: Wardrobe[];
  currentWardrobeId: string;
  items: ClothingItem[];
  customOptions: CustomOption[];
  /** 编号计数器：key = 衣橱id__服装类型 */
  counters: Record<string, number>;
  /** 天气城市（空 = 未选择） */
  city: string;
  /** v1.8.0（F-17）：城市来源——located = 启动自动定位，manual = 手动选择，空串 = 旧数据/未定位 */
  citySource: CitySource;
  /** 个人身体数据（v0.6：按衣橱归属，key = 衣橱id；切换衣橱联动） */
  bodyProfiles: Record<string, BodyProfile>;
  /** 喜爱品牌（v0.5，品牌下拉中前置展示） */
  favoriteBrands: string[];
  /** 备选条目（v0.5，准备购入） */
  tryoutItems: TryoutItem[];
  /** 着装日记（v0.6） */
  diaryEntries: DiaryEntry[];
  /** 明日穿搭勾选（v0.6：key = 衣橱id，value = 衣物id 数组） */
  tomorrowOutfits: Record<string, string[]>;
  /** 首页待应用筛选预设（v0.6：「我的」页点击喜爱衣物跳转后由首页消费） */
  wardrobeFilterPreset: 'favorite' | null;
  /** v1.9.0（F-19）：会员档位（free / vip / svip），本地记录，云端校验待云同步落地后接入 */
  memberTier: MemberTier;
  /** v1.9.0（F-19）：会员权益用量（当季图组日额度、出差/批量导入/时尚推荐月额度） */
  memberUsage: MemberUsage;
  /** v1.10.0：明日穿搭推荐当天缓存（key = 衣橱id；day 过期由读取侧与写入侧重置） */
  dailyOutfits: Record<string, DailyOutfitCache>;
  /** v1.12.0：自定义搭配场景（推荐卡片「+ 新增场景」手输入库，如 相亲/约会/婚礼），全局共享 */
  customScenes: string[];
  /** v1.15.0（R-5）：云同步元数据（openid / 版本号 / 脏标记，见《云端同步设计方案》5.2） */
  syncMeta: SyncMeta;
  /** v1.15.0（R-5）：同步衣橱选择（null = 未设置，登录后按档位初始化；VIP ≤2 / SVIP 全部） */
  syncWardrobeIds: string[] | null;
  /** v1.15.0（R-5）：云同步开关（登录后默认关闭，用户在「我的 → 云同步」开启，状态持久化在本地） */
  cloudSyncEnabled: boolean;
  /** v2.2.7：删除墓碑（实体 id → 删除时间戳），随云同步上行——
   * 修复「本机删除衣物/日记/备选后，云同步 pull 合并按并集把已删除数据又加回来」的问题 */
  deletedMarks: Record<string, number>;
}

const initialData = (): LdwData => {
  const w: Wardrobe = {
    id: genId(),
    name: '我的',
    color: getThemeById(DEFAULT_THEME_ID).primary,
    gender: 'male',
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
    citySource: '',
    bodyProfiles: {},
    favoriteBrands: [],
    tryoutItems: [],
    diaryEntries: [],
    tomorrowOutfits: {},
    wardrobeFilterPreset: null,
    memberTier: 'free',
    memberUsage: initialUsage(),
    dailyOutfits: {},
    customScenes: [],
    syncMeta: { openid: '', dataVersion: 0, lastSyncedVersion: 0, dirty: false, lastSyncedAt: 0 },
    syncWardrobeIds: null,
    cloudSyncEnabled: false,
    deletedMarks: {}
  };
};

/** 旧数据迁移：补齐 v0.3 主题色与 v0.5 新字段 */
const migrateWardrobe = (w: Wardrobe): Wardrobe => {
  const themeId = w.themeId || DEFAULT_THEME_ID;
  return {
    ...w,
    themeId,
    color: w.color || getThemeById(themeId).primary,
    // v1.15.0：性别默认值改为男性（旧数据缺 gender 时同样兜底为男性）
    gender: w.gender || 'male',
    age: w.age === undefined ? null : w.age
  };
};

const loadData = (): LdwData => {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEY) as LdwData | '';
    if (stored && stored.wardrobes && stored.wardrobes.length > 0) {
      stored.wardrobes = stored.wardrobes.map(migrateWardrobe);
      const raw = stored as LdwData & { bodyProfile?: BodyProfile };
      // v0.6 迁移：旧版全局 bodyProfile 归属到当前衣橱
      let bodyProfiles = raw.bodyProfiles || {};
      if (raw.bodyProfile && Object.keys(raw.bodyProfile).length > 0 && !bodyProfiles[stored.currentWardrobeId]) {
        bodyProfiles = { ...bodyProfiles, [stored.currentWardrobeId]: raw.bodyProfile };
        console.info('[Store] 旧版身体数据已迁移到当前衣橱');
      }
      stored.bodyProfiles = bodyProfiles;
      // v1.1：旧数据缺字段兜底，避免异常数据导致页面崩溃
      stored.customOptions = stored.customOptions || [];
      stored.counters = stored.counters || {};
      // v1.8.0（F-17）：旧数据无城市来源字段，置空（不展示定位图标，待本次定位/手动选城后更新）
      stored.citySource = stored.citySource || '';
      stored.favoriteBrands = stored.favoriteBrands || [];
      stored.tryoutItems = stored.tryoutItems || [];
      stored.diaryEntries = stored.diaryEntries || [];
      stored.tomorrowOutfits = stored.tomorrowOutfits || {};
      stored.wardrobeFilterPreset = null;
      // v1.9.0（F-19）：旧数据无会员字段，默认普通版；用量按天/月窗口滚动重置
      stored.memberTier = stored.memberTier || 'free';
      stored.memberUsage = rolledUsage(stored.memberUsage);
      // v1.10.0：明日推荐当天缓存——跨天后清空（次日重新生成）
      stored.dailyOutfits = stored.dailyOutfits || {};
      Object.keys(stored.dailyOutfits).forEach((wid) => {
        if (stored.dailyOutfits[wid].day !== todayKey()) {
          stored.dailyOutfits[wid] = { day: todayKey(), list: [] };
        }
      });
      // v1.12.0：旧数据无自定义场景字段
      stored.customScenes = Array.isArray(stored.customScenes) ? stored.customScenes : [];
      // v1.15.0（R-5）：旧数据无云同步字段——未登录、无脏数据、开关默认关闭
      stored.syncMeta =
        stored.syncMeta && typeof stored.syncMeta === 'object'
          ? stored.syncMeta
          : { openid: '', dataVersion: 0, lastSyncedVersion: 0, dirty: false, lastSyncedAt: 0 };
      stored.syncWardrobeIds = Array.isArray(stored.syncWardrobeIds) ? stored.syncWardrobeIds : null;
      stored.cloudSyncEnabled = stored.cloudSyncEnabled === true;
      // v2.2.7：删除墓碑（旧数据无此字段）；只保留 30 天内的标记，避免无限增长
      const marks = stored.deletedMarks && typeof stored.deletedMarks === 'object' ? stored.deletedMarks : {};
      const markFloor = Date.now() - 30 * 24 * 3600 * 1000;
      stored.deletedMarks = Object.fromEntries(
        Object.entries(marks).filter(([, ts]) => typeof ts === 'number' && ts >= markFloor)
      );
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
  /** 更新衣橱设置（v0.5：性别/年龄/风格主题；v0.7.0：衣橱主人称呼 name 可修改，不影响衣物名称） */
  updateWardrobe: (id: string, patch: Partial<Pick<Wardrobe, 'name' | 'gender' | 'age' | 'themeId'>>) => void;
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
  /** 当前衣橱主人的个人身体数据（v0.6：随衣橱切换联动） */
  currentBodyProfile: () => BodyProfile;
  /** 更新当前衣橱主人的个人身体数据（v0.6） */
  updateBodyProfile: (patch: Partial<BodyProfile>) => void;
  /** 切换喜爱品牌（v0.5） */
  toggleFavoriteBrand: (brand: string) => void;
  /** 新增备选条目（v0.5） */
  addTryout: (input: NewTryoutInput) => TryoutItem;
  /** 更新备选条目 */
  updateTryout: (id: string, patch: Partial<NewTryoutInput>) => void;
  /** 删除备选条目（转正式或手动删除） */
  deleteTryout: (id: string) => void;
  /** 新增着装日记（v0.6：date 为 YYYY-MM-DD） */
  addDiaryEntry: (date: string, photos: string[]) => DiaryEntry;
  /** 删除着装日记条目 */
  deleteDiaryEntry: (id: string) => void;
  /** 切换明日穿搭勾选（v0.6：作用于当前衣橱） */
  toggleTomorrowItem: (itemId: string) => void;
  /** 一键采纳推荐（v1.4.0 D 阶段）：批量加入当前衣橱明日穿搭勾选，已勾选的自动跳过 */
  adoptTomorrowItems: (itemIds: string[]) => void;
  /** 设置首页待应用筛选预设（v0.6 跳转用） */
  setWardrobeFilterPreset: (preset: 'favorite') => void;
  /** 消费首页筛选预设（首页应用后清空） */
  consumeWardrobeFilterPreset: () => void;
  /** 设置天气城市（v1.8.0 F-17：附带来源 located/manual，缺省视为手动选择） */
  setCity: (city: string, source?: CitySource) => void;
  /** v1.9.0（F-19）：设置会员档位（正式开通走云端校验；开发环境提供切换便于验证各档位） */
  setMemberTier: (tier: MemberTier) => void;
  /** v1.9.0（F-19）：登记今日当季推荐图组已看张数 */
  recordSeasonalView: (count: number) => void;
  /** v1.9.0（F-19）：登记本月出差推荐使用一次 */
  recordTripUse: () => void;
  /** v1.11.0：登记本月批量添加（批量导入）使用一次（单次批量任务 = 1 次） */
  recordBatchImportUse: () => void;
  /** v1.10.0：追加一套今日明日推荐缓存（跨天自动重置；数量上限由调用方按会员档位把关） */
  appendDailyOutfit: (wardrobeId: string, entry: Omit<DailyOutfitEntry, 'id'>) => void;
  /** v1.12.0：新增自定义搭配场景（≤6 字，去重），失败返回错误文案 */
  addCustomScene: (value: string) => string | null;
  /** v1.12.0：删除自定义搭配场景（已被今日推荐缓存引用时不可删除） */
  removeCustomScene: (value: string) => void;
  /** v1.15.0（R-5）：设置云同步开关（仅本地偏好，不打脏不触发上行） */
  setCloudSyncEnabled: (enabled: boolean) => void;
  /** v1.15.0（R-5）：设置同步衣橱选择（仅本地设置，不打脏；上限校验由调用方把关） */
  setSyncWardrobeIds: (ids: string[]) => void;
  /** v1.15.0（R-5）：更新同步元数据（登录/上行成功后校准版本号与脏标记，不打脏） */
  patchSyncMeta: (patch: Partial<SyncMeta>) => void;
  /** v1.15.0（R-5）：回填照片 fileID（照片上传成功后调用，不打脏避免同步死循环） */
  replacePhotoPaths: (
    replacements: { kind: 'item' | 'diary' | 'tryout'; id: string; photos: string[] }[]
  ) => void;
  /** v1.15.0（R-5）：原子写入云端合并结果（递增版本号 + 打脏，随下次 push 上行） */
  applySyncMerge: (partial: Partial<LdwData>) => void;
}

export const useWardrobeStore = create<WardrobeStore>((set, get) => {
  /** v1.15.0（R-5）：全量持久化（含云同步元数据），由 commit 与 patchSyncMeta 复用 */
  const persistAll = (): void => {
    const s = get();
    persistData({
      wardrobes: s.wardrobes,
      currentWardrobeId: s.currentWardrobeId,
      items: s.items,
      customOptions: s.customOptions,
      counters: s.counters,
      city: s.city,
      citySource: s.citySource,
      bodyProfiles: s.bodyProfiles,
      favoriteBrands: s.favoriteBrands,
      tryoutItems: s.tryoutItems,
      diaryEntries: s.diaryEntries,
      tomorrowOutfits: s.tomorrowOutfits,
      memberTier: s.memberTier,
      memberUsage: s.memberUsage,
      dailyOutfits: s.dailyOutfits,
      customScenes: s.customScenes,
      syncMeta: s.syncMeta,
      syncWardrobeIds: s.syncWardrobeIds,
      cloudSyncEnabled: s.cloudSyncEnabled,
      // v2.2.7：删除墓碑需持久化，否则重启后丢失、下次合并仍会复活已删除实体
      deletedMarks: s.deletedMarks,
      wardrobeFilterPreset: null
    });
  };

  /** v2.2.7：记录删除墓碑（id → 删除时间）。墓碑随云同步上行，
   * 合并时据此跳过「云端仍存在、但本机已删除」的实体，避免删除被 pull 并集复活 */
  const markDeleted = (ids: string | string[]): Record<string, number> => {
    const now = Date.now();
    const marks = { ...get().deletedMarks };
    (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
      if (id) marks[id] = now;
    });
    return marks;
  };

  /** v1.15.0（R-5）：commit 统一入口。
   * 同步范围内数据变更（衣橱/衣物/日记/自定义项/备选/身体数据/品牌/计数器/当前衣橱/自定义场景）
   * 默认递增 dataVersion 并打脏标记，触发云端上行；
   * 仅本地字段（明日穿搭勾选、推荐缓存、城市、会员用量、筛选预设等）传 opts.localOnly = true 跳过。 */
  const commit = (partial: Partial<LdwData>, opts?: { localOnly?: boolean }) => {
    const localOnly = opts?.localOnly === true;
    const prev = get();
    set({
      ...partial,
      ...(localOnly
        ? {}
        : {
            syncMeta: {
              ...prev.syncMeta,
              dataVersion: prev.syncMeta.dataVersion + 1,
              dirty: true
            }
          })
    });
    persistAll();
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
      // v0.7.0：称呼修改校验（非空、≤10 字），非法则忽略本次名称修改
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed || trimmed.length > WARDROBE_NAME_MAX_LEN) {
          console.warn('[Store] 衣橱称呼非法, 已忽略本次名称修改');
          next.name = target.name;
        } else {
          next.name = trimmed;
        }
      }
      // 主题变更时联动更新主题色
      if (patch.themeId && patch.themeId !== target.themeId) {
        next.color = getThemeById(patch.themeId).primary;
      }
      // v1.15.0（R-5）：记录最后修改时间，云同步合并按「新者胜」裁决
      next.updatedAt = Date.now();
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
      const diaryEntries = s.diaryEntries.filter((d) => d.wardrobeId !== id);
      const counters = { ...s.counters };
      Object.keys(counters).forEach((key) => {
        if (key.startsWith(`${id}__`)) {
          delete counters[key];
        }
      });
      const bodyProfiles = { ...s.bodyProfiles };
      delete bodyProfiles[id];
      const tomorrowOutfits = { ...s.tomorrowOutfits };
      delete tomorrowOutfits[id];
      const currentWardrobeId = s.currentWardrobeId === id ? wardrobes[0].id : s.currentWardrobeId;
      console.info('[Store] 删除衣橱, id =', id, '剩余衣橱 =', wardrobes.length);
      // v2.2.7：衣橱及其下全部实体写墓碑，避免云同步合并复活
      commit({
        wardrobes,
        items,
        tryoutItems,
        diaryEntries,
        counters,
        bodyProfiles,
        tomorrowOutfits,
        currentWardrobeId,
        deletedMarks: markDeleted([
          id,
          ...s.items.filter((it) => it.wardrobeId === id).map((it) => it.id),
          ...s.tryoutItems.filter((t) => t.wardrobeId === id).map((t) => t.id),
          ...s.diaryEntries.filter((d) => d.wardrobeId === id).map((d) => d.id)
        ])
      });
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
        // v0.7.0 命名规则：「类型-编号」，不再包含衣橱主人称呼前缀（历史旧名称保持不变）
        name: `${input.type}-${pad3(no)}`,
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
        ...(patchName !== undefined ? { name: patchName } : {}),
        // v1.15.0（R-5）：记录最后修改时间，云同步合并按「新者胜」裁决
        updatedAt: Date.now()
      };

      // 用户手动改名（PRD 6.2 第 5 条）
      if (patchName !== undefined && patchName !== item.name) {
        updated.renamed = true;
      }

      // 修改服装类型且未手动改名时，名称联动更新（v0.7.0 规则：「类型-编号」，无称呼前缀）
      if (patch.type && patch.type !== item.type && !updated.renamed) {
        const wardrobe = s.wardrobes.find((w) => w.id === item.wardrobeId);
        if (wardrobe) {
          const key = counterKey(wardrobe.id, patch.type);
          const no = (s.counters[key] || 0) + 1;
          updated.name = `${patch.type}-${pad3(no)}`;
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
      commit({
        items: s.items.map((it) =>
          it.id === id ? { ...it, favorite: !it.favorite, updatedAt: Date.now() } : it
        )
      });
    },

    deleteItem: (id) => {
      console.info('[Store] 删除衣物, id =', id);
      // v2.2.7：写删除墓碑，防止下次云同步 pull 合并把已删除衣物加回来（表现为「删除没有效果」）
      commit({ items: get().items.filter((it) => it.id !== id), deletedMarks: markDeleted(id) });
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
      if (dimension === 'layer') return get().items.some((it) => it.layer === value);
      if (dimension === 'season') return get().items.some((it) => (it.seasons || []).includes(value));
      return get().items.some((it) => (it.occasions || []).includes(value));
    },

    currentBodyProfile: () => get().bodyProfiles[get().currentWardrobeId] || {},

    updateBodyProfile: (patch) => {
      const s = get();
      const wid = s.currentWardrobeId;
      const next: BodyProfile = { ...(s.bodyProfiles[wid] || {}) };
      const mutable = next as Record<string, number | string | undefined>;
      Object.keys(patch).forEach((k) => {
        const key = k as keyof BodyProfile;
        const v = patch[key] as number | string | undefined;
        // 空值删除字段，避免无效数据
        if (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) {
          delete mutable[key];
        } else {
          mutable[key] = v;
        }
      });
      commit({ bodyProfiles: { ...s.bodyProfiles, [wid]: next } });
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
        name: (input.name || '').trim() || '未命名试穿',
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
      const updated: TryoutItem = { ...item, ...patch, updatedAt: Date.now() };
      if (patch.name !== undefined && patch.name.trim()) {
        updated.name = patch.name.trim();
      }
      commit({ tryoutItems: s.tryoutItems.map((t) => (t.id === id ? updated : t)) });
    },

    deleteTryout: (id) => {
      console.info('[Store] 删除备选, id =', id);
      commit({
        tryoutItems: get().tryoutItems.filter((t) => t.id !== id),
        deletedMarks: markDeleted(id)
      });
    },

    addDiaryEntry: (date, photos) => {
      const s = get();
      const entry: DiaryEntry = {
        id: genId(),
        wardrobeId: s.currentWardrobeId,
        date,
        photos,
        createdAt: Date.now()
      };
      console.info('[Store] 新增着装日记, date =', date, '照片数 =', photos.length);
      commit({ diaryEntries: [entry, ...s.diaryEntries] });
      return entry;
    },

    deleteDiaryEntry: (id) => {
      console.info('[Store] 删除着装日记, id =', id);
      commit({
        diaryEntries: get().diaryEntries.filter((d) => d.id !== id),
        deletedMarks: markDeleted(id)
      });
    },

    toggleTomorrowItem: (itemId) => {
      const s = get();
      const wid = s.currentWardrobeId;
      const list = s.tomorrowOutfits[wid] || [];
      const next = list.includes(itemId) ? list.filter((v) => v !== itemId) : [...list, itemId];
      // 明日穿搭勾选为「明日穿搭记录」，仅本地（设计方案 4.4），不参与云同步
      commit({ tomorrowOutfits: { ...s.tomorrowOutfits, [wid]: next } }, { localOnly: true });
    },

    adoptTomorrowItems: (itemIds) => {
      const s = get();
      const wid = s.currentWardrobeId;
      const list = s.tomorrowOutfits[wid] || [];
      const next = [...list];
      itemIds.forEach((id) => {
        if (!next.includes(id)) next.push(id);
      });
      if (next.length === list.length) {
        console.info('[Store] 一键采纳：推荐衣物均已在明日穿搭中，跳过');
        return;
      }
      console.info('[Store] 一键采纳推荐到明日穿搭, 新增件数 =', next.length - list.length);
      // 明日穿搭勾选为「明日穿搭记录」，仅本地（设计方案 4.4），不参与云同步
      commit({ tomorrowOutfits: { ...s.tomorrowOutfits, [wid]: next } }, { localOnly: true });
    },

    setWardrobeFilterPreset: (preset) => {
      commit({ wardrobeFilterPreset: preset }, { localOnly: true });
    },

    consumeWardrobeFilterPreset: () => {
      if (get().wardrobeFilterPreset !== null) {
        commit({ wardrobeFilterPreset: null }, { localOnly: true });
      }
    },

    setCity: (city, source) => {
      // 城市为设备本地偏好（设计方案 4.4），不参与云同步
      commit({ city, citySource: source || 'manual' }, { localOnly: true });
    },

    setMemberTier: (tier) => {
      console.info('[Store] 会员档位切换, tier =', tier);
      // v1.15.1：档位联动——切到 free（无云同步权益）时自动关闭云同步开关，保证开关与档位一致
      const s = get();
      const closeSync = tier === 'free' && s.cloudSyncEnabled;
      commit(
        {
          memberTier: tier,
          memberUsage: rolledUsage(s.memberUsage),
          ...(closeSync ? { cloudSyncEnabled: false } : {})
        },
        { localOnly: true }
      );
      if (closeSync) {
        console.info('[Store] 档位切换为 free，云同步开关已自动关闭');
      }
    },

    recordSeasonalView: (count) => {
      const usage = rolledUsage(get().memberUsage);
      const next = Math.max(usage.seasonalViewed, count);
      // v1.19.0：用量计数上云——不再 localOnly，打脏后随防抖上行同步跨端
      commit({ memberUsage: { ...usage, seasonalViewed: next } });
    },

    recordTripUse: () => {
      const usage = rolledUsage(get().memberUsage);
      commit({ memberUsage: { ...usage, tripUsed: usage.tripUsed + 1 } });
    },

    recordBatchImportUse: () => {
      const usage = rolledUsage(get().memberUsage);
      console.info('[Store] 批量添加计次, 本月已用 =', usage.batchImportUsed + 1);
      commit({ memberUsage: { ...usage, batchImportUsed: usage.batchImportUsed + 1 } });
    },

    appendDailyOutfit: (wardrobeId, entry) => {
      const s = get();
      const day = todayKey();
      const cache = s.dailyOutfits[wardrobeId];
      // 跨天或首次：重置当天缓存；同天：追加（调用方保证不超会员档位套数上限）
      const list = cache && cache.day === day ? cache.list : [];
      console.info('[Store] 缓存明日推荐, 衣橱 =', wardrobeId, '第', list.length + 1, '套');
      // v1.19.0：每日推荐已生成套数计入 memberUsage.dailyOutfitUsed（随用量计数上云）；
      // 推荐缓存本体仍仅本地（设计方案 4.4），commit 打脏仅因用量计数变更
      const usage = rolledUsage(s.memberUsage);
      const usedCount = { ...(usage.dailyOutfitUsed || {}), [wardrobeId]: list.length + 1 };
      commit(
        {
          dailyOutfits: {
            ...s.dailyOutfits,
            [wardrobeId]: { day, list: [...list, { ...entry, id: genId() }] }
          },
          memberUsage: { ...usage, dailyOutfitUsed: usedCount }
        }
      );
    },

    addCustomScene: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return '场景名称不能为空';
      if (trimmed.length > 6) return '场景名称最多 6 个字';
      const s = get();
      if (
        s.customScenes.includes(trimmed) ||
        SCENE_PRESET_NAMES.includes(trimmed)
      ) {
        return '该场景已存在';
      }
      if (s.customScenes.length >= 8) return '自定义场景最多 8 个';
      console.info('[Store] 新增自定义场景, name =', trimmed);
      commit({ customScenes: [...s.customScenes, trimmed] });
      return null;
    },

    removeCustomScene: (value) => {
      const s = get();
      const used = Object.values(s.dailyOutfits).some((c) =>
        (c.list || []).some((e) => e.scene === value)
      );
      if (used) {
        console.warn('[Store] 自定义场景已被今日推荐引用，不可删除');
        return;
      }
      console.info('[Store] 删除自定义场景, name =', value);
      commit({ customScenes: s.customScenes.filter((v) => v !== value) });
    },

    setCloudSyncEnabled: (enabled) => {
      console.info('[Store] 云同步开关切换, enabled =', enabled);
      commit({ cloudSyncEnabled: enabled }, { localOnly: true });
    },

    setSyncWardrobeIds: (ids) => {
      console.info('[Store] 同步衣橱选择更新, 数量 =', ids.length);
      commit({ syncWardrobeIds: ids }, { localOnly: true });
    },

    patchSyncMeta: (patch) => {
      set({ syncMeta: { ...get().syncMeta, ...patch } });
      persistAll();
    },

    replacePhotoPaths: (replacements) => {
      if (replacements.length === 0) return;
      const s = get();
      const itemMap = new Map(replacements.filter((r) => r.kind === 'item').map((r) => [r.id, r.photos]));
      const diaryMap = new Map(replacements.filter((r) => r.kind === 'diary').map((r) => [r.id, r.photos]));
      // v1.21.0：试穿照片 fileID 回填（此前仅衣物/日记，试穿照片从未上传云存储）
      const tryoutMap = new Map(replacements.filter((r) => r.kind === 'tryout').map((r) => [r.id, r.photos]));
      set({
        items: s.items.map((it) => {
          const photos = itemMap.get(it.id);
          return photos ? { ...it, photos } : it;
        }),
        diaryEntries: s.diaryEntries.map((d) => {
          const photos = diaryMap.get(d.id);
          return photos ? { ...d, photos } : d;
        }),
        tryoutItems: s.tryoutItems.map((t) => {
          const photos = tryoutMap.get(t.id);
          return photos ? { ...t, photos } : t;
        })
      });
      persistAll();
    },

    applySyncMerge: (partial) => {
      // 合并结果一次性 commit（设计方案 5.5 第 5 条：合并原子化，递增版本号并打脏，随下次 push 上行）
      console.info('[Store] 云端合并写入, dataVersion =', get().syncMeta.dataVersion + 1);
      commit(partial);
    }
  };
});

/** 各维度预设选项名列表 */
export const getDimensionPreset = (dimension: CustomDimension): string[] => {
  if (dimension === 'type') return TYPE_PRESETS;
  if (dimension === 'color') return COLOR_PRESETS.map((c) => c.name);
  if (dimension === 'size') return SIZE_OPTIONS;
  if (dimension === 'occasion') return OCCASION_OPTIONS;
  if (dimension === 'layer') return LAYER_OPTIONS;
  if (dimension === 'season') return SEASON_OPTIONS;
  return MATERIAL_PRESETS;
};
