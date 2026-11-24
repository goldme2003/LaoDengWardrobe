/** 云同步云函数（v1.15.0，R-5 M1）
 * 入参：{ action: 'ping' | 'login' | 'pull' | 'push' | 'deleteCloud' | 'photoStat', ... }
 * 出参（均 { code, ... }）：
 *   login      → { code:'OK', openid, tier, dataVersion, hasRemote, photoBytes, maxWardrobes, photoQuotaMB }
 *   pull       → { code:'OK', dataVersion, updatedAt, data }（data = null 表示云端无快照）
 *   push       → { code:'OK'|'CONFLICT', dataVersion?, remoteVersion?, remoteData?, conflictId? }
 *   deleteCloud→ { code:'OK' }
 *   photoStat  → { code:'OK', photoBytes }
 * 说明：
 *   1. 登录方式为微信授权静默登录：服务端经 cloud.getWXContext().OPENID 识别微信号身份，全程无弹窗；
 *   2. 会员档位以服务端为准：members 集合订单校验；微信支付未开通的测试期，若服务端为 free
 *      且客户端上报 vip/svip（本地测试开通），采用客户端上报值写入 users.tier（支付接入后移除该回落）；
 *   3. 快照为单用户全量文档（同步范围见设计方案 4.4：所选衣橱 + 衣物 + 日记 + 自定义项/场景 +
 *      喜爱品牌 + 备选条目 + 身体数据 + 编号计数器；明日穿搭勾选/推荐缓存/推荐产物不上云）；
 *   4. push 快照版本冲突时写入 sync_conflicts 副本（统一保留 30 天，M3 做过期清理），不覆盖任何一方；
 *   5. 需在云开发控制台创建集合：users、wardrobe_snapshots、sync_conflicts（权限：仅管理端可读写）。 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const CONFLICT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

/** 档位约束（与前端 entitlement.ts 保持一致）：VIP 可同步 2 个衣橱 / 500MB 照片，SVIP 全部 / 2GB */
const TIER_LIMITS = {
  free: { maxWardrobes: 0, photoQuotaMB: 0 },
  vip: { maxWardrobes: 2, photoQuotaMB: 500 },
  svip: { maxWardrobes: 999, photoQuotaMB: 2048 }
};

/** 会员档位：members 订单校验（与 member 云函数 contextTier 口径一致） */
async function tierFromOrders(openid) {
  try {
    const res = await db.collection('members').where({ openid }).limit(1).get();
    const doc = res.data && res.data[0];
    if (doc && (doc.tier === 'vip' || doc.tier === 'svip')) return doc.tier;
    return 'free';
  } catch (e) {
    console.error('[userSync] 查询会员档位失败：', e.message);
    return 'free';
  }
}

async function getUser(openid) {
  try {
    const res = await db.collection('users').doc(openid).get();
    return res && res.data ? res.data : null;
  } catch (e) {
    return null;
  }
}

async function getSnapshot(openid) {
  try {
    const res = await db.collection('wardrobe_snapshots').doc(openid).get();
    return res && res.data ? res.data : null;
  } catch (e) {
    return null;
  }
}

/** 注销宽限判断：deletedAt 在 30 天内 = 宽限期（登录自动恢复），过期 = 视为新用户重置 */
function inGrace(user) {
  if (!user || !user.deletedAt) return false;
  return Date.now() - user.deletedAt < CONFLICT_RETENTION_DAYS * DAY_MS;
}

