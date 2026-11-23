import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Image, Swiper, SwiperItem } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { Gender } from '@/types';
import type { MemberTier } from '@/services/entitlement';
import { requestSeasonalImages, SeasonalImage } from '@/services/seasonalImages';
import autumnM1 from '@/assets/seasonal/autumn-m-1.jpg';
import autumnM2 from '@/assets/seasonal/autumn-m-2.jpg';
import autumnM3 from '@/assets/seasonal/autumn-m-3.jpg';
import autumnM4 from '@/assets/seasonal/autumn-m-4.jpg';
import autumnM5 from '@/assets/seasonal/autumn-m-5.jpg';
import autumnF1 from '@/assets/seasonal/autumn-f-1.jpg';
import autumnF2 from '@/assets/seasonal/autumn-f-2.jpg';
import autumnF3 from '@/assets/seasonal/autumn-f-3.jpg';
import autumnF4 from '@/assets/seasonal/autumn-f-4.jpg';
import autumnF5 from '@/assets/seasonal/autumn-f-5.jpg';
import styles from './index.module.scss';

interface Props {
  /** 衣橱主人性别（决定使用男士/女士图组） */
  gender?: Gender;
  /** 衣橱主人年龄（决定云端图组的年龄段） */
  age?: number | null;
  /** v1.13.0：会员档位（普通 1 / VIP 3 / SVIP 5 张，风格组随档位变化） */
  tier: MemberTier;
  /** v1.9.0（F-19）：今日可看张数（会员权益） */
  quota: number;
  /** v1.9.0（F-19）：今日已看张数 */
  viewed: number;
  /** v1.9.0（F-19）：本轮实际展示 n 张，由首页登记用量 */
  onShow: (n: number) => void;
}

/** 季节（按当前月份划分）：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬 */
const seasonOf = (month: number): { label: string } => {
  if (month >= 3 && month <= 5) return { label: '春季' };
  if (month >= 6 && month <= 8) return { label: '夏季' };
  if (month >= 9 && month <= 11) return { label: '秋季' };
  return { label: '冬季' };
};

/** 年龄段（与空衣橱引导、云函数口径一致）：<18 青少年 / ≤30 青年 / ≤50 中年 / 其余熟龄 */
const ageGroupOf = (age?: number | null): string => {
  if (!age || age <= 0) return '青年';
  if (age < 18) return '青少年';
  if (age <= 30) return '青年';
  if (age <= 50) return '中年';
  return '熟龄';
};

/** 本地兜底图组（v1.7.1 打包资源，仅秋季；云端图组不可用时展示，避免空白卡片） */
const STYLE_LABELS = ['通勤简约', '街头休闲', '运动活力', '轻正式', '周末出行'];
const LOCAL_IMAGES: Record<'male' | 'female', string[]> = {
  male: [autumnM1, autumnM2, autumnM3, autumnM4, autumnM5],
  female: [autumnF1, autumnF2, autumnF3, autumnF4, autumnF5]
};

interface Slide {
  label: string;
  src: string;
  /** 是否云端 AI 生成（用于「AI 生成」标识） */
  ai: boolean;
}

/** 当季推荐卡（v1.7.0，v1.13.0 改为云端混元生图，v1.13.1 调整档位与模型）
 * 云函数按「当日 + 季节 + 性别 + 年龄段 + 会员档位」调用 Hy-Image-3.5-Preview 生成当季流行穿搭图并缓存到云存储，
 * 前端优先展示云端图组（含「AI 生成」标识），云端不可用时回退本地图组；
 * 普通版不生图（展示 1 张本地示例并引导开通 VIP），VIP 1 张 / SVIP 2 张，当日额度用尽后保留已展示图片并停止自动轮播。 */
