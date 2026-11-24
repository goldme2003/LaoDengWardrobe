import React, { useMemo, useState } from 'react';
import { View, Text, Switch } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { APP_VERSION, GENDER_OPTIONS, BODY_FIELD_DEFS, themeVarsOf } from '@/data/presets';
import { tierOf } from '@/services/entitlement';
import {
  useSyncStore,
  setCloudSync,
  syncNow,
  deleteCloudData,
  resolveConflictUseRemote,
  resolveConflictKeepLocal,
  deferConflict
} from '@/services/sync';
import { exportBackup } from '@/services/exportBackup';
import { BodyProfile } from '@/types';
import styles from './index.module.scss';

const UNFILLED = '未填写';

/** v0.7.0：信息卡摘要字段（身高/胸围/腰围/臀围/肩宽，按此顺序取已填项拼接） */
const SUMMARY_FIELD_KEYS: (keyof BodyProfile)[] = ['height', 'bust', 'waist', 'hip', 'shoulderWidth'];

/** 常用衣物尺寸摘要字段（v0.7.0 用户意见 5） */
const SIZE_SUMMARY_FIELD_KEYS: (keyof BodyProfile)[] = ['topSize', 'pantsSize', 'shoeSize'];

/** 我的页（v0.6）：统计跳转、个人信息卡、关于
 * v0.7.0：信息卡展示身体数据摘要；v0.7.0 用户意见 5：点击信息卡跳转独立「修改个人信息」页（身高文本框 + 常用衣物尺寸） */
const MinePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const tryoutItems = useWardrobeStore((s) => s.tryoutItems);
  const bodyProfile = useWardrobeStore((s) => s.bodyProfiles[s.currentWardrobeId]) || {};
  const setWardrobeFilterPreset = useWardrobeStore((s) => s.setWardrobeFilterPreset);

  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const totalCount = items.length;
  const favoriteCount = items.filter((it) => it.favorite).length;
  const tryoutCount = tryoutItems.filter((t) => t.wardrobeId === currentWardrobeId).length;

  // v0.6：统计项点击跳转
  const goHome = () => Taro.switchTab({ url: '/pages/wardrobe/index' });
  const goFavorites = () => {
    setWardrobeFilterPreset('favorite');
    Taro.switchTab({ url: '/pages/wardrobe/index' });
  };
  const goTryout = () => Taro.switchTab({ url: '/pages/tryout/index' });
  const goWardrobes = () => Taro.navigateTo({ url: '/pages/wardrobes/index' });
  // v0.7.0 用户意见 5：个人信息修改改为独立页面（原弹层编辑移入该页）
  const goProfile = () => Taro.navigateTo({ url: '/pages/profile/index' });
  // v1.9.0（F-19）：会员中心
  const memberTier = useWardrobeStore((s) => s.memberTier);
  const memberLabel = tierOf(memberTier).label;
  const goMember = () => Taro.navigateTo({ url: '/pages/member/index' });

  // ===== v1.15.0（R-5 M1）：云同步 =====
  const cloudSyncEnabled = useWardrobeStore((s) => s.cloudSyncEnabled);
  const syncWardrobeIds = useWardrobeStore((s) => s.syncWardrobeIds);
  const setSyncWardrobeIds = useWardrobeStore((s) => s.setSyncWardrobeIds);
  const syncStatus = useSyncStore((s) => s.status);
  const syncErrorMsg = useSyncStore((s) => s.errorMsg);
  const conflict = useSyncStore((s) => s.conflict);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const hasRemote = useSyncStore((s) => s.hasRemote);
  const [conflictOpen, setConflictOpen] = useState(false);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const syncStatusInfo = useMemo(() => {
    const time = lastSyncedAt ? `${pad2(new Date(lastSyncedAt).getHours())}:${pad2(new Date(lastSyncedAt).getMinutes())}` : '';
    switch (syncStatus) {
      case 'logging-in':
        return { dot: '#e6a23c', text: '正在登录云端…' };
      case 'disabled':
        return { dot: '#909399', text: '云同步已关闭，数据仅保存在本机' };
      case 'syncing':
        return { dot: '#409eff', text: '同步中…' };
      case 'pending':
        return { dot: '#e6a23c', text: '有变更待上行（稍后自动同步）' };
      case 'ready':
        return { dot: '#67c23a', text: time ? `已同步 ${time}` : '已连接云端' };
      case 'conflict':
        return { dot: '#c0392b', text: '数据冲突待处理，本地功能不受影响' };
      case 'error':
        return { dot: '#c0392b', text: `云端未连接：${syncErrorMsg || '网络异常'}（可点「立即同步」重试）` };
      default:
        return { dot: '#909399', text: '未连接云端（启动后自动登录）' };
    }
  }, [syncStatus, syncErrorMsg, lastSyncedAt]);

  const handleSyncSwitch = async (e) => {
    const ok = await setCloudSync(e.detail.value);
    if (!ok) {
      Taro.showToast({ title: e.detail.value ? '未能开启云同步' : '已关闭', icon: 'none' });
    }
  };

  const handleSyncNow = async () => {
    Taro.showLoading({ title: '同步中…', mask: true });
    const ok = await syncNow();
    Taro.hideLoading();
    Taro.showToast({ title: ok ? '同步完成' : '同步未完成，请稍后重试', icon: 'none' });
  };

  const handleExport = async () => {
    const ok = await exportBackup();
    if (ok) {
      Taro.showToast({ title: '备份已导出，请在微信中保存', icon: 'none' });
    }
  };

  const handleDeleteCloud = () => {
    Taro.showModal({
      title: '删除云端数据',
      content: '将删除云端保存的衣橱/衣物/日记等同步数据（30 天宽限期内登录可恢复），本机数据不受影响。确定删除？',
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: async (res) => {
        if (!res.confirm) return;
        Taro.showLoading({ title: '删除中…', mask: true });
        const ok = await deleteCloudData();
        Taro.hideLoading();
        if (ok) Taro.showToast({ title: '云端数据已删除', icon: 'none' });
      }
    });
  };

  // 快照冲突三选一（设计方案 6.3）
  const handleConflictChoice = () => {
    Taro.showActionSheet({
      itemList: ['使用云端版本', '保留本地版本', '稍后处理'],
      success: async (res) => {
        if (res.tapIndex === 0) {
          Taro.showLoading({ title: '合并云端数据…', mask: true });
          await resolveConflictUseRemote();
          Taro.hideLoading();
        } else if (res.tapIndex === 1) {
          Taro.showLoading({ title: '上传本地数据…', mask: true });
          await resolveConflictKeepLocal();
          Taro.hideLoading();
        } else {
          deferConflict();
        }
      }
    });
  };

  // VIP 同步衣橱多选（VIP ≤2；SVIP 全部，不展示选择）
  const maxSync = tierOf(memberTier).maxSyncWardrobes;
  const selectedIds = syncWardrobeIds || [];
  const handleToggleWardrobe = (id: string) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length <= 1) {
        Taro.showToast({ title: '至少保留 1 个同步衣橱', icon: 'none' });
        return;
      }
      setSyncWardrobeIds(selectedIds.filter((v) => v !== id));
    } else {
      if (maxSync !== null && selectedIds.length >= maxSync) {
        Taro.showToast({ title: `VIP 最多同步 ${maxSync} 个衣橱，升级 SVIP 可同步全部`, icon: 'none' });
        return;
      }
      setSyncWardrobeIds([...selectedIds, id]);
    }
  };

  const genderLabel = GENDER_OPTIONS.find((g) => g.value === currentWardrobe?.gender)?.label || '-';
  // v0.7.0：身体数据摘要（已填项拼接，如「身高 170 · 胸围 92 · 肩宽 45」；全部未填显示「未填写」）
  const bodySummary = useMemo(() => {
    const defs = BODY_FIELD_DEFS.filter(
      (f) => SUMMARY_FIELD_KEYS.includes(f.key) && bodyProfile[f.key] !== undefined
    );
    if (defs.length === 0) return UNFILLED;
    return defs.map((f) => `${f.label} ${bodyProfile[f.key]}`).join(' · ');
  }, [bodyProfile]);
  // v0.7.0 用户意见 5：常用衣物尺寸摘要（上衣/裤装/鞋码已填项）
  const sizeSummary = useMemo(() => {
    const parts: string[] = [];
    const labels: Record<string, string> = { topSize: '上衣', pantsSize: '裤装', shoeSize: '鞋码' };
    SIZE_SUMMARY_FIELD_KEYS.forEach((k) => {
      const v = bodyProfile[k];
      if (v !== undefined && v !== '') parts.push(`${labels[k]} ${v}`);
    });
    return parts.length > 0 ? parts.join(' · ') : UNFILLED;
  }, [bodyProfile]);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  return (
    <View className={styles.page} style={themeStyle}>
      {/* v0.6 用户意见 8：统计项可点击跳转 */}
      <View className={styles.card}>
        <View className={styles.stats}>
          <View className={styles.statItem} onClick={goHome}>
            <Text className={styles.statNum}>{totalCount}</Text>
            <Text className={styles.statLabel}>衣物总数</Text>
          </View>
          <View className={styles.statItem} onClick={goFavorites}>
            <Text className={styles.statNum}>{favoriteCount}</Text>
            <Text className={styles.statLabel}>喜爱衣物</Text>
          </View>
          <View className={styles.statItem} onClick={goTryout}>
            <Text className={styles.statNum}>{tryoutCount}</Text>
            <Text className={styles.statLabel}>试穿</Text>
          </View>
          <View className={styles.statItem} onClick={goWardrobes}>
            <Text className={styles.statNum}>{wardrobes.length}</Text>
            <Text className={styles.statLabel}>衣橱数量</Text>
          </View>
        </View>
      </View>

      {/* v0.6 用户意见 1/2：个人信息卡（随衣橱联动）；v0.7.0 用户意见 5：点击跳转个人信息修改页 */}
      <View className={styles.card} onClick={goProfile}>
        <View className={styles.infoHeader}>
          <Text className={styles.sectionTitle}>个人信息</Text>
          <Text className={styles.infoEditHint}>点击修改 ›</Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>衣橱主人</Text>
          <Text className={styles.infoValue}>{currentWardrobe?.name || '-'}</Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>性别</Text>
          <Text className={styles.infoValue}>{genderLabel}</Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>年龄</Text>
          <Text className={styles.infoValue}>
            {currentWardrobe?.age !== null && currentWardrobe?.age !== undefined
              ? `${currentWardrobe.age} 岁`
              : UNFILLED}
          </Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>身体数据</Text>
          <Text className={styles.infoSummary}>{bodySummary}</Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>常用尺码</Text>
          <Text className={styles.infoSummary}>{sizeSummary}</Text>
        </View>
        <Text className={styles.cardTip}>
          身体数据为缝纫/尺码参考（均为选填），身高可直接输入，支持记录上衣、裤装、鞋码等常用衣物尺寸。
        </Text>
      </View>

      {/* v1.9.0（F-19）：会员中心入口 */}
      <View className={styles.card} onClick={goMember}>
        <View className={styles.wardrobeEntry}>
          <View className={styles.entryDot} style={{ background: '#b07d50' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>会员中心 · {memberLabel}</Text>
            <Text className={styles.entryDesc}>
              {memberTier === 'free'
                ? '升级 VIP/SVIP 解锁更多衣橱、出差推荐与综合穿搭'
                : '查看权益矩阵与当前档位权益'}
            </Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
      </View>

      {/* v1.15.0（R-5 M1）：云同步（状态条 / 开关 / 同步衣橱选择 / 冲突 / 删除云端数据 / 导出备份） */}
      <View className={styles.card}>
        <View className={styles.infoHeader}>
          <Text className={styles.sectionTitle}>云同步</Text>
          <Text className={styles.infoEditHint}>{memberLabel}</Text>
        </View>

        {/* 同步状态条 */}
        <View className={styles.syncStatusBar}>
          <View className={styles.syncDot} style={{ background: syncStatusInfo.dot }} />
          <Text className={styles.syncStatusText}>{syncStatusInfo.text}</Text>
        </View>

        {/* 云同步开关（默认关闭，设计方案 5.1 第 4 条） */}
        <View className={styles.syncSwitchRow}>
          <View className={styles.syncSwitchInfo}>
            <Text className={styles.entryTitle}>云同步</Text>
            <Text className={styles.entryDesc}>
              {memberTier === 'free'
                ? 'VIP/SVIP 权益：换设备不丢数据，登录后自动合并云端与本机数据'
                : '开启后衣物、日记等数据自动同步云端；关闭后仅保存在本机'}
            </Text>
          </View>
          <Switch checked={cloudSyncEnabled} color="#B07D50" onChange={handleSyncSwitch} />
        </View>

        {/* 同步衣橱选择（VIP ≤2 / SVIP 全部；开关开启后展示） */}
        {cloudSyncEnabled && memberTier !== 'free' && (
          <View>
            <Text className={styles.syncSectionLabel}>
              {maxSync === null
                ? 'SVIP 同步全部衣橱，无需选择'
                : `同步衣橱（VIP 最多 ${maxSync} 个，已选 ${selectedIds.length} 个）`}
            </Text>
            <View className={styles.syncChips}>
              {maxSync !== null &&
                wardrobes.map((w) => (
                  <View
                    key={w.id}
                    className={[styles.syncChip, selectedIds.includes(w.id) ? styles.syncChipActive : ''].join(' ')}
                    onClick={() => handleToggleWardrobe(w.id)}
                  >
                    <Text>{w.name}</Text>
                  </View>
                ))}
            </View>
          </View>
        )}

        {/* 快照冲突面板（三选一；设计方案 6.3） */}
        {conflict && conflictOpen && (
          <View className={styles.conflictBox}>
            <Text className={styles.conflictTitle}>数据已在其他设备更新</Text>
            <Text className={styles.conflictMeta}>
              本地版本 {conflict.localVersion} · 云端版本 {conflict.remoteVersion}
              {conflict.createdAt ? ` · 产生于 ${pad2(new Date(conflict.createdAt).getHours())}:${pad2(new Date(conflict.createdAt).getMinutes())}` : ''}
            </Text>
            <View className={styles.conflictBtnRow}>
              <View className={styles.syncActionBtn} onClick={handleConflictChoice}>
                <Text>处理冲突</Text>
              </View>
            </View>
          </View>
        )}

        {/* 操作行 */}
        <View className={styles.syncActions}>
          <View className={styles.syncActionBtn} onClick={handleSyncNow}>
            <Text>立即同步</Text>
          </View>
          <View className={styles.syncActionBtn} onClick={handleExport}>
            <Text>导出备份</Text>
          </View>
          {conflict && !conflictOpen && (
            <View className={styles.syncActionBtn} onClick={() => setConflictOpen(true)}>
              <Text>冲突记录</Text>
            </View>
          )}
          {hasRemote && (
            <View className={[styles.syncActionBtn, styles.syncActionBtnDanger].join(' ')} onClick={handleDeleteCloud}>
              <Text>删除云端数据</Text>
            </View>
          )}
        </View>

        <Text className={styles.cardTip}>
          同步范围：衣橱、衣物、着装日记、自定义项、备选条目、身体数据；明日穿搭记录与推荐方案仅保存在本机，不上传云端。开关关闭时全部数据仅存本机。
        </Text>
      </View>

      {/* 衣橱设置（v0.7.0：风格主题移至衣橱管理页，此处保留管理入口） */}
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>衣橱设置</Text>
        <View className={styles.wardrobeEntry} onClick={goWardrobes}>
          <View className={styles.entryDot} style={{ background: currentWardrobe?.color || '#B07D50' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>衣橱管理</Text>
            <Text className={styles.entryDesc}>新建/切换/删除衣橱，修改个人信息与风格主题</Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
      </View>

      <View className={styles.card}>
        <Text className={styles.sectionTitle}>关于</Text>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>版本</Text>
          <Text className={styles.aboutValue}>{APP_VERSION}（开发预览）</Text>
        </View>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>数据存储</Text>
          <Text className={styles.aboutValue}>
            {cloudSyncEnabled ? '本机 + 云端同步' : '本机存储'}
          </Text>
        </View>
        <Text className={styles.cardTip}>
          当前版本所有数据（照片与衣物档案）保存在本机。卸载小程序或清除数据会导致数据丢失，请知悉。
        </Text>
      </View>
    </View>
  );
};

export default MinePage;
