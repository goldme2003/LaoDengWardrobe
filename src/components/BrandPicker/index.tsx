import React, { useState, useMemo } from 'react';
import { View, Text, Input } from '@tarojs/components';
import classnames from 'classnames';
import styles from './index.module.scss';

interface Props {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** 全部可选品牌（预设 + 自定义） */
  allBrands: string[];
  /** 已有衣物使用过的品牌（前置展示） */
  usedBrands?: string[];
  /** 喜爱品牌（最前置 + ★） */
  favoriteBrands?: string[];
  onToggleFavorite?: (brand: string) => void;
  maxLength?: number;
  placeholder?: string;
}

/** 品牌选择器（v0.5 用户意见 9）：下拉菜单 + 检索 + 喜爱品牌/已有品牌前置 */
const BrandPicker: React.FC<Props> = ({
  label = '品牌（选填）',
  value,
  onChange,
  allBrands,
  usedBrands = [],
  favoriteBrands = [],
  onToggleFavorite,
  maxLength = 20,
  placeholder = '输入或点选品牌'
}) => {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');

  const sortedBrands = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const pool = Array.from(new Set([...allBrands, ...(usedBrands || [])]));
    const matched = kw
      ? pool.filter((b) => b.toLowerCase().includes(kw))
      : pool;
    const rank = (b: string): number => {
      if (favoriteBrands.includes(b)) return 0;
      if (usedBrands.includes(b)) return 1;
      return 2;
    };
    return matched.sort((a, b) => {
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }, [allBrands, usedBrands, favoriteBrands, keyword]);

  const exactNew = (): string | null => {
    const kw = keyword.trim();
    if (!kw) return null;
    const exists = Array.from(new Set([...allBrands, ...(usedBrands || [])])).some(
      (b) => b.toLowerCase() === kw.toLowerCase()
    );
    return exists ? null : kw;
  };

  const pick = (b: string) => {
    onChange(b);
    setKeyword('');
    setOpen(false);
  };

  const toggleStar = (b: string, e) => {
    e.stopPropagation();
    onToggleFavorite && onToggleFavorite(b);
  };

  return (
    <View className={styles.section}>
      <Text className={styles.label}>{label}</Text>
      <Input
        className={styles.input}
        value={value}
        maxlength={maxLength}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onInput={(e) => {
          onChange(e.detail.value);
          setKeyword(e.detail.value);
          setOpen(true);
        }}
      />
      {open && (
        <View className={styles.dropdown}>
          {favoriteBrands.length > 0 && !keyword.trim() && (
            <Text className={styles.groupLabel}>★ 喜爱品牌</Text>
          )}
          {sortedBrands.length === 0 && !exactNew() && (
            <Text className={styles.emptyText}>无匹配品牌，可直接输入</Text>
          )}
          {sortedBrands.map((b) => (
            <View key={b} className={styles.row} onClick={() => pick(b)}>
              <Text className={classnames(styles.star, favoriteBrands.includes(b) && styles.starOn)}>
                {favoriteBrands.includes(b) ? '★' : '☆'}
              </Text>
              <Text className={classnames(styles.brandName, usedBrands.includes(b) && styles.brandUsed)}>
                {b}
                {usedBrands.includes(b) && !favoriteBrands.includes(b) ? '（已有）' : ''}
              </Text>
            </View>
          ))}
          {exactNew() && (
            <View className={styles.row} onClick={() => pick(exactNew() as string)}>
              <Text className={styles.plus}>＋</Text>
              <Text className={styles.brandName}>添加品牌「{exactNew()}」</Text>
            </View>
          )}
          <View className={styles.closeRow} onClick={() => setOpen(false)}>
            <Text className={styles.closeText}>收起</Text>
          </View>
        </View>
      )}
    </View>
  );
};

export default BrandPicker;
