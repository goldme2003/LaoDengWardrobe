/** 云同步服务（v1.15.0，R-5 M1，见《云端同步设计方案-v1.13.0》）
 * 职责：
 *   1. 微信授权静默登录（userSync 云函数，openid 维度，失败指数退避重试，不阻塞本地功能）；
 *   2. 全量快照上下行（pull / push，乐观锁 baseVersion）；
 *   3. 实体合并（设计方案 5.5：按 id 合并、updatedAt 新者胜、计数器取 max、集合取并集、合并原子化）；
 *   4. 同步范围裁剪（4.4：所选衣橱 + 衣物/日记/备选/身体数据/计数器 + 全局自定义项/品牌/场景；
 *      明日穿搭勾选、推荐缓存、推荐产物、城市、会员用量不上云）；
 *   5. 3s 防抖上行（commit 打脏后自动触发，冲突待处理时暂停）；
 *   6. 照片上传（仅衣物/日记照片，分批 5 张、路径去重、容量按档位约束、fileID 回填不打脏）；
 *   7. 快照冲突三选一（使用云端 / 保留本地 / 稍后处理）。
 * 仅微信端可用（CLOUD_READY）；H5 端所有入口静默返回，不阻塞本地功能。
 * 云同步开关默认关闭：开启后才发起任何云端数据请求（登录本身除外，仅返回身份与档位）。 */
import Taro from '@tarojs/taro';
import { create } from 'zustand';
import { CLOUD_READY } from '@/config/cloud';
import { USER_SYNC_FN_NAME } from '@/config/cloud';
import { useWardrobeStore, LdwData } from '@/store/useWardrobeStore';
import { tierOf, MemberTier } from '@/services/entitlement';
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
  | 'conflict' // 冲突待用户选择
  | 'error'; // 登录或同步失败（可重试）

/** 快照冲突信息（快照级，三选一） */
export interface SnapshotConflict {
  localData: SnapshotData;
  remoteData: SnapshotData | null;
  localVersion: number;
  remoteVersion: number;
  createdAt: number;
}

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
  currentWardrobeId: string;
}

interface SyncState {
  status: SyncStatus;
  openid: string;
  tier: MemberTier;
  /** 服务端权威上限：可同步衣橱数（VIP 2 / SVIP 999≈全部） */
  maxWardrobes: number;
  /** 服务端权威上限：照片容量 MB */
  photoQuotaMB: number;
  photoBytes: number;
  hasRemote: boolean;
  lastSyncedAt: number;
  errorMsg: string;
  conflict: SnapshotConflict | null;
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
  errorMsg: '',
  conflict: null
}));

const setSyncState = (patch: Partial<SyncState>) => useSyncStore.setState(patch);

const PUSH_DEBOUNCE_MS = 3000;
/** 指数退避重试上限（登录与同步共用，超限后停止自动重试，可手动触发） */
const MAX_RETRY = 5;
const RETRY_BASE_MS = 2000;
const PHOTO_BATCH = 5;
const PHOTO_UPLOAD_MAP_KEY = 'ldw_photo_upload_map';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let syncing = false;
let watcherRegistered = false;

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
    currentWardrobeId: typeof raw.currentWardrobeId === 'string' ? raw.currentWardrobeId : ''
  };
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
    currentWardrobeId
  };
};

/**
 * 实体合并（设计方案 5.5）：在内存中完成合并计算，结果经 applySyncMerge 一次 commit 写入（原子化）。
 * 规则：仅本地 → 保留；仅云端 → 写入；同 id → updatedAt||createdAt 新者胜；
 * customOptions 按 dimension+value 并集；customScenes/favoriteBrands 字符串并集；
 * counters 取 max（计数器单调递增）；bodyProfiles 本地优先（无时间戳字段）。
 */
