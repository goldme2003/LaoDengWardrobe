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

  /** 虚拟支付下单返回的拉起支付参数（透传 wx.requestVirtualPayment，官方 5.3） */
  interface VirtualPayData {
    signData: string;
    mode: string;
    paySig: string;
    signature: string;
  }

  /** 调起虚拟支付（Taro 未内置类型，运行时取 wx.requestVirtualPayment） */
  const requestVirtualPayment = (payData: VirtualPayData): Promise<void> =>
    new Promise((resolve, reject) => {
      const g = globalThis as { wx?: { requestVirtualPayment?: (o: unknown) => void } };
      const fn = g.wx?.requestVirtualPayment;
      if (!fn) {
        reject(new Error('当前微信版本过低，请更新微信后重试'));
        return;
      }
      fn({
        ...payData,
        success: () => resolve(),
        fail: (err: { errMsg?: string }) => reject(new Error(err?.errMsg || 'requestVirtualPayment:fail'))
      });
    });

  /** iOS 端虚拟支付要求微信 ≥ 8.0.68（官方要求），不满足时提示更新（其他平台直接放行） */
  const checkIosWechatVersion = (): boolean => {
    try {
      const sys = Taro.getSystemInfoSync();
      if (sys.platform !== 'ios') return true;
      const cur = String(sys.version || '')
        .split('.')
        .map((n) => Number(n));
      const base = [8, 0, 68];
      for (let i = 0; i < 3; i++) {
        if ((cur[i] || 0) > base[i]) return true;
        if ((cur[i] || 0) < base[i]) break;
      }
      Taro.showModal({
        title: '提示',
        content: 'iOS 端支付需将微信更新至 8.0.68 及以上版本',
        showCancel: false
      });
      return false;
    } catch (e) {
      return true;
    }
  };

  // 支付成功后轮询云端档位生效（发货推送写入 members 可能有秒级延迟，最多 5 次 × 1.5s）
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

  // 兜底查单：发货推送丢失时主动触发服务端 query_order 补发货（官方 5.4.2），随后再轮询一次
  const reconcileOrder = async (orderId: string): Promise<void> => {
    try {
      await Taro.cloud.callFunction({
        name: MEMBER_FN_NAME,
        data: { action: 'queryOrder', orderId }
      });
    } catch (e) {
      // 查单失败不阻塞，用户可稍后重进
    }
  };

  // v2.1.0：虚拟支付开通——wx.login 换 code → 服务端签名下单 → requestVirtualPayment 拉起
  // → 轮询档位生效（发货推送为主）→ 未生效时查单补发（兜底）→ 再轮询
  const handlePay = async (tier: 'vip' | 'svip') => {
    if (payingTier) return;
    if (!CLOUD_READY) {
      Taro.showToast({ title: '请在微信端开通会员', icon: 'none' });
      return;
    }
    // v2.1.0：开关关闭 = MP 后台虚拟支付尚未配置完成（OfferID/AppKey/道具），不发起支付
    if (!WX_PAY_ENABLED) {
      Taro.showModal({
        title: '会员开通暂未开放',
        content:
          '虚拟支付开通配置中（小程序后台「虚拟支付」开通、道具上架与凭据配置完成后即开放），敬请期待。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    if (!checkIosWechatVersion()) return;
    setPayingTier(tier);
    Taro.showLoading({ title: '正在发起支付…', mask: true });
    let payData: VirtualPayData | null = null;
    let orderId = '';
    let failMsg = '下单失败，请稍后重试';
    try {
      const { code } = await Taro.login();
      const res = await Taro.cloud.callFunction({
        name: MEMBER_FN_NAME,
        data: { action: 'createOrder', tier, jsCode: code }
      });
      const result = (res.result || {}) as {
        code?: string;
        message?: string;
        orderId?: string;
        payData?: VirtualPayData;
      };
      if (result.code === 'OK' && result.payData) {
        payData = result.payData;
        orderId = result.orderId || '';
      } else if (result.code === 'ALREADY_MEMBER') {
        failMsg = result.message || '已开通该档位';
      } else {
        failMsg = result.message || '下单失败，请稍后重试';
      }
    } catch (e) {
      failMsg = '网络异常，请稍后重试';
    }
    Taro.hideLoading();
    if (!payData) {
      setPayingTier('');
      Taro.showToast({ title: failMsg, icon: 'none', duration: 2500 });
      return;
    }
    try {
      await requestVirtualPayment(payData);
    } catch (e) {
      // 用户取消或支付失败；平台限制类错误说明 MP 后台虚拟支付配置未完成
      setPayingTier('');
      const raw = String((e as { errMsg?: string })?.errMsg || (e as Error)?.message || '');
      if (/限制|limit/i.test(raw)) {
        Taro.showModal({
          title: '支付能力受平台限制',
          content:
            '微信平台未放行本小程序的虚拟支付：请确认小程序后台已开通「虚拟支付」、道具已创建并发布，且云函数凭据（OfferID/AppKey）配置正确。',
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        Taro.showToast({ title: '支付未完成', icon: 'none' });
      }
      return;
    }
    // 支付成功：确认云端档位生效（发货推送为主）；未生效则查单补发后再轮询一次
    Taro.showLoading({ title: '开通确认中…', mask: true });
    let newTier = await pollMemberTier();
    if (!newTier && orderId) {
      await reconcileOrder(orderId);
      newTier = await pollMemberTier();
    }
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
          ? '微信虚拟支付 · 一次开通、永久有效；支付完成后档位自动生效，更换设备登录同一微信即可恢复权益（iOS 端由 Apple 渠道代收，费率略有差异）。'
          : '会员开通暂未开放：虚拟支付开通配置中（小程序后台虚拟支付 + 道具上架 + 凭据配置完成后即开放）。'}
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
