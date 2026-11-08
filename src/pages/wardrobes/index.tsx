import React, { useState } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  WARDROBE_NAME_MAX_LEN,
  GENDER_OPTIONS,
  AGE_MIN,
  AGE_MAX,
  THEME_SETS,
  getThemeById,
  themeVarsOf
} from '@/data/presets';
import { Gender, ThemeId } from '@/types';
import { formatDate } from '@/utils/format';
import styles from './index.module.scss';

/** 衣橱管理页（PRD FR-01 / v0.5：创建时选择风格主题与性别年龄；v0.5 起改为普通页面，从首页切换器/我的页进入） */
const WardrobesPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const addWardrobe = useWardrobeStore((s) => s.addWardrobe);
  const deleteWardrobe = useWardrobeStore((s) => s.deleteWardrobe);
  const setCurrentWardrobe = useWardrobeStore((s) => s.setCurrentWardrobe);

  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState<ThemeId>(THEME_SETS[0].id);
  const [gender, setGender] = useState<Gender>('female');
  const [age, setAge] = useState('');

  const genderIndex = GENDER_OPTIONS.findIndex((g) => g.value === gender);

  // 当前衣橱风格主题（v0.5：页面整体风格联动）
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
    const ageNum = age.trim() ? Number(age.trim()) : null;
    if (ageNum !== null && (isNaN(ageNum) || ageNum < AGE_MIN || ageNum > AGE_MAX)) {
      Taro.showToast({ title: `年龄需在 ${AGE_MIN}-${AGE_MAX} 之间`, icon: 'none' });
      return;
    }
    const ok = addWardrobe(trimmed, themeId, gender, ageNum);
    if (!ok) {
      Taro.showToast({ title: '名称已存在', icon: 'none' });
      return;
    }
    setName('');
    setAge('');
    Taro.showToast({ title: '已创建并切换', icon: 'success' });
  };

  const handleDelete = (id: string, wardrobeName: string) => {
    if (wardrobes.length <= 1) {
      Taro.showToast({ title: '至少保留一个衣橱', icon: 'none' });
      return;
    }
    Taro.showModal({
      title: '删除衣橱',
      content: `将同时删除「${wardrobeName}」下的全部衣物，不可恢复。确定删除吗？`,
      confirmColor: '#F53F3F',
      success: (res) => {
        if (res.confirm) {
          deleteWardrobe(id);
          Taro.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
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

        {/* v0.5 用户意见 2：按整体风格主题创建衣橱 */}
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

        {/* v0.5 用户意见 1：创建时明确性别与年龄 */}
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
          <Text className={styles.profileLabel}>年龄</Text>
          <Input
            className={styles.ageInput}
            type='number'
            value={age}
            placeholder='选填'
            onInput={(e) => setAge(e.detail.value)}
          />
        </View>

        <View className={styles.addBtn} onClick={handleAdd}>
          <Text className={styles.addBtnText}>＋ 新建衣橱</Text>
        </View>
        <Text className={styles.tip}>
          衣橱名称创建后不可修改；性别/年龄/风格主题可在「我的」页修改；删除衣橱将连带删除其下全部衣物。
        </Text>
      </View>

      <View className={styles.card}>
        <Text className={styles.sectionTitle}>👥 全部衣橱</Text>
        {wardrobes.map((w) => {
          const theme = getThemeById(w.themeId);
          const genderLabel = GENDER_OPTIONS.find((g) => g.value === w.gender)?.label || '-';
          return (
            <View key={w.id} className={styles.wardrobeItem}>
              <View className={styles.itemColor} style={{ background: w.color }} />
              <View className={styles.wardrobeInfo}>
                <View className={styles.wardrobeTitleRow}>
                  <Text className={styles.wardrobeName}>{w.name}</Text>
                  {w.id === currentWardrobeId && (
                    <Text className={styles.currentTag} style={{ background: w.color }}>
                      当前
                    </Text>
                  )}
                </View>
                <Text className={styles.wardrobeMeta}>
                  {theme.emoji} {theme.name} · {genderLabel}
                  {w.age !== null ? ` · ${w.age} 岁` : ''} ·{' '}
                  {items.filter((it) => it.wardrobeId === w.id).length} 件 · {formatDate(w.createdAt)}
                </Text>
              </View>
              <View className={styles.spacer} />
              {w.id !== currentWardrobeId && (
                <Text className={styles.switchBtn} onClick={() => setCurrentWardrobe(w.id)}>
                  切换
                </Text>
              )}
              <Text
                className={wardrobes.length <= 1 ? `${styles.deleteBtn} ${styles.disabled}` : styles.deleteBtn}
                onClick={() => handleDelete(w.id, w.name)}
              >
                删除
              </Text>
            </View>
          );
        })}
        <Text className={styles.tip}>切换衣橱后，各页面的整体风格主题会随之变化。</Text>
      </View>
    </View>
  );
};

export default WardrobesPage;
