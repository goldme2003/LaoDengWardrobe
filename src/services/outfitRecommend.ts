import Taro from '@tarojs/taro';
import { ClothingItem, WeatherInfo } from '@/types';
import { CLOUD_READY, OUTFIT_RECOMMEND_FN_NAME } from '@/config/cloud';
import { SceneId } from '@/services/recommend';

/** v1.5.0：明日穿搭推荐云函数（混元按场景从衣物清单选搭） */
export type OutfitSource = 'hunyuan' | 'fallback';

export interface AiOutfitResult {
  itemIds: string[];
  scene: SceneId;
  advice: string;
  source: OutfitSource;
}

const SCENE_IDS: SceneId[] = ['日常', '通勤', '运动', '正式', '居家', '旅行'];

export const isSceneId = (v: string): v is SceneId => SCENE_IDS.includes(v as SceneId);

interface Params {
  scene: SceneId;
  weather: WeatherInfo;
  items: ClothingItem[];
  gender?: string;
  age?: number | null;
  excludeIds?: string[];
}

/** 调用混元穿搭云函数；不可用/失败时返回 null，由首页回退到本地规则引擎 */
export const requestOutfitRecommend = async (params: Params): Promise<AiOutfitResult | null> => {
  if (!CLOUD_READY) {
    console.info('[OutfitAI] 云环境不可用，使用本地规则引擎');
    return null;
  }
  const day = (params.weather.days && params.weather.days[0]) || params.weather.today;
  try {
    const res = await Taro.cloud.callFunction({
      name: OUTFIT_RECOMMEND_FN_NAME,
      data: {
        action: 'recommend',
        scene: params.scene,
        gender: params.gender,
        age: params.age ?? undefined,
        weather: day
          ? { cond: day.cond, low: day.low, high: day.high }
          : undefined,
        items: params.items.slice(0, 40).map((it) => ({
          id: it.id,
          name: it.name,
          type: it.type,
          layer: it.layer,
          color: it.color,
          material: it.material,
          occasions: it.occasions || []
        })),
        excludeIds: params.excludeIds || []
      }
    });
    const result = (res.result || {}) as {
      code?: string;
      source?: string;
      itemIds?: string[];
      scene?: string;
      advice?: string;
    };
    const itemIds = Array.isArray(result.itemIds) ? result.itemIds.filter((id) => typeof id === 'string') : [];
    if (result.code !== 'OK' || itemIds.length === 0) {
      console.warn('[OutfitAI] 云函数未返回有效搭配：', result.code);
      return null;
    }
    const source: OutfitSource = result.source === 'hunyuan' ? 'hunyuan' : 'fallback';
    const scene: SceneId =
      result.scene && isSceneId(result.scene)
        ? result.scene
        : params.scene === 'all'
          ? '日常'
          : params.scene;
    console.info(`[OutfitAI] 推荐来源 = ${source}，场景 = ${scene}，件数 = ${itemIds.length}`);
    return { itemIds, scene, advice: result.advice || '', source };
  } catch (e) {
    console.warn('[OutfitAI] 云函数调用失败，使用本地规则引擎：', (e as Error).message);
    return null;
  }
};

/** 统一推荐理由格式：城市+明日天气，针对X，可以A + B + C，AI 建议 */
export const composeAiReason = (
  weather: WeatherInfo,
  sceneLabel: string,
  items: ClothingItem[],
  advice: string
): string => {
  const day = (weather.days && weather.days[0]) || weather.today;
  const weatherText = day ? `${weather.city}明日 ${day.low}~${day.high}℃ ${day.cond}` : weather.city;
  const names = items.map((it) => it.name).join(' + ');
  return `${weatherText}，针对${sceneLabel}，可以${names}${advice ? `，${advice}` : ''}`;
};