export const mergeSnapshot = (
  local: LdwData,
  remote: SnapshotData
): { patch: Partial<LdwData>; stats: { wardrobes: number; items: number; diary: number; tryout: number } } => {
  const wardrobes = [...local.wardrobes];
  const wardrobeMap = new Map(wardrobes.map((w) => [w.id, w]));
  let wardrobeWins = 0;
  remote.wardrobes.forEach((rw) => {
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

  const items = [...local.items];
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

  const diary = [...local.diaryEntries];
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

  const tryout = [...local.tryoutItems];
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

  // 身体数据本地优先（无时间戳，设计方案 5.5 简化：仅云端存在的衣橱写入）
  const bodyProfiles = { ...local.bodyProfiles };
  Object.entries(remote.bodyProfiles || {}).forEach(([wid, bp]) => {
    if (!bodyProfiles[wid]) bodyProfiles[wid] = bp;
  });

  // 当前衣橱：本地选择优先；本地值失效时回落
  const mergedIds = wardrobes.map((w) => w.id);
  const currentWardrobeId = mergedIds.includes(local.currentWardrobeId)
    ? local.currentWardrobeId
    : mergedIds[0] || local.currentWardrobeId;

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
      currentWardrobeId
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
  // 会员档位以服务端为准（设计方案 5.1 第 3 条；测试期服务端 free 时回落客户端上报值）
  if (res.tier !== store.memberTier) {
    store.setMemberTier(res.tier);
  }
  setSyncState({
    openid: res.openid,
    tier: res.tier,
    maxWardrobes: res.maxWardrobes,
    photoQuotaMB: res.photoQuotaMB,
    photoBytes: res.photoBytes,
    hasRemote: res.hasRemote,
    errorMsg: ''
  });
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
      data: { action: 'login', tier: store.memberTier }
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
    const enabled = useWardrobeStore.getState().cloudSyncEnabled;
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

const pushSnapshot = async (force = false): Promise<boolean> => {
  const s = useWardrobeStore.getState();
  if (!s.syncMeta.dirty && !force) return true;
  const meta: SyncMeta = s.syncMeta;
  const data = buildSnapshotData(s);
  const res = await Taro.cloud.callFunction({
    name: USER_SYNC_FN_NAME,
    data: {
      action: 'push',
      baseVersion: meta.lastSyncedVersion,
      dataVersion: meta.dataVersion,
      data,
      force
    }
  });
  const result = res.result as { code: string; message?: string } & Record<string, any>;
  if (result.code === 'OK') {
    markSynced(result.dataVersion || meta.dataVersion);
    setSyncState({ status: 'ready', hasRemote: true, conflict: null });
    console.info('[Sync] 上行成功, dataVersion =', result.dataVersion);
    return true;
  }
  if (result.code === 'CONFLICT') {
    // 快照级冲突：写副本在服务端完成，客户端三选一（设计方案 6.3）
    const remote = normalizeSnapshot(result.remoteData);
    setSyncState({
      status: 'conflict',
      conflict: {
        localData: data,
        remoteData: remote,
        localVersion: meta.dataVersion,
        remoteVersion: result.remoteVersion || 0,
        createdAt: Date.now()
      },
      errorMsg: ''
    });
    console.warn('[Sync] 上行冲突, remoteVersion =', result.remoteVersion);
    return false;
  }
  throw new Error(result.message || '上行失败');
};

/** pull + 合并（设计方案 5.4/5.5） */
const pullAndMerge = async (): Promise<void> => {
  const res = await Taro.cloud.callFunction({
    name: USER_SYNC_FN_NAME,
    data: { action: 'pull' }
  });
  const result = res.result as { code: string; data?: Partial<SnapshotData>; dataVersion?: number };
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
  console.info(
    '[Sync] 云端合并完成, 衣橱覆盖 =', stats.wardrobes,
    '衣物覆盖 =', stats.items,
    '日记覆盖 =', stats.diary,
    '备选覆盖 =', stats.tryout
  );
};

/** 完整同步一轮：pull 合并 → 照片上传 → push（照片回填后上行携带 fileID） */
export const syncOnce = async (): Promise<boolean> => {
  if (!CLOUD_READY || syncing) return false;
  const s = useWardrobeStore.getState();
  if (!s.syncMeta.openid || !s.cloudSyncEnabled) return false;
  syncing = true;
  setSyncState({ status: 'syncing' });
  try {
    await pullAndMerge();
    await uploadPendingPhotos();
    await pushSnapshot();
    retryCount = 0;
    syncing = false;
    setSyncState({ status: useSyncStore.getState().status === 'conflict' ? 'conflict' : 'ready' });
    return true;
  } catch (e: any) {
    syncing = false;
    console.warn('[Sync] 同步失败（稍后重试）:', e?.message || e);
    setSyncState({ status: 'error', errorMsg: e?.message || '同步失败' });
    return false;
  }
};

/** 3s 防抖上行（store commit 打脏后经订阅触发） */
export const schedulePush = (): void => {
  if (!CLOUD_READY) return;
  const s = useWardrobeStore.getState();
  if (!s.cloudSyncEnabled || !s.syncMeta.openid) return;
  if (useSyncStore.getState().status === 'conflict') return;
  if (pushTimer) clearTimeout(pushTimer);
  setSyncState({ status: 'pending' });
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncOnce();
  }, PUSH_DEBOUNCE_MS);
};

/** 监听 store 写操作（脏标记 → 防抖上行）；幂等，模块首次使用时注册 */
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
  if (!s.cloudSyncEnabled) return;
  void syncOnce();
};

