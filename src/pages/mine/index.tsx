import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import styles from './index.module.scss';

/** 我的页（PRD 6.3）：统计概览、衣橱管理入口、关于 */
const MinePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);

  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const totalCount = items.length;
  const favoriteCount = items.filter((it) => it.favorite).length;
  const wardrobeCount = wardrobes.length;

  const goWardrobes = () => {
    Taro.switchTab({ url: '/pages/wardrobes/index' });
  };

  return (
    <View className={styles.page}>
      <View className={styles.card}>
        <View className={styles.stats}>
          <View className={styles.statItem}>
            <Text className={styles.statNum}>{totalCount}</Text>
            <Text className={styles.statLabel}>衣物总数</Text>
          </View>
          <View className={styles.statItem}>
            <Text className={styles.statNum}>{favoriteCount}</Text>
            <Text className={styles.statLabel}>喜爱衣物</Text>
          </View>
          <View className={styles.statItem}>
            <Text className={styles.statNum}>{wardrobeCount}</Text>
            <Text className={styles.statLabel}>衣橱数量</Text>
          </View>
        </View>
      </View>

      <View className={styles.card}>
        <Text className={styles.sectionTitle}>衣橱管理</Text>
        <View className={styles.wardrobeEntry} onClick={goWardrobes}>
          <View className={styles.entryDot} style={{ background: currentWardrobe?.color || '#B07D50' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>衣橱管理</Text>
            <Text className={styles.entryDesc}>
              新建/切换/删除衣橱，为每位用户自定义专属颜色
            </Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
        <Text className={styles.tip}>
          衣橱管理已移至底部标签页「衣橱」，可在此查看与切换不同用户的衣橱。
        </Text>
      </View>

      <View className={styles.card}>
        <Text className={styles.sectionTitle}>关于</Text>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>版本</Text>
          <Text className={styles.aboutValue}>v0.1.0-alpha（预览初版）</Text>
        </View>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>数据存储</Text>
          <Text className={styles.aboutValue}>本机存储</Text>
        </View>
        <Text className={styles.tip}>
          当前版本所有数据（照片与衣物档案）保存在本机。卸载小程序或清除小程序数据会导致数据丢失，请知悉。
        </Text>
      </View>
    </View>
  );
};

export default MinePage;
