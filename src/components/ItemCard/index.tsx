import React, { useMemo } from 'react';
import { View, Text, Image } from '@tarojs/components';
import classnames from 'classnames';
import styles from './index.module.scss';

interface Props {
  item: {
    id: string;
    photos: string[];
    name: string;
    type: string;
    color: string;
    seasons: string[];
    favorite: boolean;
  };
  colorHexMap: Record<string, string>;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** 衣物卡片（列表条目）：主图 + 名称 + 属性标签 + 喜爱 */
const ItemCard: React.FC<Props> = ({ item, colorHexMap, onClick, onToggleFavorite }) => {
  const colorDot = useMemo(() => colorHexMap[item.color] || '#C9C2B8', [colorHexMap, item.color]);

  return (
    <View className={styles.card} onClick={onClick}>
      <View className={styles.photoWrap}>
        <Image
          className={styles.photo}
          src={item.photos[0]}
          mode='aspectFill'
          lazyLoad
          onError={() => console.error('[ItemCard] 照片加载失败, src =', item.photos[0])}
        />
        {item.photos.length > 1 && (
          <View className={styles.photoBadge}>
            <Text className={styles.photoBadgeText}>{item.photos.length}张</Text>
          </View>
        )}
      </View>
      <View className={styles.body}>
        <View className={styles.nameRow}>
          <Text className={styles.name}>{item.name}</Text>
          <Text
            className={classnames(styles.heart, item.favorite && styles.heartActive)}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
          >
            {item.favorite ? '♥' : '♡'}
          </Text>
        </View>
        <View className={styles.tags}>
          <Text className={styles.tag}>{item.type}</Text>
          <View className={styles.tag}>
            <View className={styles.colorDot} style={{ background: colorDot }} />
            <Text className={styles.tagText}>{item.color}</Text>
          </View>
          <Text className={styles.tag}>{item.seasons.join('·')}</Text>
        </View>
      </View>
    </View>
  );
};

export default ItemCard;
