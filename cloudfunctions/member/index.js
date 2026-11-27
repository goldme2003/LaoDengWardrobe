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
 *      推送丢失由 queryOrder（/xpay/query_order 查单）兜底；前端支付回调不作为发货依据。
 * v2.1.7：修复兜底查单三处缺陷（缺 access_token / status 数字枚举按字符串匹配 / wx_order_id 字段名），
 *      已支付未发货订单（平台 status=2）重进会员页即可自动补发货。
 * v2.1.8：queryOrder 支持缺省 orderId 自动定位最近一笔未完成订单（7 天内），响应携带订单档位
 *      tier 配合前端按目标档位轮询生效——修复「已开通 VIP 后购买 SVIP 被已有 VIP 误判为开通成功」竞态。
 * v2.2.0：1) VIP 升级 SVIP 补差价——VIP 用户购买 SVIP 时改用升级道具（SVIP_Upgrade_Tool，补差价），
 *      权益直接覆盖、无需重复全额购买；2) 新增售后退款链路——refundOrder（官方 POST /xpay/refund_order
 *      发起退款任务，受理后会员档位自动还原为该用户剩余已支付订单中的最高档位）与 listOrders
 *      （订单列表 + 退款状态复核：query_order status 5=商户侧扣款完成（退款中）/ 7=退款失败 / 8=用户侧收款完成）。 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 档位价格（分，须与 MP 后台道具价格一致）与商品名
 * v2.1.6：需求方临时将后台两道具改为 0.01 元测试价，代码同步 1 分（上线前恢复 1990/2990 时须同步改回） */
const TIERS = {
  vip: { label: 'VIP', totalFee: 1 },
  svip: { label: 'SVIP', totalFee: 1 }
};
/** v2.2.0：VIP 升级 SVIP 补差价道具价格（分）。当前测试期与后台道具一致为 1 分（0.01 元）；
 * 上线时后台将升级道具改为 ¥10（1000 分），代码经环境变量 VP_SVIP_UPGRADE_PRICE=1000 配置（或改此默认值） */
const SVIP_UPGRADE_FEE = Number(process.env.VP_SVIP_UPGRADE_PRICE) || 1;
/** 道具 ID（MP 后台虚拟支付 → 道具管理 实际发布的 ID；可经环境变量 VP_PRODUCT_* 覆盖）
 * v2.1.4：对齐需求方后台实际道具 ID——此前默认 vip_member/svip_member 与后台不符，导致拉起支付即失败
 * v2.2.0：新增升级道具 SVIP_Upgrade_Tool（¥10 补差价，MP 后台需新增该道具并发布） */
