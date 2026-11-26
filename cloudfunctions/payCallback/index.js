/** 微信小程序「虚拟支付」发货推送云函数（v2.1.0 重写）
 * 背景：member.createOrder 改走虚拟支付（wx.requestVirtualPayment，道具直购 short_series_goods），
 * 支付成功后平台向 MP 后台「开发管理 → 消息推送」配置的地址推送发货通知；云开发环境下
 * 该推送可路由到本云函数（mp 后台消息推送选择云开发环境 + 本函数）。
 * 推送核心字段（官方 5.4.1）：
 *   Event = xpay_goods_deliver_notify
 *   OpenId（发货对象）、OutTradeNo（业务单号，下单时传入）
 *   WeChatPayInfo.MchOrderNo（平台单号 wx_order_id，幂等去重以此为准）
 *   GoodsInfo.ProductId / GoodsInfo.Quantity
 * 处理：幂等（wx_order_id/订单状态去重）→ 订单置 paid → members 写入档位（仅升不降）→
 *       应答 <xml><ErrCode>0</ErrCode></xml>（非 0 平台最多重试 15 次）。
 * 兼容：云开发推送可能为已解析对象，也可能含原始 XML 字符串，两种形态均处理。 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const RANK = { free: 0, vip: 1, svip: 2 };
/** 道具 ID → 档位（与 member 云函数 PRODUCT_IDS 一致；缺省按订单 tier 发货）
 * v2.1.4：对齐后台实际道具 ID（VIP_Tool / SVIP_Tool） */
const TIER_BY_PRODUCT = {
  VIP_Tool: 'vip',
  SVIP_Tool: 'svip'
};

/** 从任意形态的推送中提取字段：对象直取；字符串按 XML 标签正则提取 */
function pickField(source, tag) {
  if (source && typeof source === 'object') {
    // 支持嵌套对象（WeChatPayInfo.MchOrderNo 等）与带命名空间的键
    const keys = Object.keys(source);
    for (const k of keys) {
      if (k === tag || k.endsWith(':' + tag)) {
        const v = source[k];
        if (v !== null && typeof v !== 'object') return String(v);
        if (v && typeof v === 'object') {
          const hit = pickField(v, tag);
          if (hit) return hit;
        }
      }
    }
    for (const k of keys) {
      const v = source[k];
      if (v && typeof v === 'object') {
        const hit = pickField(v, tag);
        if (hit) return hit;
      }
    }
    return '';
  }
  const text = String(source || '');
  const re = new RegExp(`<[^>]*:?${tag}[^>]*><!\\[CDATA\\[([^\\]]*)\\]\\]></[^>]*:?${tag}[^>]*>|<[^>]*:?${tag}[^>]*>([^<]*)</[^>]*:?${tag}[^>]*>`);
  const m = re.exec(text);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}

/** 在 event 中定位推送内容（对象或 XML 字符串） */
function locatePayload(event) {
  if (!event) return '';
  if (typeof event === 'string') return event;
  if (typeof event.xml === 'string') return event.xml;
  // 云开发消息推送常见包装：event 自身即消息对象，或挂在 data/Message/pushData 下
  if (event.Event || event.event) return event;
  for (const k of ['data', 'Message', 'message', 'pushData', 'body']) {
    if (event[k]) return event[k];
  }
  return event;
}

async function deliver(openid, outTradeNo, wxOrderId, productId) {
  const res = await db.collection('orders').where({ outTradeNo }).limit(1).get();
  const order = res.data && res.data[0];
  if (!order) {
    console.error('[payCallback] 订单不存在:', outTradeNo);
    return false;
  }
  if (order.status === 'paid') return true; // 幂等
  // 档位：优先按订单登记；异常时按道具 ID 反查
  const tier = TIER_BY_PRODUCT[order.tier] ? order.tier : TIER_BY_PRODUCT[productId] || order.tier;
  const now = Date.now();
  await db.collection('orders').doc(order._id).update({
    data: {
      status: 'paid',
      paidAt: now,
      wxOrderId: wxOrderId || '',
      updatedAt: now
    }
  });
  const mRes = await db.collection('members').where({ openid: order.openid || openid }).limit(1).get();
  const member = mRes.data && mRes.data[0];
  if (!member) {
    await db.collection('members').add({
      data: {
        openid: order.openid || openid,
        tier,
        orderId: order._id,
        paidAt: now,
        createdAt: now,
        updatedAt: now
      }
    });
  } else if (RANK[tier] > RANK[member.tier || 'free']) {
    await db.collection('members').doc(member._id).update({
      data: { tier, orderId: order._id, paidAt: now, updatedAt: now }
    });
  }
  console.info('[payCallback] 发货完成 openid =', order.openid || openid, 'tier =', tier);
  return true;
}

exports.main = async (event = {}) => {
  try {
    const payload = locatePayload(event);
    const eventName = pickField(payload, 'Event');
    const outTradeNo = pickField(payload, 'OutTradeNo');
    const openid = pickField(payload, 'OpenId');
    const wxOrderId = pickField(payload, 'MchOrderNo');
    const productId = pickField(payload, 'ProductId');

    console.info('[payCallback] 收到推送:', JSON.stringify(event).slice(0, 400));

    // 非发货推送（其他消息误路由）：应答成功避免无意义重试
    if (eventName && eventName !== 'xpay_goods_deliver_notify') {
      console.warn('[payCallback] 非发货推送事件:', eventName);
      return '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>';
    }
    if (!outTradeNo) {
      console.error('[payCallback] 缺少 OutTradeNo');
      return '<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[MISSING_OUT_TRADE_NO]]></ErrMsg></xml>';
    }
    await deliver(openid, outTradeNo, wxOrderId, productId);
    // 官方要求应答 XML（<ErrCode>0</ErrCode> = 成功；非 0 平台最多重试 15 次）
    return '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>';
  } catch (e) {
    console.error('[payCallback] 处理失败:', e.message);
    // 返回非 0 触发平台重试（最多 15 次）；推送丢失仍有 query_order 查单兜底
    return '<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[INTERNAL_ERROR]]></ErrMsg></xml>';
  }
};