/** 应用启动：注册脏标记监听 + 静默登录（强制登录，失败自动重试） */
export const initSync = (): void => {
  if (!CLOUD_READY) return;
  registerWatcher();
  void loginAndSync();
};

/** 手动同步（mine 页「立即同步」；登录失败时先重试登录） */
export const syncNow = async (): Promise<boolean> => {
  if (!CLOUD_READY) return false;
  if (!useWardrobeStore.getState().syncMeta.openid) {
    retryCount = 0;
    await loginAndSync();
  }
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
    void syncOnce();
  } else {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    setSyncState({ status: 'disabled', conflict: null });
  }
  return true;
};

/** ---------- 快照冲突三选一（设计方案 6.3） ---------- */

/** 冲突选择：使用云端版本（先合并云端数据，本地独有数据保留并随新版本上行） */
export const resolveConflictUseRemote = async (): Promise<void> => {
  const { conflict } = useSyncStore.getState();
  if (!conflict) return;
  const remote = normalizeSnapshot(conflict.remoteData);
  if (remote && remote.wardrobes.length > 0) {
    const local = useWardrobeStore.getState();
    const { patch } = mergeSnapshot(local, remote);
    local.applySyncMerge(patch);
  }
  // 上行成功后 lastSyncedVersion 对齐远端版本，本地剩余独有变更随新版本 push
  useWardrobeStore.getState().patchSyncMeta({ lastSyncedVersion: conflict.remoteVersion, dirty: true });
  setSyncState({ status: 'pending', conflict: null });
  await pushSnapshot();
};

/** 冲突选择：保留本地版本（强制上行，生成新版本号） */
export const resolveConflictKeepLocal = async (): Promise<void> => {
  setSyncState({ status: 'pending', conflict: null });
  await pushSnapshot(true);
};

/** 冲突选择：稍后处理（保持本地可继续使用，状态条提示待处理冲突） */
export const deferConflict = (): void => {
  setSyncState({ status: 'pending' });
};

/** ---------- 照片上传（设计方案 7） ---------- */

const isLocalPath = (p: string): boolean =>
  !!p && !p.startsWith('cloud://') && !p.startsWith('http://') && !p.startsWith('https://');

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
 * 扫描同步范围内衣物/日记照片的本地路径，分批上传云存储并回填 fileID。
 * 按本地路径去重（已上传不重复传）；超出档位容量的照片跳过（提示一次，不阻断文字数据同步）。
 * 推荐产物（明日穿搭方案、当季 AI 推荐图）不上传、不占容量。
 */
export const uploadPendingPhotos = async (): Promise<void> => {
  const s = useWardrobeStore.getState();
  if (!s.syncMeta.openid || !s.cloudSyncEnabled) return;
  const openid = s.syncMeta.openid;
  const selected = new Set(s.syncWardrobeIds || []);
  const uploadMap = getUploadMap();
  const quotaBytes = useSyncStore.getState().photoQuotaMB * 1024 * 1024;

  // 收集待上传：{ kind, id, index, path }，仅同步范围内条目
  const pending: { kind: 'item' | 'diary'; id: string; path: string; dir: string }[] = [];
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
    const touched = new Map<string, 'item' | 'diary'>();
    batch.forEach((t) => touched.set(`${t.kind}:${t.id}`, t.kind));
    const replacements: { kind: 'item' | 'diary'; id: string; photos: string[] }[] = [];
    const cur = useWardrobeStore.getState();
    touched.forEach((kind, key) => {
      const id = key.slice(kind.length + 1);
      const entry =
        kind === 'item'
          ? cur.items.find((x) => x.id === id)
          : cur.diaryEntries.find((x) => x.id === id);
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
        data: { action: 'photoStat', delta: uploadedBytes }
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
    // 本地数据保留；对齐同步游标，下次开启同步后以当前本地数据重新上行
    useWardrobeStore.getState().patchSyncMeta({
      lastSyncedVersion: 0,
      dirty: true,
      lastSyncedAt: 0
    });
    setSyncState({ hasRemote: false, photoBytes: 0, status: 'ready', conflict: null, errorMsg: '' });
    console.info('[Sync] 云端数据已删除（本地数据保留）');
    return true;
  } catch (e: any) {
    console.warn('[Sync] 删除云端数据失败:', e?.message || e);
    Taro.showToast({ title: e?.message || '删除失败', icon: 'none' });
    return false;
  }
};
