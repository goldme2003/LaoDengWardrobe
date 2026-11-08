import React, { useMemo } from 'react';
import { View, Text, Swiper, SwiperItem, Image } from '@tarojs/components';
import Taro, { useRouter, useDidShow } from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { COLOR_HEX_MAP, themeVarsOf } from '@/data/presets';
import { formatDateTime } from '@/utils/format';
import styles from './index.module.scss';

/** 衣物详情（PRD FR-07）：照片组滑动浏览、属性、喜爱、备注、编辑/删除 */
const DetailItemPage: React.FC = () => {
  const router = useRouter();
  const id = router.params.id;

  const items = useWardrobeStore((s) => s.items);
  const toggleFavorite = useWardrobeStore((s) => s.toggleFavorite);
  const deleteItem = useWardrobeStore((s) => s.deleteItem);

  // 从编辑页返回时刷新（useDidShow 中递增 tick 触发重渲染）
  const [tick, setTick] = React.useState(0);
  useDidShow(() => {
    setTick((t) => t + 1);
  });

  const item = useMemo(() => items.find((it) => it.id === id), [items, id]);

  // v0.5：页面整体风格主题
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  if (!item) {
    return (
      <View className={styles.page} style={themeStyle}>
        <View className={styles.infoCard}>
          <Text className={styles.emptyRemark}>该衣物不存在或已删除</Text>
        </View>
      </View>
    );
  }

  const handleDelete = () => {
    Taro.showModal({
      title: '删除衣物',
      content: '删除后不可恢复，确定删除该衣物吗？',
      confirmColor: '#F53F3F',
      success: (res) => {
        if (res.confirm) {
          deleteItem(item.id);
          console.info('[Detail] 删除衣物, id =', item.id);
          Taro.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => Taro.navigateBack(), 600);
        }
      }
    });
  };

  const attrRows: { label: string; value: React.ReactNode }[] = [
    { label: '服装类型', value: item.type },
    { label: '内外穿', value: item.layer },
    {
      label: '颜色',
      value: (
        <View className={styles.colorValue}>
          <View className={styles.colorDot} style={{ background: COLOR_HEX_MAP[item.color] || '#C9C2B8' }} />
          <Text className={styles.attrValue}>{item.color}</Text>
        </View>
      )
    },
    { label: '材质', value: item.material },
    { label: '穿着季节', value: item.seasons.join('、') },
    ...(item.size ? [{ label: '尺码', value: item.size }] : []),
    ...(item.brand ? [{ label: '品牌', value: item.brand }] : []),
    ...(item.occasions && item.occasions.length > 0
      ? [{ label: '适用场合', value: item.occasions.join('、') }]
      : []),
    // v0.5 用户意见 6：购入信息展示
    ...(item.purchase?.date ? [{ label: '购入时间', value: item.purchase.date }] : []),
    ...(item.purchase?.place ? [{ label: '购入地点', value: item.purchase.place }] : []),
    ...(item.purchase?.price ? [{ label: '价格', value: `¥${item.purchase.price}` }] : []),
    ...(item.purchase?.photo
      ? [
          {
            label: '凭证照片',
            value: (
              <Image
                key='receipt'
                className={styles.receiptImage}
                src={item.purchase.photo}
                mode='aspectFill'
                onClick={() =>
                  Taro.previewImage({ urls: [item.purchase!.photo!] }).catch(() => undefined)
                }
              />
            )
          }
        ]
      : []),
    { label: '录入时间', value: formatDateTime(item.createdAt) }
  ];

  return (
    <View className={styles.page} style={themeStyle}>
      <View className={styles.swiperWrap}>
        <Swiper className={styles.swiper} indicatorDots circular>
          {item.photos.map((p, i) => (
            <SwiperItem key={`${p}_${i}`} className={styles.slide}>
              <Image
                className={styles.slideImage}
                src={p}
                mode='aspectFill'
                onError={() => console.error('[Detail] 照片加载失败, src =', p)}
              />
            </SwiperItem>
          ))}
        </Swiper>
        {item.photos.length > 1 && (
          <View className={styles.photoCount}>
            <Text className={styles.photoCountText}>1/{item.photos.length}</Text>
          </View>
        )}
      </View>

      <View className={styles.infoCard}>
        <View className={styles.nameRow}>
          <Text className={styles.name}>{item.name}</Text>
          <Text
            className={`${styles.heart} ${item.favorite ? styles.heartActive : ''}`}
            onClick={() => toggleFavorite(item.id)}
          >
            {item.favorite ? '♥' : '♡'}
          </Text>
        </View>

        {attrRows.map((row, idx) => (
          <View
            key={row.label}
            className={idx === attrRows.length - 1 ? styles.attrRowLast : styles.attrRow}
          >
            <Text className={styles.attrLabel}>{row.label}</Text>
            {row.value}
          </View>
        ))}

        <View className={styles.remarkBlock}>
          <Text className={styles.sectionTitle}>备注</Text>
          {item.remark ? (
            <Text className={styles.remarkText}>{item.remark}</Text>
          ) : (
            <Text className={styles.emptyRemark}>未填写</Text>
          )}
        </View>
      </View>

      <View className={styles.bottomBar}>
        <View
          className={styles.editBtn}
          onClick={() => Taro.navigateTo({ url: `/pages/add/index?id=${item.id}` })}
        >
          <Text className={styles.editBtnText}>编辑</Text>
        </View>
        <View className={styles.deleteBtn} onClick={handleDelete}>
          <Text className={styles.deleteBtnText}>删除</Text>
        </View>
      </View>
    </View>
  );
};

export default DetailItemPage;
