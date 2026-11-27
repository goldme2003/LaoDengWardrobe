/** 云同步服务（v1.15.0，R-5 M1，见《云端同步设计方案-v1.13.0》）
 * 职责：
 *   1. 微信授权静默登录（userSync 云函数，openid 维度，失败指数退避重试，不阻塞本地功能）；
 *   2. 全量快照上下行（pull / push，乐观锁 baseVersion）；
 *   3. 实体合并（设计方案 5.5：按 id 合并、updatedAt 新者胜、计数器取 max、集合取并集、合并原子化）；
 *   4. 同步范围裁剪（4.4：所选衣橱 + 衣物/日记/备选/身体数据/计数器 + 全局自定义项/品牌/场景 + 会员用量计数；
 *      明日穿搭勾选、推荐缓存、推荐产物、城市不上云；v1.19.0 起用量计数（含每日推荐套数）上云）；
 *   5. 3s 防抖上行（commit 打脏后自动触发）；
 *   6. 照片上传（衣物/日记/试穿照片，分批 5 张、路径去重、容量按档位约束、fileID 回填不打脏；
 *      v1.21.0 起试穿照片随同步上传——此前仅衣物/日记上传，快照内试穿照片为本地临时路径，
 *      换设备拉取、云端覆盖回写或微信清理临时文件后路径失效，导致试穿图片无法显示）；
 *   7. 快照冲突策略（v2.2.0）：冲突时弹窗由用户三选一——使用云端覆盖本机 / 本机覆盖云端 / 智能合并
 *      （两端最新保留，实体新者胜 + 计数取 max）；「暂不处理」保留本机数据暂停上行，两侧快照
 *      自动存为冲突副本（30 天，服务端写入）；此前 v1.16.0 为云端覆盖本地；
 *   8. 会员档位（v2.0.0）：服务端权威（members 订单校验，微信支付回调写入），login 返回后回写本地；
 *      客户端上报与 setTier 通道已随测试模式移除（档位不入快照）；
 *   9. 单端互踢（v1.19.0，需求方确认）：登录上报 deviceId，服务端登记唯一活跃设备；
 *      pull/push/photoStat 被判非活跃设备时返回 KICKED → 本机进入 kicked 态，暂停云端读写（本地数据保留），
 *      「立即同步」重新登录后接管（顶掉另一设备）。
 * 仅微信端可用（CLOUD_READY）；H5 端所有入口静默返回，不阻塞本地功能。
 * 云同步开关默认关闭：开启后才发起任何云端数据请求（登录本身除外，仅返回身份与档位）。 */
import Taro from '@tarojs/taro';
import { create } from 'zustand';
import { CLOUD_READY } from '@/config/cloud';
import { USER_SYNC_FN_NAME } from '@/config/cloud';
import { useWardrobeStore, LdwData } from '@/store/useWardrobeStore';
import { tierOf, MemberTier, MemberUsage, rolledUsage } from '@/services/entitlement';
import {
  Wardrobe,
  ClothingItem,
  DiaryEntry,
  TryoutItem,
  CustomOption,
  BodyProfile,
  SyncMeta
} from '@/types';

/** 同步状态（mine 页状态条展示） */
export type SyncStatus =
  | 'idle' // 未登录（未连上云）
  | 'logging-in' // 登录中
  | 'disabled' // 已登录但云同步开关关闭
  | 'ready' // 已同步（无待上行变更）
  | 'pending' // 有变更待上行（防抖/重试中）
  | 'syncing' // 同步中
  | 'kicked' // v1.19.0：账号已在其他设备登录，本机暂停云同步（本地数据保留，可手动「立即同步」接管）
  | 'error'; // 登录或同步失败（可重试；v2.2.0 起冲突弹窗未处理时也置 error，本机数据保留）

/** 云端快照数据结构（同步范围，见设计方案 4.4；与服务端 wardrobe_snapshots.data 一致） */
export interface SnapshotData {
  wardrobeIds: string[];
  wardrobes: Wardrobe[];
  items: ClothingItem[];
  diaryEntries: DiaryEntry[];
  tryoutItems: TryoutItem[];
  customOptions: CustomOption[];
  customScenes: string[];
  favoriteBrands: string[];
  bodyProfiles: Record<string, BodyProfile>;
  counters: Record<string, number>;
  /** v1.19.0：会员用量计数（当季图组/出差/批量导入/时尚推荐 + 每日推荐套数），跨端取 max 合并 */
  memberUsage: MemberUsage;
  currentWardrobeId: string;
}

interface SyncState {
  status: SyncStatus;
  openid: string;
  tier: MemberTier;
  /** 服务端权威上限：可同步衣橱数（v1.19.1：VIP 3 / SVIP 999≈全部） */
  maxWardrobes: number;
  /** 服务端权威上限：照片容量 MB */
  photoQuotaMB: number;
  photoBytes: number;
  hasRemote: boolean;
  lastSyncedAt: number;
  errorMsg: string;
}

export const useSyncStore = create<SyncState>(() => ({
  status: 'idle',
  openid: '',
  tier: 'free',
  maxWardrobes: 0,
  photoQuotaMB: 0,
  photoBytes: 0,
  hasRemote: false,
  lastSyncedAt: 0,
  errorMsg: ''
}));

const setSyncState = (patch: Partial<SyncState>) => useSyncStore.setState(patch);

/** v1.15.1：档位门控——云同步（含 push/pull/照片上传）为 VIP/SVIP 权益，所有同步动作前统一校验 */
const canSync = (): boolean => tierOf(useWardrobeStore.getState().memberTier).cloudSync === 'cloud';

/** v2.2.0：冲突处理选择（用户三选一：云端覆盖本机 / 本机覆盖云端 / 智能合并；取消 = 暂不处理） */
type ConflictChoice = 'cloud' | 'local' | 'merge' | 'later';

/** v2.2.0：存在未处理的冲突时置 true——自动同步（防抖/回前台）跳过 push，避免反复弹窗或静默覆盖；
 * 「立即同步」（syncNow）会重置该标记并重新弹出选择 */
let conflictPending = false;

