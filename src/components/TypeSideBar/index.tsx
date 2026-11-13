import React from 'react';
import { View, Text } from '@tarojs/components';
import classnames from 'classnames';
import styles from './index.module.scss';

interface Props {
  /** 分组类型列表（与手风琴分组顺序一致） */
  types: string[];
  /** 当前选中类型（随滚动联动/手风琴展开收起同步更新） */
  activeType: string;
  /** 点击类型：滚动定位到对应分组 */
  onSelect: (type: string) => void;
}

/** 侧边类型标签栏（v1.1 / 配合手风琴分组 FR-06）：
 * 固定悬浮于页面右侧，点击快速定位衣物类型分组；
 * 选中态由父级根据滚动位置与手风琴展开/收起状态同步驱动 */
const TypeSideBar: React.FC<Props> = ({ types, activeType, onSelect }) => {
  // 仅一个分组时无定位价值，不渲染
  if (types.length < 2) return null;
  return (
    <View className={styles.wrap}>
      {types.map((t) => {
        const active = t === activeType;
        return (
          <View
            key={t}
            className={classnames(styles.item, active && styles.itemActive)}
            onClick={() => onSelect(t)}
          >
            <Text className={classnames(styles.text, active && styles.textActive)}>{t}</Text>
          </View>
        );
      })}
    </View>
  );
};

export default TypeSideBar;
