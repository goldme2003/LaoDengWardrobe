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

/** 月熔断预算（元，与云函数 RECOGNIZE_BUDGET_YUAN 保持一致）与预警阈值 */
export const RECOGNIZE_BUDGET_YUAN = 50;
export const RECOGNIZE_WARN_YUAN = 40;
/** 单次调用成本估算（大模型 0.05 + OCR 0.01 保守取值） */
export const RECOGNIZE_COST_PER_CALL = 0.06;