/** 冲突处理选择弹窗（ActionSheet 三选一；取消/异常视为「暂不处理」，不静默丢任何一侧数据） */
const askConflictChoice = async (): Promise<ConflictChoice> => {
  interface WxActionSheetOption {
    itemList: string[];
    itemColor?: string;
    /** weapp 2.14.0+：顶部说明文字 */
    alertText?: string;
  }
  try {
    const res = await Taro.showActionSheet({
      alertText: '检测到云端与本机数据版本冲突，请选择处理方式（两侧快照已自动存为冲突副本，保留 30 天）',
      itemList: ['使用云端数据（覆盖本机）', '使用本机数据（覆盖云端）', '智能合并（保留两端最新）'],
      itemColor: '#4a3524'
    } as WxActionSheetOption);
    return res.tapIndex === 0 ? 'cloud' : res.tapIndex === 1 ? 'local' : res.tapIndex === 2 ? 'merge' : 'later';
  } catch (e) {
    return 'later';
  }
};

const PUSH_DEBOUNCE_MS = 3000;
/** 指数退避重试上限（登录与同步共用，超限后停止自动重试，可手动触发） */
const MAX_RETRY = 5;
const RETRY_BASE_MS = 2000;
const PHOTO_BATCH = 5;
const PHOTO_UPLOAD_MAP_KEY = 'ldw_photo_upload_map';
/** v1.19.0：设备标识持久化 key（单端互踢判定依据） */
const DEVICE_ID_KEY = 'ldw_device_id';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let syncing = false;
let watcherRegistered = false;

/** v1.19.0：设备标识（本地生成并持久化；登录上报服务端登记为唯一活跃设备） */
const getDeviceId = (): string => {
  try {
    const stored = Taro.getStorageSync(DEVICE_ID_KEY);
    if (stored) return stored;
    const id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    Taro.setStorageSync(DEVICE_ID_KEY, id);
    return id;
  } catch (e) {
    return 'd_unknown';
  }
};

/** v1.19.0：被其他设备顶下线——清理定时器、进入 kicked 态；本地数据保留，仅暂停云端读写 */
const handleKicked = (): void => {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  setSyncState({ status: 'kicked', errorMsg: '' });
  Taro.showToast({ title: '账号已在其他设备登录，本机已暂停云同步', icon: 'none', duration: 2500 });
  console.warn('[Sync] 已被其他设备顶下线，本机暂停云同步（「立即同步」可重新接管）');
};

/** 空快照兜底（远端旧数据/异常数据缺字段时不崩溃） */
const normalizeSnapshot = (raw: Partial<SnapshotData> | null | undefined): SnapshotData | null => {
  if (!raw || !Array.isArray(raw.wardrobes)) return null;
  return {
    wardrobeIds: Array.isArray(raw.wardrobeIds) ? raw.wardrobeIds : raw.wardrobes.map((w) => w.id),
    wardrobes: raw.wardrobes,
    items: Array.isArray(raw.items) ? raw.items : [],
    diaryEntries: Array.isArray(raw.diaryEntries) ? raw.diaryEntries : [],
    tryoutItems: Array.isArray(raw.tryoutItems) ? raw.tryoutItems : [],
    customOptions: Array.isArray(raw.customOptions) ? raw.customOptions : [],
    customScenes: Array.isArray(raw.customScenes) ? raw.customScenes : [],
    favoriteBrands: Array.isArray(raw.favoriteBrands) ? raw.favoriteBrands : [],
    bodyProfiles: raw.bodyProfiles && typeof raw.bodyProfiles === 'object' ? raw.bodyProfiles : {},
    counters: raw.counters && typeof raw.counters === 'object' ? raw.counters : {},
    // v1.19.0：旧快照无 memberUsage 时以本地 rolledUsage 兜底（缺字段不崩溃）
    memberUsage: rolledUsage(
      raw.memberUsage && typeof raw.memberUsage === 'object'
        ? (raw.memberUsage as MemberUsage)
        : undefined
    ),
    currentWardrobeId: typeof raw.currentWardrobeId === 'string' ? raw.currentWardrobeId : ''
  };
};

/** 用量计数合并（v1.19.0）：窗口（day/month）一致时各计数取 max（单调递增，防止换端重复用额度），
 * 窗口不一致以本地为准（跨天后 rolledUsage 本就会重置）。 */
const mergeMemberUsage = (local: MemberUsage, remote: MemberUsage): MemberUsage => {
  const merged: MemberUsage = { ...local };
  if (remote.day === local.day) {
    merged.seasonalViewed = Math.max(local.seasonalViewed || 0, remote.seasonalViewed || 0);
    const used: Record<string, number> = { ...(local.dailyOutfitUsed || {}) };
    Object.entries(remote.dailyOutfitUsed || {}).forEach(([wid, v]) => {
      used[wid] = Math.max(used[wid] || 0, v);
    });
    merged.dailyOutfitUsed = used;
  }
  if (remote.month === local.month) {
    merged.tripUsed = Math.max(local.tripUsed || 0, remote.tripUsed || 0);
    merged.batchImportUsed = Math.max(local.batchImportUsed || 0, remote.batchImportUsed || 0);
    merged.fashionUsed = Math.max(local.fashionUsed || 0, remote.fashionUsed || 0);
  }
  return merged;
};

/** 实体最后修改时间（updatedAt 优先，旧数据以 createdAt 兜底，见设计方案 5.5 第 2 条） */
const entityTime = (e: { updatedAt?: number; createdAt?: number }): number =>
  e.updatedAt || e.createdAt || 0;

/**
 * 同步范围裁剪（设计方案 4.4）：
 * 衣橱/衣物/日记/备选/身体数据/计数器按所选衣橱过滤；
 * currentWardrobeId 不在所选集合内时回落到所选集合第一个；
 * 明日穿搭勾选/推荐缓存/城市/会员用量/筛选预设不纳入。
 */
export const buildSnapshotData = (s: LdwData, wardrobeIds?: string[]): SnapshotData => {
  const selected = (wardrobeIds || s.syncWardrobeIds || []).filter((id) =>
    s.wardrobes.some((w) => w.id === id)
  );
  const selectedSet = new Set(selected);
  const currentWardrobeId = selectedSet.has(s.currentWardrobeId)
    ? s.currentWardrobeId
    : selected[0] || s.currentWardrobeId;
  const counters: Record<string, number> = {};
  Object.entries(s.counters || {}).forEach(([key, value]) => {
    const wid = key.split('__')[0];
    if (selectedSet.has(wid)) counters[key] = value;
  });
  const bodyProfiles: Record<string, BodyProfile> = {};
  selected.forEach((id) => {
    if (s.bodyProfiles[id]) bodyProfiles[id] = s.bodyProfiles[id];
  });
  return {
    wardrobeIds: selected,
    wardrobes: s.wardrobes.filter((w) => selectedSet.has(w.id)),
    items: s.items.filter((it) => selectedSet.has(it.wardrobeId)),
    diaryEntries: s.diaryEntries.filter((d) => selectedSet.has(d.wardrobeId)),
    tryoutItems: s.tryoutItems.filter((t) => selectedSet.has(t.wardrobeId)),
    customOptions: s.customOptions || [],
    customScenes: s.customScenes || [],
    favoriteBrands: s.favoriteBrands || [],
    bodyProfiles,
    counters,
    // v1.19.0：会员用量计数随快照上云（全局数据，不按衣橱裁剪； rolledUsage 保证窗口新鲜）
    memberUsage: rolledUsage(s.memberUsage),
    currentWardrobeId
  };
};

