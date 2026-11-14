import React from 'react';
import { View, Text, Image } from '@tarojs/components';
import type { RecommendOutfit } from '@/services/recommend';
import styles from './index.module.scss';

interface Props {
  outfit: RecommendOutfit;
  /** 推荐衣物是否已全部加入明日穿搭（已采纳则按钮置灰） */
  adopted: boolean;
  onShuffle: () => void;
  onAdopt: () => void;
}

/** 今日穿搭推荐卡片（v1.4.0 B/D 阶段）：规则引擎生成 1–3 套，「换一件」轮换、「一键采纳」写入明日穿搭勾选 */
const RecommendCard: React.FC<Props> = ({ outfit, adopted, onShuffle, onAdopt }) => {
  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <Text className={styles.title}>今日穿搭推荐</Text>
        <Text className={styles.reason}>{outfit.reason}</Text>
      </View>
      <View className={styles.items}>
        {outfit.items.map((it) => (
          <View key={it.id} className={styles.item}>
            <Image className={styles.photo} src={it.photos[0]} mode='aspectFill' />
            <Text className={styles.name} numberOfLines={1}>
              {it.name}
            </Text>
          </View>
        ))}
      </View>
      <View className={styles.actions}>
        <View className={styles.shuffleBtn} onClick={onShuffle}>
          <Text className={styles.shuffleText}>换一件</Text>
        </View>
        <View
          className={`${styles.adoptBtn} ${adopted ? styles.adoptBtnDone : ''}`}
          onClick={adopted ? undefined : onAdopt}
        >
          <Text className={styles.adoptText}>{adopted ? '已采纳 ✓' : '一键采纳到明日穿搭'}</Text>
        </View>
      </View>
    </View>
  );
};

export default RecommendCard;
