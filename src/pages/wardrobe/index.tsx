import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro, { usePullDownRefresh, useDidShow, usePageScroll, useReachBottom } from '@tarojs/taro';
import WeatherCard from '@/components/WeatherCard';
import FilterBar, { Filters, EMPTY_FILTERS } from '@/components/FilterBar';
import AccordionList, { AccordionGroup } from '@/components/AccordionList';
import TypeSideBar from '@/components/TypeSideBar';
import ItemCard from '@/components/ItemCard';
import EmptyState from '@/components/EmptyState';
import RecommendCard, { OutfitVM } from '@/components/RecommendCard';
import SeasonalCard from '@/components/SeasonalCard';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { getWeather, cityFromLocation } from '@/services/weather';
import { getEmptyGuide } from '@/services/emptyGuide';
import { buildOutfits, SCENE_OPTIONS, SceneId, SceneOption, RecommendOutfit } from '@/services/recommend';
import { requestOutfitRecommend, composeAiReason } from '@/services/outfitRecommend';
import { DEFAULT_CITY } from '@/data/mockWeather';
import { ALL_COLOR_PRESETS, MATERIAL_PRESETS, themeVarsOf, getThemeById } from '@/data/presets';
import { tierOf, tripQuota, dailyOutfitsOf, todayKey } from '@/services/entitlement';
import { ClothingItem, WeatherInfo } from '@/types';
import styles from './index.module.scss';

/** 分组类型顺序（自定义类型排在预设之后） */
const PLAN_TYPE_ORDER = ['上装', '外套', '裤装', '裙装', '连衣裙', '内衣', '家居服', '鞋履', '配饰', '其他'];
// v1.17.1：备选套序号中文（超出后回落数字）
const PLAN_SET_CN = ['一', '二', '三', '四', '五'];

/** v2.2.5：套装签名（衣物 id 排序后拼接）——用于剔除衣物完全相同、仅场景标签不同的重复套装 */
const outfitSig = (ids: string[]): string => [...ids].sort().join('|');

/** v1.4.3：小程序启动标记（由 app.tsx useLaunch 写入），首次进入首页时自动执行穿搭推荐 */
const APP_LAUNCH_FLAG = 'ldw_app_launched';

/** v1.7.0：启动定位刷新标记（由 app.tsx useLaunch 写入），首次进入首页时自动定位并刷新城市 */
const APP_GEO_FLAG = 'ldw_geo_refresh';

