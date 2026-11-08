import React from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  APP_VERSION,
  GENDER_OPTIONS,
  AGE_MIN,
  AGE_MAX,
  THEME_SETS,
  BODY_FIELD_DEFS,
  themeVarsOf
} from '@/data/presets';
import { Gender, ThemeId } from '@/types';
import styles from './index.module.scss';

/** 我的页（PRD 6.3 / v0.5）：统计概览、个人信息（缝纫基本数据）、衣橱设置（性别/年龄/风格主题）、关于 */
const MinePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const tryoutItems = useWardrobeStore((s) => s.tryoutItems);
  const bodyProfile = useWardrobeStore((s) => s.bodyProfile);
  const updateBodyProfile = useWardrobeStore((s) => s.updateBodyProfile);
  const updateWardrobe = useWardrobeStore((s) => s.updateWardrobe);

  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const totalCount = items.length;
  const favoriteCount = items.filter((it) => it.favorite).length;
  const tryoutCount = tryoutItems.filter((t) => t.wardrobeId === currentWardrobeId).length;

  const goWardrobes = () => {
    Taro.navigateTo({ url: '/pages/wardrobes/index' });
  };

  // 身体数据输入：数字校验（空值清空字段）
  const onBodyInput = (key: keyof typeof bodyProfile, min: number, max: number) => (e) => {
    const raw = e.detail.value.trim();
    if (!raw) {
      updateBodyProfile({ [key]: undefined });
      return;
    }
    const num = Number(raw);
    if (isNaN(num) || num < min || num > max) {
      return;
    }
    updateBodyProfile({ [key]: num });
  };

  const onGenderChange = (e) => {
    const idx = Number(e.detail.value);
    const g = GENDER_OPTIONS[idx];
    if (g && currentWardrobe) {
      updateWardrobe(currentWardrobe.id, { gender: g.value as Gender });
    }
  };

  const onAgeInput = (e) => {
    if (!currentWardrobe) return;
    const raw = e.detail.value.trim();
    if (!raw) {
      updateWardrobe(currentWardrobe.id, { age: null });
      return;
    }
    const num = Number(raw);
    if (isNaN(num) || num < AGE_MIN || num > AGE_MAX) {
      return;
    }
    updateWardrobe(currentWardrobe.id, { age: num });
  };

  const genderIndex = GENDER_OPTIONS.findIndex((g) => g.value === currentWardrobe?.gender);
  const genderLabel = GENDER_OPTIONS[Math.max(0, genderIndex)]?.label || '女';
  // v0.5：页面整体风格主题
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  return (
    <View className={styles.page} style={themeStyle}>
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
            <Text className={styles.statNum}>{tryoutCount}</Text>
            <Text className={styles.statLabel}>备选</Text>
          </View>
          <View className={styles.statItem}>
            <Text className={styles.statNum}>{wardrobes.length}</Text>
            <Text className={styles.statLabel}>衣橱数量</Text>
          </View>
        </View>
      </View>

      {/* v0.5 用户意见 11：个人身体数据（缝纫基本信息） */}
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>个人信息</Text>
        <Text className={styles.cardTip}>
          缝纫/量体基本数据，用于尺码默认值与属性推荐，均为选填。
        </Text>
        <View className={styles.bodyGrid}>
          {BODY_FIELD_DEFS.map((f) => (
            <View key={f.key} className={styles.bodyItem}>
              <Text className={styles.bodyLabel}>
                {f.label}（{f.unit}）
              </Text>
              <Input
                className={styles.bodyInput}
                type='digit'
                value={bodyProfile[f.key] !== undefined ? String(bodyProfile[f.key]) : ''}
                placeholder='选填'
                onInput={onBodyInput(f.key, f.min, f.max)}
              />
            </View>
          ))}
        </View>
      </View>

      {/* v0.5 用户意见 1：当前衣橱性别/年龄可在「我的」页修改；意见 2：风格主题切换 */}
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>衣橱设置</Text>
        <View className={styles.settingRow}>
          <Text className={styles.settingLabel}>用户名称</Text>
          <Text className={styles.settingValue}>{currentWardrobe?.name || '-'}</Text>
        </View>
        <View className={styles.settingRow}>
          <Text className={styles.settingLabel}>性别</Text>
          <Picker mode='selector' range={GENDER_OPTIONS.map((g) => g.label)} value={Math.max(0, genderIndex)} onChange={onGenderChange}>
            <View className={styles.settingPicker}>
              <Text className={styles.settingValue}>{genderLabel}</Text>
              <Text className={styles.settingArrow}>▾</Text>
            </View>
          </Picker>
        </View>
        <View className={styles.settingRow}>
          <Text className={styles.settingLabel}>年龄</Text>
          <Input
            className={styles.settingInput}
            type='number'
            value={currentWardrobe?.age !== null && currentWardrobe?.age !== undefined ? String(currentWardrobe.age) : ''}
            placeholder={`选填（${AGE_MIN}-${AGE_MAX}）`}
            onInput={onAgeInput}
          />
        </View>

        <Text className={styles.settingLabel}>风格主题（不同衣橱不同整体风格）</Text>
        <View className={styles.themeGrid}>
          {THEME_SETS.map((t) => (
            <View
              key={t.id}
              className={`${styles.themeCard} ${currentWardrobe?.themeId === t.id ? styles.themeCardActive : ''}`}
              style={{ background: t.bg }}
              onClick={() => currentWardrobe && updateWardrobe(currentWardrobe.id, { themeId: t.id as ThemeId })}
            >
              <View className={styles.themeDotRow}>
                <View className={styles.themeDot} style={{ background: t.primary }} />
                <View className={styles.themeDot} style={{ background: t.primaryLight }} />
              </View>
              <Text className={styles.themeName}>
                {t.emoji} {t.name}
              </Text>
              {currentWardrobe?.themeId === t.id && <Text className={styles.themeCheck}>✓ 当前</Text>}
            </View>
          ))}
        </View>

        <View className={styles.wardrobeEntry} onClick={goWardrobes}>
          <View className={styles.entryDot} style={{ background: currentWardrobe?.color || '#B07D50' }} />
          <View className={styles.entryInfo}>
            <Text className={styles.entryTitle}>衣橱管理</Text>
            <Text className={styles.entryDesc}>新建/切换/删除不同用户的衣橱</Text>
          </View>
          <Text className={styles.entryArrow}>›</Text>
        </View>
      </View>

      <View className={styles.card}>
        <Text className={styles.sectionTitle}>关于</Text>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>版本</Text>
          <Text className={styles.aboutValue}>{APP_VERSION}（公网预览）</Text>
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