exports.main = async (event = {}) => {
  const action = event.action || 'login';
  console.log(`[userSync] v1.15.0 action=${action}`);

  if (action === 'ping') {
    return {
      code: 'OK',
      collections: ['users', 'wardrobe_snapshots', 'sync_conflicts'],
      conflictRetentionDays: CONFLICT_RETENTION_DAYS
    };
  }

  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { code: 'UNAUTHORIZED', message: '无法获取微信身份' };
  }

  // ---------- 登录：openid 维度 upsert，返回档位与云端数据状态 ----------
  if (action === 'login') {
    const now = Date.now();
    let user = await getUser(OPENID);
    let reset = false;
    if (user && !inGrace(user)) {
      // 超过 30 天宽限：本地视为新用户（物理删除由 M3 定期任务执行，此处先重置口径）
      reset = true;
    }
    if (!user || reset) {
      user = { _id: OPENID, tier: 'free', dataVersion: 0, photoBytes: 0, createdAt: now };
    }

    // 档位：订单校验优先；测试期（无订单）采用客户端上报档位，支付接入后移除
    const serverTier = await tierFromOrders(OPENID);
    let tier = serverTier;
    const clientTier = ['vip', 'svip'].includes(event.tier) ? event.tier : 'free';
    if (serverTier === 'free' && clientTier !== 'free') {
      tier = clientTier;
    }

    // 宽限期内登录：清除删除标记自动恢复
    const patch = {
      tier,
      updatedAt: now,
      ...(user.deletedAt && inGrace(user) ? { deletedAt: null } : {})
    };
    if (reset) patch.deletedAt = null;
    try {
      await db.collection('users').doc(OPENID).set({ data: { ...user, ...patch } });
    } catch (e) {
      console.error('[userSync] 用户档案写入失败：', e.message);
      return { code: 'DB_ERROR', message: '用户档案写入失败' };
    }

    const snap = await getSnapshot(OPENID);
    const hasRemote = !!(snap && snap.data && Object.keys(snap.data).length > 0 && !reset);
    const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
    return {
      code: 'OK',
      openid: OPENID,
      tier,
      dataVersion: hasRemote ? snap.dataVersion || 0 : 0,
      hasRemote,
      photoBytes: reset ? 0 : user.photoBytes || 0,
      maxWardrobes: limits.maxWardrobes,
      photoQuotaMB: limits.photoQuotaMB
    };
  }

  // ---------- 下行：返回云端全量快照（合并由客户端执行，见设计方案 5.5） ----------
  if (action === 'pull') {
    const user = await getUser(OPENID);
    if (!user) return { code: 'OK', dataVersion: 0, updatedAt: 0, data: null };
    const snap = await getSnapshot(OPENID);
    if (!snap || !snap.data) return { code: 'OK', dataVersion: 0, updatedAt: 0, data: null };
    return {
      code: 'OK',
      dataVersion: snap.dataVersion || 0,
      updatedAt: snap.updatedAt || 0,
      data: snap.data
    };
  }

  // ---------- 上行：全量快照 + 乐观锁；冲突写副本（30 天），不覆盖任何一方 ----------
  if (action === 'push') {
    const { baseVersion, dataVersion, data, force } = event;
    if (!data || typeof dataVersion !== 'number') {
      return { code: 'BAD_PARAM', message: '缺少快照数据或版本号' };
    }
    const now = Date.now();
    let user = await getUser(OPENID);
    if (!user) {
      try {
        user = { _id: OPENID, tier: 'free', dataVersion: 0, photoBytes: 0, createdAt: now };
        await db.collection('users').doc(OPENID).set({ data: user });
      } catch (e) {
        return { code: 'DB_ERROR', message: '用户档案初始化失败' };
      }
    }
    const serverVersion = user.dataVersion || 0;
    const accepted = force || baseVersion === serverVersion;
    if (!accepted) {
      // 快照级冲突：写副本（仅保留差异侧由客户端三选一时对比，M1 双侧均存）
      const snap = await getSnapshot(OPENID);
      const remoteData = snap && snap.data ? snap.data : null;
      let conflictId = '';
      try {
        const res = await db.collection('sync_conflicts').add({
          data: {
            openid: OPENID,
            entity: 'snapshot',
            localVersion: dataVersion,
            remoteVersion: serverVersion,
            localData: data,
            remoteData,
            status: 'pending',
            createdAt: now
          }
        });
        conflictId = res._id || '';
      } catch (e) {
        console.error('[userSync] 冲突副本写入失败：', e.message);
      }
      return {
        code: 'CONFLICT',
        remoteVersion: serverVersion,
        remoteData,
        conflictId,
        message: '数据已在其他设备更新'
      };
    }

    // 接受上行：版本号取 max(客户端版本, 服务端+1)，保证单调递增
    const nextVersion = accepted && baseVersion !== serverVersion
      ? Math.max(dataVersion, serverVersion + 1)
      : Math.max(dataVersion, baseVersion + 1);
    try {
      await db
        .collection('wardrobe_snapshots')
        .doc(OPENID)
        .set({ data: { dataVersion: nextVersion, updatedAt: now, data } });
      await db
        .collection('users')
        .doc(OPENID)
        .update({ data: { dataVersion: nextVersion, updatedAt: now } });
    } catch (e) {
      console.error('[userSync] 快照写入失败：', e.message);
      return { code: 'DB_ERROR', message: '快照写入失败' };
    }
    return { code: 'OK', dataVersion: nextVersion };
  }

  // ---------- 删除云端数据：物理删除快照与冲突副本，users 重置并标记注销（30 天宽限内登录自动恢复） ----------
  if (action === 'deleteCloud') {
    const now = Date.now();
    try {
      await db.collection('wardrobe_snapshots').doc(OPENID).remove();
    } catch (e) {
      // 快照不存在视为已删除
    }
    try {
      await db.collection('sync_conflicts').where({ openid: OPENID }).remove();
    } catch (e) {
      console.error('[userSync] 冲突副本清理失败：', e.message);
    }
    const user = await getUser(OPENID);
    const base = user || { _id: OPENID, tier: 'free', createdAt: now };
    try {
      await db.collection('users').doc(OPENID).set({
        data: { ...base, dataVersion: 0, photoBytes: 0, deletedAt: now, updatedAt: now }
      });
    } catch (e) {
      console.error('[userSync] 注销标记写入失败：', e.message);
      return { code: 'DB_ERROR', message: '注销标记写入失败' };
    }
    return { code: 'OK' };
  }

  // ---------- 照片容量计量：上传/删除照片后由客户端上报增量 ----------
  if (action === 'photoStat') {
    const delta = Number(event.delta) || 0;
    try {
      const user = await getUser(OPENID);
      const base = user || { _id: OPENID, tier: 'free', dataVersion: 0, photoBytes: 0, createdAt: Date.now() };
      const next = Math.max(0, (base.photoBytes || 0) + delta);
      await db.collection('users').doc(OPENID).set({
        data: { ...base, photoBytes: next, updatedAt: Date.now() }
      });
      return { code: 'OK', photoBytes: next };
    } catch (e) {
      console.error('[userSync] 容量计量失败：', e.message);
      return { code: 'DB_ERROR', message: '容量计量失败' };
    }
  }

  return { code: 'BAD_PARAM', message: '未知 action' };
};
