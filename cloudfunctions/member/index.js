/** 会员中心云函数（v1.9.0，F-19）
 * 入参：{ action: 'ping' | 'getMember' | 'createOrder', tier?: 'vip'|'svip' }
 * 出参：
 *   getMember  → { code:'OK', tier:'free'|'vip'|'svip' }
 *   createOrder→ { code:'OK'|'BAD_PARAM'|'PAY_UNAVAILABLE', orderId?, message? }
 * 说明：
 *   1. 会员档位以云端 members 集合为准（openid 维度），客户端本地 tier 仅作展示缓存；
 *   2. 微信支付商户号尚未开通：createOrder 只登记 orders 集合（status='created'），
 *      并返回 PAY_UNAVAILABLE，由客户端提示「支付暂未开通」；支付开通后在此接入
 *      统一下单（cloud.cloudPay.unifiedOrder）与支付回调（action='payCallback'）；
 *   3. 需在云开发控制台创建集合：members、orders（权限：仅创建者可读写）。 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const TIERS = {
  vip: { label: 'VIP', price: 18 },
  svip: { label: 'SVIP', price: 48 }
};

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
    return { code: 'OK', hasPay: false, collections: ['members', 'orders'] };
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
    const price = TIERS[tier].price;
    let orderId = '';
    try {
      const res = await db.collection('orders').add({
        data: {
          openid: OPENID,
          tier,
          price,
          payMode: 'once',
          status: 'created',
          createdAt: Date.now()
        }
      });
      orderId = res._id || '';
    } catch (e) {
      console.error('[member] 订单登记失败：', e.message);
      return { code: 'DB_ERROR', message: '订单登记失败' };
    }
    // 支付未开通：订单保留 created 状态，待微信支付商户号开通后接统一继续支付流程
    return {
      code: 'PAY_UNAVAILABLE',
      orderId,
      message: '支付暂未开通，敬请期待'
    };
  }

  return { code: 'BAD_PARAM', message: '未知 action' };
};
