import React, { useState } from 'react';
import { View, Text } from '@tarojs/components';
import classnames from 'classnames';
import { SEASON_OPTIONS } from '@/data/presets';
import styles from './index.module.scss';

export interface Filters {
  type: string;
  color: string;
  material: string;
  seasons: string[];
  onlyFavorite: boolean;
}

export const EMPTY_FILTERS: Filters = {
  type: '',
  color: '',
  material: '',
  seasons: [],
  onlyFavorite: false
};

interface Props {
  filters: Filters;
  typeOptions: string[];
  colorOptions: string[];
  materialOptions: string[];
  colorHexMap: Record<string, string>;
  onChange: (filters: Filters) => void;
}

const countActive = (f: Filters): number => {
  let n = 0;
  if (f.type) n += 1;
  if (f.color) n += 1;
  if (f.material) n += 1;
  if (f.seasons.length > 0) n += 1;
  if (f.onlyFavorite) n += 1;
  return n;
};

/** 筛选栏（PRD FR-06）：服装类型/颜色/材质单选，季节多选并集，只看喜爱 */
const FilterBar: React.FC<Props> = ({
  filters,
  typeOptions,
  colorOptions,
  materialOptions,
  colorHexMap,
  onChange
}) => {
  const [open, setOpen] = useState(false);
  const activeCount = countActive(filters);

  const renderRow = (
    label: string,
    options: string[],
    key: 'type' | 'color' | 'material',
    withDot = false
  ) => (
    <View className={styles.row} key={key}>
      <Text className={styles.rowLabel}>{label}</Text>
      <View className={styles.rowChips}>
        <View
          className={classnames(styles.chip, !filters[key] && styles.chipActive)}
          onClick={() => onChange({ ...filters, [key]: '' })}
        >
          <Text className={styles.chipText}>全部</Text>
        </View>
        {options.map((opt) => (
          <View
            key={opt}
            className={classnames(styles.chip, filters[key] === opt && styles.chipActive)}
            onClick={() => onChange({ ...filters, [key]: filters[key] === opt ? '' : opt })}
          >
            {withDot && colorHexMap[opt] ? (
              <View className={styles.dot} style={{ background: colorHexMap[opt] }} />
            ) : null}
            <Text className={styles.chipText}>{opt}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View className={styles.wrap}>
      <View className={styles.header} onClick={() => setOpen(!open)}>
        <Text className={styles.headerTitle}>筛选</Text>
        {activeCount > 0 && (
          <View className={styles.badge}>
            <Text className={styles.badgeText}>{activeCount}</Text>
          </View>
        )}
        <Text className={styles.arrow}>{open ? '收起' : '展开'}</Text>
      </View>

      {open && (
        <View className={styles.body}>
          {renderRow('类型', typeOptions, 'type')}
          {renderRow('颜色', colorOptions, 'color', true)}
          {renderRow('材质', materialOptions, 'material')}

          <View className={styles.row}>
            <Text className={styles.rowLabel}>穿着季节</Text>
            <View className={styles.rowChips}>
              <Text
                className={classnames(styles.chip, filters.seasons.length === 0 && styles.chipActive)}
                onClick={() => onChange({ ...filters, seasons: [] })}
              >
                全部
              </Text>
              {SEASON_OPTIONS.map((s) => (
                <Text
                  key={s}
                  className={classnames(
                    styles.chip,
                    filters.seasons.includes(s) && styles.chipActive
                  )}
                  onClick={() =>
                    onChange({
                      ...filters,
                      seasons: filters.seasons.includes(s)
                        ? filters.seasons.filter((v) => v !== s)
                        : [...filters.seasons, s]
                    })
                  }
                >
                  {s}
                </Text>
              ))}
            </View>
          </View>

          <View className={styles.row}>
            <Text className={styles.rowLabel}>喜爱</Text>
            <View className={styles.rowChips}>
              <Text
                className={classnames(styles.chip, filters.onlyFavorite && styles.chipActive)}
                onClick={() => onChange({ ...filters, onlyFavorite: !filters.onlyFavorite })}
              >
                {filters.onlyFavorite ? '♥ 只看喜爱' : '♡ 只看喜爱'}
              </Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

export default FilterBar;
