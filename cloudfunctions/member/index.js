/** 会员中心云函数（v1.9.0，F-19；v2.1.0 改造为微信小程序「虚拟支付」通道）
 * 入参：{ action: 'ping' | 'getMember' | 'createOrder' | 'queryOrder', tier?, jsCode?, orderId? }
 * 出参：
 *   getMember   → { code:'OK', tier:'free'|'vip'|'svip' }
 *   createOrder → { code:'OK', orderId, payData: { signData, mode:'short_series_goods', paySig, signature } }
 *              或 { code:'ALREADY_MEMBER'|'NOT_CONFIGURED'|'BAD_PARAM'|'SIGN_ERROR'|'DB_ERROR', message? }
 *   queryOrder  → { code:'OK'|'NOT_PAID'|'BAD_PARAM'|'NOT_CONFIGURED', delivered?, message? }
 * 背景（v2.1.0，依据官方《虚拟支付：个人》文档）：
 *   1. 小程序主体为个人，官方已向个人主体开放虚拟支付（条件：服务类目含「工具」+ 认证 + 备案；
 *      月限额 10 万元；费率 Android 1% / iOS 12%）。此前走 cloudPay.unifiedOrder + wx.requestPayment
 *      售卖虚拟商品被平台拦截（「小程序对应支付能力已被限制」），v2.1.0 起改走虚拟支付专用链路；
 *   2. 模式：道具直购（mode = short_series_goods）。会员买断 = 道具：MP 后台【虚拟支付 → 道具管理】
 *      创建 VIP（1990 分）/ SVIP（2990 分）道具并发布，道具 ID 经环境变量 VP_PRODUCT_VIP / VP_PRODUCT_SVIP 配置；
 *   3. 凭据（云函数环境变量）：VP_OFFER_ID（OfferID）、VP_APP_KEY（现网 AppKey）、
 *      WX_APP_SECRET（AppSecret，code2Session 换 session_key 用）、VP_PRODUCT_VIP / VP_PRODUCT_SVIP；
 *   4. 签名（官方 5.5）：paySig = HMAC-SHA256(AppKey, 'requestVirtualPayment&' + signData)；
 *      signature = HMAC-SHA256(session_key, signData)；signData 为固定键序 JSON 串（不得格式化）；
 *   5. 发货：以平台发货推送（payCallback 云函数，xpay_goods_deliver_notify）为主，
 *      推送丢失由 queryOrder（/xpay/query_order 查单）兜底；前端支付回调不作为发货依据。 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 档位价格（分，须与 MP 后台道具价格一致）与商品名 */
const TIERS = {
  vip: { label: 'VIP', totalFee: 1990 },
  svip: { label: 'SVIP', totalFee: 2990 }
};
/** 道具 ID（MP 后台虚拟支付 → 道具管理 实际发布的 ID；可经环境变量 VP_PRODUCT_* 覆盖）
 * v2.1.4：对齐需求方后台实际道具 ID——此前默认 vip_member/svip_member 与后台不符，导致拉起支付即失败 */
const PRODUCT_IDS = {
  vip: process.env.VP_PRODUCT_VIP || 'VIP_Tool',
  svip: process.env.VP_PRODUCT_SVIP || 'SVIP_Tool'
};
const OFFER_ID = process.env.VP_OFFER_ID || '';
const APP_KEY = process.env.VP_APP_KEY || '';
const WX_APP_SECRET = process.env.WX_APP_SECRET || '';

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex');
}

/** HTTPS GET/POST 轻量封装（code2Session 与 /xpay/query_order 使用） */
function httpJson(urlPath, { method = 'GET', body = '', timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.weixin.qq.com',
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': method === 'POST' ? Buffer.byteLength(body) : 0
        },
        timeout
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('error', (e) => reject(new Error('WX_HTTP_ERROR: ' + e.message)));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error('WX_BAD_JSON: ' + buf.slice(0, 200)));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('WX_HTTP_TIMEOUT'));
    });
    req.on('error', (e) => reject(e));
    if (method === 'POST') req.write(body);
    req.end();
  });
}

