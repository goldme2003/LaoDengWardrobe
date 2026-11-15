import React from 'react';
import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

interface Props {
  icon?: string;
  title: string;
  desc?: string;
  /** 调试角标（v1.4.1：空态建议来源区分，green = 云函数生成，red = 内置兜底） */
  badge?: { text: string; tone: 'green' | 'red' };
  /** 次级引导提示（v1.4.0：如「添加自有衣物可获取更精准推荐」），展示在 desc 下方 */
  hint?: string;
  actionText?: string;
  onAction?: () => void;
}

/** 空态组件：空衣橱 / 筛选无结果 */
const EmptyState: React.FC<Props> = ({ icon, title, desc, badge, hint, actionText, onAction }) => {
  return (
    <View className={styles.wrap}>
      <Text className={styles.icon}>{icon || '👕'}</Text>
      <Text className={styles.title}>{title}</Text>
      {!!badge && (
        <View className={`${styles.badge} ${badge.tone === 'green' ? styles.badgeGreen : styles.badgeRed}`}>
          <Text className={styles.badgeText}>{badge.text}</Text>
        </View>
      )}
      {!!desc && <Text className={styles.desc}>{desc}</Text>}
      {!!hint && <Text className={styles.hint}>{hint}</Text>}
      {!!actionText && onAction && (
        <View className={styles.action} onClick={onAction}>
          <Text className={styles.actionText}>{actionText}</Text>
        </View>
      )}
    </View>
  );
};

export default EmptyState;
