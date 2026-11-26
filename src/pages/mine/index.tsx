import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { APP_VERSION, GENDER_OPTIONS, themeVarsOf } from '@/data/presets';
import { tierOf } from '@/services/entitlement';
import { useSyncStore } from '@/services/sync';
import styles from './index.module.scss';

/** 我的页（v0.6）：统计跳转 + 功能入口；v1.20.0：个人信息/云同步/衣橱设置/关于改为
 * 会员中心同风格二级菜单入口——入口卡仅展示摘要，全部修改在对应二级页完成
 * （个人信息 → profile 页；云同步 → cloud-sync 页；衣橱设置 → wardrobes 页；关于 → about 页）。 */
const MinePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const tryoutItems = useWardrobeStore((s) => s.tryoutItems);
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
  // v0.7.0 用户意见 5：个人信息修改为独立页面（v1.20.0 起入口改为二级菜单卡）
  const goProfile = () => Taro.navigateTo({ url: '/pages/profile/index' });
  // v1.9.0（F-19）：会员中心
  const memberTier = useWardrobeStore((s) => s.memberTier);
  const memberLabel = tierOf(memberTier).label;
  const goMember = () => Taro.navigateTo({ url: '/pages/member/index' });
  // v1.20.0：云同步 / 关于二级页
  const goCloudSync = () => Taro.navigateTo({ url: '/pages/cloud-sync/index' });
  const goAbout = () => Taro.navigateTo({ url: '/pages/about/index' });

  // 云同步入口摘要（状态一句话；状态机详见 services/sync）
  const syncStatus = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const syncOpenid = useSyncStore((s) => s.openid);
  const syncSummary = React.useMemo(() => {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const time = lastSyncedAt
      ? `${pad2(new Date(lastSyncedAt).getHours())}:${pad2(new Date(lastSyncedAt).getMinutes())}`
      : '';
    switch (syncStatus) {
      case 'logging-in':
        return '正在登录云端…';
      case 'syncing':
        return '同步中…';
      case 'kicked':
        return '账号已在其他设备登录，本机已暂停云同步';
      case 'pending':
        return '有变更待上行（稍后自动同步）';
      case 'ready':
        return time ? `已同步 ${time}` : '已连接云端';
      case 'error':
        return '云端未连接，点进重试';
      case 'disabled':
        return syncOpenid ? '云同步已关闭，数据仅保存在本机' : '未连接云端（启动后自动登录）';
      default:
        return '未连接云端（启动后自动登录）';
    }
  }, [syncStatus, lastSyncedAt, syncOpenid]);

  const genderLabel = GENDER_OPTIONS.find((g) => g.value === currentWardrobe?.gender)?.label || '-';
  // v1.20.0：个人信息入口摘要（衣橱主人 · 性别 · 年龄）
  const profileSummary = [
    currentWardrobe?.name || '未填写',
    genderLabel,
    currentWardrobe?.age !== null && currentWardrobe?.age !== undefined ? `${currentWardrobe.age} 岁` : '年龄未填写'
  ].join(' · ');
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

      {/* v1.20.0：二级菜单入口（样式同会员中心入口卡）——个人信息 */}
      <View className={styles.card} onClick={goProfile}>
        <View className={styles.wardrobeEntry}>
          <View className={styles.entryDot} style={{ background: currentWardrobe?.color || '#8a9a6b' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>个人信息</Text>
            <Text className={styles.entryDesc}>{profileSummary}</Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
      </View>

      {/* v1.20.0：云同步入口（修改/开关/清空云存储数据均在二级页完成） */}
      <View className={styles.card} onClick={goCloudSync}>
        <View className={styles.wardrobeEntry}>
          <View className={styles.entryDot} style={{ background: '#5b8db8' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>云同步 · {memberLabel}</Text>
            <Text className={styles.entryDesc}>{syncSummary}</Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
      </View>

      {/* 衣橱设置（v0.7.0：风格主题移至衣橱管理页；v1.20.0：入口卡样式统一） */}
      <View className={styles.card} onClick={goWardrobes}>
        <View className={styles.wardrobeEntry}>
          <View className={styles.entryDot} style={{ background: currentWardrobe?.color || '#B07D50' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>衣橱设置</Text>
            <Text className={styles.entryDesc}>新建/切换/删除衣橱，修改个人信息与风格主题</Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
      </View>

      {/* v1.20.0：关于入口（版本与数据存储说明在二级页展示） */}
      <View className={styles.card} onClick={goAbout}>
        <View className={styles.wardrobeEntry}>
          <View className={styles.entryDot} style={{ background: '#a39385' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>关于</Text>
            <Text className={styles.entryDesc}>
              {APP_VERSION} · {`版本与数据存储说明`}
            </Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
      </View>
    </View>
  );
};

export default MinePage;
