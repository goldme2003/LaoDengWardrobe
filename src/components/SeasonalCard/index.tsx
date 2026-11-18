import React, { useMemo } from 'react';
import { View, Text, Image, Swiper, SwiperItem } from '@tarojs/components';
import type { Gender } from '@/types';
import styles from './index.module.scss';

interface Props {
  /** 衣橱主人性别（决定模特性别） */
  gender?: Gender;
  /** 衣橱主人年龄（决定年龄段；null 按青年处理） */
  age?: number | null;
}

/** 季节（按当前月份划分）：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬 */
const seasonOf = (month: number): { label: string; en: string } => {
  if (month >= 3 && month <= 5) return { label: '春季', en: 'spring' };
  if (month >= 6 && month <= 8) return { label: '夏季', en: 'summer' };
  if (month >= 9 && month <= 11) return { label: '秋季', en: 'autumn' };
  return { label: '冬季', en: 'winter' };
};

/** 年龄段（与空衣橱引导口径一致）：<18 青少年 / ≤30 青年 / ≤50 中年 / 其余熟龄 */
const ageGroupOf = (age?: number | null): { label: string; en: string } => {
  if (!age || age <= 0) return { label: '青年', en: 'young adult' };
  if (age < 18) return { label: '青少年', en: 'teenage' };
  if (age <= 30) return { label: '青年', en: 'young adult' };
  if (age <= 50) return { label: '中年', en: 'middle-aged' };
  return { label: '熟龄', en: 'senior' };
};

/** 5 种当季风格方向（v1.7.0 暂定 5 张，后续可按会员情况扩充） */
const STYLE_SLIDES = [
  { label: '通勤简约', en: 'minimal smart casual commute outfit with tailored coat' },
  { label: '街头休闲', en: 'relaxed street style outfit with layered pieces' },
  { label: '运动活力', en: 'athleisure sporty outfit with sneakers' },
  { label: '轻正式', en: 'semi-formal outfit with blazer and clean trousers' },
  { label: '周末出行', en: 'casual weekend outing outfit with denim and jacket' }
];

/** 文生图服务：按 SDXL 提示词生成竖版全身穿搭照 */
const imgSrc = (prompt: string) =>
  `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(
    prompt
  )}&image_size=portrait_4_3`;

/** 当季推荐卡（v1.7.0）：衣橱页跑马灯展示与当季、主人性别/年龄段相仿的时尚着装照片。
 * 纯展示组件，图片由文生图服务按提示词实时生成，不依赖衣物数据。 */
const SeasonalCard: React.FC<Props> = ({ gender, age }) => {
  const slides = useMemo(() => {
    const now = new Date();
    const season = seasonOf(now.getMonth() + 1);
    const ageGroup = ageGroupOf(age);
    const figure = gender === 'female' ? 'woman' : 'man';
    return STYLE_SLIDES.map((s) => ({
      label: s.label,
      src: imgSrc(
        `full body fashion editorial photo of a ${ageGroup.en} asian ${figure}, ` +
          `${season.en} ${s.en}, stylish well-fitted clothes, plain light background, ` +
          'soft natural daylight, high quality photography'
      )
    }));
  }, [gender, age]);

  const now = new Date();
  const season = seasonOf(now.getMonth() + 1);
  const ageGroup = ageGroupOf(age);
  const genderLabel = gender === 'female' ? '女士' : '男士';

  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <Text className={styles.title}>当季推荐 · {season.label}</Text>
        <Text className={styles.sub}>
          为{ageGroup.label}{genderLabel}挑选的当季穿搭灵感
        </Text>
      </View>
      {/* 跑马灯：自动轮播 + 循环 + 指示点 */}
      <Swiper
        className={styles.swiper}
        autoplay
        circular
        interval={3200}
        duration={450}
        indicatorDots
        indicatorColor='rgba(255, 255, 255, 0.4)'
        indicatorActiveColor='#ffffff'
      >
        {slides.map((s) => (
          <SwiperItem key={s.label} className={styles.slide}>
            <Image className={styles.photo} src={s.src} mode='aspectFill' lazyLoad />
            <View className={styles.caption}>
              <Text className={styles.captionText}>{s.label}</Text>
            </View>
          </SwiperItem>
        ))}
      </Swiper>
    </View>
  );
};

export default SeasonalCard;
