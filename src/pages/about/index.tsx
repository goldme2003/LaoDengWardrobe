import React from 'react';
import { View, Text } from '@tarojs/components';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { APP_VERSION, themeVarsOf } from '@/data/presets';
// v1.20.1：改用本页独立样式模块（跨页 import mine 页 scss 会触发 wxss 编译错误）
import styles from './index.module.scss';

/** 关于二级页（v1.20.0）：版本、数据存储方式与数据说明，自「我的」页迁入。 */
const AboutPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobe = wardrobes.find((w) => w.id === useWardrobeStore((s) => s.currentWardrobeId));
  const cloudSyncEnabled = useWardrobeStore((s) => s.cloudSyncEnabled);

  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  return (
    <View className={styles.page} style={themeStyle}>
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>关于</Text>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>版本</Text>
          <Text className={styles.aboutValue}>{APP_VERSION}（开发预览）</Text>
        </View>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>数据存储</Text>
          <Text className={styles.aboutValue}>{cloudSyncEnabled ? '本机 + 云端同步' : '本机存储'}</Text>
        </View>
        <Text className={styles.cardTip}>
          当前版本所有数据（照片与衣物档案）保存在本机；开启云同步后，同步范围内的数据另存云端（「我的 →
          云同步」可开启或清空云存储数据）。卸载小程序或清除数据会导致本机数据丢失，请知悉。
        </Text>
      </View>
    </View>
  );
};

export default AboutPage;
