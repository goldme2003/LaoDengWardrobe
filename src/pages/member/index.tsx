import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Textarea } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  TIERS,
  TIER_ORDER,
  tierOf,
  weatherLevelLabel,
  MemberTier
} from '@/services/entitlement';
import { MEMBER_FN_NAME, CLOUD_READY } from '@/config/cloud';
import { FEATURES } from '@/config/features';
import styles from './index.module.scss';

/** v2.1.5：支付中订单暂存 key——支付完成后档位未即时生效时，重进本页自动查单补发货（自愈） */
const LAST_PAY_ORDER_KEY = 'ldw_last_pay_order';

/** v2.2.0：开发者联系电话（售后说明区展示，点击复制） */
const DEV_CONTACT_PHONE = '17612733117';

/** v2.2.0：售后卡订单条目（listOrders 返回；status 为服务端复核后的退款状态） */
interface RefundOrderItem {
  orderId: string;
  tier: MemberTier;
  upgrade?: boolean;
  totalFee: number;
  status: 'paid' | 'refunding' | 'refunded' | 'refund_failed';
  paidAt: number;
  refundFee?: number;
  refundReason?: string;
  refundAcceptedAt?: number;
  refundedAt?: number;
}

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
  /** v2.1.5：进页自愈防重入 */
  const reconcilingRef = useRef(false);

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
  // v2.1.8：携带最低档位门槛——已开通 VIP 后购买 SVIP 时，必须等到 svip 生效才算成功，
  // 不能把已有的 vip 误判为本次开通成功（此前该竞态导致 SVIP 支付后被误报「VIP 开通成功」
  // 并误清自愈单号，订单永久失去补发货机会）
  const TIER_RANK: Record<MemberTier, number> = { free: 0, vip: 1, svip: 2 };
  const pollMemberTier = async (minRank = 1): Promise<MemberTier | ''> => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const res = await Taro.cloud.callFunction({
          name: MEMBER_FN_NAME,
          data: { action: 'getMember' }
        });
        const result = (res.result || {}) as { code?: string; tier?: MemberTier };
        if (result.code === 'OK' && result.tier && TIER_RANK[result.tier] >= minRank) {
          return result.tier;
        }
      } catch (e) {
        // 网络波动：继续重试
      }
    }
    return '';
  };

  // 兜底查单：发货推送丢失时主动触发服务端 query_order 补发货（官方 5.4.2）；
  // v2.1.5：返回服务端结果（含平台原始应答摘要 provider）供超时提示与日志定位
  const reconcileOrder = async (orderId: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await Taro.cloud.callFunction({
        name: MEMBER_FN_NAME,
        data: { action: 'queryOrder', orderId }
      });
      const result = (res.result || {}) as Record<string, unknown>;
      console.info('[member] queryOrder 兜底结果:', JSON.stringify(result).slice(0, 400));
      return result;
    } catch (e) {
      // 查单失败不阻塞，用户可稍后重进
      return null;
    }
  };

  /** v2.1.5：进页自愈——支付后档位未即时生效（推送丢失/延迟）时，重进本页自动查单补发货
   * v2.1.8：不再限于 free 档（VIP 用户购买 SVIP 未生效时同样自愈）；暂存单号被误清时由服务端
   * 自动定位最近一笔未完成订单；仅在查单确认已支付后再按订单档位门槛轮询生效 */
  useEffect(() => {
    if (!CLOUD_READY || !FEATURES.paymentEnabled) return;
    if (payingTier) return;
    let stored = '';
    try {
      stored = String(Taro.getStorageSync(LAST_PAY_ORDER_KEY) || '');
    } catch (e) {
      stored = '';
    }
    if (reconcilingRef.current) return;
    reconcilingRef.current = true;
    (async () => {
      Taro.showLoading({ title: '检测未完成订单…', mask: true });
      const diag = await reconcileOrder(stored);
      if (diag && diag.code === 'OK') {
        const orderTier = String(diag.tier || '') as MemberTier;
        const tier = await pollMemberTier(TIER_RANK[orderTier] || 1);
        if (tier) {
          try {
            Taro.removeStorageSync(LAST_PAY_ORDER_KEY);
          } catch (e) {
            // 清理失败不影响
          }
          setMemberTier(tier);
          Taro.showToast({ title: '检测到已支付，会员已开通', icon: 'success', duration: 2000 });
        }
      }
      Taro.hideLoading();
      reconcilingRef.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2.1.0：虚拟支付开通——wx.login 换 code → 服务端签名下单 → requestVirtualPayment 拉起
  // → 轮询档位生效（发货推送为主）→ 未生效时查单补发（兜底）→ 再轮询
  const handlePay = async (tier: 'vip' | 'svip') => {
    if (payingTier) return;
    if (!CLOUD_READY) {
      Taro.showToast({ title: '请在微信端开通会员', icon: 'none' });
      return;
    }
    // v2.1.0：开关关闭 = MP 后台虚拟支付尚未配置完成（OfferID/AppKey/道具），不发起支付
    if (!FEATURES.paymentEnabled) {
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
        // v2.1.5：暂存订单号——若支付后档位未即时生效，重进本页自动查单补发货
        try {
          Taro.setStorageSync(LAST_PAY_ORDER_KEY, orderId);
        } catch (e) {
          // 存储失败不影响支付
        }
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
      console.error('[member] requestVirtualPayment fail:', raw);
      if (/限制|limit/i.test(raw)) {
        Taro.showModal({
          title: '支付能力受平台限制',
          content:
            '微信平台未放行本小程序的虚拟支付：请确认小程序后台已开通「虚拟支付」、道具已创建并发布，且云函数凭据（OfferID/AppKey）配置正确。',
          showCancel: false,
          confirmText: '知道了'
        });
      } else if (raw && !/cancel|取消/i.test(raw)) {
        // v2.1.3：展示具体错误信息便于定位（AppKey/道具/签名/版本等问题）
        Taro.showModal({
          title: '支付未完成',
          content: raw.slice(0, 300),
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        Taro.showToast({ title: '支付未完成', icon: 'none' });
      }
      return;
    }
    // 支付成功：确认云端档位生效（发货推送为主）；未生效则查单补发后再轮询一次
    // v2.1.8：轮询与查单均以本次购买档位为最低门槛（购买 SVIP 须等到 svip 生效），
    // 且仅在查单确认已支付后才进行二次轮询
    const minRank = tier === 'svip' ? 2 : 1;
    Taro.showLoading({ title: '开通确认中…', mask: true });
    let newTier = await pollMemberTier(minRank);
    let diag: Record<string, unknown> | null = null;
    if (!newTier && orderId) {
      diag = await reconcileOrder(orderId);
      if (diag && diag.code === 'OK') {
        newTier = await pollMemberTier(minRank);
      }
    }
    Taro.hideLoading();
    setPayingTier('');
    if (newTier) {
      try {
        Taro.removeStorageSync(LAST_PAY_ORDER_KEY);
      } catch (e) {
        // 清理失败不影响
      }
      setMemberTier(newTier);
      Taro.showToast({ title: `${TIERS[newTier].label} 开通成功`, icon: 'success', duration: 2000 });
    } else {
      // v2.1.5：超时时弹出兜底查单的原始应答，便于定位（推送是否到达/查单失败原因）
      const provider = (diag && (diag.provider as Record<string, unknown>)) || null;
      Taro.showModal({
        title: '支付完成，开通确认中',
        content:
          `档位生效确认超时，已记录订单（重进本页将自动补单）。` +
          (provider
            ? `查单应答：errcode=${provider.errcode ?? '-'} status=${diag?.status ?? '-'} ${(provider.errmsg as string) || ''} ${(provider.orderRaw as string) || ''}`.slice(0, 300)
            : '兜底查单未返回结果，请稍后重进本页。'),
        showCancel: false,
        confirmText: '知道了'
      });
    }
  };

  // ---------- v2.2.0：售后与退款 ----------
  const REFUND_STATUS_TEXT: Record<RefundOrderItem['status'], string> = {
    paid: '生效中',
    refunding: '退款处理中',
    refunded: '已退款',
    refund_failed: '退款失败'
  };

  const [refundOrders, setRefundOrders] = useState<RefundOrderItem[]>([]);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundErr, setRefundErr] = useState('');
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  /** 金额展示：分 → 元 */
  const fenToYuan = (fen: number): string => `¥${(Number(fen || 0) / 100).toFixed(2)}`;
  const fmtDate = (ts?: number): string => {
    if (!ts) return '-';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** 加载本人订单（服务端 listOrders 会顺带向平台复核「退款中」订单的最新状态并回写） */
  const loadRefundOrders = async () => {
    if (!CLOUD_READY || !FEATURES.paymentEnabled) return;
    setRefundLoading(true);
    try {
      const res = await Taro.cloud.callFunction({
        name: MEMBER_FN_NAME,
        data: { action: 'listOrders' }
      });
      const result = (res.result || {}) as {
        code?: string;
        orders?: (Omit<RefundOrderItem, 'status'> & { status?: string })[];
      };
      if (result.code === 'OK') {
        setRefundOrders(
          (result.orders || []).filter((o) => o.status !== 'created') as RefundOrderItem[]
        );
      }
    } catch (e) {
      console.warn('[member] 售后订单加载失败:', e);
    }
    setRefundLoading(false);
  };

  // 会员用户进页加载订单与退款状态（进度实时展示在售后卡）
  useEffect(() => {
    if (memberTier !== 'free') void loadRefundOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberTier]);

  /** 可退款订单：最近一笔已支付/退款失败的订单（更早订单请电话联系开发者处理） */
  const refundableOrder = refundOrders.find((o) => o.status === 'paid' || o.status === 'refund_failed');

  const copyPhone = () => {
    Taro.setClipboardData({ data: DEV_CONTACT_PHONE }).catch(() => undefined);
  };

  /** 提交退款申请：原因必填校验 → 确认弹窗 → 云端发起退款（受理后档位还原、金额原路退回） */
  const handleRefundSubmit = async () => {
    const reason = refundReason.trim();
    if (!reason) {
      // 必填校验：为空时无法提交
      setRefundErr('请填写退款原因（必填）');
      return;
    }
    if (!refundableOrder || refundSubmitting) return;
    setRefundErr('');
    const confirm = await Taro.showModal({
      title: '确认申请退款',
      content:
        `将对「${TIERS[refundableOrder.tier].label}${refundableOrder.upgrade ? '（升级）' : ''}」订单发起全额退款（${fenToYuan(refundableOrder.totalFee)}）。` +
        `退款成功后会员等级将还原至购买前的状态，退款金额原路退回（预计 1–3 个工作日到账）。确认继续？`,
      confirmText: '申请退款',
      cancelText: '再想想'
    });
    if (!confirm.confirm) return;
    setRefundSubmitting(true);
    Taro.showLoading({ title: '正在提交退款申请…', mask: true });
    try {
      const res = await Taro.cloud.callFunction({
        name: MEMBER_FN_NAME,
        data: { action: 'refundOrder', orderId: refundableOrder.orderId, reason }
      });
      const result = (res.result || {}) as {
        code?: string;
        message?: string;
        refundFee?: number;
        restoredTier?: MemberTier;
        refundState?: string;
      };
      Taro.hideLoading();
      if (result.code === 'OK') {
        if (result.restoredTier) setMemberTier(result.restoredTier);
        setRefundReason('');
        Taro.showModal({
          title: result.refundState === 'refunded' ? '退款完成' : '退款申请已提交',
          content:
            `退款金额 ${fenToYuan(result.refundFee || refundableOrder.totalFee)} 将原路退回（预计 1–3 个工作日到账）。` +
            (result.restoredTier ? `会员等级已还原至「${TIERS[result.restoredTier].label}」。` : '') +
            '可在下方售后卡跟踪退款进度。',
          showCancel: false,
          confirmText: '知道了'
        });
        void loadRefundOrders();
      } else {
        Taro.showModal({
          title: '退款申请未成功',
          content: `${result.message || '处理失败，请稍后重试'}。如持续失败请联系开发者：${DEV_CONTACT_PHONE}`,
          showCancel: false,
          confirmText: '知道了'
        });
      }
    } catch (e) {
      Taro.hideLoading();
      Taro.showModal({
        title: '退款申请未成功',
        content: `网络异常，请稍后重试；如持续失败请联系开发者：${DEV_CONTACT_PHONE}`,
        showCancel: false,
        confirmText: '知道了'
      });
    }
    setRefundSubmitting(false);
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
          // v2.0.2：支付未开放时按钮显示「暂未开放」（点击说明原因）；v2.2.0：开关迁移至 FEATURES.paymentEnabled
          const payClosed = !FEATURES.paymentEnabled;
          const disabled = active || locked || payingTier !== '' || payClosed;
          // v2.2.0：VIP 升级 SVIP 仅需补差价（升级价，权益直接覆盖、无需重复全额购买）
          const upgradePrice =
            t === 'svip' && memberTier === 'vip' && cfg.upgradePrice != null ? cfg.upgradePrice : null;
          const btnText =
            payClosed && !active
              ? '暂未开放'
              : payingTier === t
                ? '支付中…'
                : active
                  ? '当前等级'
                  : locked
                    ? '已含于 SVIP'
                    : upgradePrice != null
                      ? '升级 SVIP'
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
                <Text className={`${styles.priceNum} ${t === 'svip' ? styles.priceNumSvip : ''}`}>
                  ¥{upgradePrice != null ? upgradePrice : cfg.price}
                </Text>
                <Text className={styles.priceUnit}>/ 永久有效</Text>
                {upgradePrice != null && <Text className={styles.priceOrigin}>¥{cfg.price}</Text>}
              </View>
              {upgradePrice != null && (
                <Text className={styles.upgradeTag}>VIP 升级价 · 仅补差价，权益直接覆盖</Text>
              )}
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
        {FEATURES.paymentEnabled
          ? `微信虚拟支付 · 一次开通、永久有效；${memberTier === 'vip' ? `VIP 升级 SVIP 仅需补差价 ¥${TIERS.svip.upgradePrice}（权益直接覆盖，无需重复购买）；` : ''}支付完成后档位自动生效，更换设备登录同一微信即可恢复权益（iOS 端由 Apple 渠道代收，费率略有差异）。`
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

      {/* v2.2.0：售后与退款——说明区预留开发者联系电话（点击复制）；退款原因必填，受理后档位自动还原 */}
      <View className={styles.refundCard}>
        <View className={styles.refundHead}>
          <Text className={styles.refundTitle}>售后与退款</Text>
          <Text className={styles.refundPhone} onClick={copyPhone}>
            开发者电话 {DEV_CONTACT_PHONE}（点击复制）
          </Text>
        </View>
        <Text className={styles.refundTip}>
          支付问题或退款请先电话联系开发者确认；退款成功后会员等级自动还原至购买前状态，退款金额原路退回（预计 1–3 个工作日到账）。
        </Text>
        {CLOUD_READY && FEATURES.paymentEnabled && memberTier !== 'free' && (
          <View className={styles.refundBody}>
            {refundLoading ? (
              <Text className={styles.refundLoading}>订单加载中…</Text>
            ) : refundOrders.length === 0 ? (
              <Text className={styles.refundLoading}>暂无订单记录</Text>
            ) : (
              refundOrders.map((o) => (
                <View key={o.orderId} className={styles.refundRow}>
                  <Text className={styles.refundRowMain}>
                    {TIERS[o.tier].label}
                    {o.upgrade ? '（升级）' : ''} · {fenToYuan(o.totalFee)} · {fmtDate(o.paidAt)}
                  </Text>
                  <Text
                    className={[
                      styles.refundTag,
                      o.status === 'refund_failed' ? styles.refundTagErr : '',
                      o.status === 'refunded' || o.status === 'refunding' ? styles.refundTagOk : ''
                    ].join(' ')}
                  >
                    {REFUND_STATUS_TEXT[o.status]}
                  </Text>
                </View>
              ))
            )}
            {refundableOrder && (
              <View className={styles.refundForm}>
                <Text className={styles.refundLabel}>
                  退款订单：{TIERS[refundableOrder.tier].label}
                  {refundableOrder.upgrade ? '（升级）' : ''} · {fenToYuan(refundableOrder.totalFee)}
                  （更早订单请电话联系开发者）
                </Text>
                <Textarea
                  className={styles.refundTextarea}
                  value={refundReason}
                  maxlength={200}
                  placeholder='请填写退款原因（必填），如：误操作购买、与预期不符…'
                  onInput={(e) => {
                    setRefundReason(e.detail.value);
                    if (refundErr) setRefundErr('');
                  }}
                />
                {!!refundErr && <Text className={styles.refundErr}>{refundErr}</Text>}
                <View
                  className={[
                    styles.refundSubmit,
                    !refundReason.trim() || refundSubmitting ? styles.refundSubmitDisabled : ''
                  ].join(' ')}
                  onClick={handleRefundSubmit}
                >
                  <Text className={styles.refundSubmitText}>
                    {refundSubmitting ? '提交中…' : '申请退款'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      <Text className={styles.footTip}>
        会员权益说明：服装批量导入已上线（VIP 5 次/月、SVIP 无限次，按批量任务计次）；衣物属性自动识别为 VIP/SVIP 专属（普通版不自动识别）；出差推荐 VIP 2 次/月、SVIP 无限次；时尚穿搭推荐为待上线功能（VIP 2 次/月、SVIP 5 次/月，权益额度自功能上线后开始计数）；明日推荐套数每日生成后当天缓存、次日重新生成（普通版不含）；云同步已上线（登录后可在「我的 → 云同步」开启，VIP 可同步 3 个衣橱、SVIP 全部，冲突副本保留 30 天）；会员一次开通、永久有效。
      </Text>
    </View>
  );
};

export default MemberPage;