/**
 * 实体合并（设计方案 5.5）：在内存中完成合并计算，结果经 applySyncMerge 一次 commit 写入（原子化）。
 * 规则：仅本地 → 保留；仅云端 → 写入；同 id → updatedAt||createdAt 新者胜；
 * v1.16.0：同名不同 id 的衣橱一律并入保留方，消除重复衣橱——
 *   本地空 → 采用云端 id；云端空 → 跳过云端衣橱；双方均有数据 → 云端覆盖本地（需求方确认）：
 *   采用云端衣橱 id，本地实体 wardrobeId 重映射到云端 id 后与云端实体按 id 合并去重；
 * customOptions 按 dimension+value 并集；customScenes/favoriteBrands 字符串并集；
 * counters 取 max（计数器单调递增）；bodyProfiles 本地优先（无时间戳字段）。
 */
export const mergeSnapshot = (
  local: LdwData,
  remote: SnapshotData
): { patch: Partial<LdwData>; stats: { wardrobes: number; items: number; diary: number; tryout: number } } => {
  // 同名衣橱去重（v1.16.0：不再「双方均有数据则并存」——那是重复衣橱反复出现的根源）
  const localEntityCount = (wid: string): number =>
    local.items.filter((it) => it.wardrobeId === wid).length +
    local.diaryEntries.filter((d) => d.wardrobeId === wid).length +
    local.tryoutItems.filter((t) => t.wardrobeId === wid).length;
  const remoteEntityCount = (wid: string): number =>
    remote.items.filter((it) => it.wardrobeId === wid).length +
    remote.diaryEntries.filter((d) => d.wardrobeId === wid).length +
    remote.tryoutItems.filter((t) => t.wardrobeId === wid).length;

  /** 本地待丢弃的同名衣橱 id → 云端保留衣橱 id（含双方均有数据时的云端覆盖） */
  const adoptMap = new Map<string, string>();
  /** 云端待跳过的空同名衣橱 id（不写入本地，随下次 push 全量覆盖自然清理） */
  const skipRemoteIds = new Set<string>();
  remote.wardrobes.forEach((rw) => {
    const lw = local.wardrobes.find((w) => w.id !== rw.id && w.name === rw.name);
    if (!lw) return;
    const lc = localEntityCount(lw.id);
    const rc = remoteEntityCount(rw.id);
    if (rc === 0 && lc > 0) {
      skipRemoteIds.add(rw.id);
    } else {
      // 本地空 → 并入云端；双方均有数据 → 云端覆盖本地（保留云端 id）
      adoptMap.set(lw.id, rw.id);
    }
  });
  if (adoptMap.size > 0 || skipRemoteIds.size > 0) {
    console.info('[Sync] 同名衣橱去重, 本地衣橱并入云端 =', adoptMap.size, '云端空衣橱跳过 =', skipRemoteIds.size);
  }

  /** 本地实体重映射：被丢弃衣橱的实体 wardrobeId 改挂到云端保留衣橱（按 id 与云端实体去重合并） */
  const remapWid = <T extends { wardrobeId: string }>(list: T[]): T[] =>
    adoptMap.size === 0 ? list : list.map((e) => {
      const keep = adoptMap.get(e.wardrobeId);
      return keep ? { ...e, wardrobeId: keep } : e;
    });

  const wardrobes = local.wardrobes.filter((w) => !adoptMap.has(w.id));
  const wardrobeMap = new Map(wardrobes.map((w) => [w.id, w]));
  let wardrobeWins = 0;
  remote.wardrobes.forEach((rw) => {
    if (skipRemoteIds.has(rw.id)) return;
    const lw = wardrobeMap.get(rw.id);
    if (!lw) {
      wardrobes.push(rw);
      wardrobeMap.set(rw.id, rw);
    } else if (entityTime(rw) > entityTime(lw)) {
      // 不 mutate 原 state 对象：以新对象替换（保持不可变，便于合并失败回滚）
      const idx = wardrobes.indexOf(lw);
      const merged = { ...lw, ...rw };
      wardrobes[idx] = merged;
      wardrobeMap.set(rw.id, merged);
      wardrobeWins++;
    }
  });

  const items = remapWid([...local.items]);
  const itemMap = new Map(items.map((it) => [it.id, it]));
  let itemWins = 0;
  remote.items.forEach((ri) => {
    const li = itemMap.get(ri.id);
    if (!li) {
      items.push(ri);
      itemMap.set(ri.id, ri);
    } else if (entityTime(ri) > entityTime(li)) {
      const idx = items.indexOf(li);
      const merged = { ...li, ...ri };
      items[idx] = merged;
      itemMap.set(ri.id, merged);
      itemWins++;
    }
  });

  const diary = remapWid([...local.diaryEntries]);
  const diaryMap = new Map(diary.map((d) => [d.id, d]));
  let diaryWins = 0;
  remote.diaryEntries.forEach((rd) => {
    const ld = diaryMap.get(rd.id);
    if (!ld) {
      diary.push(rd);
      diaryMap.set(rd.id, rd);
    } else if (entityTime(rd) > entityTime(ld)) {
      const idx = diary.indexOf(ld);
      const merged = { ...ld, ...rd };
      diary[idx] = merged;
      diaryMap.set(rd.id, merged);
      diaryWins++;
    }
  });

  const tryout = remapWid([...local.tryoutItems]);
  const tryoutMap = new Map(tryout.map((t) => [t.id, t]));
  let tryoutWins = 0;
  remote.tryoutItems.forEach((rt) => {
    const lt = tryoutMap.get(rt.id);
    if (!lt) {
      tryout.push(rt);
      tryoutMap.set(rt.id, rt);
    } else if (entityTime(rt) > entityTime(lt)) {
      const idx = tryout.indexOf(lt);
      const merged = { ...lt, ...rt };
      tryout[idx] = merged;
      tryoutMap.set(rt.id, merged);
      tryoutWins++;
    }
  });

  // 自定义选项按 dimension + value 并集
  const optKeys = new Set(local.customOptions.map((o) => `${o.dimension}__${o.value}`));
  const customOptions = [...local.customOptions];
  remote.customOptions.forEach((ro) => {
    if (!optKeys.has(`${ro.dimension}__${ro.value}`)) customOptions.push(ro);
  });

  // 字符串集合并集（本地顺序优先，远端追加）
  const customScenes = [...local.customScenes];
  remote.customScenes.forEach((v) => {
    if (!customScenes.includes(v)) customScenes.push(v);
  });
  const favoriteBrands = [...local.favoriteBrands];
  remote.favoriteBrands.forEach((v) => {
    if (!favoriteBrands.includes(v)) favoriteBrands.push(v);
  });

  // 计数器按 key 取 max（单调递增，避免旧设备把计数推回）
  const counters = { ...local.counters };
  Object.entries(remote.counters || {}).forEach(([k, v]) => {
    counters[k] = Math.max(counters[k] || 0, v);
  });
  // v1.15.2：被丢弃衣橱的编号计数器迁移到保留衣橱（编号不回收，避免沿用旧计数被重置）
  adoptMap.forEach((keep, dropped) => {
    Object.entries(counters).forEach(([k, v]) => {
      if (k.startsWith(`${dropped}__`)) {
        const nk = `${keep}__${k.slice(dropped.length + 2)}`;
        counters[nk] = Math.max(counters[nk] || 0, v);
        delete counters[k];
      }
    });
  });

  // 身体数据本地优先（无时间戳，设计方案 5.5 简化：仅云端存在的衣橱写入）
  const bodyProfiles = { ...local.bodyProfiles };
  Object.entries(remote.bodyProfiles || {}).forEach(([wid, bp]) => {
    if (!bodyProfiles[wid]) bodyProfiles[wid] = bp;
  });
  // v1.15.2：被丢弃衣橱的身体数据迁移到保留衣橱
  adoptMap.forEach((keep, dropped) => {
    if (bodyProfiles[dropped]) {
      if (!bodyProfiles[keep]) bodyProfiles[keep] = bodyProfiles[dropped];
      delete bodyProfiles[dropped];
    }
  });

  // 当前衣橱：本地选择优先；本地值失效时回落（被丢弃衣橱跟随迁移到云端保留衣橱）
  const mergedIds = wardrobes.map((w) => w.id);
  const preferredCurrent = adoptMap.get(local.currentWardrobeId) || local.currentWardrobeId;
  const currentWardrobeId = mergedIds.includes(preferredCurrent)
    ? preferredCurrent
    : mergedIds[0] || local.currentWardrobeId;

  // v1.15.2：同步范围同步重映射（丢弃 id → 保留 id），避免合并结果不在同步范围内被下次 push 覆盖丢失
  const patchSync: Partial<LdwData> = {};
  if (adoptMap.size > 0 && local.syncWardrobeIds) {
    patchSync.syncWardrobeIds = local.syncWardrobeIds.map((id) => adoptMap.get(id) || id);
  }

  return {
    patch: {
      wardrobes,
      items,
      diaryEntries: diary,
      tryoutItems: tryout,
      customOptions,
      customScenes,
      favoriteBrands,
      counters,
      bodyProfiles,
      // v1.19.0：用量计数跨端取 max（含每日推荐套数）
      memberUsage: mergeMemberUsage(rolledUsage(local.memberUsage), remote.memberUsage),
      currentWardrobeId,
      ...patchSync
    },
    stats: {
      wardrobes: wardrobeWins,
      items: itemWins,
      diary: diaryWins,
      tryout: tryoutWins
    }
  };
};

