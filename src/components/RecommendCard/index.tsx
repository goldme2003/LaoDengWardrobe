import React from 'react';
import { View, Text, Image } from '@tarojs/components';
import type { RecommendOutfit, SceneId, SceneOption } from '@/services/recommend';
import styles from './index.module.scss';

/** v1.7.0：空衣橱时的天气推荐文案（复用空衣橱引导：云函数按性别/年龄/明日天气生成或本地兜底） */
export interface RecommendAdvice {
  text: string;
  source: 'hunyuan' | 'fallback';
}

interface Props {
  /** 推荐搭配（有衣物时）；空衣橱建议模式下为空 */
  outfit?: RecommendOutfit | null;
  /** v1.7.0：空衣橱时的天气推荐（outfit 为空时展示，同样区分云端/兜底来源角标） */
  advice?: RecommendAdvice | null;
  /** 搭配场景预设（v1.4.1：只能点选预设，不支持自由输入） */
  scenes: SceneOption[];
  scene: SceneId;
  onSelectScene: (scene: SceneId) => void;
  /** 推荐衣物是否已全部加入明日穿搭（已采纳则按钮置灰） */
  adopted: boolean;
  /** v1.4.2：生成中（选择风格 / 切换城市后展示显性加载态） */
  loading: boolean;
  /** v1.5.0：推荐来源（hunyuan = 混元生成，fallback = 本地/云端兜底） */
  source?: 'hunyuan' | 'fallback';
  /** v1.6.1：出差模式下隐藏场景选择、标题改为"出差穿搭推荐" */
  tripMode?: boolean;
  onShuffle: () => void;
  onAdopt: () => void;
}

/** 明日穿搭推荐卡片（v1.4.0 B/D 阶段）：规则引擎生成 1–3 套，「换一件」轮换、「一键采纳」写入明日穿搭勾选
 * v1.6.1：tripMode 下标题改为"出差穿搭推荐"并隐藏场景选择条
 * v1.7.0：空衣橱时默认展示（advice 模式：显示按天气生成的着装建议 + 添加衣物引导，不再整卡隐藏） */
const RecommendCard: React.FC<Props> = ({
  outfit,
  advice,
  scenes,
  scene,
  onSelectScene,
  adopted,
  loading,
  source,
  tripMode,
  onShuffle,
  onAdopt
}) => {
  const isAdvice = !outfit && !!advice;
  // 来源角标：搭配模式用 source，建议模式用 advice.source（绿=云端生成 / 红=兜底）
  const tagSource = outfit ? source : isAdvice ? advice!.source : undefined;
  // 无搭配也无建议时（如天气尚在加载）统一展示生成中，保证卡片默认可见
  const showLoading = loading || (!outfit && !advice);

  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <View className={styles.titleRow}>
          <Text className={styles.title}>{tripMode ? '出差穿搭推荐' : '明日穿搭推荐'}</Text>
          {/* v1.5.1：移除右上角「适用场景」角标，场景仅由下方标签组展示 */}
          {/* v1.5.0：来源区分——绿色混元生成 / 红色兜底 */}
          {!!tagSource && (
            <Text className={`${styles.sourceTag} ${tagSource === 'hunyuan' ? styles.sourceGreen : styles.sourceRed}`}>
              {tagSource === 'hunyuan' ? '混元生成' : '兜底推荐'}
            </Text>
          )}
        </View>
        {!showLoading && !!outfit && <Text className={styles.reason}>{outfit.reason}</Text>}
      </View>
      {showLoading ? (
        <View className={styles.loading}>
          <View className={styles.spinner} />
          <Text className={styles.loadingText}>穿搭建议生成中…</Text>
        </View>
      ) : outfit ? (
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
          <View className={styles.items}>
            {outfit.items.map((it) => (
              <View key={it.id} className={styles.item}>
                <Image className={styles.photo} src={it.photos[0]} mode='aspectFill' />
                <Text className={styles.name} numberOfLines={1}>
                  {it.name}
                </Text>
              </View>
            ))}
          </View>
          <View className={styles.actions}>
            <View className={styles.shuffleBtn} onClick={onShuffle}>
              <Text className={styles.shuffleText}>换一件</Text>
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
          <Text className={styles.reason}>{advice!.text}</Text>
          <View className={styles.adviceHint}>
            <Text className={styles.adviceHintText}>添加衣物后，将按你的衣橱实况生成可一键采纳的专属搭配</Text>
          </View>
        </>
      )}
    </View>
  );
};

export default RecommendCard;
