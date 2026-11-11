import React from 'react';
import { View, Text } from '@tarojs/components';
import classnames from 'classnames';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { GENDER_OPTIONS, THEME_SETS, getThemeById, themeVarsOf } from '@/data/presets';
import { formatDate } from '@/utils/format';
import styles from './index.module.scss';

/** 衣橱管理页（v0.6：仅展示全部衣橱列表；新建衣橱为独立页面）
 * v0.7.0：风格主题选择移入本页（列表项内色点点选，替代「我的」页主题区块） */
const WardrobesPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const deleteWardrobe = useWardrobeStore((s) => s.deleteWardrobe);
  const setCurrentWardrobe = useWardrobeStore((s) => s.setCurrentWardrobe);
  const updateWardrobe = useWardrobeStore((s) => s.updateWardrobe);

  // 当前衣橱风格主题（v0.5：页面整体风格联动）
  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  const goCreate = () => Taro.navigateTo({ url: '/pages/wardrobe-new/index' });

  // v0.7.0 用户意见 5：修改入口 —— 先切换为当前衣橱，再进入个人信息修改页（该页编辑当前衣橱主人信息）
  const goEditProfile = (id: string) => {
    setCurrentWardrobe(id);
    Taro.navigateTo({ url: '/pages/profile/index' });
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
      {/* v0.6 用户意见 9：新建衣橱独立成页 */}
      <View className={styles.addBtn} onClick={goCreate}>
        <Text className={styles.addBtnText}>＋ 新建衣橱</Text>
      </View>

      <View className={styles.card}>
        <Text className={styles.sectionTitle}>👥 全部衣橱</Text>
        {wardrobes.map((w) => {
          const theme = getThemeById(w.themeId);
          const genderLabel = GENDER_OPTIONS.find((g) => g.value === w.gender)?.label || '-';
          return (
            <View key={w.id} className={styles.wardrobeBlock}>
              <View className={styles.wardrobeItem}>
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
                <Text className={styles.editBtn} onClick={() => goEditProfile(w.id)}>
                  修改
                </Text>
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

              {/* v0.7.0：风格主题色点选择（点击即更新该衣橱主题，当前主题高亮） */}
              <View className={styles.themeRow}>
                <Text className={styles.themeRowLabel}>主题</Text>
                {THEME_SETS.map((t) => (
                  <View
                    key={t.id}
                    className={classnames(styles.themeDotBtn, w.themeId === t.id && styles.themeDotBtnActive)}
                    style={{ background: t.bg }}
                    onClick={() => updateWardrobe(w.id, { themeId: t.id })}
                  >
                    <View className={styles.themeDotInner} style={{ background: t.primary }} />
                  </View>
                ))}
              </View>
            </View>
          );
        })}
        <Text className={styles.tip}>切换衣橱后，各页面的整体风格主题与个人信息会随之变化。</Text>
      </View>
    </View>
  );
};

export default WardrobesPage;