/** 衣柜首页（PRD FR-06/FR-09）：天气 + 衣橱切换 + 筛选 + 手风琴分组衣物列表 */
const WardrobePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const city = useWardrobeStore((s) => s.city);
  // v1.8.0（F-17）：城市来源（located = 启动自动定位 / manual = 手动选择），用于天气卡定位图标
  const citySource = useWardrobeStore((s) => s.citySource);
  const customOptions = useWardrobeStore((s) => s.customOptions);
  const setCurrentWardrobe = useWardrobeStore((s) => s.setCurrentWardrobe);
  const toggleFavorite = useWardrobeStore((s) => s.toggleFavorite);
  const setCity = useWardrobeStore((s) => s.setCity);
  // v0.6：明日穿搭勾选（按衣橱归属）
  const tomorrowOutfits = useWardrobeStore((s) => s.tomorrowOutfits);
  const toggleTomorrowItem = useWardrobeStore((s) => s.toggleTomorrowItem);
  const adoptTomorrowItems = useWardrobeStore((s) => s.adoptTomorrowItems);
  // v0.6：「我的」页跳转携带的筛选预设
  const wardrobeFilterPreset = useWardrobeStore((s) => s.wardrobeFilterPreset);
  const consumeWardrobeFilterPreset = useWardrobeStore((s) => s.consumeWardrobeFilterPreset);
  // v1.9.0（F-19）：会员档位与权益用量
  const memberTier = useWardrobeStore((s) => s.memberTier);
  const memberUsage = useWardrobeStore((s) => s.memberUsage);
  const recordSeasonalView = useWardrobeStore((s) => s.recordSeasonalView);
  const recordTripUse = useWardrobeStore((s) => s.recordTripUse);
  // v1.10.0：明日推荐当天缓存（按衣橱隔离，跨天自动重置）
  const dailyOutfitsMap = useWardrobeStore((s) => s.dailyOutfits);
  const appendDailyOutfit = useWardrobeStore((s) => s.appendDailyOutfit);
  // v2.2.5：今日备选套装——长按移出全部衣物后记住「已移出」，避免渲染时回落成整套预览
  const [movedOutSets, setMovedOutSets] = useState<string[]>([]);
  // v1.12.0：自定义搭配场景（「＋ 场景」手输入库，如 相亲/约会/婚礼）
  const customScenes = useWardrobeStore((s) => s.customScenes);
  const addCustomScene = useWardrobeStore((s) => s.addCustomScene);
  const removeCustomScene = useWardrobeStore((s) => s.removeCustomScene);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const [weatherTick, setWeatherTick] = useState(0);
  // v1.8.0（F-18）：最近一次天气请求对应的城市——城市切换后、新天气返回前视为「过期」，
  // 期间旧城市的推荐不展示，避免推荐与天气卡城市不一致
  const [weatherCity, setWeatherCity] = useState('');
  // v0.6：明日穿搭勾选模式
  const [planMode, setPlanMode] = useState(false);
  // v0.7：手风琴分组收起状态（key = 类型名，true = 收起；不在表中 = 展开，默认全部展开）
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  // v1.1：点击页内「切换衣橱」按钮弹出的衣橱切换弹层
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // v1.1：侧边标签栏选中类型（随滚动联动/手风琴展开收起同步更新）
  const [activeType, setActiveType] = useState('');
  // v1.4.1：搭配场景（仅预设选项，不支持自由输入）
  const [scene, setScene] = useState<SceneId>('all');
  // v1.6.1：出差模式
  const [mode, setMode] = useState<'local' | 'trip'>('local');
  const [tripCity, setTripCity] = useState<string>('');

  // 滚动联动状态（用 ref，避免高频渲染）
  const lastScrollTop = useRef(0);
  const lastManualTs = useRef(0);
  // v1.1：侧边栏选中态同步独立节流
  const lastSyncTs = useRef(0);
  const windowHeight = useRef(667);
  useEffect(() => {
    try {
      windowHeight.current = Taro.getSystemInfoSync().windowHeight || 667;
    } catch (e) {
      // 忽略，保留默认值
    }
  }, []);

  const activeCity =
    mode === 'trip'
      ? tripCity || city || DEFAULT_CITY  // 出差模式优先 tripCity，空则回退当地 city
      : city || DEFAULT_CITY;

  // v1.6.1：自动定位——腾讯位置服务坐标 → 逆地理反查城市
  // v1.7.0：改为「每次冷启动首次进入首页时都定位刷新」，无论本地是否已有城市，
  // 保证用户位置变化后再进入小程序时城市与天气均为最新；
  // 用户本次会话内手动选择的城市不会被覆盖（定位只在启动时执行一次）
  // v1.10.0：抽取为 refreshLocation，供冷启动与下拉刷新共用（问题1：下拉刷新后回到定位城市）
  const refreshLocation = useCallback(() => {
    Taro.getLocation({
      type: 'gcj02',
      success: async (res) => {
        try {
          const locCity = await cityFromLocation(res.latitude, res.longitude);
          if (!locCity) return;
          const cur = useWardrobeStore.getState();
          // 城市变化，或此前为手动选城时，刷新为定位来源（恢复 📍 定位图标）
          if (locCity !== cur.city || cur.citySource !== 'located') {
            console.info('[Wardrobe] 定位刷新城市：', cur.city || '(空)', '→', locCity);
            setCity(locCity, 'located');
          }
        } catch (e) {
          console.warn('[Wardrobe] 逆地理失败：', (e as Error).message);
        }
      },
      fail: (err) => {
        console.info('[Wardrobe] 用户未授权定位或定位失败，保留当前城市', err?.errMsg || '');
      }
    });
  }, [setCity]);

  useDidShow(() => {
    try {
      if (!Taro.getStorageSync(APP_GEO_FLAG)) return;
      Taro.removeStorageSync(APP_GEO_FLAG);
      refreshLocation();
    } catch (e) {
      console.warn('[Wardrobe] 读取定位刷新标记失败', e);
    }
  });

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherFailed(false);
    setWeatherCity(activeCity);
    try {
      const info = await getWeather(activeCity);
      setWeather(info);
    } catch (e) {
      console.error('[Wardrobe] 天气加载失败', e);
      setWeatherFailed(true);
    } finally {
      setWeatherLoading(false);
    }
  }, [activeCity]);

  // v1.7.0：城市变化（含启动自动定位刷新）后自动重载天气——
  // 修复「定位刷新了 city 但天气仍停留在旧城市/默认城市」的问题；
  // 首次挂载由 useDidShow 加载，此处跳过避免重复请求
  const cityLoadInited = useRef(false);
  useEffect(() => {
    if (!cityLoadInited.current) {
      cityLoadInited.current = true;
      return;
    }
    loadWeather();
  }, [loadWeather]);

  // 进入页面与下拉刷新时更新天气
  useDidShow(() => {
    loadWeather();
  });
  // v1.10.0（问题1）：下拉刷新时重新定位——回到定位城市（📍 图标）并刷新天气；
  // 推荐基于当天缓存不重复生成，见下方「明日推荐当天缓存」
  usePullDownRefresh(() => {
    refreshLocation();
    loadWeather();
    setTimeout(() => Taro.stopPullDownRefresh(), 800);
  });

  const customOf = (dimension: 'color' | 'material') =>
    customOptions.filter((o) => o.dimension === dimension).map((o) => o.value);

  // 当前衣橱风格主题（v0.5 用户意见 2：整体风格联动，含底色/卡片/文本/圆角）
  const currentWardrobe = useMemo(
    () => wardrobes.find((w) => w.id === currentWardrobeId),
    [wardrobes, currentWardrobeId]
  );

  // v1.11.0：筛选选项含历史预设色（8 种新预设 + 旧预设），保证旧数据可按颜色筛选
  const colorOptions = useMemo(() => [...ALL_COLOR_PRESETS.map((c) => c.name), ...customOf('color')], [customOptions]);
  const materialOptions = useMemo(() => [...MATERIAL_PRESETS, ...customOf('material')], [customOptions]);

  const colorHexMap = useMemo(() => ALL_COLOR_PRESETS.reduce((m, c) => ({ ...m, [c.name]: c.hex }), {}), []);

  const currentItems = useMemo(
    () =>
      items
        .filter((it) => it.wardrobeId === currentWardrobeId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [items, currentWardrobeId]
  );

  const filtered = useMemo(() => {
    return currentItems.filter((it: ClothingItem) => {
      if (filters.color && it.color !== filters.color) return false;
      if (filters.material && it.material !== filters.material) return false;
      if (filters.seasons.length > 0 && !filters.seasons.some((s) => it.seasons.includes(s))) return false;
      if (filters.onlyFavorite && !it.favorite) return false;
      return true;
    });
  }, [currentItems, filters]);

  const counts = useMemo(
    () =>
      wardrobes.map((w) => ({
        id: w.id,
        name: w.name,
        count: items.filter((it) => it.wardrobeId === w.id).length,
        color: w.color
      })),
    [wardrobes, items]
  );

  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  // v1.9.0（F-19）：当前会员权益配置（衣橱数/推荐档位/当季图组/出差次数等）
  const tierCfg = useMemo(() => tierOf(memberTier), [memberTier]);
  const goMember = useCallback(() => Taro.navigateTo({ url: '/pages/member/index' }), []);

  // v1.9.0（F-19）：出差模式门控——普通版无出差推荐；v1.19.1：VIP 2 次/月（用尽提示升级）；SVIP 无限次
  const handleSwitchMode = useCallback(
    (m: 'local' | 'trip') => {
      if (m === 'trip') {
        const q = tripQuota(memberTier);
        if (q.kind === 'blocked') {
          Taro.showModal({
            title: '出差推荐为会员权益',
            content: '普通版不含出差推荐。升级 VIP/SVIP 后，可按目的地天气挑选携带穿搭。',
            confirmText: '去升级',
            success: (r) => {
              if (r.confirm) goMember();
            }
          });
          return;
        }
        if (q.kind === 'counted' && memberUsage.tripUsed >= q.limit) {
          Taro.showModal({
            title: '本月出差次数已用完',
            content: `VIP 每月可使用 ${q.limit} 次出差推荐，本月额度已用完；升级 SVIP 可无限次使用。`,
            confirmText: '去升级',
            success: (r) => {
              if (r.confirm) goMember();
            }
          });
          return;
        }
        if (q.kind === 'counted') recordTripUse();
      }
      setMode(m);
      setWeatherTick((t) => t + 1);
    },
    [memberTier, memberUsage.tripUsed, recordTripUse, goMember]
  );

  // v0.7.3：tabBar 选中色/文字色随当前衣橱主题联动（微信端经 setTabBarStyle 动态设置；
  // H5 端不支持时静默失败可接受。注意：tabBar 图标为固定 PNG，无法逐主题重着色，属已知限制）
  useEffect(() => {
    const theme = getThemeById(currentWardrobe?.themeId);
    Taro.setTabBarStyle({
      color: theme.textSecondary,
      selectedColor: theme.primary
    }).catch(() => {
      console.info('[Wardrobe] setTabBarStyle 未生效（可能为 H5 端），已跳过');
    });
  }, [currentWardrobe?.themeId, currentWardrobeId]);

  // v0.6：消费「我的」页跳转携带的筛选预设（喜爱衣物）
  useEffect(() => {
    if (wardrobeFilterPreset === 'favorite') {
      setFilters({ ...EMPTY_FILTERS, onlyFavorite: true });
      consumeWardrobeFilterPreset();
    }
  }, [wardrobeFilterPreset, consumeWardrobeFilterPreset]);

  // 切换衣橱后重置分组展开状态与滚动联动状态
  useEffect(() => {
    setCollapsedMap({});
    lastScrollTop.current = 0;
    activeTypeRef.current = '';
    setActiveType('');
    // v2.2.5：切换衣橱后重置「已移出」的备选套装标记
    setMovedOutSets([]);
  }, [currentWardrobeId]);

  // v0.6：明日穿搭已选件数（剔除已删除衣物）
  const tomorrowIds = useMemo(
    () => (tomorrowOutfits[currentWardrobeId] || []).filter((id) => currentItems.some((it) => it.id === id)),
    [tomorrowOutfits, currentWardrobeId, currentItems]
  );

  // v0.6：明日穿搭分组（按类型顺序，自定义类型排后）
  const planGroups = useMemo(() => {
    const types = Array.from(new Set(currentItems.map((it) => it.type)));
    const ordered = [
      ...PLAN_TYPE_ORDER.filter((t) => types.includes(t)),
      ...types.filter((t) => !PLAN_TYPE_ORDER.includes(t))
    ];
    return ordered
      .map((t) => ({ type: t, list: currentItems.filter((it) => it.type === t) }))
      .filter((g) => g.list.length > 0);
  }, [currentItems]);

  // v0.7：列表手风琴分组（无筛选时生效，分组顺序 = 预设类型顺序 + 自定义类型排后）
  const listGroups = useMemo<AccordionGroup[]>(() => {
    const types = Array.from(new Set(filtered.map((it) => it.type)));
    const ordered = [
      ...PLAN_TYPE_ORDER.filter((t) => types.includes(t)),
      ...types.filter((t) => !PLAN_TYPE_ORDER.includes(t))
    ];
    return ordered
      .map((t) => ({ type: t, list: filtered.filter((it) => it.type === t) }))
      .filter((g) => g.list.length > 0);
  }, [filtered]);

  const isFiltering =
    filters.color || filters.material || filters.seasons.length > 0 || filters.onlyFavorite;
  // v0.7：手风琴分组展示条件（无筛选 + 非明日穿搭模式 + 有衣物）
  const showAccordion = !planMode && !isFiltering && currentItems.length > 0 && filtered.length > 0;

  // v1.4.0（B/D 模块）：规则引擎推荐（普通版精简推荐与云函数失败的本地兜底来源）；
  // v1.10.0：本地引擎不再直接驱动卡片，统一写入「明日推荐当天缓存」后展示
  // v1.8.0（F-18）：城市切换后天气重载完成前（weatherCity !== activeCity）视为过期，不基于旧城市天气出推荐
  const weatherStale = weatherCity !== activeCity;

  // ===== v1.10.0（问题3/4）：明日推荐按档位每日生成 1/2/5 套，当天缓存、次日重置，左右滑动展示 =====
  const cachedEntries = useMemo(
    () => dailyOutfitsOf(dailyOutfitsMap, currentWardrobeId),
    [dailyOutfitsMap, currentWardrobeId]
  );
  const outfitQuota = tierCfg.dailyOutfits; // v1.19.1：普通 0 / VIP 2 / SVIP 5
  const quotaReached = cachedEntries.length >= outfitQuota;

  // ===== v1.12.0：场景条扩展——预设 + 自定义场景、已推荐场景高亮、点标签跳转对应缓存套 =====
  const sceneOptions = useMemo<SceneOption[]>(
    () => [
      ...SCENE_OPTIONS,
      ...customScenes.map((s) => ({ id: s as SceneId, label: s, keywords: [] }))
    ],
    [customScenes]
  );
  // 场景标签文案：预设取 label，自定义场景即场景名（云函数返回场景兜底同规则）
  const sceneLabelOf = useCallback(
    (id: SceneId) => {
      const hit = sceneOptions.find((s) => s.id === id);
      return hit ? hit.label : id === 'all' ? '不限' : (id as string);
    },
    [sceneOptions]
  );
  // 今日已生成过推荐的场景（去重），用于场景按钮绿点高亮
  const recommendedScenes = useMemo<SceneId[]>(
    () => Array.from(new Set(cachedEntries.map((e) => e.scene as SceneId))),
    [cachedEntries]
  );

  const itemMap = useMemo(() => new Map(currentItems.map((it) => [it.id, it])), [currentItems]);

  const cachedVMs = useMemo<OutfitVM[]>(() => {
    // v2.2.5：按衣物组合去重——同一批衣物即使场景标签不同（如「日常」与「旅行」）只保留首套，
    // 修复「多套备选衣物完全一样」；历史缓存中已有的重复套在展示层一并剔除
    const seen = new Set<string>();
    return cachedEntries
      .map((e) => ({
        id: e.id,
        scene: e.scene as SceneId,
        sceneLabel: e.sceneLabel,
        reason: e.reason,
        source: e.source,
        items: e.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as ClothingItem[]
      }))
      .filter((vm) => {
        if (vm.items.length === 0) return false;
        const sig = outfitSig(vm.items.map((it) => it.id));
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });
  }, [cachedEntries, itemMap]);

  // v2.2.5：当前仍展示的备选套装（长按移出整套后隐藏；全部移出时提示「无备选套装」）
  const visibleSets = useMemo(
    () => cachedVMs.filter((vm) => !movedOutSets.includes(vm.id)),
    [cachedVMs, movedOutSets]
  );

  // v1.18.0：自选套——明日穿搭中不属于任何备选套的衣物聚合为一套
  // （来源：衣橱长按加入或手动勾选；与备选套并列展示，点击卡片整体取消）
  const customSetItems = useMemo(() => {
    const inSets = new Set<string>();
    cachedVMs.forEach((vm) => vm.items.forEach((it) => inSets.add(it.id)));
    return tomorrowIds
      .filter((id) => !inSets.has(id))
      .map((id) => itemMap.get(id))
      .filter((it): it is ClothingItem => !!it);
  }, [tomorrowIds, cachedVMs, itemMap]);

  // v1.10.0（问题3）：普通版建议只依据衣橱主人性别、年龄与明日天气，文案简短
  const basicReason = useCallback(
    (o: RecommendOutfit) => {
      const who =
        currentWardrobe?.gender === 'female'
          ? '女士'
          : currentWardrobe?.gender === 'male'
            ? '男士'
            : '主人';
      return `${who}${currentWardrobe?.age ? `（${currentWardrobe.age}岁）` : ''}：${o.reason}`;
    },
    [currentWardrobe?.gender, currentWardrobe?.age]
  );

  const appendLocalOutfit = useCallback(
    (o: RecommendOutfit) => {
      appendDailyOutfit(currentWardrobeId, {
        scene: o.scene,
        sceneLabel: o.sceneLabel,
        reason: basicReason(o),
        itemIds: o.items.map((it) => it.id),
        source: 'fallback'
      });
    },
    [appendDailyOutfit, currentWardrobeId, basicReason]
  );

  // 生成一套并写入今日缓存：普通版走本地规则引擎（不调云函数）；
  // VIP/SVIP 调混元（plus = AI 详细建议 / full = 综合全衣橱深度建议），云函数不可用或失败时本地兜底，仍计入当日缓存
  const [genLoading, setGenLoading] = useState(false);
  // v1.13.0：云端生成耗时长，按阶段提示进度，避免用户误以为页面假死
  const [genHint, setGenHint] = useState('');
  useEffect(() => {
    if (!genLoading) {
      setGenHint('');
      return;
    }
    setGenHint('正在连接 AI 造型师…');
    const t1 = setTimeout(() => setGenHint('正在结合天气、性别与年龄挑选搭配…'), 3000);
    const t2 = setTimeout(() => setGenHint('云端响应较慢，正在准备本地推荐…'), 12000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [genLoading]);
  // 当前滑动到的套（采纳 / 换一件作用于该套）；v1.12.0 上移声明供生成后跳转最新套使用
  const [outfitIdx, setOutfitIdx] = useState(0);
  const genReqRef = useRef(0);
  const aiLevel: 'plus' | 'full' = tierCfg.weatherLevel === 'full' ? 'full' : 'plus';
  const gender = currentWardrobe?.gender;
  const age = currentWardrobe?.age ?? null;

  // v1.12.0：生成成功后跳转到最新缓存套（点场景标签生成新套时立刻展示新套）
  const jumpToLatest = useCallback(() => {
    const cache = useWardrobeStore.getState().dailyOutfits[currentWardrobeId];
    if (cache && cache.day === todayKey()) {
      setOutfitIdx(Math.max(cache.list.length - 1, 0));
    }
  }, [currentWardrobeId]);

  // ===== v1.16.0：空衣橱明日穿搭建议——按衣橱主人性别/年龄（结合明日天气）生成，
  // 每次生成消耗 1 次当日推荐额度（itemIds 为空的缓存条目，计入「今日 x/y 套」） =====
  const adviceEntries = useMemo(() => cachedEntries.filter((e) => e.itemIds.length === 0), [cachedEntries]);
  const latestAdvice = adviceEntries.length > 0 ? adviceEntries[adviceEntries.length - 1] : null;
  const adviceLeft = outfitQuota - cachedEntries.length;
  const [adviceLoading, setAdviceLoading] = useState(false);
  const adviceGender = currentWardrobe?.gender;
  const adviceAge = currentWardrobe?.age ?? null;

  const genEmptyAdvice = useCallback(async () => {
    if (adviceLoading) return;
    if (cachedEntries.length >= outfitQuota) {
      // 额度用尽：与场景切换同口径提示（SVIP 提示明日再来，其余引导升级）
      if (memberTier === 'svip') {
        Taro.showToast({ title: `今日 ${outfitQuota} 套已生成完毕，明天再来看新搭配`, icon: 'none' });
      } else {
        const upTier = memberTier === 'free' ? 'VIP' : 'SVIP';
        const upQuota = tierOf(memberTier === 'free' ? 'vip' : 'svip').dailyOutfits;
        Taro.showModal({
          title: '今日推荐已达上限',
          content: `当前等级每日可生成 ${outfitQuota} 套明日推荐，今日额度已用完。升级 ${upTier} 每日可生成 ${upQuota} 套。`,
          confirmText: '去升级',
          success: (r) => {
            if (r.confirm) goMember();
          }
        });
      }
      return;
    }
    setAdviceLoading(true);
    try {
      // 天气失败时传 null，getEmptyGuide 走无天气上下文流程，仍按性别/年龄生成
      const res = await getEmptyGuide(adviceGender, adviceAge, weatherFailed ? null : weather);
      appendDailyOutfit(currentWardrobeId, {
        scene: 'all',
        sceneLabel: '穿搭建议',
        reason: res.tip,
        itemIds: [],
        source: res.source
      });
      jumpToLatest();
      console.info(`[Wardrobe] 空衣橱建议已生成（消耗 1 次推荐）, 来源 = ${res.source}`);
    } finally {
      setAdviceLoading(false);
    }
  }, [
    adviceLoading,
    cachedEntries.length,
    outfitQuota,
    memberTier,
    goMember,
    adviceGender,
    adviceAge,
    weather,
    weatherFailed,
    appendDailyOutfit,
    currentWardrobeId,
    jumpToLatest
  ]);

  const generateOutfit = useCallback(
    async (excludeIds: string[] = [], sceneOverride?: SceneId) => {
      if (!weather || weatherFailed || weatherStale || currentItems.length === 0) return;
      const reqId = ++genReqRef.current;
      setGenLoading(true);
      const sceneUsed = sceneOverride || scene;
      // v2.2.5：已有套装的衣物签名——新生成的搭配若与已有完全相同（仅场景标签不同）则视为重复
      const existingSigs = new Set(
        cachedEntries.filter((e) => e.itemIds.length > 0).map((e) => outfitSig(e.itemIds))
      );
      /** 从本地规则引擎结果中取第一套与已有套装不同的搭配（衣物过少时可能没有） */
      const firstNewLocal = (): RecommendOutfit | null => {
        const base = buildOutfits(weather, currentItems, sceneUsed);
        return base.find((o) => !existingSigs.has(outfitSig(o.items.map((it) => it.id)))) || null;
      };
      try {
        if (tierCfg.weatherLevel === 'basic') {
          const pick = firstNewLocal();
          if (pick && reqId === genReqRef.current) {
            appendLocalOutfit(pick);
            jumpToLatest();
          } else if (reqId === genReqRef.current) {
            Taro.showToast({ title: '衣橱衣物较少，暂时无法生成新的不同搭配', icon: 'none', duration: 2500 });
          }
          return;
        }
        const res = await requestOutfitRecommend({
          scene: sceneUsed,
          weather,
          items: currentItems,
          gender,
          age,
          excludeIds,
          level: aiLevel
        });
        if (res && reqId === genReqRef.current) {
          const picked = res.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as ClothingItem[];
          // v2.2.5：AI 返回的衣物与已有套装完全相同 → 视为重复，转本地规则引擎另取一套
          if (picked.length && existingSigs.has(outfitSig(picked.map((it) => it.id)))) {
            throw new Error('OUTFIT_DUPLICATE');
          }
          if (picked.length) {
            const sceneLabel = sceneLabelOf(res.scene);
            appendDailyOutfit(currentWardrobeId, {
              scene: res.scene,
              sceneLabel,
              reason: composeAiReason(weather, sceneLabel, picked, res.advice),
              itemIds: picked.map((it) => it.id),
              source: res.source
            });
            jumpToLatest();
            console.info(`[Wardrobe] 明日推荐已缓存, 来源 = ${res.source}, 场景 = ${sceneLabel}`);
            return;
          }
        }
        throw new Error('OUTFIT_EMPTY');
      } catch (e) {
        // 云函数未返回 / 出错 / 与已有套装重复：本地规则引擎兜底（v1.8.1 口径，不显示「兜底推荐」角标）
        const pick = firstNewLocal();
        if (pick && reqId === genReqRef.current) {
          appendLocalOutfit(pick);
          jumpToLatest();
        } else if (reqId === genReqRef.current) {
          // v2.2.5：衣物过少、本地也生成不出不同搭配时明确提示，且不占用当日套数
          console.warn('[Wardrobe] 明日推荐生成失败：', (e as Error).message);
          Taro.showToast({ title: '衣橱衣物较少，暂时无法生成新的不同搭配', icon: 'none', duration: 2500 });
        }
      } finally {
        if (reqId === genReqRef.current) setGenLoading(false);
      }
    },
    [weather, weatherFailed, weatherStale, currentItems, scene, tierCfg.weatherLevel, gender, age, aiLevel, itemMap, appendLocalOutfit, appendDailyOutfit, currentWardrobeId, sceneLabelOf, jumpToLatest, cachedEntries]
  );
  const generateRef = useRef(generateOutfit);
  useEffect(() => {
    generateRef.current = generateOutfit;
  }, [generateOutfit]);

  // 首套自动生成：今日缓存为空且具备生成条件时执行；刷新 / 重复进入页面命中当天缓存不再生成
  const recommendReady = !!weather && !weatherFailed && !weatherStale && currentItems.length > 0;
  useEffect(() => {
    if (!recommendReady || genLoading || cachedEntries.length > 0) return;
    generateOutfit();
  }, [recommendReady, genLoading, cachedEntries.length, generateOutfit]);

  // ===== 出差模式：保持实时生成（不占用每日明日推荐套数） =====
  const [tripOutfit, setTripOutfit] = useState<(RecommendOutfit & { source: 'hunyuan' | 'fallback' }) | null>(null);
  const [tripLoading, setTripLoading] = useState(false);
  const [tripNonce, setTripNonce] = useState(0);
  const tripExcludeRef = useRef<string[]>([]);
  const tripReqRef = useRef(0);
  useEffect(() => {
    if (mode !== 'trip' || !recommendReady || !weather) {
      setTripOutfit(null);
      setTripLoading(false);
      return;
    }
    const reqId = ++tripReqRef.current;
    let alive = true;
    setTripLoading(true);
    setTripOutfit(null);
    // 「换一件」排除上一次组合：只对本次请求生效，用后即清空
    const excludeIds = tripExcludeRef.current;
    tripExcludeRef.current = [];
    requestOutfitRecommend({ scene, weather, items: currentItems, gender, age, excludeIds, level: aiLevel })
      .then((res) => {
        if (!alive || reqId !== tripReqRef.current || !res) return;
        const picked = res.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as ClothingItem[];
        if (!picked.length) return;
        const sceneLabel = sceneLabelOf(res.scene);
        setTripOutfit({
          items: picked,
          scene: res.scene,
          sceneLabel,
          reason: composeAiReason(weather, sceneLabel, picked, res.advice),
          source: res.source
        });
      })
      .catch((e) => console.warn('[Wardrobe] 出差推荐生成失败：', (e as Error).message))
      .finally(() => {
        if (alive && reqId === tripReqRef.current) setTripLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mode, recommendReady, weather, currentItems, scene, gender, age, tripNonce, aiLevel, itemMap, sceneLabelOf]);

  // 本地规则引擎第一套：出差模式云函数失败时的兜底展示
  const localOutfit = useMemo(
    () =>
      weather && !weatherFailed && !weatherStale
        ? buildOutfits(weather, currentItems, scene)[0] || null
        : null,
    [weather, weatherFailed, weatherStale, currentItems, scene]
  );

  // 卡片展示模型：当地模式 = 今日缓存（1/2/5 套，Swiper 左右滑动）；出差模式 = 实时生成 1 套（失败退本地）
  const cardOutfits = useMemo<OutfitVM[]>(() => {
    if (mode === 'trip') {
      if (tripOutfit) {
        return [
          {
            id: 'trip',
            scene: tripOutfit.scene,
            sceneLabel: tripOutfit.sceneLabel,
            reason: tripOutfit.reason,
            items: tripOutfit.items,
            source: tripOutfit.source
          }
        ];
      }
      return localOutfit
        ? [
            {
              id: 'local-trip',
              scene: localOutfit.scene,
              sceneLabel: localOutfit.sceneLabel,
              reason: localOutfit.reason,
              items: localOutfit.items,
              source: 'fallback'
            }
          ]
        : [];
    }
    return cachedVMs;
  }, [mode, tripOutfit, localOutfit, cachedVMs]);

  const currentOutfit = cardOutfits[Math.min(outfitIdx, Math.max(cardOutfits.length - 1, 0))];
  const outfitAdopted = !!currentOutfit && currentOutfit.items.every((it) => tomorrowIds.includes(it.id));

  const handleShuffle = useCallback(() => {
    // 出差模式：排除当前组合重新请求混元
    if (mode === 'trip') {
      if (tripOutfit) tripExcludeRef.current = tripOutfit.items.map((it) => it.id);
      setTripNonce((n) => n + 1);
      return;
    }
    if (genLoading) return;
    // v1.10.0：每日套数用尽后不再生成，统一展示今日缓存
    if (quotaReached) {
      Taro.showToast({ title: `今日 ${outfitQuota} 套已生成完毕，明天再来看新搭配`, icon: 'none' });
      return;
    }
    const cur = cardOutfits[outfitIdx] || cardOutfits[cardOutfits.length - 1];
    generateRef.current(cur ? cur.items.map((it) => it.id) : []);
  }, [mode, tripOutfit, genLoading, quotaReached, outfitQuota, cardOutfits, outfitIdx]);

  const handleAdopt = useCallback(() => {
    if (!currentOutfit) return;
    adoptTomorrowItems(currentOutfit.items.map((it) => it.id));
    Taro.showToast({ title: '已加入明日穿搭', icon: 'success' });
  }, [currentOutfit, adoptTomorrowItems]);

  // v1.12.0：场景切换/点击——
  // ① 该场景今日已有推荐 → 直接跳转展示对应缓存套（高亮场景可回看，不重复生成）；
  // ② 今日套数未用尽 → 按新场景生成一套（计入当日套数）；
  // ③ 已用尽且该场景无推荐 → 按会员档位提示「已达上限」并引导升级（SVIP 仅提示上限）
  const handleSelectScene = useCallback(
    (next: SceneId) => {
      // v1.13.0：生成中忽略场景切换，避免连点触发多次云端请求
      if (genLoading) return;
      // 已有缓存的场景：跳转到第一套该场景的缓存方案（含当前已选场景的重复点击回看）
      const existIdx = cachedVMs.findIndex((vm) => vm.scene === next);
      if (existIdx >= 0) {
        setScene(next);
        setOutfitIdx(existIdx);
        return;
      }
      if (next === scene) return;
      setScene(next);
      if (mode === 'trip') return; // 出差模式 effect 依赖 scene 自动重生成
      if (!recommendReady) return;
      if (quotaReached) {
        if (memberTier === 'svip') {
          Taro.showToast({ title: `今日 ${outfitQuota} 套已生成完毕，明天再来看新搭配`, icon: 'none' });
        } else {
          const upTier = memberTier === 'free' ? 'VIP' : 'SVIP';
          const upQuota = tierOf(memberTier === 'free' ? 'vip' : 'svip').dailyOutfits;
          Taro.showModal({
            title: '今日推荐已达上限',
            content: `当前等级每日可生成 ${outfitQuota} 套明日推荐，今日额度已用完。升级 ${upTier} 每日可生成 ${upQuota} 套。`,
            confirmText: '去升级',
            success: (r) => {
              if (r.confirm) goMember();
            }
          });
        }
        return;
      }
      setTimeout(() => generateRef.current([], next), 0);
    },
    [scene, mode, recommendReady, quotaReached, outfitQuota, memberTier, cachedVMs, goMember, genLoading]
  );

  // v1.4.3：小程序启动后首次进入首页，自动执行穿搭推荐
  // v1.10.0：首套由「今日缓存为空自动生成」effect 负责，这里仅消费启动标记
  useDidShow(() => {
    try {
      if (Taro.getStorageSync(APP_LAUNCH_FLAG)) {
        Taro.removeStorageSync(APP_LAUNCH_FLAG);
        setOutfitIdx(0);
        console.info('[Wardrobe] 启动自动执行穿搭推荐（命中当天缓存则直接展示）');
      }
    } catch (e) {
      console.warn('[Wardrobe] 读取启动标记失败', e);
    }
  });

  // v1.16.0：空衣橱建议改为「点击生成 + 消耗当日推荐额度」（原自动加载的 emptyGuide 已移除，
  // 生成逻辑见上方 genEmptyAdvice），避免未获用户确认即消耗推荐次数

  // v1.1：listGroups 的 ref 同步（滚动/定位回调中读取，避免闭包过期）
  const listGroupsRef = useRef(listGroups);
  useEffect(() => {
    listGroupsRef.current = listGroups;
  }, [listGroups]);
  const activeTypeRef = useRef('');
  useEffect(() => {
    activeTypeRef.current = activeType;
  }, [activeType]);

  // v1.1：侧边栏选中态同步（所有联动路径统一入口）——
  // 取「最后一个滚过激活线（视口上部 35%）的组」为选中类型；
  // 触底几何判定：手风琴列表容器底边已进入视口（bottom ≤ 视口高度）且页面已滚动一段距离
  // （y > 200，避免列表变短/内容不满一屏时误判），此时强制选中最后一个分组，
  // 修复最后一组内容较短时其组头始终越不过激活线的边界问题
  const syncActiveType = useCallback(() => {
    const groups = listGroupsRef.current;
    if (groups.length === 0) return;
    const y = lastScrollTop.current;
    const query = Taro.createSelectorQuery().selectAll('.ldw-acc-header').boundingClientRect();
    (query as unknown as Taro.SelectorQuery)
      .select('.ldw-acc-wrap')
      .boundingClientRect()
      .exec((resArr) => {
        const list = ((resArr && resArr[0]) || []) as { top: number }[];
        const wrapRect = (resArr && resArr[1]) as { bottom: number } | null;
        if (list.length !== groups.length) return;
        const line = windowHeight.current * 0.35;
        let idx = 0;
        for (let i = 0; i < list.length; i++) {
          if (list[i].top <= line) idx = i;
          else break;
        }
        const atBottom = y > 200 && !!wrapRect && wrapRect.bottom <= windowHeight.current;
        const t = atBottom ? groups[groups.length - 1].type : groups[idx].type;
        if (t !== activeTypeRef.current) {
          activeTypeRef.current = t;
          setActiveType(t);
        }
      });
  }, []);

  // 分组列表变化时校正选中类型（如筛选后分组减少，保证侧边栏选中项始终有效）
  useEffect(() => {
    if (listGroups.length === 0) {
      if (activeTypeRef.current !== '') {
        activeTypeRef.current = '';
        setActiveType('');
      }
      return;
    }
    if (!listGroups.some((g) => g.type === activeTypeRef.current)) {
      const t = listGroups[0].type;
      activeTypeRef.current = t;
      setActiveType(t);
    }
  }, [listGroups]);

  // v1.1：侧边标签栏点击 → 滚动定位到对应分组组头；分组处于收起状态时先展开再定位
  const scrollToGroup = useCallback((type: string) => {
    const groups = listGroupsRef.current;
    const idx = groups.findIndex((g) => g.type === type);
    if (idx < 0) return;
    const wasCollapsed = !!collapsedMapRef.current[type];
    lastManualTs.current = Date.now();
    activeTypeRef.current = type;
    setActiveType(type);
    if (wasCollapsed) {
      setCollapsedMap((prev) => ({ ...prev, [type]: false }));
    }
    setTimeout(() => {
      Taro.createSelectorQuery()
        .selectAll('.ldw-acc-header')
        .boundingClientRect()
        .selectViewport()
        .scrollOffset()
        .exec((res) => {
          const rects = ((res && res[0]) || []) as { top: number }[];
          const scroll = (res && res[1] && res[1].scrollTop) || 0;
          const rect = rects[idx];
          if (!rect) return;
          Taro.pageScrollTo({ scrollTop: Math.max(scroll + rect.top - 8, 0), duration: 300 }).catch(() => {
            // H5 等端不支持时静默降级
          });
        });
    }, wasCollapsed ? 150 : 0);
  }, []);

  // v1.2.0：新增衣物返回后，右侧标签栏自动选中并定位到该衣物所属分组
  useDidShow(() => {
    try {
      const jumpType = Taro.getStorageSync('ldw_jump_type') as string;
      if (!jumpType) return;
      Taro.removeStorageSync('ldw_jump_type');
      setTimeout(() => scrollToGroup(jumpType), 350);
    } catch (e) {
      // 读取失败时静默跳过，不影响正常浏览
    }
  });

  // 是否存在收起中的分组（滚动联动判断用，ref 同步）
  const collapsedMapRef = useRef(collapsedMap);
  useEffect(() => {
    collapsedMapRef.current = collapsedMap;
  }, [collapsedMap]);

  // v1.2.0：取消手风琴「滑动自动收起/展开」（原自动缩放导致浏览时空间反复变化）
  // 分组默认全部展开，仅保留手动点击组头展开/收起；滚动只用于同步右侧标签栏选中态。
  usePageScroll(() => {
    if (!showAccordion) return;
    const nowTs = Date.now();
    if (nowTs - lastSyncTs.current < 120) return;
    lastSyncTs.current = nowTs;
    syncActiveType();
  });

  // v1.1：滚动触底时立即选中最后一个分组（最终选中态以测量回调的几何判定为准）
  useReachBottom(() => {
    const groups = listGroupsRef.current;
    if (groups.length === 0) return;
    const t = groups[groups.length - 1].type;
    if (t !== activeTypeRef.current) {
      activeTypeRef.current = t;
      setActiveType(t);
    }
  });

  // v0.7：组头点击手动切换展开/收起（v1.1：切换后稍作延时重新同步侧边栏选中态）
  const toggleGroup = useCallback((type: string) => {
    lastManualTs.current = Date.now();
    setCollapsedMap((prev) => ({ ...prev, [type]: !prev[type] }));
    setTimeout(syncActiveType, 200);
  }, [syncActiveType]);

  // v1.1：交互变更（用户确认）——取消「再点底部衣柜标签弹出弹层」，改为点击衣柜页上部
  // 「切换衣橱」按钮弹出衣橱选择弹层；tabBar 点击仅保留原生页面切换行为，不再触发弹层

  const goAdd = () => Taro.navigateTo({ url: '/pages/add/index' });
  const goDetail = (id: string) => Taro.navigateTo({ url: `/pages/detail/index?id=${id}` });

  // v1.18.0：衣橱长按衣物加入/移出明日穿搭（longpress 触发后不再触发 tap，与进详情不冲突）
  const handleItemLongPress = (id: string) => {
    const it = itemMap.get(id);
    if (!it) return;
    const inPlan = tomorrowIds.includes(id);
    Taro.showModal({
      title: '明日穿搭',
      content: inPlan ? `将「${it.name}」移出明日穿搭？` : `将「${it.name}」加入明日穿搭？`,
      confirmText: inPlan ? '移出' : '加入',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        toggleTomorrowItem(id);
        Taro.showToast({ title: inPlan ? '已移出明日穿搭' : '已加入明日穿搭', icon: 'success' });
      }
    });
  };
  // v0.5：衣橱管理页已从底部标签改为普通页面，经切换器「管理」进入
  const goManage = () => Taro.navigateTo({ url: '/pages/wardrobes/index' });

  return (
    <View className={styles.page} style={themeStyle}>
      {/* v1.5.0：切换衣橱入口位于天气卡片之上的右上角 */}
      <View className={styles.wardTopRow}>
        <View className={styles.wardTopBtn} onClick={() => setSwitcherOpen(true)}>
          <Text className={styles.wardTopText}>
            衣橱 · {currentWardrobe?.name || '默认衣橱'}
          </Text>
          <Text className={styles.wardTopArrow}>▾</Text>
        </View>
      </View>
      <WeatherCard
        weather={weather}
        loading={weatherLoading}
        failed={weatherFailed}
        mode={mode}
        onSwitchMode={handleSwitchMode}
        activeCity={activeCity}
        located={mode === 'local' && citySource === 'located'}
        onSelectCity={(c) => {
          if (c === activeCity) return;
          if (mode === 'trip') {
            setTripCity(c);
          } else {
            setCity(c, 'manual'); // v1.8.0（F-17）：手动选城标记来源，定位图标随之消失
          }
          setWeatherTick((t) => t + 1);
        }}
        onRetry={() => setWeatherTick((t) => t + 1)}
      />
      {/* weatherTick 变化触发重新加载 */}
      <LoadTrigger tick={weatherTick} onLoad={loadWeather} />

      {/* v1.4.3：推荐卡片移至天气卡片下方（筛选/明日穿搭勾选模式下不展示）
          v1.7.0：卡片默认展示——空衣橱时进入建议模式，显示按天气生成的着装建议（不再整卡隐藏）
          v1.10.0：当地模式展示今日缓存的 1/2/5 套（左右滑动），套数用尽不再生成
          v1.16.0：空衣橱改为点击生成建议（按性别/年龄/明日天气，消耗 1 次推荐）+ 添加衣物引导 */}
      {!planMode && !isFiltering && (
        <RecommendCard
          outfits={cardOutfits}
          advice={
            currentItems.length === 0 && latestAdvice
              ? { text: latestAdvice.reason, source: latestAdvice.source }
              : null
          }
          adviceAction={
            currentItems.length === 0
              ? {
                  canGenerate: adviceLeft > 0,
                  loading: adviceLoading,
                  onGenerate: genEmptyAdvice,
                  onAddClothes: goAdd
                }
              : null
          }
          scenes={sceneOptions}
          scene={scene}
          onSelectScene={handleSelectScene}
          adopted={outfitAdopted}
          loading={mode === 'trip' ? tripLoading : genLoading || adviceLoading}
          loadingHint={mode === 'trip' ? '正在生成出差穿搭，请稍候…' : genHint}
          canShuffle={mode === 'trip' || !quotaReached}
          used={mode === 'trip' ? 0 : cachedEntries.length}
          total={mode === 'trip' ? 0 : outfitQuota}
          tripMode={mode === 'trip'}
          onSwiperIndex={setOutfitIdx}
          onShuffle={handleShuffle}
          onAdopt={handleAdopt}
          index={outfitIdx}
          recommendedScenes={recommendedScenes}
          customSceneNames={customScenes}
          onAddScene={addCustomScene}
          onDeleteScene={removeCustomScene}
        />
      )}

      {/* v1.7.0：当季推荐卡——按当季与衣橱主人性别/年龄段展示时尚着装照片
          v1.9.0（F-19）：接入会员每日额度（v1.13.1 起为 0/1/2 张）
          v1.14.0：成本受控——进页只读本地缓存不自动生图，点击风格或自定义风格后按张生成（额度上限不变） */}
      {!planMode && !isFiltering && (
        <SeasonalCard
          gender={currentWardrobe?.gender}
          age={currentWardrobe?.age ?? null}
          tier={memberTier}
          quota={tierCfg.seasonalPerDay}
          viewed={memberUsage.seasonalViewed}
          onShow={recordSeasonalView}
        />
      )}

      {/* v1.4.3：移除独立「切换衣橱」行，入口移至天气卡片右上角 */}

      {/* v0.6 用户意见 6：明日穿搭入口（按分类勾选明天穿的衣物）
          v1.7.0：空衣橱时也默认展示（勾选页内提供添加衣物引导） */}
      {!planMode && (
        <View className={styles.planEntry} onClick={() => setPlanMode(true)}>
          <Text className={styles.planEntryIcon}>🌤️</Text>
          <View className={styles.planEntryInfo}>
            <Text className={styles.planEntryTitle}>明日穿搭</Text>
            <Text className={styles.planEntryDesc}>
              {tomorrowIds.length > 0
                ? `已选 ${tomorrowIds.length} 件 · 衣橱长按衣物可加入`
                : '衣橱长按衣物加入，或从备选套装挑选'}
            </Text>
          </View>
          <Text className={styles.planEntryArrow}>›</Text>
        </View>
      )}

      {planMode ? (
        <>
          <View className={styles.planHeader}>
            <View className={styles.planBack} onClick={() => setPlanMode(false)}>
              <Text className={styles.planBackText}>‹ 返回</Text>
            </View>
            <Text className={styles.planTitle}>🧳 明日穿搭</Text>
            <Text className={styles.planCount}>已选 {tomorrowIds.length} 件</Text>
          </View>
          {/* v1.7.0：空衣橱进入时给出引导，避免整页空白 */}
          {planGroups.length === 0 && (
            <EmptyState
              icon='🧳'
              title='衣柜还没有衣物'
              desc='先添加几件衣物，再来安排明日穿搭吧'
              actionText='添加衣物'
              onAction={goAdd}
            />
          )}

          {/* v1.17.1：今日备选套装（首页推荐缓存）——点击套装应用；v1.20.5：长按图片移出单件
              v2.2.5：长按移出最后一件后不再回退成整套预览（原逻辑 picked 为空即回落全套，
              表现为「删掉最后一件又变回两件」）；整套移出后隐藏卡片，全部移出显示「无备选套装」 */}
          {planGroups.length > 0 && visibleSets.length > 0 && (
            <View className={styles.planSets}>
              <Text className={styles.planSectionTitle}>今日备选套装（点击套装应用 · 长按图片移出）</Text>
              {visibleSets.map((vm) => {
                const idx = cachedVMs.findIndex((v) => v.id === vm.id);
                const setNo = PLAN_SET_CN[idx] || idx + 1;
                // 套内展示跟随实际勾选（picked）：已应用（或部分移出）时只展示仍在明日穿搭中的衣物
                const picked = vm.items.filter((it) => tomorrowIds.includes(it.id));
                const active = vm.items.length > 0 && picked.length === vm.items.length;
                const shown = picked.length > 0 ? picked : vm.items;
                const moveOutSet = () => {
                  setMovedOutSets((prev) => (prev.includes(vm.id) ? prev : [...prev, vm.id]));
                  Taro.showToast({ title: `已将第${setNo}套装移出备选`, icon: 'none' });
                };
                const removeItem = (it: ClothingItem) => {
                  // 未应用的套装没有可移出的衣物：长按即整套移出
                  if (picked.length === 0) {
                    moveOutSet();
                    return;
                  }
                  toggleTomorrowItem(it.id);
                  if (picked.filter((p) => p.id !== it.id).length === 0) moveOutSet();
                  else Taro.showToast({ title: `已将「${it.name}」移出明日穿搭`, icon: 'none' });
                };
                return (
                  <View
                    key={vm.id}
                    className={`${styles.planSetCard} ${active ? styles.planSetCardActive : ''}`}
                    onClick={() => {
                      // 重新应用时同时取消「已移出」标记
                      setMovedOutSets((prev) => prev.filter((k) => k !== vm.id));
                      adoptTomorrowItems(vm.items.map((it) => it.id));
                      Taro.showToast({ title: `已选第${setNo}套装为明日穿搭`, icon: 'success' });
                    }}
                  >
                    <View className={styles.planSetHeader}>
                      <Text className={styles.planSetTitle}>
                        第{setNo}套装 · {vm.sceneLabel || '推荐搭配'}
                      </Text>
                      {active ? (
                        <Text className={styles.planSetCheck}>✓ 已选</Text>
                      ) : picked.length > 0 ? (
                        <Text className={styles.planSetCheck}>已选 {picked.length}/{vm.items.length} 件</Text>
                      ) : null}
                    </View>
                    <View className={styles.planGrid}>
                      {shown.map((it) => (
                        <View
                          key={it.id}
                          className={styles.planItem}
                          onLongPress={() => removeItem(it)}
                        >
                          <Image className={styles.planPhoto} src={it.photos[0]} mode='aspectFill' />
                          <Text className={styles.planName} numberOfLines={1}>
                            {it.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* v1.18.0：自选套装——首页长按衣物加入的衣物聚合为一套；v1.20.5：长按图片移出单件 */}
          {customSetItems.length > 0 && (
            <View className={styles.planSets}>
              <Text className={styles.planSectionTitle}>我的自选套装（首页长按衣物加入 · 长按图片移出）</Text>
              <View
                className={styles.planSetCard}
                onClick={() => {
                  customSetItems.forEach((it) => toggleTomorrowItem(it.id));
                  Taro.showToast({ title: '已取消自选套装', icon: 'none' });
                }}
              >
                <View className={styles.planSetHeader}>
                  <Text className={styles.planSetTitle}>自选套装 · {customSetItems.length} 件</Text>
                  <Text className={styles.planSetCheck}>✓ 已选 · 点击取消</Text>
                </View>
                <View className={styles.planGrid}>
                  {customSetItems.map((it) => (
                    <View
                      key={it.id}
                      className={styles.planItem}
                      onLongPress={() => {
                        toggleTomorrowItem(it.id);
                        Taro.showToast({ title: `已将「${it.name}」移出明日穿搭`, icon: 'none' });
                      }}
                    >
                      <Image className={styles.planPhoto} src={it.photos[0]} mode='aspectFill' />
                      <Text className={styles.planName} numberOfLines={1}>
                        {it.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          )}

          {/* v1.20.5：手动勾选区已移除——衣物选择统一在首页长按完成；v1.20.8：「完成」按钮移除，经顶部「‹ 返回」退出
              v2.2.5：备选套装全部移出后显示「无备选套装」 */}
          {customSetItems.length === 0 && visibleSets.length === 0 && (
            <View className={styles.planSets}>
              <Text className={styles.planSectionTitle}>无备选套装</Text>
              <Text className={styles.planSectionTip}>
                {cachedVMs.length > 0
                  ? '今日备选套装已全部移出，点击「‹ 返回」后可在推荐卡重新生成搭配'
                  : '回到衣橱长按衣物即可加入明日穿搭；也可在上方推荐卡生成今日备选套装'}
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <FilterBar
            filters={filters}
            colorOptions={colorOptions}
            materialOptions={materialOptions}
            colorHexMap={colorHexMap}
            onChange={setFilters}
          />

          {currentItems.length === 0 && !isFiltering ? (
            // v1.7.0：按天气生成的着装建议已上移至「明日穿搭推荐」卡（含来源角标），
            // 空态卡只保留添加衣物引导，避免同一文案重复展示
            <EmptyState
              icon='🧥'
              title='这个衣橱还空着'
              desc='拍几张照片，记录第一件衣物吧'
              hint='添加自有衣物后，可按你的身材与当前天气获取更精准的个性化推荐'
              actionText='添加衣物'
              onAction={goAdd}
            />
          ) : filtered.length === 0 ? (
            <EmptyState icon='🔍' title='没有符合条件的衣物' desc='试试调整筛选条件' />
          ) : showAccordion ? (
            <>
              {/* v0.7：手风琴分组列表（应用任一筛选后退化为平铺网格，清除筛选恢复分组） */}
              <AccordionList
                groups={listGroups}
                collapsedMap={collapsedMap}
                colorHexMap={colorHexMap}
                onToggleGroup={toggleGroup}
                onItemPress={goDetail}
                onToggleFavorite={toggleFavorite}
                onItemLongPress={handleItemLongPress}
              />
              {/* v1.1：侧边类型标签栏（快速定位分组，选中态随滚动/展开收起同步） */}
              <TypeSideBar
                types={listGroups.map((g) => g.type)}
                activeType={activeType}
                onSelect={scrollToGroup}
              />
            </>
          ) : (
            <View className={styles.grid}>
              {filtered.map((it) => (
                <View key={it.id} className={styles.gridItem}>
                  <ItemCard
                    item={it}
                    colorHexMap={colorHexMap}
                    onClick={() => goDetail(it.id)}
                    onToggleFavorite={() => toggleFavorite(it.id)}
                    onLongPress={() => handleItemLongPress(it.id)}
                  />
                </View>
              ))}
            </View>
          )}

          <View className={styles.fab} onClick={goAdd}>
            <Text className={styles.fabIcon}>+</Text>
          </View>
        </>
      )}

      {/* v1.1：点击上部「切换衣橱」按钮弹出的衣橱选择底部弹层（样式与「我的」页弹层一致） */}
      {switcherOpen && (
        <View className={styles.sheetMask} onClick={() => setSwitcherOpen(false)}>
          <View className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <View className={styles.sheetHead}>
              <View className={styles.sheetHeadLeft}>
                <Text className={styles.sheetTitle}>切换衣橱</Text>
                {/* v1.20.3：当前档位衣橱额度（如 VIP 2/3），达上限文字变红 */}
                <Text
                  className={
                    counts.length >= tierCfg.wardrobes ? styles.sheetQuotaFull : styles.sheetQuota
                  }
                >
                  {tierCfg.label} {counts.length}/{tierCfg.wardrobes}
                </Text>
              </View>
              <View className={styles.sheetManage} onClick={goManage}>
                <Text className={styles.sheetManageText}>管理衣橱</Text>
              </View>
            </View>
            <View className={styles.sheetList}>
              {counts.map((w) => (
                <View
                  key={w.id}
                  className={styles.sheetItem}
                  onClick={() => {
                    setCurrentWardrobe(w.id);
                    setSwitcherOpen(false);
                  }}
                >
                  <View className={styles.sheetDot} style={{ background: w.color }} />
                  <Text className={styles.sheetName}>{w.name}</Text>
                  <Text className={styles.sheetCount}>{w.count} 件</Text>
                  {w.id === currentWardrobeId && <Text className={styles.sheetCurrent}>当前</Text>}
                </View>
              ))}
            </View>
            <View className={styles.sheetCancel} onClick={() => setSwitcherOpen(false)}>
              <Text className={styles.sheetCancelText}>取消</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

/** 气象刷新触发器：tick 变化时调用 onLoad */
const LoadTrigger: React.FC<{ tick: number; onLoad: () => void }> = ({ tick, onLoad }) => {
  React.useEffect(() => {
    if (tick > 0) onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return null;
};

export default WardrobePage;
