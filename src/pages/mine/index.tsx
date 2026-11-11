import React, { useMemo } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { APP_VERSION, GENDER_OPTIONS, BODY_FIELD_DEFS, themeVarsOf } from '@/data/presets';
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
          <Text className={styles.aboutValue}>本机存储</Text>
        </View>
        <Text className={styles.cardTip}>
          当前版本所有数据（照片与衣物档案）保存在本机。卸载小程序或清除数据会导致数据丢失，请知悉。
        </Text>
      </View>
    </View>
  );
};

export default MinePage;