/** 同步衣橱选择初始化：当前衣橱优先 + 创建时间倒序补足到档位上限（SVIP 全部） */
const initSyncWardrobeIds = (s: LdwData, max: number): string[] => {
  const sorted = [...s.wardrobes].sort(
    (a, b) => (b.id === s.currentWardrobeId ? 1 : 0) - (a.id === s.currentWardrobeId ? 1 : 0) || b.createdAt - a.createdAt
  );
  if (max >= sorted.length) return sorted.map((w) => w.id);
  return sorted.slice(0, Math.max(1, max)).map((w) => w.id);
};

/** ---------- 登录 ---------- */

const applyLoginResult = (res: {
  openid: string;
  tier: MemberTier;
  maxWardrobes: number;
  photoQuotaMB: number;
  photoBytes: number;
  hasRemote: boolean;
  dataVersion: number;
}) => {
  const store = useWardrobeStore.getState();
  store.patchSyncMeta({ openid: res.openid });
  setSyncState({
    openid: res.openid,
    tier: res.tier,
    maxWardrobes: res.maxWardrobes,
    photoQuotaMB: res.photoQuotaMB,
    photoBytes: res.photoBytes,
    hasRemote: res.hasRemote,
    errorMsg: ''
  });
  // 会员档位以服务端为准（设计方案 5.1 第 3 条；v2.0.0 起档位唯一权威为 members 订单，客户端不可上报）
  // v1.17.0：setSyncState 先行，避免下方 setMemberTier 触发订阅时对刚写入的档位重复上行
  if (res.tier !== store.memberTier) {
    store.setMemberTier(res.tier);
  }
  // 同步衣橱选择初始化（null = 未设置）
  const cur = useWardrobeStore.getState();
  if (!cur.syncWardrobeIds) {
    cur.setSyncWardrobeIds(initSyncWardrobeIds(cur, res.maxWardrobes));
  }
};

