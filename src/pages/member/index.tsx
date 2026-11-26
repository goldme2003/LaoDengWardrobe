import React, { useState } from 'react';
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
import { MEMBER_FN_NAME, CLOUD_READY, WX_PAY_ENABLED } from '@/config/cloud';
import styles from './index.module.scss';

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

/** 会员中心页（v1.9.0，F-19）：三档权益对比 + 一次性买断价格 + 开通入口。
 * v2.0.0：微信支付正式接入——「立即开通」走 member.createOrder 统一下单 → requestPayment 拉起支付
 * → 轮询 getMember 确认档位生效；档位以云端 members（支付回调 payCallback 写入）为唯一权威，
 * 本地仅作展示缓存；测试模式（本地切换档位 / 测试档位切换区块）已随发布版移除。 */
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

  // v2.0.0：支付进行中的档位（按钮 loading 态，防重复提交）
  const [payingTier, setPayingTier] = useState<MemberTier | ''>('');

  /** cloudPay.unifiedOrder 返回的拉起支付参数（透传 wx.requestPayment） */
  interface WxPayParams {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'MD5' | 'HMAC-SHA256' | 'RSA';
    paySign: string;
  }

  // 支付成功后轮询云端档位生效（支付回调写入 members 可能有秒级延迟，最多 5 次 × 1.5s）
  const pollMemberTier = async (): Promise<MemberTier | ''> => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const res = await Taro.cloud.callFunction({
          name: MEMBER_FN_NAME,
          data: { action: 'getMember' }
        });
        const result = (res.result || {}) as { code?: string; tier?: MemberTier };
        if (result.code === 'OK' && result.tier && result.tier !== 'free') {
          return result.tier;
        }
      } catch (e) {
        // 网络波动：继续重试
      }
    }
    return '';
  };

  // v2.0.0：微信支付开通——下单 → 拉起支付 → 云端确认档位（失败给出明确文案）
  const handlePay = async (tier: 'vip' | 'svip') => {
    if (payingTier) return;
    if (!CLOUD_READY) {
      Taro.showToast({ title: '请在微信端开通会员', icon: 'none' });
      return;
    }
    // v2.0.2：个人主体收款受限——开关关闭时不发起支付，说明原因
    if (!WX_PAY_ENABLED) {
      Taro.showModal({
        title: '会员开通暂未开放',
        content:
          '当前小程序为个人主体，微信平台限制其收款能力（会员属虚拟商品，需企业/个体工商户主体并开通微信支付与虚拟支付后才能收款）。支付链路已开发完成，主体升级后即开放，敬请期待。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    // v2.0.1：iOS 端微信限制小程序虚拟支付（requestPayment 报「小程序对应支付能力已被限制」），
    // 支付前置检测，直接给出指引而不是让用户走到支付失败一步
    try {
      const { platform } = Taro.getSystemInfoSync();
      if (platform === 'ios' || platform === 'mac') {
        Taro.showModal({
          title: 'iOS 端暂不支持小程序内开通',
          content:
            '微信平台限制 iOS 端小程序虚拟支付。请使用 Android 手机在本页开通，权益一次买断，开通后在 iOS 登录同一微信即可正常使用。',
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
    } catch (e) {
      // 系统信息获取失败不阻断支付流程
    }
    setPayingTier(tier);
    Taro.showLoading({ title: '正在发起支付…', mask: true });
    let payment: WxPayParams | null = null;
    let failMsg = '下单失败，请稍后重试';
    try {
      const res = await Taro.cloud.callFunction({
        name: MEMBER_FN_NAME,
        data: { action: 'createOrder', tier }
      });
      const result = (res.result || {}) as {
        code?: string;
        message?: string;
        payment?: WxPayParams;
      };
      if (result.code === 'OK' && result.payment) {
        payment = result.payment;
      } else if (result.code === 'ALREADY_MEMBER') {
        failMsg = result.message || '已开通该档位';
      } else {
        failMsg = result.message || '下单失败，请稍后重试';
      }
    } catch (e) {
      failMsg = '网络异常，请稍后重试';
    }
    Taro.hideLoading();
    if (!payment) {
      setPayingTier('');
      Taro.showToast({ title: failMsg, icon: 'none', duration: 2500 });
      return;
    }
    try {
      await Taro.requestPayment(payment);
    } catch (e) {
      // 用户取消或支付失败；v2.0.1：识别平台支付限制类错误并给出明确指引
      setPayingTier('');
      const raw = String((e as { errMsg?: string })?.errMsg || (e as Error)?.message || '');
      if (/限制|limit/i.test(raw)) {
        Taro.showModal({
          title: '支付能力受平台限制',
          content:
            '当前设备/环境的支付能力被微信平台限制（常见于 iOS 端小程序虚拟支付限制）。请使用 Android 手机完成开通；若 Android 同样受限，请确认小程序后台已开通微信支付且商户号绑定正常。',
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        Taro.showToast({ title: '支付未完成', icon: 'none' });
      }
      return;
    }
    // 支付成功：确认云端档位生效
    Taro.showLoading({ title: '开通确认中…', mask: true });
    const newTier = await pollMemberTier();
    Taro.hideLoading();
    setPayingTier('');
    if (newTier) {
      setMemberTier(newTier);
      Taro.showToast({ title: `${TIERS[newTier].label} 开通成功`, icon: 'success', duration: 2000 });
    } else {
      Taro.showToast({
        title: '支付完成，档位生效可能有延迟，请稍后重新进入查看',
        icon: 'none',
        duration: 3000
      });
    }
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
          SVIP 卡升级为黑金尊享外观 */}
      <View className={styles.priceRow}>
        {TIER_ORDER.filter((t) => t !== 'free').map((t) => {
          const cfg = TIERS[t];
          const active = memberTier === t;
          // v1.10.0：SVIP 为最高档——开通后所有付费档按钮均不可用（VIP 档显示「已含于 SVIP」）
          const locked = memberTier === 'svip';
          // v2.0.2：个人主体收款受限——支付未开放时按钮显示「暂未开放」（点击说明原因）
          const payClosed = !WX_PAY_ENABLED;
          const disabled = active || locked || payingTier !== '' || payClosed;
          const btnText =
            payClosed && !active
              ? '暂未开放'
              : payingTier === t
                ? '支付中…'
                : active
                  ? '当前等级'
                  : locked
                    ? '已含于 SVIP'
                    : '立即开通';
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
                <Text className={`${styles.priceNum} ${t === 'svip' ? styles.priceNumSvip : ''}`}>¥{cfg.price}</Text>
                <Text className={styles.priceUnit}>/ 永久有效</Text>
              </View>
              <View
                className={[
                  styles.buyBtn,
                  t === 'svip' ? styles.buyBtnSvip : '',
                  active ? (t === 'svip' ? styles.buyBtnSvipOwned : styles.buyBtnOwned) : '',
                  locked && !active ? styles.buyBtnDisabled : ''
                ].join(' ')}
                onClick={disabled ? undefined : () => handlePay(t)}
              >
                <Text className={styles.buyBtnText}>{btnText}</Text>
              </View>
              {active && <Text className={styles.mineTag}>当前等级</Text>}
            </View>
          );
        })}
      </View>
      <Text className={styles.payTip}>
        {WX_PAY_ENABLED
          ? '微信支付 · 一次开通、永久有效；支付完成后档位自动生效，更换设备登录同一微信即可恢复权益。'
          : '会员开通暂未开放（微信对个人主体小程序限制收款能力）；云同步等会员权益已上线，开通入口将在主体升级后开放。'}
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

      <Text className={styles.footTip}>
        会员权益说明：服装批量导入已上线（VIP 5 次/月、SVIP 无限次，按批量任务计次）；衣物属性自动识别为 VIP/SVIP 专属（普通版不自动识别）；出差推荐 VIP 2 次/月、SVIP 无限次；时尚穿搭推荐为待上线功能（VIP 2 次/月、SVIP 5 次/月，权益额度自功能上线后开始计数）；明日推荐套数每日生成后当天缓存、次日重新生成（普通版不含）；云同步已上线（登录后可在「我的 → 云同步」开启，VIP 可同步 3 个衣橱、SVIP 全部，冲突副本保留 30 天）；会员一次开通、永久有效。
      </Text>
    </View>
  );
};

export default MemberPage;
