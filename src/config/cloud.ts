/** 云开发环境配置（PRD 9.3 识别功能）
 * 开通微信云开发后填入环境 ID；留空时识别功能整体禁用（入口不展示、不自动触发）。
 * 云函数密钥存于云函数环境变量，前端不放置任何云服务密钥（方案 R3 强约束）。 */
export const CLOUD_ENV_ID = 'laodengwardrobe-d7fyycr6954804b4';

/** 识别功能是否可用（已配置环境 ID 且当前为微信端） */
export const CLOUD_READY =
  CLOUD_ENV_ID !== '' && process.env.TARO_ENV === 'weapp';
export const RECOGNIZE_AVAILABLE = CLOUD_READY;

/** 云函数名与集合名（与 cloudfunctions/recognizeClothing 保持一致） */
export const RECOGNIZE_FN_NAME = 'recognizeClothing';
/** PRD 9.1 / 9.4 云函数 */
export const WEATHER_FN_NAME = 'weatherProxy';
export const EMPTY_GUIDE_FN_NAME = 'emptyGuide';
/** v1.5.0：明日穿搭推荐（混元按场景选搭 + 兜底） */
export const OUTFIT_RECOMMEND_FN_NAME = 'outfitRecommend';
/** v1.9.0（F-19）：会员中心（getMember / createOrder 微信支付统一下单；支付回调 payCallback，v2.0.0 正式接入） */
export const MEMBER_FN_NAME = 'member';
/**
 * v2.0.2：微信支付开放开关。
 * 根因：当前小程序主体为「个人」，微信平台限制个人主体收款能力（虚拟支付/微信支付均不可开通），
 * 客户端调起 requestPayment 必报「小程序对应支付能力已被限制」——与代码/商户号/集合权限无关。
 * 置 false 时会员页购买按钮显示「暂未开放」并给出说明；小程序升级/迁移为企业（或个体工商户）主体
 * 并开通微信支付 + 虚拟支付后，改回 true 即恢复支付链路（代码与云函数均已就绪，无需其他改动）。
 */
export const WX_PAY_ENABLED = false;
/** v1.13.0：当季推荐图组（混元生图 + 云存储缓存，按季节/性别/年龄段/会员档位差异化） */
export const SEASONAL_FN_NAME = 'seasonalImages';
/** v1.15.0（R-5 M1）：云同步（微信静默登录 / 快照上下行 / 冲突副本 / 删除云端数据 / 照片容量计量） */
export const USER_SYNC_FN_NAME = 'userSync';

/** 月熔断预算（元，与云函数 RECOGNIZE_BUDGET_YUAN 保持一致）与预警阈值 */
export const RECOGNIZE_BUDGET_YUAN = 50;
export const RECOGNIZE_WARN_YUAN = 40;
/** 单次调用成本估算（大模型 0.05 + OCR 0.01 保守取值） */
export const RECOGNIZE_COST_PER_CALL = 0.06;