/** 登录 + 首次同步（启动时调用；失败指数退避重试，期间保持纯本地模式） */
export const loginAndSync = async (): Promise<void> => {
  if (!CLOUD_READY) return;
  const store = useWardrobeStore.getState();
  setSyncState({ status: 'logging-in', errorMsg: '' });
  try {
    const res = await Taro.cloud.callFunction({
      name: USER_SYNC_FN_NAME,
      data: { action: 'login', tier: store.memberTier, deviceId: getDeviceId() }
    });
    const result = res.result as { code: string; message?: string } & Record<string, any>;
    if (result.code !== 'OK') {
      throw new Error(result.message || '登录失败');
    }
    applyLoginResult({
      openid: result.openid,
      tier: result.tier,
      maxWardrobes: result.maxWardrobes,
      photoQuotaMB: result.photoQuotaMB,
      photoBytes: result.photoBytes || 0,
      hasRemote: !!result.hasRemote,
      dataVersion: result.dataVersion || 0
    });
    retryCount = 0;
    console.info('[Sync] 登录成功, openid =', result.openid, 'tier =', result.tier);
    // v1.15.1：登录反馈——首次登录（此前无 openid）给出轻提示，确认微信账号登录成功
    const isFirstLogin = !store.syncMeta.openid;
    if (isFirstLogin) {
      Taro.showToast({ title: '微信账号登录成功', icon: 'success', duration: 1500 });
    }
    const cur = useWardrobeStore.getState();
    // v1.15.1：档位联动——无云同步权益（free）时开关残留开启 → 自动关闭，保证开关状态与档位一致
    if (tierOf(cur.memberTier).cloudSync !== 'cloud') {
      if (cur.cloudSyncEnabled) {
        cur.setCloudSyncEnabled(false);
        Taro.showToast({ title: '云同步为 VIP/SVIP 权益，已自动关闭', icon: 'none' });
      }
      setSyncState({ status: 'disabled' });
      return;
    }
    const enabled = cur.cloudSyncEnabled;
    if (enabled) {
      await syncOnce();
    } else {
      setSyncState({ status: 'disabled' });
    }
  } catch (e: any) {
    console.warn('[Sync] 登录失败（自动重试）:', e?.message || e);
    setSyncState({ status: 'error', errorMsg: e?.message || '登录失败' });
    scheduleRetry();
  }
};

/** 指数退避重试（登录失败时；上限后停止，可从「我的 → 云同步」手动重试） */
const scheduleRetry = () => {
  if (retryCount >= MAX_RETRY) return;
  if (retryTimer) clearTimeout(retryTimer);
  const delay = RETRY_BASE_MS * Math.pow(2, retryCount);
  retryCount++;
  retryTimer = setTimeout(() => {
    void loginAndSync();
  }, delay);
};

/** ---------- 上下行 ---------- */

/** push 成功/校准后更新本地同步元数据（不打脏） */
const markSynced = (serverVersion: number) => {
  const meta = useWardrobeStore.getState().syncMeta;
  useWardrobeStore.getState().patchSyncMeta({
    dataVersion: Math.max(meta.dataVersion, serverVersion),
    lastSyncedVersion: serverVersion,
    dirty: false,
    lastSyncedAt: Date.now()
  });
  setSyncState({ lastSyncedAt: Date.now() });
};

/** 自定义选项按 dimension+value 去重合并（并集） */
const optKey = (o: CustomOption): string => `${o.dimension}__${o.value}`;
const unionOptions = (a: CustomOption[], b: CustomOption[]): CustomOption[] => {
  const seen = new Set(a.map(optKey));
  return [...a, ...b.filter((o) => !seen.has(optKey(o)))];
};

/**
 * 云端覆盖本地（v1.16.0 冲突策略，需求方确认）：
 * 同步范围内以云端快照为准整体替换；范围外（未选同步的衣橱）数据保留；
 * 自定义项/场景/品牌为全局数据取并集，避免误删；版本游标对齐云端，不打脏。
 * 云端无有效快照时返回 false（调用方回退为保留本地强制上行对齐）。
 */
const applyRemoteOverwrite = (remote: SnapshotData | null, remoteVersion: number): boolean => {
  if (!remote || remote.wardrobes.length === 0) return false;
  const s = useWardrobeStore.getState();
  const ids = new Set(remote.wardrobeIds.length > 0 ? remote.wardrobeIds : remote.wardrobes.map((w) => w.id));
  const counters: Record<string, number> = {};
  Object.entries(s.counters || {}).forEach(([k, v]) => {
    if (!ids.has(k.split('__')[0])) counters[k] = v; // 范围外计数器保留
  });
  Object.entries(remote.counters || {}).forEach(([k, v]) => {
    counters[k] = v; // 同步范围内以云端为准
  });
  const remoteCurrent = remote.currentWardrobeId;
  s.applySyncMerge({
    wardrobes: [...s.wardrobes.filter((w) => !ids.has(w.id)), ...remote.wardrobes],
    items: [...s.items.filter((it) => !ids.has(it.wardrobeId)), ...remote.items],
    diaryEntries: [...s.diaryEntries.filter((d) => !ids.has(d.wardrobeId)), ...remote.diaryEntries],
    tryoutItems: [...s.tryoutItems.filter((t) => !ids.has(t.wardrobeId)), ...remote.tryoutItems],
    customOptions: unionOptions(s.customOptions || [], remote.customOptions),
    customScenes: Array.from(new Set([...(s.customScenes || []), ...remote.customScenes])),
    favoriteBrands: Array.from(new Set([...(s.favoriteBrands || []), ...remote.favoriteBrands])),
    bodyProfiles: { ...s.bodyProfiles, ...remote.bodyProfiles },
    counters,
    // v1.19.0：用量计数窗口一致取 max（单调递增），不随云端覆盖回退
    memberUsage: mergeMemberUsage(rolledUsage(s.memberUsage), remote.memberUsage),
    currentWardrobeId: ids.has(s.currentWardrobeId)
      ? s.currentWardrobeId
      : remoteCurrent && ids.has(remoteCurrent)
        ? remoteCurrent
        : s.currentWardrobeId,
    // 同步范围对齐云端（原范围外衣橱转仅本地，数据不删除）
    syncWardrobeIds: remote.wardrobeIds.length > 0 ? remote.wardrobeIds : s.syncWardrobeIds
  });
  useWardrobeStore.getState().patchSyncMeta({
    dataVersion: Math.max(useWardrobeStore.getState().syncMeta.dataVersion, remoteVersion),
    lastSyncedVersion: remoteVersion,
    dirty: false,
    lastSyncedAt: Date.now()
  });
  setSyncState({ lastSyncedAt: Date.now() });
  console.info('[Sync] 云端覆盖本地完成, 同步衣橱 =', ids.size, '衣物 =', remote.items.length, '云端版本 =', remoteVersion);
  return true;
};

