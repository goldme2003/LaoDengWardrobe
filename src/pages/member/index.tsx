import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  TIERS,
  TIER_ORDER,
  tierOf,
  weatherLevelLabel,
  MemberTier
} from '@/services/entitlement';
import { FEATURES } from '@/config/features';
import styles from './index.module.scss';

/** 开发者联系电话（售后与联系卡展示，点击复制） */
const DEV_CONTACT_PHONE = '17612733117';

/** 权益矩阵行（与 PRD 10.6 三档矩阵一致；v1.10.0 文案修正 + 新增明日推荐次数；v1.19.1 权益数值调整 + 出差推荐前置） */
const BENEFIT_ROWS: { label: string; values: Record<MemberTier, string> }[] = [
  { label: '衣橱数量', values: { free: '1 个', vip: '3 个', svip: '8 个' } },
  {
    // v1.19.1：出差推荐前置到第二行；VIP 调整为 2 次/月
    label: '出差推荐',
    values: { free: '无', vip: '2 次/月', svip: '无限次' }
  },
  {
    label: '服装批量导入 / 分类',
    // v1.10.0：普通版为「无」（该功能为会员权益，非「即将上线」）；v1.11.0：功能已上线、额度开始计数；v1.19.1：SVIP 无限次
    values: { free: '无', vip: '5 次/月', svip: '无限次' }
  },
  {
    // v1.11.0（重点变更）：衣物属性自动识别为 VIP 及以上专属，普通版不自动识别
    label: '衣物属性自动识别',
    values: { free: '无', vip: '✓', svip: '✓' }
  },
  { label: '当季推荐图组', values: { free: '无（本地示例）', vip: '1 张/天', svip: '2 张/天' } },
  {
    label: '天气穿搭推荐',
    values: {
      free: weatherLevelLabel.basic,
      vip: weatherLevelLabel.plus,
      svip: weatherLevelLabel.full
    }
  },
  {
    // v1.10.0：明日推荐次数——生成后当天缓存，套数用尽不再生成（左右滑动查看）；v1.19.1：普通版 0 套
    label: '明日推荐次数',
    values: { free: '0 套/天', vip: '2 套/天', svip: '5 套/天' }
  },
  {
    // v1.19.1：时尚穿搭推荐 VIP 2 次/月、SVIP 5 次/月（功能待上线，权益额度自上线后开始计数）
    label: '时尚穿搭推荐',
    values: { free: '无', vip: '2 次/月', svip: '5 次/月' }
  },
  {
    // v1.15.0（R-5）：云同步 M1 已落地；v1.19.1：VIP 可同步 3 个衣橱，SVIP 全部
    label: '云同步',
    values: { free: '本地存储', vip: '云端 · 3 个衣橱', svip: '云端 · 全部衣橱' }
  },
  {
    // v1.15.0（R-5）：照片云容量（仅衣物/日记照片；推荐产物不上云）
    label: '照片云容量',
    values: { free: '—', vip: '500MB', svip: '2GB' }
  }
];

/** 会员中心页（v1.9.0，F-19）：三档权益对比 + 价格 + 档位切换入口。
 * v2.2.1（GLM模型版）：支付功能已关闭（FEATURES.paymentEnabled = false）——支付/退款的调用入口
 * （下单、拉起支付、档位轮询、查单自愈、售后退款）与相关校验已全部移除；恢复 v1.9.1 测试模式：
 * 「立即开通」与测试档位切换区直接本地切换档位，三档可自由选择，便于多场景验证。 */