/** wx.login 的 jsCode → session_key（官方 code2Session；每次 wx.login 会刷新 session_key，
 * 因此下单实时换取，不做长期缓存） */
async function code2Session(jsCode) {
  const path =
    `/sns/jscode2session?appid=${process.env.WX_APPID || 'wxe42fe1ecc2645be1'}` +
    `&secret=${encodeURIComponent(WX_APP_SECRET)}&js_code=${encodeURIComponent(jsCode)}` +
    '&grant_type=authorization_code';
  const res = await httpJson(path);
  if (!res || !res.session_key) {
    throw new Error('CODE2SESSION_FAILED: ' + JSON.stringify(res).slice(0, 160));
  }
  return res;
}

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

/** 发货（订单置 paid + members 写入档位；幂等：订单已 paid 直接返回） */
async function deliverOrder(order, wxOrderId) {
  if (order.status === 'paid') return { delivered: false };
  const now = Date.now();
  await db.collection('orders').doc(order._id).update({
    data: {
      status: 'paid',
      paidAt: now,
      wxOrderId: wxOrderId || order.wxOrderId || '',
      updatedAt: now
    }
  });
  const mRes = await db.collection('members').where({ openid: order.openid }).limit(1).get();
  const member = mRes.data && mRes.data[0];
  const RANK = { free: 0, vip: 1, svip: 2 };
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
  } else if (RANK[order.tier] > RANK[member.tier || 'free']) {
    await db.collection('members').doc(member._id).update({
      data: { tier: order.tier, orderId: order._id, paidAt: now, updatedAt: now }
    });
  }
  console.info('[member] 发货完成 openid =', order.openid, 'tier =', order.tier);
  return { delivered: true };
}

/** 兜底查单（官方 /xpay/query_order，pay_sig = HMAC-SHA256(AppKey, '/xpay/query_order&' + body)）
 * v2.1.5：已支付状态匹配放宽（不同文档版本字段/取值差异：PAID/SUCCESS/PAY_SUCCESS/FINISH 等），
 * 未判定为已支付时在返回中携带平台原始应答摘要（provider），供前端与日志定位 */
const PAID_ORDER_STATES = new Set(['PAID', 'SUCCESS', 'PAY_SUCCESS', 'FINISH', 'TRADE_SUCCESS', 'PAID_SUCCESS']);

