/** 功能开关配置（v2.2.0）
 * 集中管理可开关的产品能力：修改后重新构建生效（npm run build:weapp）。
 * 与云函数环境变量无关——此处为前端打包期开关，控制对应功能的入口与展示。 */
export const FEATURES = {
  /**
   * 支付功能总开关——v2.2.1（GLM模型版）已关闭。
   * 关闭期间客户端不含任何支付/退款调用入口（下单、拉起支付、档位轮询、查单自愈、售后退款均已移除），
   * 会员档位恢复为测试态本地自由切换；如需重新开放支付，需从 untested 分支恢复支付流程后再置回 true。
   */
  paymentEnabled: false,
  /**
   * 当季推荐图开关（GLM 模型生成 + 本地示例图兜底）。
   * false = 首页当季推荐卡仅展示标题与「暂未开放」提示，隐藏图组/风格条/生图入口与额度计数。
   * 生图模型在云函数 seasonalImages 中配置（智谱 GLM-IMAGE，密钥 GLM_API_KEY）。
   */
  seasonalImagesEnabled: true
} as const;
