import React, { useState, useEffect } from 'react';
import { View, Text, Image, Swiper, SwiperItem } from '@tarojs/components';
import type { SceneId, SceneOption } from '@/services/recommend';
import type { ClothingItem } from '@/types';
import styles from './index.module.scss';

/** v1.7.0：空衣橱时的天气推荐文案（复用空衣橱引导：云函数按性别/年龄/明日天气生成或本地兜底） */
export interface RecommendAdvice {
  text: string;
  source: 'hunyuan' | 'fallback';
}

/** v1.10.0：单套推荐展示模型（缓存条目解析后的视图对象） */
export interface OutfitVM {
  id: string;
  scene: SceneId;
  sceneLabel: string;
  reason: string;
  items: ClothingItem[];
  source: 'hunyuan' | 'fallback';
}

interface Props {
  /** 今日缓存的多套推荐（1–5 套，Swiper 左右滑动查看） */
  outfits: OutfitVM[];
  /** v1.7.0：空衣橱时的天气推荐（outfits 为空时展示，同样区分云端/兜底来源角标） */
  advice?: RecommendAdvice | null;
  /** 搭配场景预设（v1.4.1：只能点选预设，不支持自由输入） */
  scenes: SceneOption[];
  scene: SceneId;
  onSelectScene: (scene: SceneId) => void;
  /** 当前滑动到的套是否已全部加入明日穿搭（已采纳则按钮置灰） */
  adopted: boolean;
  /** 首套尚未生成时的加载态 */
  loading: boolean;
  /** 「换一件」是否可用（每日套数用尽后置灰并提示） */
  canShuffle: boolean;
  /** 今日已生成套数 / 会员每日套数（普通版 1 / VIP 2 / SVIP 5） */
  used: number;
  total: number;
  tripMode?: boolean;
  onSwiperIndex: (idx: number) => void;
  onShuffle: () => void;
  onAdopt: () => void;
}

/** 明日穿搭推荐卡片（v1.4.0 B/D 阶段起步）
 * v1.10.0：按会员档位每日可生成 1/2/5 套，全部缓存至「明日穿搭」当天展示，
 * 以 Swiper 左右滑动切换；套数用尽后「换一件」置灰，不再重新生成。
 * v1.6.1：tripMode 下标题改为"出差穿搭推荐"并隐藏场景选择条
 * v1.7.0：空衣橱时默认展示（advice 模式：显示按天气生成的着装建议 + 添加衣物引导，不再整卡隐藏） */
const RecommendCard: React.FC<Props> = ({
  outfits,
  advice,
  scenes,
  scene,
  onSelectScene,
  adopted,
  loading,
  canShuffle,
  used,
  total,
  tripMode,
  onSwiperIndex,
  onShuffle,
  onAdopt
}) => {
  const isAdvice = outfits.length === 0 && !!advice;
  const [idx, setIdx] = useState(0);
  // 缓存列表变化时收敛索引，避免越界停留在空滑块
  useEffect(() => {
    if (idx >= outfits.length) {
      setIdx(0);
      onSwiperIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfits.length]);

  const current = outfits[Math.min(idx, Math.max(outfits.length - 1, 0))];
  // 来源角标：仅云端生成时显示「混元生成」（v1.8.1：兜底方案不再显示角标）
  const tagSource = current ? current.source : isAdvice ? advice!.source : undefined;
  // 无搭配也无建议时（如天气尚在加载 / 首套生成中）统一展示生成中，保证卡片默认可见
  const showLoading = loading || (outfits.length === 0 && !advice);

  const handleIdx = (i: number) => {
    setIdx(i);
    onSwiperIndex(i);
  };

  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <View className={styles.titleRow}>
          <Text className={styles.title}>{tripMode ? '出差穿搭推荐' : '明日穿搭推荐'}</Text>
          <View className={styles.titleRight}>
            {/* v1.10.0：今日生成进度（套数用尽后不再生成，仅展示缓存） */}
            {!tripMode && total > 0 && (
              <Text className={styles.progressText}>
                今日 {used}/{total} 套{used >= total ? ' · 已缓存' : ''}
              </Text>
            )}
            {tagSource === 'hunyuan' && (
              <Text className={`${styles.sourceTag} ${styles.sourceGreen}`}>混元生成</Text>
            )}
          </View>
        </View>
        {!showLoading && current && <Text className={styles.reason}>{current.reason}</Text>}
        {!showLoading && !current && isAdvice && <Text className={styles.reason}>{advice!.text}</Text>}
      </View>
      {showLoading ? (
        <View className={styles.loading}>
          <View className={styles.spinner} />
          <Text className={styles.loadingText}>穿搭建议生成中…</Text>
        </View>
      ) : outfits.length > 0 ? (
        <>
          {!tripMode && (
            <View className={styles.sceneBar}>
              {scenes.map((s) => (
                <View
                  key={s.id}
                  className={`${styles.sceneChip} ${scene === s.id ? styles.sceneChipActive : ''}`}
                  onClick={() => onSelectScene(s.id)}
                >
                  <Text className={`${styles.sceneChipText} ${scene === s.id ? styles.sceneChipTextActive : ''}`}>
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {/* v1.10.0：多套缓存方案左右滑动展示（单套时为普通整卡展示） */}
          <Swiper
            className={styles.outfitSwiper}
            current={idx}
            onChange={(e) => handleIdx(e.detail.current)}
            indicatorDots={outfits.length > 1}
            indicatorColor='rgba(0, 0, 0, 0.15)'
            indicatorActiveColor='rgba(176, 125, 80, 0.9)'
          >
            {outfits.map((o) => (
              <SwiperItem key={o.id}>
                <View className={styles.items}>
                  {o.items.map((it) => (
                    <View key={it.id} className={styles.item}>
                      <Image className={styles.photo} src={it.photos[0]} mode='aspectFill' />
                      <Text className={styles.name} numberOfLines={2}>
                        {it.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </SwiperItem>
            ))}
          </Swiper>
          <View className={styles.actions}>
            <View
              className={`${styles.shuffleBtn} ${!canShuffle ? styles.shuffleBtnDisabled : ''}`}
              onClick={canShuffle ? onShuffle : undefined}
            >
              <Text className={styles.shuffleText}>{canShuffle ? '换一件' : '今日已生成完'}</Text>
            </View>
            <View
              className={`${styles.adoptBtn} ${adopted ? styles.adoptBtnDone : ''}`}
              onClick={adopted ? undefined : onAdopt}
            >
              <Text className={styles.adoptText}>{adopted ? '已采纳 ✓' : '一键采纳到明日穿搭'}</Text>
            </View>
          </View>
        </>
      ) : (
        <>
          {/* v1.7.0：空衣橱建议模式——只展示按天气生成的建议文案 + 添加衣物引导 */}
          <View className={styles.adviceHint}>
            <Text className={styles.adviceHintText}>添加衣物后，将按你的衣橱实况生成可一键采纳的专属搭配</Text>
          </View>
        </>
      )}
    </View>
  );
};

export default RecommendCard;
