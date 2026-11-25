import React, { useMemo, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import type { ITouchEvent } from '@tarojs/components';
import Taro from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';

/** 长按判定时长（ms）：超过该时间未移动且未松手即视为长按 */
const LONG_PRESS_MS = 600;
/** 触点移动超过该距离（px）视为滑动浏览，取消长按判定 */
const LONG_PRESS_MOVE_TOLERANCE = 10;

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
  /** 长按卡片（v1.18.0：衣橱长按衣物加入明日穿搭；不传则无长按行为）
   * v1.18.1：真机上原生 bindlongpress 触发不可靠，改为 touchstart 计时自实现长按 */
  onLongPress?: () => void;
}

/** 衣物卡片（列表条目）：主图 + 名称 + 属性标签 + 喜爱 */
const ItemCard: React.FC<Props> = ({ item, colorHexMap, onClick, onToggleFavorite, onLongPress }) => {
  const colorDot = useMemo(() => colorHexMap[item.color] || '#C9C2B8', [colorHexMap, item.color]);

  // v1.18.1：自实现长按——touchstart 起 600ms 计时，移动超容差或松手即取消；
  // 长按触发后置 suppressTap 标记，随后紧跟的 tap 不再进入详情（原生 longpress 本身会抑制 tap）
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTap = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);

  const clearPressTimer = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleTouchStart = (e: ITouchEvent) => {
    if (!onLongPress) return;
    suppressTap.current = false;
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      suppressTap.current = true;
      if (process.env.TARO_ENV === 'weapp') {
        Taro.vibrateShort({ type: 'medium' }).catch(() => {});
      }
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e: ITouchEvent) => {
    if (!pressTimer.current) return;
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_TOLERANCE) clearPressTimer();
  };

  const handleTouchEnd = () => clearPressTimer();

  const handleClick = () => {
    if (suppressTap.current) {
      suppressTap.current = false;
      return;
    }
    onClick();
  };

  return (
    <View
      className={styles.card}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
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