const MemberPage: React.FC = () => {
  const memberTier = useWardrobeStore((s) => s.memberTier);
  const setMemberTier = useWardrobeStore((s) => s.setMemberTier);
  const currentWardrobe = useWardrobeStore((s) => s.wardrobes).find(
    (w) => w.id === useWardrobeStore((s) => s.currentWardrobeId)
  );

  const current = tierOf(memberTier);
  const themeStyle = {
    background: 'var(--bg-page, #f7f4ef)'
  } as React.CSSProperties;

  /** 测试模式：直接本地切换档位（即时生效，用于验证各档位权益与门控；不发起任何支付） */
  const handleBuy = (tier: MemberTier) => {
    setMemberTier(tier);
    Taro.showToast({ title: `已切换为 ${TIERS[tier].label}（测试）`, icon: 'none' });
  };

  const copyPhone = () => {
    Taro.setClipboardData({ data: DEV_CONTACT_PHONE }).catch(() => undefined);
  };

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
            ? 'VIP / SVIP 一次开通，永久有效'
            : `当前衣橱：${currentWardrobe?.name || '-'} · 已享 ${current.label} 全部权益`}
        </Text>
      </View>

      {/* 价格卡（免费档不展示购买按钮）
          v1.10.0：已开通 SVIP 后 VIP / SVIP 开通按钮均不可用；当前档位卡片高亮标记「当前等级」；
          SVIP 卡升级为黑金尊享外观；v2.2.1：测试模式——按钮直接本地切换档位，不发起支付 */}
      <View className={styles.priceRow}>
        {TIER_ORDER.filter((t) => t !== 'free').map((t) => {
          const cfg = TIERS[t];
          const active = memberTier === t;
          // v1.10.0：SVIP 为最高档——开通后所有付费档按钮均不可用（VIP 档显示「已含于 SVIP」）
          const locked = memberTier === 'svip';
          const disabled = active || locked;
          const btnText = active ? '当前等级' : locked ? '已含于 SVIP' : '立即开通';
          return (
            <View
              key={t}
              className={[
                styles.priceCard,
                t === 'svip' ? styles.priceCardSvip : '',
                active ? (t === 'svip' ? styles.priceCardSvipActive : styles.priceCardActive) : ''
              ].join(' ')}
            >
              <View className={styles.priceHead}>
                <Text className={`${styles.priceName} ${t === 'svip' ? styles.priceNameSvip : ''}`}>
                  {t === 'svip' ? '👑 ' : ''}
                  {cfg.label}
                </Text>
                {t === 'svip' && <Text className={`${styles.priceTag} ${styles.priceTagSvip}`}>全权益</Text>}
              </View>
              <View className={styles.priceLine}>
                <Text className={`${styles.priceNum} ${t === 'svip' ? styles.priceNumSvip : ''}`}>
                  ¥{cfg.price}
                </Text>
                <Text className={styles.priceUnit}>/ 永久有效</Text>
              </View>
              <View
                className={[
                  styles.buyBtn,
                  t === 'svip' ? styles.buyBtnSvip : '',
                  active ? (t === 'svip' ? styles.buyBtnSvipOwned : styles.buyBtnOwned) : '',
                  locked && !active ? styles.buyBtnDisabled : ''
                ].join(' ')}
                onClick={disabled ? undefined : () => handleBuy(t)}
              >
                <Text className={styles.buyBtnText}>{btnText}</Text>
              </View>
              {active && <Text className={styles.mineTag}>当前等级</Text>}
            </View>
          );
        })}
      </View>
      <Text className={styles.payTip}>
        测试模式：点击「立即开通」或下方档位按钮直接切换会员档位，体验对应权益。
        {!FEATURES.paymentEnabled && '当前版本支付功能已关闭，切换档位不会产生任何扣费。'}
      </Text>

      {/* 三档权益矩阵 */}
      <View className={styles.table}>
        <View className={styles.tr}>
          <Text className={styles.tdLabel}>权益</Text>
          <Text className={styles.td}>普通版</Text>
          <Text className={styles.td}>VIP</Text>
          {/* v1.16.0：SVIP 列固定金色、VIP 列固定黑色（不再随当前档位高亮） */}
          <Text className={`${styles.td} ${styles.tdSvip}`}>SVIP</Text>
        </View>
        {BENEFIT_ROWS.map((row) => (
          <View key={row.label} className={styles.tr}>
            <Text className={styles.tdLabel}>{row.label}</Text>
            <Text className={styles.td}>{row.values.free}</Text>
            <Text className={styles.td}>{row.values.vip}</Text>
            <Text className={`${styles.td} ${styles.tdSvip}`}>{row.values.svip}</Text>
          </View>
        ))}
      </View>

      {/* 测试档位切换（v1.9.1；v2.2.1 GLM模型版恢复）：三档可自由切换，便于验证各档位权益与门控 */}
      <View className={styles.devBox}>
        <Text className={styles.devTitle}>测试：切换会员档位（普通版 / VIP / SVIP 可自由选择）</Text>
        <View className={styles.devRow}>
          {TIER_ORDER.map((t) => (
            <View
              key={t}
              className={`${styles.devBtn} ${memberTier === t ? styles.devBtnActive : ''}`}
              onClick={() => handleBuy(t)}
            >
              <Text className={styles.devBtnText}>{TIERS[t].label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 售后与联系：支付/退款入口已随支付功能关闭移除，仅保留开发者联系电话（点击复制） */}
      <View className={styles.contactCard}>
        <View className={styles.contactHead}>
          <Text className={styles.contactTitle}>售后与联系</Text>
          <Text className={styles.contactPhone} onClick={copyPhone}>
            开发者电话 {DEV_CONTACT_PHONE}（点击复制）
          </Text>
        </View>
        <Text className={styles.contactTip}>
          {!FEATURES.paymentEnabled
            ? '当前版本支付功能已关闭，会员档位仅用于测试体验；如遇问题或有会员、订单相关疑问，请电话联系开发者。'
            : '支付问题或退款请先电话联系开发者确认。'}
        </Text>
      </View>

      <Text className={styles.footTip}>
        会员权益说明：服装批量导入已上线（VIP 5 次/月、SVIP 无限次，按批量任务计次）；衣物属性自动识别为 VIP/SVIP 专属（普通版不自动识别）；出差推荐 VIP 2 次/月、SVIP 无限次；时尚穿搭推荐为待上线功能（VIP 2 次/月、SVIP 5 次/月，权益额度自功能上线后开始计数）；明日推荐套数每日生成后当天缓存、次日重新生成（普通版不含）；云同步已上线（登录后可在「我的 → 云同步」开启，VIP 可同步 3 个衣橱、SVIP 全部，冲突副本保留 30 天）；会员一次开通、永久有效。
      </Text>
    </View>
  );
};

export default MemberPage;