const pushSnapshot = async (force = false): Promise<boolean> => {
  const s = useWardrobeStore.getState();
  if (!s.syncMeta.dirty && !force) return true;
  // v2.2.0：存在未处理的冲突时，自动同步（防抖/回前台触发）跳过上行——本机数据保留、不弹窗、不覆盖；
  // 「立即同步」（syncNow 已重置 conflictPending）可重新弹出处理选择
  if (conflictPending && !force) {
    console.warn('[Sync] 存在未处理的数据冲突，跳过自动上行');
    return false;
  }
  const meta: SyncMeta = s.syncMeta;
  const data = buildSnapshotData(s);
  const res = await Taro.cloud.callFunction({
    name: USER_SYNC_FN_NAME,
    data: {
      action: 'push',
      baseVersion: meta.lastSyncedVersion,
      dataVersion: meta.dataVersion,
      data,
      force,
      deviceId: getDeviceId()
    }
  });
  const result = res.result as { code: string; message?: string } & Record<string, any>;
  if (result.code === 'KICKED') {
    // v1.19.0：单端互踢——本机已被顶下线，停止上行（本地数据保留）
    handleKicked();
    return false;
  }
  if (result.code === 'OK') {
    markSynced(result.dataVersion || meta.dataVersion);
    setSyncState({ status: 'ready', hasRemote: true });
    console.info('[Sync] 上行成功, dataVersion =', result.dataVersion);
    return true;
  }
  if (result.code === 'CONFLICT') {
    // v2.2.0：冲突弹窗三选一（用户自主决定）——云端覆盖本机 / 本机覆盖云端 / 智能合并；
    // 「暂不处理」保留本机数据并暂停自动上行；两侧快照服务端已存为冲突副本（30 天）
    const remoteVersion = result.remoteVersion || 0;
    const remote = normalizeSnapshot(result.remoteData);
    console.warn('[Sync] 上行冲突, remoteVersion =', remoteVersion);
    const choice = await askConflictChoice();
    if (choice === 'later') {
      conflictPending = true;
      setSyncState({
        status: 'error',
        errorMsg: '存在待处理的数据冲突，本机数据已保留；可稍后点「立即同步」选择处理方式'
      });
      Taro.showToast({ title: '数据冲突待处理，本机数据已保留', icon: 'none', duration: 2500 });
      return false;
    }
    conflictPending = false;
    if (choice === 'local') {
      // 本机覆盖云端：对齐下行游标后强制上行（服务端 force 接受，版本号取 max 单调递增）
      useWardrobeStore.getState().patchSyncMeta({ lastSyncedVersion: remoteVersion });
      const ok = await pushSnapshot(true);
      if (ok) Taro.showToast({ title: '已使用本机数据覆盖云端', icon: 'none', duration: 2000 });
      return ok;
    }
    if (choice === 'merge') {
      // 智能合并：实体按 id 新者胜 + 计数/用量取 max + 集合并集（mergeSnapshot 规则），
      // 合并结果原子写入并打脏，随后强制上行对齐云端
      if (remote) {
        const local = useWardrobeStore.getState();
        const { patch } = mergeSnapshot(local, remote);
        local.applySyncMerge(patch);
      }
      useWardrobeStore.getState().patchSyncMeta({ lastSyncedVersion: remoteVersion });
      const ok = await pushSnapshot(true);
      if (ok) Taro.showToast({ title: '已合并两端数据并上行', icon: 'none', duration: 2000 });
      return ok;
    }
    // cloud（默认）：云端覆盖本机（同步范围内以云端为准，范围外数据保留）
    if (applyRemoteOverwrite(remote, remoteVersion)) {
      setSyncState({ status: 'ready', hasRemote: true, errorMsg: '' });
      Taro.showToast({ title: '已使用云端数据覆盖本机', icon: 'none', duration: 2000 });
      return true;
    }
    // 云端无有效快照（如刚清空云端）：无数据可覆盖，保留本地并强制上行对齐版本
    useWardrobeStore.getState().patchSyncMeta({ lastSyncedVersion: remoteVersion });
    return pushSnapshot(true);
  }
  throw new Error(result.message || '上行失败');
};

/** pull + 合并（设计方案 5.4/5.5） */
const pullAndMerge = async (): Promise<void> => {
  const res = await Taro.cloud.callFunction({
    name: USER_SYNC_FN_NAME,
    data: { action: 'pull', deviceId: getDeviceId() }
  });
  const result = res.result as { code: string; data?: Partial<SnapshotData>; dataVersion?: number };
  if (result.code === 'KICKED') {
    // v1.19.0：单端互踢——本机已被顶下线，停止下行
    handleKicked();
    return;
  }
  if (result.code !== 'OK' || !result.data) return;
  const remote = normalizeSnapshot(result.data);
  if (!remote || remote.wardrobes.length === 0) return;
  const remoteVersion = result.dataVersion || 0;
  const meta = useWardrobeStore.getState().syncMeta;
  if (remoteVersion <= meta.lastSyncedVersion && !meta.dirty) return;

  const local = useWardrobeStore.getState();
  const { patch, stats } = mergeSnapshot(local, remote);
  // 合并原子化：一次 commit（递增版本号 + 打脏，随下次 push 上行）
  local.applySyncMerge(patch);
  // v1.22.0 修复：合并后推进下行游标到云端版本（patchSyncMeta 不打脏）。
  // 此前 lastSyncedVersion 停留在旧值，push 乐观锁 baseVersion 过期 → 本地变更上行必然 CONFLICT，
  // 随后云端覆盖本地再 force push——表现为「经常出现数据冲突」且每次 pull 到新数据都触发一次。
  useWardrobeStore.getState().patchSyncMeta({ lastSyncedVersion: remoteVersion });
  console.info(
    '[Sync] 云端合并完成, 衣橱覆盖 =', stats.wardrobes,
    '衣物覆盖 =', stats.items,
    '日记覆盖 =', stats.diary,
    '备选覆盖 =', stats.tryout,
    '下行游标推进至 =', remoteVersion
  );
};

/** 完整同步一轮：pull 合并 → 照片上传 → push（照片回填后上行携带 fileID） */
export const syncOnce = async (): Promise<boolean> => {
  if (!CLOUD_READY || syncing) return false;
  const s = useWardrobeStore.getState();
  // v1.15.1：档位门控——free 不发起任何同步；开关残留开启时纠正为关闭
  if (!canSync()) {
    if (s.cloudSyncEnabled) s.setCloudSyncEnabled(false);
    return false;
  }
  if (!s.syncMeta.openid || !s.cloudSyncEnabled) return false;
  // v1.19.0：kicked 态不发同步（先经 syncNow/loginAndSync 重新接管）
  if (useSyncStore.getState().status === 'kicked') return false;
  syncing = true;
  setSyncState({ status: 'syncing' });
  try {
    await pullAndMerge();
    // pull 阶段被顶下线时不再继续上传/上行
    if (useSyncStore.getState().status === 'kicked') {
      syncing = false;
      return false;
    }
    await uploadPendingPhotos();
    await pushSnapshot();
    // v1.19.0：push 阶段被顶下线时保持 kicked 态（不被 ready 覆盖）
    if (useSyncStore.getState().status === 'kicked') {
      syncing = false;
      return false;
    }
    retryCount = 0;
    syncing = false;
    setSyncState({ status: 'ready' });
    return true;
  } catch (e: any) {
    syncing = false;
    // v1.19.0：kicked 态不被 error 覆盖
    if (useSyncStore.getState().status === 'kicked') return false;
    console.warn('[Sync] 同步失败（稍后重试）:', e?.message || e);
    setSyncState({ status: 'error', errorMsg: e?.message || '同步失败' });
    return false;
  }
};

