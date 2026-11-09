import React, { useMemo, useState } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  WARDROBE_NAME_MAX_LEN,
  GENDER_OPTIONS,
  AGE_MIN,
  AGE_MAX,
  THEME_SETS,
  themeVarsOf
} from '@/data/presets';
import { Gender, ThemeId } from '@/types';
import styles from './index.module.scss';

const UNFILLED = '未填写';

/** 新建衣橱页（v0.6：从衣橱管理页独立；名称 + 风格主题 + 性别/年龄拨盘） */
const WardrobeNewPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const addWardrobe = useWardrobeStore((s) => s.addWardrobe);

  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState<ThemeId>(THEME_SETS[0].id);
  const [gender, setGender] = useState<Gender>('female');
  const [age, setAge] = useState<number | null>(null);

  const genderIndex = GENDER_OPTIONS.findIndex((g) => g.value === gender);
  // 年龄拨盘：['未填写', 1..120]
  const ageRange = useMemo(() => {
    const list = [UNFILLED];
    for (let i = AGE_MIN; i <= AGE_MAX; i += 1) list.push(String(i));
    return list;
  }, []);

  // 页面沿用当前衣橱主题
  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Taro.showToast({ title: '请输入用户名称', icon: 'none' });
      return;
    }
    if (trimmed.length > WARDROBE_NAME_MAX_LEN) {
      Taro.showToast({ title: `名称最多 ${WARDROBE_NAME_MAX_LEN} 个字`, icon: 'none' });
      return;
    }
    const ok = addWardrobe(trimmed, themeId, gender, age);
    if (!ok) {
      Taro.showToast({ title: '名称已存在', icon: 'none' });
      return;
    }
    Taro.showToast({ title: '已创建并切换', icon: 'success' });
    setTimeout(() => Taro.navigateBack(), 600);
  };

  return (
    <View className={styles.page} style={themeStyle}>
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>🧺 新建衣橱</Text>
        <Input
          className={styles.nameInput}
          value={name}
          maxlength={WARDROBE_NAME_MAX_LEN}
          placeholder={`用户名称，如：老王（≤${WARDROBE_NAME_MAX_LEN}字）`}
          onInput={(e) => setName(e.detail.value)}
        />

        <Text className={styles.colorLabel}>选择风格主题（页面底色/主色/卡片风格整体联动）</Text>
        <View className={styles.themeGrid}>
          {THEME_SETS.map((t) => (
            <View
              key={t.id}
              className={`${styles.themeCard} ${themeId === t.id ? styles.themeCardActive : ''}`}
              style={{ background: t.bg }}
              onClick={() => setThemeId(t.id as ThemeId)}
            >
              <View className={styles.themeDotRow}>
                <View className={styles.themeDot} style={{ background: t.primary }} />
                <View className={styles.themeDot} style={{ background: t.primaryLight }} />
              </View>
              <Text className={styles.themeName}>
                {t.emoji} {t.name}
              </Text>
              {themeId === t.id && <Text className={styles.themeCheck}>✓ 已选</Text>}
            </View>
          ))}
        </View>

        <View className={styles.profileRow}>
          <Text className={styles.profileLabel}>性别</Text>
          <Picker
            mode='selector'
            range={GENDER_OPTIONS.map((g) => g.label)}
            value={Math.max(0, genderIndex)}
            onChange={(e) => setGender(GENDER_OPTIONS[Number(e.detail.value)].value)}
          >
            <View className={styles.profilePicker}>
              <Text className={styles.profileValue}>{GENDER_OPTIONS[Math.max(0, genderIndex)].label}</Text>
              <Text className={styles.profileArrow}>▾</Text>
            </View>
          </Picker>
        </View>
        <View className={styles.profileRow}>
          <Text className={styles.profileLabel}>年龄</Text>
          <Picker
            mode='selector'
            range={ageRange}
            value={age === null ? 0 : age - AGE_MIN + 1}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              setAge(idx === 0 ? null : AGE_MIN + idx - 1);
            }}
          >
            <View className={styles.profilePicker}>
              <Text className={styles.profileValue}>
                {age === null ? UNFILLED : `${age} 岁`}
              </Text>
              <Text className={styles.profileArrow}>▾</Text>
            </View>
          </Picker>
        </View>

        <View className={styles.addBtn} onClick={handleAdd}>
          <Text className={styles.addBtnText}>创建衣橱</Text>
        </View>
        <Text className={styles.tip}>
          衣橱名称创建后不可修改；性别/年龄/风格主题可在「我的」页修改；删除衣橱将连带删除其下全部衣物。
        </Text>
      </View>
    </View>
  );
};

export default WardrobeNewPage;
