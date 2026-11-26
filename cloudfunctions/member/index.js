/** 会员中心云函数（v1.9.0，F-19；v2.0.0 微信支付正式接入）
 * 入参：{ action: 'ping' | 'getMember' | 'createOrder', tier?: 'vip'|'svip' }
 * 出参：
 *   getMember   → { code:'OK', tier:'free'|'vip'|'svip' }
 *   createOrder → { code:'OK', orderId, payment }
 *              或 { code:'ALREADY_MEMBER'|'MCH_NOT_CONFIGURED'|'BAD_PARAM'|'PAY_ERROR'|'DB_ERROR', orderId?, message? }
 * 说明：
 *   1. 会员档位以云端 members 集合为准（openid 维度，支付回调 payCallback 写入），客户端本地 tier
 *      仅作展示缓存；v2.0.0 起客户端不再上报档位（userSync 的上报回落与 setTier 通道已随测试模式移除）；
 *   2. 统一下单走云开发微信支付 cloudPay.unifiedOrder：商户号从云函数环境变量 WXPAY_SUB_MCH_ID
 *      读取（微信开发者工具 → 云函数 → member → 配置），支付结果回调至 payCallback 云函数；
 *      价格（分）：VIP 1990 / SVIP 2990，一次买断永久有效（与前端 entitlement.ts 一致）；
 *   3. 集合：members（服务端权威档位）、orders（订单流水，status: created→paid/failed）。 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 档位价格（分）与商品名——与前端 entitlement.ts（元）保持一致 */
const TIERS = {
  vip: { label: 'VIP', totalFee: 1990, body: '老登衣柜 VIP 会员（一次买断·永久有效）' },
  svip: { label: 'SVIP', totalFee: 2990, body: '老登衣柜 SVIP 会员（一次买断·永久有效）' }
};

/** 云开发环境 ID（cloudPay 回调指向），优先环境变量 CLOUD_ENV_ID */
const ENV_ID = process.env.CLOUD_ENV_ID || 'laodengwardrobe-d7fyycr6954804b4';

const contextTier = async (openid) => {
  try {
    const res = await db.collection('members').where({ openid }).limit(1).get();
    const doc = res.data && res.data[0];
    if (doc && (doc.tier === 'vip' || doc.tier === 'svip')) return doc.tier;
    return 'free';
  } catch (e) {
    console.error('[member] 查询会员档位失败：', e.message);
    return 'free';
  }
};

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'getMember';

  if (action === 'ping') {
    return { code: 'OK', hasPay: true, collections: ['members', 'orders'] };
  }

  if (!OPENID) {
    return { code: 'UNAUTHORIZED', message: '无法获取用户身份' };
  }

  if (action === 'getMember') {
    const tier = await contextTier(OPENID);
    return { code: 'OK', tier };
  }

  if (action === 'createOrder') {
    const tier = event.tier;
    if (!TIERS[tier]) {
      return { code: 'BAD_PARAM', message: '无效的会员档位' };
    }
    // 已开通同档位或更高档位：无需重复购买（SVIP 为最高档）
    const current = await contextTier(OPENID);
    if (current === 'svip' || current === tier) {
      return {
        code: 'ALREADY_MEMBER',
        message: current === 'svip' ? '已开通 SVIP，无需重复开通' : '已开通该档位'
      };
    }
    const subMchId = process.env.WXPAY_SUB_MCH_ID || '';
    if (!subMchId) {
      console.error('[member] 未配置商户号环境变量 WXPAY_SUB_MCH_ID');
      return { code: 'MCH_NOT_CONFIGURED', message: '支付商户配置中，请稍后再试' };
    }
    const cfg = TIERS[tier];
    const outTradeNo = `LDW${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`.slice(0, 32);
    let orderId = '';
    try {
      const res = await db.collection('orders').add({
        data: {
          openid: OPENID,
          tier,
          totalFee: cfg.totalFee,
          payMode: 'once',
          outTradeNo,
          status: 'created',
          createdAt: Date.now()
        }
      });
      orderId = res._id || '';
    } catch (e) {
      console.error('[member] 订单登记失败：', e.message);
      return { code: 'DB_ERROR', message: '订单登记失败' };
    }
    // 统一下单（云开发微信支付；支付结果回调 payCallback）
    try {
      const payRes = await cloud.cloudPay.unifiedOrder({
        body: cfg.body,
        outTradeNo,
        spbillCreateIp: '127.0.0.1',
        subMchId,
        totalFee: cfg.totalFee,
        envId: ENV_ID,
        functionName: 'payCallback'
      });
      if (!payRes || !payRes.payment) {
        throw new Error((payRes && (payRes.returnMsg || payRes.returnCode)) || '统一下单失败');
      }
      return { code: 'OK', orderId, payment: payRes.payment };
    } catch (e) {
      console.error('[member] 统一下单失败：', e.message);
      return { code: 'PAY_ERROR', orderId, message: '下单失败，请稍后重试' };
    }
  }

  return { code: 'BAD_PARAM', message: '未知 action' };
};