/** 3s 防抖上行（store commit 打脏后经订阅触发） */
export const schedulePush = (): void => {
  if (!CLOUD_READY) return;
  const s = useWardrobeStore.getState();
  // v1.15.1：档位门控——free 不防抖上行（含开关残留纠正）
  if (!canSync()) {
    if (s.cloudSyncEnabled) s.setCloudSyncEnabled(false);
    return;
  }
  if (!s.cloudSyncEnabled || !s.syncMeta.openid) return;
  // v1.19.0：kicked 态不防抖上行
  if (useSyncStore.getState().status === 'kicked') return;
  if (pushTimer) clearTimeout(pushTimer);
  setSyncState({ status: 'pending' });
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncOnce();
  }, PUSH_DEBOUNCE_MS);
};

/** 监听 store 写操作（脏标记 → 防抖上行）；幂等，模块首次使用时注册。
 * v2.0.0：档位上行通道（setTier）已随测试模式移除——档位以云端 members（支付回调写入）为唯一权威，
 * 仅在 login / 会员页支付开通后回写本地，客户端不再上报。 */
const registerWatcher = (): void => {
  if (watcherRegistered) return;
  watcherRegistered = true;
  useWardrobeStore.subscribe((state, prev) => {
    if (state.syncMeta.dirty && state.syncMeta.dataVersion !== prev.syncMeta.dataVersion) {
      schedulePush();
    }
  });
};

/** 回到前台：开关开启时立即同步一轮（设计方案 5.4） */
export const onAppShow = (): void => {
  if (!CLOUD_READY) return;
  registerWatcher();
  const s = useWardrobeStore.getState();
  if (!s.syncMeta.openid) return;
  // v1.15.1：档位门控——free 不同步（含开关残留纠正）
  if (!canSync()) {
    if (s.cloudSyncEnabled) s.setCloudSyncEnabled(false);
    return;
  }
  if (!s.cloudSyncEnabled) return;
  void syncOnce();
};

/** 应用启动：注册脏标记监听 + 静默登录（强制登录，失败自动重试） */
export const initSync = (): void => {
  if (!CLOUD_READY) return;
  registerWatcher();
  void loginAndSync();
};

/** 手动同步（mine 页「立即同步」；登录失败时先重试登录；v1.19.0 被顶下线时重新登录接管；
 * v2.2.0：重置冲突待处理标记——手动同步重新弹出冲突处理选择） */
export const syncNow = async (): Promise<boolean> => {
  if (!CLOUD_READY) return false;
  conflictPending = false;
  const st = useSyncStore.getState();
  if (!useWardrobeStore.getState().syncMeta.openid || st.status === 'kicked') {
    retryCount = 0;
    await loginAndSync(); // 重新登录即接管活跃设备（顶掉另一端）
  }
  if (useSyncStore.getState().status === 'kicked') return false; // 登录失败仍处 kicked
  return syncOnce();
};

/** ---------- 云同步开关 ---------- */

/**
 * 开关切换（设计方案 5.1 第 4 条：默认关闭，用户手动开启）。
 * 开启：校验档位权益 → 未登录先登录 → 开关写入本地 → 立即同步一轮；
 * 关闭：停止后续 push/pull 与照片上传（登录态与本地数据保留）。
 * 返回是否成功变更。
 */
export const setCloudSync = async (enabled: boolean): Promise<boolean> => {
  const s = useWardrobeStore.getState();
  if (enabled && tierOf(s.memberTier).cloudSync !== 'cloud') {
    Taro.showToast({ title: '云同步为 VIP/SVIP 权益，请升级会员', icon: 'none' });
    return false;
  }
  if (enabled && !s.syncMeta.openid) {
    retryCount = 0;
    await loginAndSync();
    if (!useWardrobeStore.getState().syncMeta.openid) {
      Taro.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
      return false;
    }
  }
  s.setCloudSyncEnabled(enabled);
  if (enabled) {
    // v1.15.1：开启成功给出明确反馈，随后立即同步一轮
    Taro.showToast({ title: '云同步已开启', icon: 'success', duration: 1500 });
    void syncOnce();
  } else {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    setSyncState({ status: 'disabled' });
  }
  return true;
};

/** ---------- 照片上传（设计方案 7） ---------- */

/**
 * 本地路径判定（v1.17.1 修复）：微信开发者工具 wx.chooseMedia 返回的临时文件形如
 * http://tmp/xxx.jpg——http 前缀但属本地临时文件。旧逻辑按 http:// 前缀直接判为远程 URL，
 * 导致开发者工具内照片从未上传云存储，快照里全是失效临时路径，云同步后另一端无图可显。
 */
