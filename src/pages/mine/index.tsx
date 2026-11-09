import React, { useMemo, useState } from 'react';
import { View, Text, Picker, ScrollView } from '@tarojs/components';
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
import { BodyProfile, Gender, ThemeId } from '@/types';
import styles from './index.module.scss';

const UNFILLED = '未填写';

/** 数字拨盘选项：['未填写', min..max] */
const buildNumberRange = (min: number, max: number): string[] => {
  const list = [UNFILLED];
  for (let i = min; i <= max; i += 1) list.push(String(i));
  return list;
};

/** 我的页（v0.6）：统计跳转、个人信息卡（弹层拨盘修改）、衣橱设置（风格主题）、关于 */
const MinePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const tryoutItems = useWardrobeStore((s) => s.tryoutItems);
  const bodyProfile = useWardrobeStore((s) => s.bodyProfiles[s.currentWardrobeId]) || {};
  const updateBodyProfile = useWardrobeStore((s) => s.updateBodyProfile);
  const updateWardrobe = useWardrobeStore((s) => s.updateWardrobe);
  const setWardrobeFilterPreset = useWardrobeStore((s) => s.setWardrobeFilterPreset);

  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const totalCount = items.length;
  const favoriteCount = items.filter((it) => it.favorite).length;
  const tryoutCount = tryoutItems.filter((t) => t.wardrobeId === currentWardrobeId).length;

  // v0.6：个人信息修改弹层（草稿态，保存时统一提交）
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftGender, setDraftGender] = useState<Gender>('female');
  const [draftAge, setDraftAge] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState<BodyProfile>({});

  // 拨盘选项（年龄 + 身体数据，均为「未填写」+ 数字区间）
  const ageRange = useMemo(() => buildNumberRange(AGE_MIN, AGE_MAX), []);
  const bodyRanges = useMemo(() => {
    const map: Record<string, string[]> = {};
    BODY_FIELD_DEFS.forEach((f) => {
      map[f.key] = buildNumberRange(f.min, f.max);
    });
    return map;
  }, []);

  const openEditor = () => {
    if (!currentWardrobe) return;
    setDraftGender(currentWardrobe.gender);
    setDraftAge(currentWardrobe.age);
    setDraftBody({ ...bodyProfile });
    setEditorOpen(true);
  };

  const cancelEditor = () => setEditorOpen(false);

  const saveEditor = () => {
    if (!currentWardrobe) return;
    updateWardrobe(currentWardrobe.id, { gender: draftGender, age: draftAge });
    updateBodyProfile(draftBody);
    console.info('[Mine] 个人信息已保存, wardrobeId =', currentWardrobe.id);
    setEditorOpen(false);
    Taro.showToast({ title: '已保存', icon: 'success' });
  };

  // v0.6：统计项点击跳转
  const goHome = () => Taro.switchTab({ url: '/pages/wardrobe/index' });
  const goFavorites = () => {
    setWardrobeFilterPreset('favorite');
    Taro.switchTab({ url: '/pages/wardrobe/index' });
  };
  const goTryout = () => Taro.switchTab({ url: '/pages/tryout/index' });
  const goWardrobes = () => Taro.navigateTo({ url: '/pages/wardrobes/index' });

  const genderIndex = GENDER_OPTIONS.findIndex((g) => g.value === draftGender);
  const genderLabel = GENDER_OPTIONS.find((g) => g.value === currentWardrobe?.gender)?.label || '-';
  const filledFields = BODY_FIELD_DEFS.filter((f) => bodyProfile[f.key] !== undefined);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  return (
    <View className={styles.page} style={themeStyle}>
      {/* v0.6 用户意见 8：统计项可点击跳转 */}
      <View className={styles.card}>
        <View className={styles.stats}>
          <View className={styles.statItem} onClick={goHome}>
            <Text className={styles.statNum}>{totalCount}</Text>
            <Text className={styles.statLabel}>衣物总数</Text>
          </View>
          <View className={styles.statItem} onClick={goFavorites}>
            <Text className={styles.statNum}>{favoriteCount}</Text>
            <Text className={styles.statLabel}>喜爱衣物</Text>
          </View>
          <View className={styles.statItem} onClick={goTryout}>
            <Text className={styles.statNum}>{tryoutCount}</Text>
            <Text className={styles.statLabel}>备选</Text>
          </View>
          <View className={styles.statItem} onClick={goWardrobes}>
            <Text className={styles.statNum}>{wardrobes.length}</Text>
            <Text className={styles.statLabel}>衣橱数量</Text>
          </View>
        </View>
      </View>

      {/* v0.6 用户意见 1/2：个人信息卡（随衣橱联动），点击弹出修改页 */}
      <View className={styles.card} onClick={openEditor}>
        <View className={styles.infoHeader}>
          <Text className={styles.sectionTitle}>个人信息</Text>
          <Text className={styles.infoEditHint}>点击修改 ▾</Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>衣橱主人</Text>
          <Text className={styles.infoValue}>{currentWardrobe?.name || '-'}</Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>性别</Text>
          <Text className={styles.infoValue}>{genderLabel}</Text>
        </View>
        <View className={styles.infoRow}>
          <Text className={styles.infoLabel}>年龄</Text>
          <Text className={styles.infoValue}>
            {currentWardrobe?.age !== null && currentWardrobe?.age !== undefined
              ? `${currentWardrobe.age} 岁`
              : UNFILLED}
          </Text>
        </View>
        {filledFields.length > 0 ? (
          <View className={styles.infoGrid}>
            {filledFields.map((f) => (
              <View key={f.key} className={styles.infoField}>
                <Text className={styles.infoFieldLabel}>{f.label}</Text>
                <Text className={styles.infoFieldValue}>
                  {bodyProfile[f.key]} {f.unit}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className={styles.cardTip}>身体数据暂未填写，点击卡片可补充（缝纫/尺码参考，均为选填）。</Text>
        )}
      </View>

      {/* 衣橱设置（风格主题 + 衣橱管理入口）；性别/年龄已并入个人信息卡 */}
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>衣橱设置</Text>
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
          <Text className={styles.aboutValue}>{APP_VERSION}（开发预览）</Text>
        </View>
        <View className={styles.aboutRow}>
          <Text className={styles.aboutLabel}>数据存储</Text>
          <Text className={styles.aboutValue}>本机存储</Text>
        </View>
        <Text className={styles.cardTip}>
          当前版本所有数据（照片与衣物档案）保存在本机。卸载小程序或清除数据会导致数据丢失，请知悉。
        </Text>
      </View>

      {/* v0.6：个人信息修改弹层（拨盘控件，数字内容无需手动输入） */}
      {editorOpen && (
        <View className={styles.mask} onClick={cancelEditor}>
          <View className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <Text className={styles.modalTitle}>修改个人信息</Text>
            <ScrollView scrollY className={styles.modalScroll}>
              <View className={styles.modalRow}>
                <Text className={styles.modalLabel}>性别</Text>
                <Picker
                  mode='selector'
                  range={GENDER_OPTIONS.map((g) => g.label)}
                  value={Math.max(0, genderIndex)}
                  onChange={(e) => setDraftGender(GENDER_OPTIONS[Number(e.detail.value)].value)}
                >
                  <View className={styles.modalPicker}>
                    <Text className={styles.modalValue}>
                      {GENDER_OPTIONS[Math.max(0, genderIndex)].label}
                    </Text>
                    <Text className={styles.modalArrow}>▾</Text>
                  </View>
                </Picker>
              </View>
              <View className={styles.modalRow}>
                <Text className={styles.modalLabel}>年龄（岁）</Text>
                <Picker
                  mode='selector'
                  range={ageRange}
                  value={draftAge === null ? 0 : draftAge - AGE_MIN + 1}
                  onChange={(e) => {
                    const idx = Number(e.detail.value);
                    setDraftAge(idx === 0 ? null : AGE_MIN + idx - 1);
                  }}
                >
                  <View className={styles.modalPicker}>
                    <Text className={styles.modalValue}>
                      {draftAge === null ? UNFILLED : `${draftAge} 岁`}
                    </Text>
                    <Text className={styles.modalArrow}>▾</Text>
                  </View>
                </Picker>
              </View>
              {BODY_FIELD_DEFS.map((f) => {
                const range = bodyRanges[f.key];
                const cur = draftBody[f.key];
                const valueIdx = cur === undefined ? 0 : Math.max(0, Math.min(range.length - 1, cur - f.min + 1));
                return (
                  <View key={f.key} className={styles.modalRow}>
                    <Text className={styles.modalLabel}>
                      {f.label}（{f.unit}）
                    </Text>
                    <Picker
                      mode='selector'
                      range={range}
                      value={valueIdx}
                      onChange={(e) => {
                        const idx = Number(e.detail.value);
                        setDraftBody((prev) => ({
                          ...prev,
                          [f.key]: idx === 0 ? undefined : f.min + idx - 1
                        }));
                      }}
                    >
                      <View className={styles.modalPicker}>
                        <Text className={styles.modalValue}>
                          {cur === undefined ? UNFILLED : `${cur} ${f.unit}`}
                        </Text>
                        <Text className={styles.modalArrow}>▾</Text>
                      </View>
                    </Picker>
                  </View>
                );
              })}
            </ScrollView>
            <View className={styles.modalActions}>
              <View className={styles.modalBtn} onClick={cancelEditor}>
                <Text className={styles.modalBtnText}>取消</Text>
              </View>
              <View className={`${styles.modalBtn} ${styles.modalBtnPrimary}`} onClick={saveEditor}>
                <Text className={styles.modalBtnPrimaryText}>保存</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

export default MinePage;
