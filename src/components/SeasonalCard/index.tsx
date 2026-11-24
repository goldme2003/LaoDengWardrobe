import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, Image, Swiper, SwiperItem, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { Gender } from '@/types';
import type { MemberTier } from '@/services/entitlement';
import { loadCachedSeasonalImages, generateSeasonalImage, SeasonalImage } from '@/services/seasonalImages';
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
  /** 衣橱主人性别（决定云端生成图组的性别） */
  gender?: Gender;
  /** 衣橱主人年龄（决定云端生成图组的年龄段） */
  age?: number | null;
  /** v1.13.0：会员档位（决定可选风格范围与每日可生成张数） */
  tier: MemberTier;
  /** v1.9.0（F-19）：今日可生成张数（会员权益，0 = 普通版不生图） */
  quota: number;
  /** v1.14.0：今日已生成张数（点击生成 1 张记 1 次） */
  viewed: number;
  /** 登记今日已生成张数（store 取 max，额度随天滚动重置） */
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

/** v1.14.0 默认风格池（与云函数 STYLE_LIB 对齐）：点击后按需生成对应风格单张；
 * premium 高级风格（高定质感 / 配饰细节）为 SVIP 专属，VIP 不展示 */
interface StyleOption {
  key: string;
  label: string;
  premium?: boolean;
}
const STYLE_OPTIONS: StyleOption[] = [
  { key: 'daily', label: '日常百搭' },
  { key: 'commute', label: '通勤简约' },
  { key: 'street', label: '街头休闲' },
  { key: 'sport', label: '运动活力' },
  { key: 'smart', label: '轻正式' },
  { key: 'weekend', label: '周末出行' },
  { key: 'couture', label: '高定质感', premium: true },
  { key: 'detail', label: '配饰细节', premium: true }
];

/** 本地示例图组（v1.7.1 打包资源，仅秋季）：普通版（不生图）展示 */
const LOCAL_IMAGES: Record<'male' | 'female', string[]> = {
  male: [autumnM1, autumnM2, autumnM3, autumnM4, autumnM5],
  female: [autumnF1, autumnF2, autumnF3, autumnF4, autumnF5]
};
const LOCAL_LABELS = ['通勤简约', '街头休闲', '运动活力', '轻正式', '周末出行'];

/** 云函数业务错误码 → 用户文案 */
const GEN_ERROR_TEXT: Record<string, string> = {
  TIER_NOT_ALLOWED: '该风格需要更高会员档位',
  BUDGET_EXCEEDED: '本月生成额度已用尽，敬请期待下月',
  BAD_PARAM: '生成请求异常，请重试',
  GENERATE_FAILED: '生成失败，请稍后重试'
};

interface Slide {
  label: string;
  src: string;
  /** 是否云端 AI 生成（用于「AI 生成」标识） */
  ai: boolean;
}

/** 当季推荐卡（v1.7.0，v1.14.0 改为点击风格后按需生成）
 * v1.14.0 成本控制：进入页面只读取本地当日缓存、不自动发起云端生图；用户点击风格 chip 或
 * 「＋ 自定义」填写风格后生成 1 张（消耗当日额度，上限不变：普通 0 / VIP 1 / SVIP 2），
 * 交互对齐明日穿搭推荐（默认风格 + 自定义输入，已生成风格右上角绿点标识）。
 * 每日同组合云端缓存全用户共享（不重复计费）；本地按天缓存已生成图组；
 * 普通版不生图（展示 1 张本地示例并引导开通 VIP）；当日额度用尽后保留已生成图组、点击风格提示明天再来。 */