const isLocalPath = (p: string): boolean => {
  if (!p) return false;
  if (p.startsWith('cloud://')) return false; // 已是云存储 fileID
  if (/^https?:\/\/tmp\//i.test(p)) return true; // 开发者工具临时文件
  if (p.startsWith('http://') || p.startsWith('https://')) return false; // 真远程 URL
  return true; // wxfile:// 等本地路径
};

const getUploadMap = (): Record<string, string> => {
  try {
    return Taro.getStorageSync(PHOTO_UPLOAD_MAP_KEY) || {};
  } catch (e) {
    return {};
  }
};

const saveUploadMap = (map: Record<string, string>): void => {
  try {
    Taro.setStorageSync(PHOTO_UPLOAD_MAP_KEY, map);
  } catch (e) {
    console.warn('[Sync] 上传映射写入失败', e);
  }
};

const uploadOne = async (filePath: string, cloudPath: string): Promise<string> => {
  const res = await Taro.cloud.uploadFile({ cloudPath, filePath });
  if (!res || !res.fileID) throw new Error('上传失败');
  return res.fileID;
};

/**
 * 扫描同步范围内衣物/日记/试穿照片的本地路径，分批上传云存储并回填 fileID。
 * 按本地路径去重（已上传不重复传）；超出档位容量的照片跳过（提示一次，不阻断文字数据同步）。
 * 推荐产物（明日穿搭方案、当季 AI 推荐图）不上传、不占容量。
 */
export const uploadPendingPhotos = async (): Promise<void> => {
  const s = useWardrobeStore.getState();
  // v1.15.1：档位门控——照片上传仅 VIP/SVIP（free 容量为 0，quotaBytes 校验不足够前置）
  if (!s.syncMeta.openid || !s.cloudSyncEnabled || !canSync()) return;
  // v1.19.0：kicked 态不上传照片
  if (useSyncStore.getState().status === 'kicked') return;
  const openid = s.syncMeta.openid;
  const selected = new Set(s.syncWardrobeIds || []);
  const uploadMap = getUploadMap();
  const quotaBytes = useSyncStore.getState().photoQuotaMB * 1024 * 1024;

  // 收集待上传：{ kind, id, index, path }，仅同步范围内条目
  const pending: { kind: 'item' | 'diary' | 'tryout'; id: string; path: string; dir: string }[] = [];
  s.items
    .filter((it) => selected.has(it.wardrobeId))
    .forEach((it) => {
      it.photos.forEach((p) => {
        if (isLocalPath(p) && !uploadMap[p]) {
          pending.push({ kind: 'item', id: it.id, path: p, dir: `user/${openid}/items/${it.id}` });
        }
      });
    });
  s.diaryEntries
    .filter((d) => selected.has(d.wardrobeId))
    .forEach((d) => {
      d.photos.forEach((p) => {
        if (isLocalPath(p) && !uploadMap[p]) {
          pending.push({ kind: 'diary', id: d.id, path: p, dir: `user/${openid}/diary/${d.id}` });
        }
      });
    });
  // v1.21.0：试穿照片随同步上传（此前缺失导致快照内为本地临时路径，换端/临时文件清理后无法显示）
  s.tryoutItems
    .filter((t) => selected.has(t.wardrobeId))
    .forEach((t) => {
      (t.photos || []).forEach((p) => {
        if (isLocalPath(p) && !uploadMap[p]) {
          pending.push({ kind: 'tryout', id: t.id, path: p, dir: `user/${openid}/tryout/${t.id}` });
        }
      });
    });
  if (pending.length === 0) return;

  // 容量检查：按档位约束，超出跳过（不阻断文字数据同步）
  let overQuota = false;
  const allowed = quotaBytes > 0
    ? pending.slice(0, Math.max(0, Math.floor((quotaBytes - useSyncStore.getState().photoBytes) / (200 * 1024))))
    : pending;
  if (allowed.length < pending.length) overQuota = true;

  let uploadedBytes = 0;
  for (let i = 0; i < allowed.length; i += PHOTO_BATCH) {
    const batch = allowed.slice(i, i + PHOTO_BATCH);
    await Promise.all(
      batch.map(async (task, idx) => {
        const cloudPath = `${task.dir}/${Date.now()}_${idx}.jpg`;
        try {
          const fileID = await uploadOne(task.path, cloudPath);
          uploadMap[task.path] = fileID;
          uploadedBytes += 150 * 1024; // 压缩后单张估算值，photoStat 以此累计
        } catch (e: any) {
          console.warn('[Sync] 照片上传失败（下次续传）:', task.path, e?.message || e);
        }
      })
    );
    // 批次结束后按条目回填 fileID（不打脏，展示优先 fileID、本地路径作离线缓存）
    const touched = new Map<string, 'item' | 'diary' | 'tryout'>();
    batch.forEach((t) => touched.set(`${t.kind}:${t.id}`, t.kind));
    const replacements: { kind: 'item' | 'diary' | 'tryout'; id: string; photos: string[] }[] = [];
    const cur = useWardrobeStore.getState();
    touched.forEach((kind, key) => {
      const id = key.slice(kind.length + 1);
      const entry =
        kind === 'item'
          ? cur.items.find((x) => x.id === id)
          : kind === 'diary'
            ? cur.diaryEntries.find((x) => x.id === id)
            : cur.tryoutItems.find((x) => x.id === id);
      if (!entry) return;
      replacements.push({ kind, id, photos: entry.photos.map((p) => uploadMap[p] || p) });
    });
    useWardrobeStore.getState().replacePhotoPaths(replacements);
  }
  saveUploadMap(uploadMap);
  if (uploadedBytes > 0) {
    try {
      await Taro.cloud.callFunction({
        name: USER_SYNC_FN_NAME,
        data: { action: 'photoStat', delta: uploadedBytes, deviceId: getDeviceId() }
      });
      setSyncState({
        photoBytes: useSyncStore.getState().photoBytes + uploadedBytes
      });
    } catch (e) {
      console.warn('[Sync] 容量计量上报失败（不影响数据）', e);
    }
  }
  if (overQuota) {
    Taro.showToast({ title: '部分照片超出云容量，未上传；可清理或升级', icon: 'none' });
  }
};

/** ---------- 删除云端数据（设计方案 9.5；M1 物理删除快照，users 标记注销 30 天宽限） ---------- */

export const deleteCloudData = async (): Promise<boolean> => {
  if (!CLOUD_READY) return false;
  const s = useWardrobeStore.getState();
  if (!s.syncMeta.openid) {
    Taro.showToast({ title: '尚未登录云端', icon: 'none' });
    return false;
  }
  try {
    const res = await Taro.cloud.callFunction({
      name: USER_SYNC_FN_NAME,
      data: { action: 'deleteCloud' }
    });
    const result = res.result as { code: string; message?: string };
    if (result.code !== 'OK') throw new Error(result.message || '删除失败');
    // 本地数据保留；对齐同步游标（服务端版本已重置为 0），以当前本地数据重新上行
    useWardrobeStore.getState().patchSyncMeta({
      lastSyncedVersion: 0,
      dirty: true,
      lastSyncedAt: 0
    });
    setSyncState({ hasRemote: false, photoBytes: 0, status: 'ready', errorMsg: '' });
    console.info('[Sync] 云端数据已删除（本地数据保留）');
    // v1.16.0：删除成功后立即以本地干净数据重建云端（修复残留脏数据导致重复衣橱/衣物的问题）
    void syncNow();
    return true;
  } catch (e: any) {
    console.warn('[Sync] 删除云端数据失败:', e?.message || e);
    Taro.showToast({ title: e?.message || '删除失败', icon: 'none' });
    return false;
  }
};