async function queryXpayOrder(openid, outTradeNo) {
  const body = JSON.stringify({ openid, env: 0, order_id: outTradeNo });
  const paySig = hmacSha256(APP_KEY, '/xpay/query_order&' + body);
  const res = await httpJson(`/xpay/query_order?pay_sig=${paySig}`, { method: 'POST', body });
  const order = res && res.order;
  const state = order
    ? String(order.state || order.status || order.pay_status || order.order_state || '').toUpperCase()
    : '';
  const paid = !!(res && res.errcode === 0 && state && PAID_ORDER_STATES.has(state));
  console.info('[member] query_order 原始应答:', JSON.stringify(res).slice(0, 500));
  return { res, paid, state };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'getMember';

  if (action === 'ping') {
    return {
      code: 'OK',
      channel: 'virtual-pay',
      mode: 'short_series_goods',
      hasOfferId: !!OFFER_ID,
      hasAppKey: !!APP_KEY,
      hasAppSecret: !!WX_APP_SECRET,
      products: PRODUCT_IDS,
      collections: ['members', 'orders']
    };
  }

  if (!OPENID) {
    return { code: 'UNAUTHORIZED', message: '无法获取用户身份' };
  }

  if (action === 'getMember') {
    const tier = await contextTier(OPENID);
    return { code: 'OK', tier };
  }

  // ---------- 虚拟支付下单：生成签名 payData 供前端 wx.requestVirtualPayment ----------
  if (action === 'createOrder') {
    const tier = event.tier;
    if (!TIERS[tier]) {
      return { code: 'BAD_PARAM', message: '无效的会员档位' };
    }
    if (!OFFER_ID || !APP_KEY || !WX_APP_SECRET) {
      console.error('[member] 虚拟支付凭据缺失（VP_OFFER_ID / VP_APP_KEY / WX_APP_SECRET）');
      return { code: 'NOT_CONFIGURED', message: '虚拟支付开通配置中，请稍后再试' };
    }
    // 已开通同档位或更高档位：无需重复购买（SVIP 为最高档）
    const current = await contextTier(OPENID);
    if (current === 'svip' || current === tier) {
      return {
        code: 'ALREADY_MEMBER',
        message: current === 'svip' ? '已开通 SVIP，无需重复开通' : '已开通该档位'
      };
    }
    if (!event.jsCode) {
      return { code: 'BAD_PARAM', message: '缺少登录凭据（jsCode），请重试' };
    }
    // 实时换 session_key（用于用户态签名 signature）
    let sessionKey = '';
    try {
      const session = await code2Session(event.jsCode);
      sessionKey = session.session_key;
      if (session.openid && session.openid !== OPENID) {
        return { code: 'BAD_PARAM', message: '登录凭据与当前用户不符，请重试' };
      }
    } catch (e) {
      console.error('[member] code2Session 失败：', e.message);
      return { code: 'SIGN_ERROR', message: '支付初始化失败，请重试' };
    }
    const cfg = TIERS[tier];
    const productId = PRODUCT_IDS[tier];
    // 业务单号：8–32 位、唯一、不以下划线开头（官方要求）
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
          payChannel: 'virtual',
          productId,
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
    // signData：固定键序 JSON 串（官方要求，不得格式化/改键序）
    const signData = JSON.stringify({
      offerId: OFFER_ID,
      buyQuantity: 1,
      env: 0,
      currencyType: 'CNY',
      productId,
      goodsPrice: cfg.totalFee,
      outTradeNo,
      attach: JSON.stringify({ tier, openid: OPENID })
    });
    try {
      const paySig = hmacSha256(APP_KEY, 'requestVirtualPayment&' + signData);
      const signature = hmacSha256(sessionKey, signData);
      return {
        code: 'OK',
        orderId,
        payData: { signData, mode: 'short_series_goods', paySig, signature }
      };
    } catch (e) {
      console.error('[member] 签名失败：', e.message);
      return { code: 'SIGN_ERROR', orderId, message: '支付签名失败，请重试' };
    }
  }

  // ---------- 兜底查单：发货推送丢失时前端调用，查到已支付即补发货 ----------
  if (action === 'queryOrder') {
    if (!OFFER_ID || !APP_KEY) {
      return { code: 'NOT_CONFIGURED', message: '虚拟支付开通配置中' };
    }
    if (!event.orderId) {
      return { code: 'BAD_PARAM', message: '缺少订单号' };
    }
    let order = null;
    try {
      const res = await db.collection('orders').doc(event.orderId).get();
      order = res.data;
    } catch (e) {
      return { code: 'BAD_PARAM', message: '订单不存在' };
    }
    if (!order || order.openid !== OPENID) {
      return { code: 'BAD_PARAM', message: '订单不存在' };
    }
    if (order.status === 'paid') {
      return { code: 'OK', delivered: false, message: '订单已完成' };
    }
    try {
      const { paid, state, res } = await queryXpayOrder(order.openid, order.outTradeNo);
      if (!paid) {
        // v2.1.5：携带平台原始应答摘要，便于前端定位（签名错误 / 状态未到已支付 / 字段差异）
        return {
          code: 'NOT_PAID',
          message: '订单未支付完成',
          state: state || '',
          provider: {
            errcode: res && res.errcode,
            errmsg: String((res && res.errmsg) || '').slice(0, 120),
            orderRaw: res && res.order ? JSON.stringify(res.order).slice(0, 300) : ''
          }
        };
      }
      const wxOrderId =
        (res.order && (res.order.mch_order_no || res.order.wx_order_id)) || '';
      const { delivered } = await deliverOrder(order, wxOrderId);
      return { code: 'OK', delivered, message: delivered ? '已补发货' : '订单已完成' };
    } catch (e) {
      console.error('[member] 查单失败：', e.message);
      return { code: 'QUERY_ERROR', message: '查单失败，请稍后重试' };
    }
  }

  return { code: 'BAD_PARAM', message: '未知 action' };
};