const SeasonalCard: React.FC<Props> = ({ gender, age, tier, quota, viewed, onShow }) => {
  const now = new Date();
  const season = seasonOf(now.getMonth() + 1);
  const ageGroup = ageGroupOf(age);
  const isFree = quota <= 0;
  const shown = Math.max(0, quota); // 每日可生成张数（0/1/2）
  const exhausted = viewed >= shown;
  const genderLabel = gender === 'female' ? '女士' : '男士';

  const [slides, setSlides] = useState<SeasonalImage[]>([]);
  const [genLoading, setGenLoading] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [addErr, setAddErr] = useState('');
  const genLabelRef = useRef('');
  const registeredRef = useRef('');

  // 初始读取今日已生成图组（本地缓存命中直接展示并登记张数，不发起云端请求——成本受控）
  useEffect(() => {
    const cached = loadCachedSeasonalImages({ gender, age });
    setSlides(cached);
    const regKey = `${gender || 'other'}_${ageGroup}`;
    if (cached.length > 0 && registeredRef.current !== regKey) {
      registeredRef.current = regKey;
      onShow(cached.length);
    }
  }, [gender, age, ageGroup, onShow]);

  // 本地示例图组：按日期轮换起始位，保证每天看到的示例不同
  const localSlides = useMemo<Slide[]>(() => {
    const imgs = LOCAL_IMAGES[gender === 'female' ? 'female' : 'male'];
    const d = new Date();
    const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
    const start = dayOfYear % imgs.length;
    return LOCAL_LABELS.map((_, i) => {
      const idx = (start + i) % imgs.length;
      return { label: LOCAL_LABELS[idx], src: imgs[idx], ai: false };
    });
  }, [gender]);

  /** 点击风格 / 提交自定义风格后生成 1 张（消耗当日额度） */
  const handleGenerate = useCallback(
    async (opt: { style?: string; custom?: string }) => {
      if (genLoading) return;
      if (exhausted) {
        Taro.showToast({ title: '今日生成额度已用尽，明天再来', icon: 'none' });
        return;
      }
      const label = opt.custom ? opt.custom.trim() : STYLE_OPTIONS.find((s) => s.key === opt.style)?.label || '';
      if (!label) return;
      // 同风格当日已生成过：云端缓存共享，不重复计费，直接引导查看
      if (slides.some((s) => s.label === label)) {
        Taro.showToast({ title: `「${label}」已生成，滑动即可查看`, icon: 'none' });
        return;
      }
      genLabelRef.current = label;
      setGenLoading(true);
      setGenErr('');
      try {
        const image = await generateSeasonalImage({ gender, age, tier, style: opt.style, custom: opt.custom });
        setSlides((prev) => {
          onShow(prev.length + 1);
          return [...prev, image];
        });
        Taro.showToast({ title: '已生成', icon: 'success' });
      } catch (e) {
        const code = (e as Error).message || 'GENERATE_FAILED';
        setGenErr(GEN_ERROR_TEXT[code] || GEN_ERROR_TEXT.GENERATE_FAILED);
      } finally {
        setGenLoading(false);
        genLabelRef.current = '';
      }
    },
    [genLoading, exhausted, slides, gender, age, tier, onShow]
  );

  const confirmAdd = () => {
    const text = draft.trim();
    if (!text) {
      setAddErr('请输入风格名称');
      return;
    }
    setAdding(false);
    setDraft('');
    setAddErr('');
    handleGenerate({ custom: text });
  };

  // 可选风格：SVIP 全部（含高级风格）；VIP 仅默认风格；普通版不展示风格条
  const visibleStyles = useMemo(
    () => (tier === 'svip' ? STYLE_OPTIONS : STYLE_OPTIONS.filter((s) => !s.premium)),
    [tier]
  );

  // 普通版展示本地示例（1 张）；VIP/SVIP 展示今日已生成图组（AI 生成标识）
  const displaySlides: Slide[] = isFree
    ? localSlides.slice(0, 1)
    : slides.map((s) => ({ label: s.label, src: s.fileID, ai: true }));

  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <View className={styles.titleRow}>
          <Text className={styles.title}>当季推荐 · {season.label}</Text>
          {!isFree && slides.length > 0 && <Text className={styles.aiBadge}>AI 生成</Text>}
        </View>
        <Text className={styles.sub}>
          {isFree
            ? `为${ageGroup}${genderLabel}准备的本地示例搭配`
            : `点击风格为${ageGroup}${genderLabel}生成当季流行穿搭与配饰灵感`}
        </Text>
      </View>
      {isFree ? (
        <Swiper className={styles.swiper} indicatorDots={false}>
          {displaySlides.map((s, i) => (
            <SwiperItem key={`${s.label}-${i}`} className={styles.slide}>
              <Image className={styles.photo} src={s.src} mode='aspectFill' />
              <View className={styles.caption}>
                <Text className={styles.captionText}>{s.label}</Text>
              </View>
            </SwiperItem>
          ))}
        </Swiper>
      ) : displaySlides.length > 0 ? (
        /* 跑马灯：展示今日已生成图组；额度用尽或生成中停止自动轮播 */
        <>
          <Swiper
            className={styles.swiper}
            autoplay={displaySlides.length > 1 && !exhausted && !genLoading}
            circular={displaySlides.length > 1 && !exhausted && !genLoading}
            interval={3200}
            duration={450}
            indicatorDots={displaySlides.length > 1}
            indicatorColor='rgba(255, 255, 255, 0.4)'
            indicatorActiveColor='#ffffff'
          >
            {displaySlides.map((s, i) => (
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
          {genLoading && (
            <Text className={styles.genHint}>正在生成「{genLabelRef.current}」当季穿搭，约需 10–30 秒…</Text>
          )}
        </>
      ) : genLoading ? (
        <View className={styles.skeleton}>
          <Text className={styles.skeletonText}>正在生成「{genLabelRef.current}」当季穿搭，约需 10–30 秒…</Text>
        </View>
      ) : (
        <View className={styles.placeholder}>
          <Text className={styles.placeholderText}>
            {exhausted ? '今日生成额度已用尽，明天再来' : '选择下方风格，生成今日 AI 当季搭配'}
          </Text>
        </View>
      )}
      {/* v1.14.0：风格选择条（点击后按需生成，交互对齐明日推荐场景条） */}
      {!isFree && (
        <View className={styles.styleBar}>
          {visibleStyles.map((s) => {
            const done = slides.some((it) => it.label === s.label);
            return (
              <View key={s.key} className={styles.styleChip} onClick={() => handleGenerate({ style: s.key })}>
                {done && <View className={styles.styleChipDot} />}
                <Text className={styles.styleChipText}>{s.label}</Text>
              </View>
            );
          })}
          {!adding && (
            <View className={styles.styleChipAdd} onClick={() => setAdding(true)}>
              <Text className={styles.styleChipAddText}>＋ 自定义</Text>
            </View>
          )}
        </View>
      )}
      {/* v1.14.0：自定义风格内联输入行（生成消耗当日额度） */}
      {!isFree && adding && (
        <View className={styles.styleAddForm}>
          <Input
            className={styles.styleAddInput}
            value={draft}
            maxlength={6}
            focus
            placeholder='输入风格，如：国风 / 山系 / 极简黑白'
            onInput={(e) => {
              setDraft(e.detail.value);
              setAddErr('');
            }}
            onConfirm={confirmAdd}
          />
          <View className={styles.styleAddBtn} onClick={confirmAdd}>
            <Text className={styles.styleAddBtnText}>生成</Text>
          </View>
          <View
            className={styles.styleAddCancel}
            onClick={() => {
              setAdding(false);
              setDraft('');
              setAddErr('');
            }}
          >
            <Text className={styles.styleAddCancelText}>取消</Text>
          </View>
        </View>
      )}
      {!isFree && !!addErr && <Text className={styles.styleAddErr}>{addErr}</Text>}
      {!isFree && !!genErr && (
        <View className={styles.noteRow}>
          <Text className={styles.noteText}>{genErr}</Text>
        </View>
      )}
      <View className={styles.quotaRow}>
        <Text className={styles.quotaText}>
          {isFree
            ? '普通版展示本地示例搭配'
            : `今日已生成 ${Math.min(viewed, shown)}/${shown} 张${exhausted ? ' · 明天再来' : ' · 点击风格立即生成'}`}
        </Text>
        {isFree ? (
          <Text className={styles.quotaLink} onClick={() => Taro.navigateTo({ url: '/pages/member/index' })}>
            开通 VIP ›
          </Text>
        ) : quota < 2 && viewed < shown ? (
          <Text className={styles.quotaLink} onClick={() => Taro.navigateTo({ url: '/pages/member/index' })}>
            SVIP 每日 2 张 ›
          </Text>
        ) : null}
      </View>
    </View>
  );
};

export default SeasonalCard;
