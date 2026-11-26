/** 微信支付回调云函数（v2.0.0 新增）
 * 云开发微信支付支付结果通知：member.createOrder 统一下单时 functionName 指向本函数。
 * 职责：校验支付结果 → orders 置 paid → members 写入服务端权威档位（幂等；仅升不降，vip→svip 升档允许）。
 * 回调应答：{ errcode: 0, errmsg: '' } 表示接收成功（非 0 云开发会按策略重试通知）。 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 档位金额校验（分，与 member 云函数 TIERS 一致）与档位等级（仅升不降） */
const TIER_FEE = { vip: 1990, svip: 2990 };
const TIER_RANK = { free: 0, vip: 1, svip: 2 };

exports.main = async (event = {}) => {
  try {
    const outTradeNo = event.outTradeNo;
    const returnCode = event.returnCode || event.return_code;
    const resultCode = event.resultCode || event.result_code;
    if (!outTradeNo) {
      console.error('[payCallback] 缺少 outTradeNo');
      return { errcode: 1, errmsg: 'MISSING_OUT_TRADE_NO' };
    }

    if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
      // 支付未完成：仅登记 failed，不改档位；应答成功避免无意义重试
      console.warn('[payCallback] 支付未成功:', outTradeNo, returnCode, resultCode);
      try {
        await db
          .collection('orders')
          .where({ outTradeNo })
          .update({ data: { status: 'failed', updatedAt: Date.now() } });
      } catch (e) {
        console.warn('[payCallback] 订单失败态更新失败:', e.message);
      }
      return { errcode: 0, errmsg: '' };
    }

    const res = await db.collection('orders').where({ outTradeNo }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) {
      console.error('[payCallback] 订单不存在:', outTradeNo);
      return { errcode: 0, errmsg: '' };
    }
    if (order.status === 'paid') {
      return { errcode: 0, errmsg: '' }; // 幂等：重复通知直接确认
    }
    // 金额校验（防篡改）
    if (TIER_FEE[order.tier] !== event.totalFee) {
      console.error('[payCallback] 金额不一致:', outTradeNo, 'event=', event.totalFee, 'order=', order.totalFee);
      return { errcode: 1, errmsg: 'FEE_MISMATCH' };
    }

    const now = Date.now();
    await db.collection('orders').doc(order._id).update({
      data: {
        status: 'paid',
        paidAt: now,
        transactionId: event.transactionId || '',
        updatedAt: now
      }
    });

    // members：服务端权威档位（已存在且档位更高则忽略，仅升不降）
    const mRes = await db.collection('members').where({ openid: order.openid }).limit(1).get();
    const member = mRes.data && mRes.data[0];
    if (!member) {
      await db.collection('members').add({
        data: {
          openid: order.openid,
          tier: order.tier,
          orderId: order._id,
          paidAt: now,
          createdAt: now,
          updatedAt: now
        }
      });
    } else if (TIER_RANK[order.tier] > TIER_RANK[member.tier || 'free']) {
      await db.collection('members').doc(member._id).update({
        data: { tier: order.tier, orderId: order._id, paidAt: now, updatedAt: now }
      });
    }
    console.info('[payCallback] 支付成功, openid =', order.openid, 'tier =', order.tier);
    return { errcode: 0, errmsg: '' };
  } catch (e) {
    console.error('[payCallback] 处理失败:', e.message);
    return { errcode: 1, errmsg: 'INTERNAL_ERROR' };
  }
};
