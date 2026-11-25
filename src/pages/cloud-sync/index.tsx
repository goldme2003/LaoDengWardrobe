import React, { useMemo } from 'react';
import { View, Text, Switch } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { themeVarsOf } from '@/data/presets';
import { tierOf } from '@/services/entitlement';
import { useSyncStore, setCloudSync, syncNow, deleteCloudData } from '@/services/sync';
import { exportBackup } from '@/services/exportBackup';
// v1.20.1：改用本页独立样式模块（跨页 import mine 页 scss 会使样式被抽入 common.wxss、
// mine/index.wxss 消失，触发开发者工具 wxss 编译错误）
import styles from './index.module.scss';

/** 云同步二级页（v1.20.0）：自「我的」页迁入——状态条 / 登录态 / 开关 / 同步衣橱选择 /
 * 立即同步 / 导出备份 / 清空云存储数据；全部同步操作在本页完成。 */
const CloudSyncPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobe = useWardrobeStore((s) => s.wardrobes).find(
    (w) => w.id === useWardrobeStore((s) => s.currentWardrobeId)
  );
  const memberTier = useWardrobeStore((s) => s.memberTier);
  const memberLabel = tierOf(memberTier).label;
  const goMember = () => Taro.navigateTo({ url: '/pages/member/index' });

  const cloudSyncEnabled = useWardrobeStore((s) => s.cloudSyncEnabled);
  const syncWardrobeIds = useWardrobeStore((s) => s.syncWardrobeIds);
  const setSyncWardrobeIds = useWardrobeStore((s) => s.setSyncWardrobeIds);
  const syncStatus = useSyncStore((s) => s.status);
  const syncErrorMsg = useSyncStore((s) => s.errorMsg);
  const syncOpenid = useSyncStore((s) => s.openid);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const hasRemote = useSyncStore((s) => s.hasRemote);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const loginLabel = syncOpenid ? `已登录微信账号（${syncOpenid.slice(0, 8)}…）` : '未登录（启动后自动登录）';
  const syncStatusInfo = useMemo(() => {
    const time = lastSyncedAt ? `${pad2(new Date(lastSyncedAt).getHours())}:${pad2(new Date(lastSyncedAt).getMinutes())}` : '';
    switch (syncStatus) {
      case 'logging-in':
        return { dot: '#e6a23c', text: '正在登录云端…' };
      case 'disabled':
        return {
          dot: '#909399',
          text: syncOpenid
            ? '云同步已关闭，数据仅保存在本机'
            : '未连接云端（启动后自动登录，失败会自动重试）'
        };
      case 'syncing':
        return { dot: '#409eff', text: '同步中…' };
      case 'kicked':
        // v1.19.0：单端互踢——账号在其他设备登录，本机暂停云同步（本地数据保留）
        return { dot: '#e6a23c', text: '账号已在其他设备登录，本机已暂停云同步（点「立即同步」重新接管）' };
      case 'pending':
        return { dot: '#e6a23c', text: '有变更待上行（稍后自动同步）' };
      case 'ready':
        return { dot: '#67c23a', text: time ? `已同步 ${time}` : '已连接云端' };
      case 'error':
        return { dot: '#c0392b', text: `云端未连接：${syncErrorMsg || '网络异常'}（可点「立即同步」重试）` };
      default:
        return { dot: '#909399', text: '未连接云端（启动后自动登录）' };
    }
  }, [syncStatus, syncErrorMsg, lastSyncedAt, syncOpenid]);

  const handleSyncSwitch = async (e) => {
    const ok = await setCloudSync(e.detail.value);
    if (!ok) {
      Taro.showToast({ title: e.detail.value ? '未能开启云同步' : '已关闭', icon: 'none' });
    }
  };

  // v1.16.0：立即同步——普通版提示升级（此前误报「同步未完成」）；VIP/SVIP 未开开关时给出指引
  const handleSyncNow = async () => {
    if (tierOf(memberTier).cloudSync !== 'cloud') {
      Taro.showModal({
        title: '云同步为会员权益',
        content: '普通版不含云同步。升级 VIP/SVIP 后，可将衣橱/衣物/日记同步到云端，换设备不丢数据。',
        confirmText: '去升级',
        success: (r) => {
          if (r.confirm) goMember();
        }
      });
      return;
    }
    if (!cloudSyncEnabled) {
      Taro.showToast({ title: '请先打开上方「云同步」开关', icon: 'none' });
      return;
    }
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

  // v1.20.0：清空云存储数据（原「删除云端数据」迁入本页，仅云端有数据时展示）
  const handleDeleteCloud = () => {
    Taro.showModal({
      title: '清空云存储数据',
      content: '将删除云端保存的衣橱/衣物/日记等同步数据（30 天宽限期内登录可恢复），本机数据不受影响。确定清空？',
      confirmText: '清空',
      confirmColor: '#c0392b',
      success: async (res) => {
        if (!res.confirm) return;
        Taro.showLoading({ title: '清空中…', mask: true });
        const ok = await deleteCloudData();
        Taro.hideLoading();
        if (ok) Taro.showToast({ title: '云端数据已清空', icon: 'none' });
      }
    });
  };

  // VIP 同步衣橱多选（VIP ≤3；SVIP 全部，不展示选择）
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

  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  return (
    <View className={styles.page} style={themeStyle}>
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

        {/* 登录账号行（静默登录无弹窗，此处确认微信账号登录态） */}
        <View className={styles.syncStatusBar}>
          <View className={styles.syncDot} style={{ background: syncOpenid ? '#67c23a' : '#909399' }} />
          <Text className={styles.syncStatusText}>{loginLabel}</Text>
        </View>

        {/* 云同步开关（默认关闭；free 档展示开通入口而非开关，避免状态不一致） */}
        <View className={styles.syncSwitchRow}>
          <View className={styles.syncSwitchInfo}>
            <Text className={styles.entryTitle}>云同步</Text>
            <Text className={styles.entryDesc}>
              {memberTier === 'free'
                ? 'VIP/SVIP 权益：换设备不丢数据，登录后自动合并云端与本机数据'
                : '开启后衣物、日记等数据自动同步云端；关闭后仅保存在本机'}
            </Text>
          </View>
          {memberTier === 'free' ? (
            <View className={styles.syncChip} onClick={goMember}>
              <Text>VIP 专属 · 去开通</Text>
            </View>
          ) : (
            <Switch checked={cloudSyncEnabled} color="#B07D50" onChange={handleSyncSwitch} />
          )}
        </View>

        {/* 同步衣橱选择（VIP ≤3 / SVIP 全部；开关开启后展示） */}
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

        {/* 操作行（v1.20.0：清空云存储数据保留在本页） */}
        <View className={styles.syncActions}>
          <View className={styles.syncActionBtn} onClick={handleSyncNow}>
            <Text>立即同步</Text>
          </View>
          <View className={styles.syncActionBtn} onClick={handleExport}>
            <Text>导出备份</Text>
          </View>
          {hasRemote && (
            <View className={[styles.syncActionBtn, styles.syncActionBtnDanger].join(' ')} onClick={handleDeleteCloud}>
              <Text>清空云存储数据</Text>
            </View>
          )}
        </View>

        <Text className={styles.cardTip}>
          同步范围：衣橱、衣物、着装日记、自定义项、备选条目、身体数据；明日穿搭记录与推荐方案仅保存在本机，不上传云端。开关关闭时全部数据仅存本机。
        </Text>
      </View>
    </View>
  );
};

export default CloudSyncPage;
