import React, { useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { callMember } from '@/services/member';
import {
  TIERS,
  TIER_ORDER,
  tierOf,
  weatherLevelLabel,
  MemberTier
} from '@/services/entitlement';
import styles from './index.module.scss';

/** 权益矩阵行（与 PRD 10.6 三档矩阵一致） */
const BENEFIT_ROWS: { label: string; values: Record<MemberTier, string> }[] = [
  { label: '衣橱数量', values: { free: '1 个', vip: '2 个', svip: '5 个' } },
  {
    label: '服装批量导入 / 分类',
    values: { free: '即将上线', vip: '5 次/月', svip: '15 次/月' }
  },
  { label: '当季推荐图组', values: { free: '2 张/天', vip: '5 张/天', svip: '10 张/天' } },
  {
    label: '天气穿搭推荐',
    values: {
      free: weatherLevelLabel.basic,
      vip: weatherLevelLabel.plus,
      svip: weatherLevelLabel.full
    }
  },
  { label: '出差推荐', values: { free: '无', vip: '5 次/月', svip: '无限次' } },
  {
    label: '时尚穿搭推荐',
    values: { free: '即将上线', vip: '5 次/月', svip: '无限次' }
  },
  { label: '云同步', values: { free: '本地存储', vip: '云端', svip: '云端' } }
];

/** 会员中心页（v1.9.0，F-19）：三档权益对比 + 一次性买断价格 + 开通入口。
 * 支付未开通：开通按钮走云函数 member.createOrder 登记订单，云端返回
 * PAY_UNAVAILABLE 后提示「支付暂未开通」。
 * 开发环境（NODE_ENV=development）提供档位切换，便于验证各档位权益与门控。 */
const MemberPage: React.FC = () => {
  const memberTier = useWardrobeStore((s) => s.memberTier);
  const setMemberTier = useWardrobeStore((s) => s.setMemberTier);
  const currentWardrobe = useWardrobeStore((s) => s.wardrobes).find(
    (w) => w.id === useWardrobeStore((s) => s.currentWardrobeId)
  );
  const [buying, setBuying] = useState<MemberTier | null>(null);

  const current = tierOf(memberTier);
  const themeStyle = {
    background: 'var(--bg-page, #f7f4ef)'
  } as React.CSSProperties;

  const handleBuy = async (tier: MemberTier) => {
    if (buying) return;
    setBuying(tier);
    try {
      const res = await callMember('createOrder', tier);
      if (res && res.code === 'OK') {
        setMemberTier(tier);
        Taro.showToast({ title: '开通成功', icon: 'success' });
        return;
      }
      Taro.showToast({
        title: (res && res.message) || '支付暂未开通，敬请期待',
        icon: 'none',
        duration: 2200
      });
    } finally {
      setBuying(null);
    }
  };

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <View className={styles.page} style={themeStyle}>
      {/* 当前身份卡 */}
      <View className={styles.hero}>
        <Text className={styles.heroBadge}>{current.label}</Text>
        <Text className={styles.heroTitle}>
          {memberTier === 'free' ? '升级会员，解锁更多衣橱与推荐' : '感谢支持，权益已生效'}
        </Text>
        <Text className={styles.heroSub}>
          {memberTier === 'free'
            ? 'VIP / SVIP 均为一次性买断，无月费年费'
            : `当前衣橱：${currentWardrobe?.name || '-'} · 已享 ${current.label} 全部权益`}
        </Text>
      </View>

      {/* 价格卡（免费档不展示购买按钮） */}
      <View className={styles.priceRow}>
        {TIER_ORDER.filter((t) => t !== 'free').map((t) => {
          const cfg = TIERS[t];
          const active = memberTier === t;
          return (
            <View key={t} className={`${styles.priceCard} ${active ? styles.priceCardActive : ''}`}>
              <View className={styles.priceHead}>
                <Text className={styles.priceName}>{cfg.label}</Text>
                {t === 'svip' && <Text className={styles.priceTag}>全权益</Text>}
              </View>
              <View className={styles.priceLine}>
                <Text className={styles.priceNum}>¥{cfg.price}</Text>
                <Text className={styles.priceUnit}>/ 一次性买断</Text>
              </View>
              <View
                className={`${styles.buyBtn} ${active ? styles.buyBtnOwned : ''}`}
                onClick={active ? undefined : () => handleBuy(t)}
              >
                <Text className={styles.buyBtnText}>
                  {active ? '当前档位' : buying === t ? '处理中…' : '立即开通'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text className={styles.payTip}>
        微信支付暂未开通：点击开通将登记开通意向，支付能力上线后按订单引导完成付款。
      </Text>

      {/* 三档权益矩阵 */}
      <View className={styles.table}>
        <View className={styles.tr}>
          <Text className={styles.tdLabel}>权益</Text>
          <Text className={styles.td}>普通版</Text>
          <Text className={styles.td}>VIP</Text>
          <Text className={styles.td}>SVIP</Text>
        </View>
        {BENEFIT_ROWS.map((row) => (
          <View key={row.label} className={styles.tr}>
            <Text className={styles.tdLabel}>{row.label}</Text>
            <Text className={styles.td}>{row.values.free}</Text>
            <Text className={`${styles.td} ${memberTier === 'vip' ? styles.tdMine : ''}`}>
              {row.values.vip}
            </Text>
            <Text className={`${styles.td} ${memberTier === 'svip' ? styles.tdMine : ''}`}>
              {row.values.svip}
            </Text>
          </View>
        ))}
      </View>

      {/* 开发环境档位切换（便于验证各档位门控，正式构建不出现） */}
      {isDev && (
        <View className={styles.devBox}>
          <Text className={styles.devTitle}>开发工具：切换档位（仅开发环境）</Text>
          <View className={styles.devRow}>
            {TIER_ORDER.map((t) => (
              <View
                key={t}
                className={`${styles.devBtn} ${memberTier === t ? styles.devBtnActive : ''}`}
                onClick={() => setMemberTier(t)}
              >
                <Text className={styles.devBtnText}>{TIERS[t].label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Text className={styles.footTip}>
        会员权益说明：批量导入 / 分类与时尚穿搭推荐为即将上线的功能，权益额度自功能上线后开始计数；会员有效期一次性买断、长期有效。
      </Text>
    </View>
  );
};

export default MemberPage;