const PRODUCT_IDS = {
  vip: process.env.VP_PRODUCT_VIP || 'VIP_Tool',
  svip: process.env.VP_PRODUCT_SVIP || 'SVIP_Tool',
  svipUpgrade: process.env.VP_PRODUCT_SVIP_UPGRADE || 'SVIP_Upgrade_Tool'
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

/** 获取接口调用凭证（官方 /cgi-bin/stable_token；同一 grant_type 有效期内重复调用返回同一 token，
 * 无需持久缓存；WX_APP_SECRET 与 code2Session 共用） */
async function getAccessToken() {
  const body = JSON.stringify({
    grant_type: 'client_credential',
    appid: process.env.WX_APPID || 'wxe42fe1ecc2645be1',
    secret: WX_APP_SECRET
  });
  const res = await httpJson('/cgi-bin/stable_token', { method: 'POST', body });
  if (!res || !res.access_token) {
    throw new Error('STABLE_TOKEN_FAILED: ' + JSON.stringify(res).slice(0, 160));
  }
  return res.access_token;
}

/** 兜底查单（官方 POST /xpay/query_order?access_token=ACCESS_TOKEN&pay_sig=PAY_SIG，
 * pay_sig = HMAC-SHA256(AppKey, '/xpay/query_order&' + body)）
 * v2.1.7 根因修复：
 *   1. 此前缺少必填的 access_token 查询参数，请求直接被拒（errcode≠0），查单永远判「未支付」；
 *   2. 返回的 order.status 为数字枚举（2=已支付待发货 3=发货中 4=已发货），此前按字符串
 *      PAID/SUCCESS 匹配永远不中——MP 后台显示「未发货」即 status=2，必须视为已支付并补发货；
 *   3. 微信内部单号字段为 wx_order_id（此前误取不存在的 mch_order_no）。
 * 未判定为已支付时在返回中携带平台原始应答摘要（provider），供前端与日志定位 */
const PAID_ORDER_STATUS = new Set([2, 3, 4]);

async function queryXpayOrder(openid, outTradeNo) {
  const accessToken = await getAccessToken();
  const body = JSON.stringify({ openid, env: 0, order_id: outTradeNo });
  const paySig = hmacSha256(APP_KEY, '/xpay/query_order&' + body);
  const res = await httpJson(
    `/xpay/query_order?access_token=${encodeURIComponent(accessToken)}&pay_sig=${paySig}`,
    { method: 'POST', body }
  );
  const order = res && res.order;
  const status = order && order.status !== undefined && order.status !== null ? Number(order.status) : NaN;
  const paid = !!(res && res.errcode === 0 && !isNaN(status) && PAID_ORDER_STATUS.has(status));
  console.info('[member] query_order 原始应答:', JSON.stringify(res).slice(0, 500));
  return { res, paid, status };
}

// ==================== v2.2.0：售后退款 ====================

/** 退款档位还原：members.tier = 该用户剩余已支付订单（不含退款中/已退款/未支付）中的最高档位；
 * 无剩余已支付订单 → free。自动覆盖「VIP 升级 SVIP 退款后回到 VIP」「全额购买退款后回到 free」等场景 */
async function restoreMemberTier(openid) {
  const RANK = { free: 0, vip: 1, svip: 2 };
  let tier = 'free';
  try {
    const res = await db.collection('orders').where({ openid, status: 'paid' }).limit(100).get();
    (res.data || []).forEach((o) => {
      if (RANK[o.tier] > RANK[tier]) tier = o.tier;
    });
  } catch (e) {
    console.error('[member] 退款档位还原（查订单）失败：', e.message);
    return null;
  }
  const now = Date.now();
  const mRes = await db.collection('members').where({ openid }).limit(1).get();
  const member = mRes.data && mRes.data[0];
  if (member) {
    await db.collection('members').doc(member._id).update({ data: { tier, updatedAt: now } });
  } else {
    await db.collection('members').add({ data: { openid, tier, createdAt: now, updatedAt: now } });
  }
  console.info('[member] 退款还原档位 openid =', openid, 'tier =', tier);
  return tier;
}

/** 「退款中」订单向平台复核最新状态（query_order status 枚举：5=商户侧扣款完成（退款在途）/
 * 7=退款失败 / 8=用户侧收款完成（退款最终成功）），并回写订单状态 */
async function refreshRefundStatus(order) {
  try {
    const { res } = await queryXpayOrder(order.openid, order.outTradeNo);
    const st = res && res.order ? Number(res.order.status) : NaN;
    const now = Date.now();
    if (st === 8) {
      await db.collection('orders').doc(order._id).update({
        data: {
          status: 'refunded',
          refundedAt: now,
          refundFee: Number((res.order && res.order.refund_fee) || 0) || order.totalFee,
          updatedAt: now
        }
      });
      return 'refunded';
    }
    if (st === 7) {
      await db.collection('orders').doc(order._id).update({ data: { status: 'refund_failed', updatedAt: now } });
      return 'refund_failed';
    }
    return 'refunding'; // 其余状态（含 5）视为退款任务进行中
  } catch (e) {
    console.warn('[member] 退款状态复核失败：', e.message);
    return 'refunding';
  }
}

/** 发起退款任务（官方 POST /xpay/refund_order?access_token=ACCESS_TOKEN&pay_sig=PAY_SIG，
 * pay_sig = HMAC-SHA256(AppKey, '/xpay/refund_order&' + body)）。
 * 注意：该接口仅「启动」退款任务，最终结果须经 query_order 复核（refreshRefundStatus）；
 * left_fee 必须与查单返回一致，否则报 268490016 */
async function refundXpayOrder(openid, outTradeNo, leftFee, reasonText) {
  const accessToken = await getAccessToken();
  // 退款单号：8–32 位、仅字母/数字/_/-（LDWR + 时间戳 + 3 位随机）
  const refundOrderId = `LDWR${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`.slice(0, 32);
  const body = JSON.stringify({
    openid,
    order_id: outTradeNo,
    refund_order_id: refundOrderId,
    left_fee: leftFee,
    refund_fee: leftFee, // 全额退款（0, left_fee]
    biz_meta: String(reasonText || '').slice(0, 200), // 用户自述退款原因（官方 refund_reason 仅支持固定枚举）
    refund_reason: '3', // 枚举：3-意愿问题，用户主动退款
    req_from: '2', // 2-用户自己发起退款流程
    env: 0
  });
  const paySig = hmacSha256(APP_KEY, '/xpay/refund_order&' + body);
  const res = await httpJson(
    `/xpay/refund_order?access_token=${encodeURIComponent(accessToken)}&pay_sig=${paySig}`,
    { method: 'POST', body }
  );
  console.info('[member] refund_order 原始应答:', JSON.stringify(res).slice(0, 500));
  return { res, refundOrderId };
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
    // v2.2.0：VIP 升级 SVIP 补差价——改用升级道具（价格/道具 ID 均须与 MP 后台一致）
    const isUpgrade = tier === 'svip' && current === 'vip';
    const productId = isUpgrade ? PRODUCT_IDS.svipUpgrade : PRODUCT_IDS[tier];
    const totalFee = isUpgrade ? SVIP_UPGRADE_FEE : cfg.totalFee;
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
          totalFee,
          upgrade: isUpgrade,
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
      goodsPrice: totalFee,
      outTradeNo,
      attach: JSON.stringify({ tier, openid: OPENID, upgrade: isUpgrade })
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
  // v2.1.8：orderId 缺省时自动定位该用户最近一笔未完成订单（7 天内）——覆盖暂存单号被误清、
  // 换设备等场景；响应携带订单档位 tier，供前端以该档位为门槛轮询生效（修复 SVIP 被
  // 已有 VIP 误判为开通成功的竞态）
  if (action === 'queryOrder') {
    if (!OFFER_ID || !APP_KEY) {
      return { code: 'NOT_CONFIGURED', message: '虚拟支付开通配置中' };
    }
    let order = null;
    try {
      if (event.orderId) {
        const res = await db.collection('orders').doc(event.orderId).get();
        order = res.data;
        if (order && order.openid !== OPENID) order = null;
      } else {
        const res = await db
          .collection('orders')
          .where({ openid: OPENID, status: 'created' })
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        const candidate = res.data && res.data[0];
        if (candidate && Date.now() - candidate.createdAt <= 7 * 24 * 3600 * 1000) {
          order = candidate;
        }
      }
    } catch (e) {
      return { code: 'BAD_PARAM', message: '订单不存在' };
    }
    if (!order) {
      return { code: 'BAD_PARAM', message: '订单不存在' };
    }
    if (order.status === 'paid') {
      return { code: 'OK', delivered: false, tier: order.tier, message: '订单已完成' };
    }
    try {
      const { paid, status, res } = await queryXpayOrder(order.openid, order.outTradeNo);
      if (!paid) {
        // v2.1.5：携带平台原始应答摘要，便于前端定位（签名错误 / 状态未到已支付 / 凭据错误）
        return {
          code: 'NOT_PAID',
          message: '订单未支付完成',
          tier: order.tier,
          status: isNaN(status) ? '' : status,
          provider: {
            errcode: res && res.errcode,
            errmsg: String((res && res.errmsg) || '').slice(0, 120),
            orderRaw: res && res.order ? JSON.stringify(res.order).slice(0, 300) : ''
          }
        };
      }
      const wxOrderId = (res.order && res.order.wx_order_id) || '';
      const { delivered } = await deliverOrder(order, wxOrderId);
      return { code: 'OK', delivered, tier: order.tier, message: delivered ? '已补发货' : '订单已完成' };
    } catch (e) {
      console.error('[member] 查单失败：', e.message);
      return { code: 'QUERY_ERROR', message: '查单失败，请稍后重试' };
    }
  }

  // ---------- v2.2.0：订单列表（售后卡展示 + 退款状态复核） ----------
  if (action === 'listOrders') {
    try {
      const res = await db
        .collection('orders')
        .where({ openid: OPENID })
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
      const out = [];
      for (const o of res.data || []) {
        let status = o.status;
        if (status === 'refunding') {
          // 退款中订单顺带向平台复核最新结果并回写（用户重进页面即可看到退款进度）
          status = await refreshRefundStatus(o);
        }
        out.push({
          orderId: o._id,
          tier: o.tier,
          upgrade: !!o.upgrade,
          totalFee: o.totalFee,
          status,
          paidAt: o.paidAt || 0,
          refundFee: o.refundFee || 0,
          refundReason: o.refundReason || '',
          refundAcceptedAt: o.refundAcceptedAt || 0,
          refundedAt: o.refundedAt || 0
        });
      }
      return { code: 'OK', orders: out };
    } catch (e) {
      console.error('[member] 订单列表查询失败：', e.message);
      return { code: 'DB_ERROR', message: '订单查询失败' };
    }
  }

  // ---------- v2.2.0：申请退款（原因必填；受理后档位自动还原，金额原路退回） ----------
  if (action === 'refundOrder') {
    const reason = String(event.reason || '').trim();
    if (!reason) {
      return { code: 'BAD_PARAM', message: '请填写退款原因' };
    }
    if (!OFFER_ID || !APP_KEY || !WX_APP_SECRET) {
      return { code: 'NOT_CONFIGURED', message: '虚拟支付开通配置中' };
    }
    // 定位订单：orderId 优先（校验归属），缺省取最近一笔已支付订单
    let order = null;
    try {
      if (event.orderId) {
        const res = await db.collection('orders').doc(event.orderId).get();
        order = res.data;
        if (order && order.openid !== OPENID) order = null;
      } else {
        const res = await db
          .collection('orders')
          .where({ openid: OPENID, status: 'paid' })
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        order = (res.data && res.data[0]) || null;
      }
    } catch (e) {
      return { code: 'BAD_PARAM', message: '订单不存在' };
    }
    if (!order) {
      return { code: 'BAD_PARAM', message: '未找到可退款的订单' };
    }
    if (order.status === 'refunded') {
      return { code: 'ALREADY_REFUNDED', message: '该订单已退款' };
    }
    if (order.status === 'refunding') {
      const st = await refreshRefundStatus(order);
      return st === 'refunded'
        ? { code: 'OK', refundState: 'refunded', message: '退款已完成' }
        : { code: 'REFUND_IN_PROGRESS', message: '退款处理中，请稍后查看结果' };
    }
    if (order.status !== 'paid' && order.status !== 'refund_failed') {
      return { code: 'BAD_PARAM', message: '订单不可退款' };
    }
    // 查单：确认支付状态 + 取 left_fee（官方要求与查单一致）/ wx_order_id
    let leftFee = 0;
    let wxOrderId = '';
    try {
      const { paid, res } = await queryXpayOrder(order.openid, order.outTradeNo);
      const platformOrder = res && res.order;
      if (platformOrder) {
        wxOrderId = platformOrder.wx_order_id || '';
        leftFee = Number(platformOrder.left_fee);
        const st = Number(platformOrder.status);
        if (st === 8) {
          // 平台侧退款已完成（此前已发起）：直接对账回写并还原档位
          const now = Date.now();
          const refundFee = Number(platformOrder.refund_fee) || order.totalFee;
          await db.collection('orders').doc(order._id).update({
            data: { status: 'refunded', refundedAt: now, refundFee, updatedAt: now }
          });
          const restoredTier = await restoreMemberTier(order.openid);
          return { code: 'OK', refundState: 'refunded', refundFee, restoredTier };
        }
        if (st === 5) {
          // 商户侧扣款完成（退款任务已在途）：标记退款中并还原档位
          await db.collection('orders').doc(order._id).update({
            data: { status: 'refunding', updatedAt: Date.now() }
          });
          const restoredTier = await restoreMemberTier(order.openid);
          return { code: 'OK', refundState: 'refunding', restoredTier, message: '退款处理中' };
        }
        if (isNaN(leftFee) || leftFee <= 0) {
          leftFee = Number(platformOrder.paid_fee) || order.totalFee;
        }
      }
      if (!paid) {
        return { code: 'NOT_PAID', message: '订单未支付完成，无法退款' };
      }
      if (isNaN(leftFee) || leftFee <= 0) leftFee = order.totalFee;
    } catch (e) {
      console.error('[member] 退款前查单失败：', e.message);
      return { code: 'QUERY_ERROR', message: '退款初始化失败，请稍后重试' };
    }
    // 发起退款任务（errcode 0 受理；268490014 = 退款操作已在进行中，等同受理）
    try {
      const { res } = await refundXpayOrder(order.openid, order.outTradeNo, leftFee, reason);
      if (res && (res.errcode === 0 || res.errcode === 268490014)) {
        const now = Date.now();
        await db.collection('orders').doc(order._id).update({
          data: {
            status: 'refunding',
            refundOrderId: res.refund_order_id || '',
            refundWxOrderId: res.refund_wx_order_id || '',
            refundFee: leftFee,
            refundReason: reason,
            refundAcceptedAt: now,
            updatedAt: now,
            ...(wxOrderId ? { wxOrderId } : {})
          }
        });
        const restoredTier = await restoreMemberTier(order.openid);
        return { code: 'OK', refundState: 'refunding', refundFee: leftFee, restoredTier };
      }
      console.error('[member] refund_order 失败:', res && res.errcode, res && res.errmsg);
      return {
        code: 'REFUND_FAILED',
        message: '退款发起失败：' + ((res && res.errmsg) || '平台异常'),
        provider: { errcode: res && res.errcode, errmsg: res && res.errmsg }
      };
    } catch (e) {
      console.error('[member] 退款请求异常：', e.message);
      return { code: 'REFUND_FAILED', message: '退款请求异常，请稍后重试' };
    }
  }

  return { code: 'BAD_PARAM', message: '未知 action' };
};
