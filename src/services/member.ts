import Taro from '@tarojs/taro';
import { CLOUD_READY, MEMBER_FN_NAME } from '@/config/cloud';
import { MemberTier } from '@/services/entitlement';

/** v1.9.0（F-19）：会员云函数调用封装
 * getMember：查询云端会员档位（未登录/无记录返回 free）；
 * createOrder：登记开通订单。当前微信支付商户号未开通，云端直接返回
 * PAY_UNAVAILABLE，客户端提示「支付暂未开通」；支付能力上线后按订单继续流程。 */

export interface CloudMemberResult {
  code: string;
  tier?: MemberTier;
  message?: string;
}

export const callMember = async (
  action: 'getMember' | 'createOrder',
  tier?: MemberTier
): Promise<CloudMemberResult | null> => {
  if (!CLOUD_READY) return null;
  try {
    const res = await Taro.cloud.callFunction({
      name: MEMBER_FN_NAME,
      data: { action, tier }
    });
    return (res.result || {}) as CloudMemberResult;
  } catch (e) {
    console.warn(`[Member] 云函数 ${action} 调用失败：`, (e as Error).message);
    return null;
  }
};
