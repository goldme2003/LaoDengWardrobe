import React from 'react';
import { View, Text } from '@tarojs/components';
import classnames from 'classnames';
import ItemCard from '@/components/ItemCard';
import { ClothingItem } from '@/types';
import styles from './index.module.scss';

export interface AccordionGroup {
  /** 类型名（组头标题） */
  type: string;
  /** 组内衣物（录入时间倒序） */
  list: ClothingItem[];
}

interface Props {
  groups: AccordionGroup[];
  /** 收起状态表（key = 类型名，true = 收起；不在表中 = 展开，默认全部展开） */
  collapsedMap: Record<string, boolean>;
  colorHexMap: Record<string, string>;
  /** 组头点击：手动切换展开/收起 */
  onToggleGroup: (type: string) => void;
  onItemPress: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

/** 手风琴分组列表（v0.7.0 / PRD FR-06）：衣物按服装类型分组折叠展示，
 * 组头为「类型名 + 件数 + 展开箭头」，组内为 2 列网格（复用 ItemCard）；
 * 默认全部展开，展开/收起状态由父级管理（配合滚动联动自动收起/展开） */
const AccordionList: React.FC<Props> = ({
  groups,
  collapsedMap,
  colorHexMap,
  onToggleGroup,
  onItemPress,
  onToggleFavorite
}) => {
  return (
    <View className={styles.wrap}>
      {groups.map((g) => {
        const collapsed = !!collapsedMap[g.type];
        return (
          <View key={g.type} className={styles.group}>
            <View className={`${styles.header} ldw-acc-header`} onClick={() => onToggleGroup(g.type)}>
              <Text className={styles.name}>{g.type}</Text>
              <Text className={styles.count}>{g.list.length} 件</Text>
              <Text className={classnames(styles.arrow, !collapsed && styles.arrowOpen)}>›</Text>
            </View>
            {!collapsed && (
              <View className={styles.grid}>
                {g.list.map((it) => (
                  <View key={it.id} className={styles.gridItem}>
                    <ItemCard
                      item={it}
                      colorHexMap={colorHexMap}
                      onClick={() => onItemPress(it.id)}
                      onToggleFavorite={() => onToggleFavorite(it.id)}
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

export default AccordionList;
