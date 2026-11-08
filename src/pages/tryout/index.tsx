import React, { useMemo } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import EmptyState from '@/components/EmptyState';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { COLOR_HEX_MAP, themeVarsOf } from '@/data/presets';
import { formatDateTime } from '@/utils/format';
import { TryoutItem } from '@/types';
import styles from './index.module.scss';

/** 备选页（v0.5 用户意见 7）：准备购入的试穿/展示图片与信息，可转正式衣物 */
const TryoutPage: React.FC = () => {
  const tryoutItems = useWardrobeStore((s) => s.tryoutItems);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const deleteTryout = useWardrobeStore((s) => s.deleteTryout);

  // v0.5：页面整体风格主题
  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  const list = useMemo(
    () =>
      tryoutItems
        .filter((t) => t.wardrobeId === currentWardrobeId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [tryoutItems, currentWardrobeId]
  );

  const goAdd = () => Taro.navigateTo({ url: '/pages/tryout-edit/index' });
  const goEdit = (id: string) => Taro.navigateTo({ url: `/pages/tryout-edit/index?id=${id}` });
  const goConvert = (id: string) => {
    Taro.showModal({
      title: '转正式衣物',
      content: '将携带照片与已填信息进入衣物录入页，保存后移除该备选。',
      success: (res) => {
        if (res.confirm) {
          Taro.navigateTo({ url: `/pages/add/index?fromTryout=${id}` });
        }
      }
    });
  };

  const handleDelete = (item: TryoutItem) => {
    Taro.showModal({
      title: '删除备选',
      content: `删除「${item.name}」后不可恢复，确定删除吗？`,
      confirmColor: '#F53F3F',
      success: (res) => {
        if (res.confirm) {
          deleteTryout(item.id);
          Taro.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  };

  return (
    <View className={styles.page} style={themeStyle}>
      {list.length === 0 ? (
        <EmptyState
          icon='🛍️'
          title='还没有备选衣物'
          desc='把准备购入的试穿照或展示图先存到这里'
          actionText='添加备选'
          onAction={goAdd}
        />
      ) : (
        list.map((t) => (
          <View key={t.id} className={styles.card}>
            <View className={styles.photoRow}>
              {(t.photos || []).slice(0, 3).map((p, i) => (
                <Image
                  key={`${p}_${i}`}
                  className={styles.photo}
                  src={p}
                  mode='aspectFill'
                  onClick={() => Taro.previewImage({ urls: t.photos, current: p }).catch(() => undefined)}
                />
              ))}
              {(t.photos || []).length > 3 && (
                <Text className={styles.moreCount}>+{(t.photos || []).length - 3}</Text>
              )}
              {(t.photos || []).length === 0 && (
                <View className={styles.photoPlaceholder}>
                  <Text className={styles.photoPlaceholderText}>暂无图片</Text>
                </View>
              )}
            </View>

            <View className={styles.infoRow}>
              <Text className={styles.name}>{t.name}</Text>
              {t.price ? <Text className={styles.price}>¥{t.price}</Text> : null}
            </View>
            <View className={styles.metaRow}>
              {t.brand ? <Text className={styles.meta}>品牌：{t.brand}</Text> : null}
              {t.size ? <Text className={styles.meta}>尺码：{t.size}</Text> : null}
              {t.color ? (
                <View className={styles.colorMeta}>
                  <View
                    className={styles.colorDot}
                    style={{ background: COLOR_HEX_MAP[t.color] || '#C9C2B8' }}
                  />
                  <Text className={styles.meta}>{t.color}</Text>
                </View>
              ) : null}
            </View>
            {t.note ? <Text className={styles.note}>{t.note}</Text> : null}
            <Text className={styles.time}>{formatDateTime(t.createdAt)}</Text>

            <View className={styles.actions}>
              <View className={styles.convertBtn} onClick={() => goConvert(t.id)}>
                <Text className={styles.convertText}>转正式衣物</Text>
              </View>
              <View className={styles.editBtn} onClick={() => goEdit(t.id)}>
                <Text className={styles.editText}>编辑</Text>
              </View>
              <View className={styles.deleteBtn} onClick={() => handleDelete(t)}>
                <Text className={styles.deleteText}>删除</Text>
              </View>
            </View>
          </View>
        ))
      )}

      <View className={styles.fab} onClick={goAdd}>
        <Text className={styles.fabIcon}>+</Text>
      </View>
    </View>
  );
};

export default TryoutPage;