const SeasonalCard: React.FC<Props> = ({ gender, age, tier, quota, viewed, onShow }) => {
  const now = new Date();
  const season = seasonOf(now.getMonth() + 1);
  const ageGroup = ageGroupOf(age);
  const genderLabel = gender === 'female' ? '女士' : '男士';
  // 每日放行张数 = min(当日额度, 图库上限 5)
  const shown = Math.max(0, Math.min(quota, 5));
  const exhausted = viewed >= shown;

  const [cloud, setCloud] = useState<SeasonalImage[]>([]);
  // 普通版（额度 0）不生图，直接展示本地示例，无需加载态
  const [loading, setLoading] = useState(quota > 0);
  const [failed, setFailed] = useState(false);
  const reportedRef = useRef(false);

  const load = useCallback(() => {
    let alive = true;
    // 额度用尽后不再请求云端（避免重复生成计费），保留已展示图片
    if (exhausted) {
      setLoading(false);
      setFailed(false);
      return () => {
        alive = false;
      };
    }
    setLoading(true);
    setFailed(false);
    requestSeasonalImages({ gender, age, tier })
      .then((imgs) => {
        if (!alive) return;
        setCloud(imgs);
        setFailed(imgs.length === 0);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [gender, age, tier, exhausted]);

  useEffect(() => load(), [load]);

  // 本地兜底：按日期轮换起始位，保证每天看到的示例不同
  const localSlides = useMemo<Slide[]>(() => {
    const imgs = LOCAL_IMAGES[gender === 'female' ? 'female' : 'male'];
    const d = new Date();
    const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
    const start = dayOfYear % imgs.length;
    return STYLE_LABELS.map((label, i) => {
      const idx = (start + i) % imgs.length;
      return { label: STYLE_LABELS[idx], src: imgs[idx], ai: false };
    });
  }, [gender]);

  const cloudSlides = useMemo<Slide[]>(
    () => cloud.slice(0, shown).map((it) => ({ label: it.label, src: it.fileID, ai: true })),
    [cloud, shown]
  );
  // 云端图组优先；不可用或普通版（额度 0）时用本地示例补位（普通版固定展示 1 张）
  const slides = cloudSlides.length > 0 ? cloudSlides : localSlides.slice(0, shown > 0 ? shown : 1);

  // 首次加载完成登记今日展示张数（额度随天滚动重置，由 store 侧保证）
  useEffect(() => {
    if (loading || reportedRef.current || exhausted || slides.length === 0) return;
    reportedRef.current = true;
    onShow(slides.length);
  }, [loading, exhausted, slides.length, onShow]);

  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <View className={styles.titleRow}>
          <Text className={styles.title}>当季推荐 · {season.label}</Text>
          {cloudSlides.length > 0 && <Text className={styles.aiBadge}>AI 生成</Text>}
        </View>
        <Text className={styles.sub}>
          为{ageGroup}{genderLabel}挑选的当季流行穿搭与配饰灵感
        </Text>
      </View>
      {loading ? (
        <View className={styles.skeleton}>
          <Text className={styles.skeletonText}>正在生成当季穿搭灵感…</Text>
        </View>
      ) : slides.length > 0 ? (
        /* 跑马灯：额度内自动轮播循环；额度用尽后保留已展示图片、停止自动轮播 */
        <Swiper
          className={styles.swiper}
          autoplay={slides.length > 1 && !exhausted}
          circular={slides.length > 1 && !exhausted}
          interval={3200}
          duration={450}
          indicatorDots={slides.length > 1}
          indicatorColor='rgba(255, 255, 255, 0.4)'
          indicatorActiveColor='#ffffff'
        >
          {slides.map((s, i) => (
            <SwiperItem key={`${s.label}-${i}`} className={styles.slide}>
              <Image className={styles.photo} src={s.src} mode='aspectFill' />
              {s.ai && (
                <View className={styles.aiTag}>
                  <Text className={styles.aiTagText}>AI 生成</Text>
                </View>
              )}
              <View className={styles.caption}>
                <Text className={styles.captionText}>{s.label}</Text>
              </View>
            </SwiperItem>
          ))}
        </Swiper>
      ) : null}
      {!loading && failed && (
        <View className={styles.noteRow}>
          <Text className={styles.noteText}>云端图组暂不可用，已展示本地示例搭配</Text>
          <Text className={styles.retry} onClick={load}>
            重试
          </Text>
        </View>
      )}
      {!loading && quota < 2 && (
        <View className={styles.quotaRow}>
          <Text className={styles.quotaText}>
            {quota <= 0
              ? '普通版展示本地示例搭配'
              : `今日已看 ${Math.min(viewed, shown)}/${shown} 张 · SVIP 可看 AI 高定搭配`}
          </Text>
          <Text className={styles.quotaLink} onClick={() => Taro.navigateTo({ url: '/pages/member/index' })}>
            {quota <= 0 ? '开通 VIP ›' : '去升级 ›'}
          </Text>
        </View>
      )}
    </View>
  );
};

export default SeasonalCard;
