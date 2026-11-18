import React, { useMemo } from 'react';
import { View, Text, Image, Swiper, SwiperItem } from '@tarojs/components';
import type { Gender } from '@/types';
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
  /** 衣橱主人性别（决定使用男士/女士图片组） */
  gender?: Gender;
  /** 衣橱主人年龄（展示文案按年龄段描述；null 按青年处理） */
  age?: number | null;
}

/** 季节（按当前月份划分）：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬。
 * v1.7.1：仅秋季图片已入库；其余季节上线前需按同一提示词规范补齐图组 */
const seasonOf = (month: number): { label: string; ready: boolean } => {
  if (month >= 3 && month <= 5) return { label: '春季', ready: false };
  if (month >= 6 && month <= 8) return { label: '夏季', ready: false };
  if (month >= 9 && month <= 11) return { label: '秋季', ready: true };
  return { label: '冬季', ready: false };
};

/** 年龄段（与空衣橱引导口径一致）：<18 青少年 / ≤30 青年 / ≤50 中年 / 其余熟龄 */
const ageGroupOf = (age?: number | null): string => {
  if (!age || age <= 0) return '青年';
  if (age < 18) return '青少年';
  if (age <= 30) return '青年';
  if (age <= 50) return '中年';
  return '熟龄';
};

/** 5 种当季风格（与图组顺序一一对应；暂定 5 张，后续可按会员情况扩充） */
const STYLE_LABELS = ['通勤简约', '街头休闲', '运动活力', '轻正式', '周末出行'];

/** 本地图组（v1.7.1 改为打包资源）：原远程文生图接口为异步占位返回
 * （首次请求仅返回 "generating" 占位图，小程序 <image> 不二次刷新导致一直无法显示），
 * 且域名不在小程序合法域名白名单内，故改为开发期预生成、按性别分组的本地图片 */
const AUTUMN_IMAGES: Record<'male' | 'female', string[]> = {
  male: [autumnM1, autumnM2, autumnM3, autumnM4, autumnM5],
  female: [autumnF1, autumnF2, autumnF3, autumnF4, autumnF5]
};

/** 当季推荐卡（v1.7.0）：衣橱页跑马灯展示与当季、主人性别/年龄段相仿的时尚着装照片。
 * 纯展示组件，图片为打包的本地资源，不依赖衣物数据与网络。 */
const SeasonalCard: React.FC<Props> = ({ gender, age }) => {
  const slides = useMemo(() => {
    const imgs = AUTUMN_IMAGES[gender === 'female' ? 'female' : 'male'];
    return STYLE_LABELS.map((label, i) => ({ label, src: imgs[i] }));
  }, [gender]);

  const now = new Date();
  const season = seasonOf(now.getMonth() + 1);
  const ageGroup = ageGroupOf(age);
  const genderLabel = gender === 'female' ? '女士' : '男士';

  return (
    <View className={styles.card}>
      <View className={styles.head}>
        <Text className={styles.title}>当季推荐 · {season.label}</Text>
        <Text className={styles.sub}>
          为{ageGroup}{genderLabel}挑选的当季穿搭灵感
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
            <Image className={styles.photo} src={s.src} mode='aspectFill' />
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
