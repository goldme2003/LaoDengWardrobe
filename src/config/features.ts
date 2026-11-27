/** 功能开关配置（v2.2.0）
 * 集中管理可开关的产品能力：修改后重新构建生效（npm run build:weapp）。
 * 与云函数环境变量无关——此处为前端打包期开关，控制对应功能的入口与展示。 */
export const FEATURES = {
  /**
   * 虚拟支付总开关（v2.0.0 起自 cloud.ts WX_PAY_ENABLED 迁移至此统一管理）。
   * true = 会员页「立即开通/升级」可用；false = 按钮显示「暂未开放」并弹窗说明。
   * 前提：MP 后台已开通虚拟支付、道具已上架（VIP_Tool / SVIP_Tool / SVIP_Upgrade_Tool），
   * 云函数凭据（VP_OFFER_ID / VP_APP_KEY / WX_APP_SECRET）配置完成。
   */
  paymentEnabled: true,
  /**
   * 当季推荐图开关（AI 生成 + 本地示例图兜底）。
   * false = 首页当季推荐卡仅展示标题与「暂未开放」提示，隐藏图组/风格条/生图入口与额度计数。
   */
  seasonalImagesEnabled: true
} as const;
