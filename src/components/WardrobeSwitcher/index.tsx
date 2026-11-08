import React from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import classnames from 'classnames';
import styles from './index.module.scss';

interface Props {
  wardrobes: { id: string; name: string; count: number; color: string }[];
  currentId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
}

/** 衣橱切换器（PRD FR-01 / v0.3：各衣橱以主题色区分，快速切换） */
const WardrobeSwitcher: React.FC<Props> = ({ wardrobes, currentId, onSelect, onManage }) => {
  return (
    <View className={styles.wrap}>
      <ScrollView scrollX enhanced showScrollView={false} className={styles.scroll}>
        <View className={styles.inner}>
          {wardrobes.map((w) => {
            const active = w.id === currentId;
            return (
              <View
                key={w.id}
                className={classnames(styles.chip, active && styles.chipActive)}
                style={active ? { background: w.color, borderColor: w.color } : { borderColor: w.color }}
                onClick={() => onSelect(w.id)}
              >
                {!active && <View className={styles.colorDot} style={{ background: w.color }} />}
                <Text className={classnames(styles.chipName, active && styles.chipNameActive)}>
                  {w.name}
                </Text>
                <Text className={classnames(styles.chipCount, active && styles.chipCountActive)}>
                  {w.count}
                </Text>
              </View>
            );
          })}
          <View className={styles.manageChip} onClick={onManage}>
            <Text className={styles.manageText}>⚙ 管理</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

export default WardrobeSwitcher;
