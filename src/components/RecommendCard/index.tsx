import React from 'react';
import { View, Text, Image } from '@tarojs/components';
import type { RecommendOutfit, SceneId, SceneOption } from '@/services/recommend';
import styles from './index.module.scss';

interface Props {
  outfit: RecommendOutfit;
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
 * v1.6.1：tripMode 下标题改为"出差穿搭推荐"并隐藏场景选择条 */
const RecommendCard: React.FC<Props> = ({
  outfit,
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
  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <View className={styles.titleRow}>
          <Text className={styles.title}>{tripMode ? '出差穿搭推荐' : '明日穿搭推荐'}</Text>
          {/* v1.5.1：移除右上角「适用场景」角标，场景仅由下方标签组展示 */}
          {/* v1.5.0：来源区分——绿色混元生成 / 红色兜底 */}
          {!!source && (
            <Text className={`${styles.sourceTag} ${source === 'hunyuan' ? styles.sourceGreen : styles.sourceRed}`}>
              {source === 'hunyuan' ? '混元生成' : '兜底推荐'}
            </Text>
          )}
        </View>
        {!loading && <Text className={styles.reason}>{outfit.reason}</Text>}
      </View>
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
      {loading ? (
        <View className={styles.loading}>
          <View className={styles.spinner} />
          <Text className={styles.loadingText}>穿搭建议生成中…</Text>
        </View>
      ) : (
        <>
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
      )}
    </View>
  );
};

export default RecommendCard;
