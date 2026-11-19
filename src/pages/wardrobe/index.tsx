import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro, { usePullDownRefresh, useDidShow, usePageScroll, useReachBottom } from '@tarojs/taro';
import WeatherCard from '@/components/WeatherCard';
import FilterBar, { Filters, EMPTY_FILTERS } from '@/components/FilterBar';
import AccordionList, { AccordionGroup } from '@/components/AccordionList';
import TypeSideBar from '@/components/TypeSideBar';
import ItemCard from '@/components/ItemCard';
import EmptyState from '@/components/EmptyState';
import RecommendCard from '@/components/RecommendCard';
import SeasonalCard from '@/components/SeasonalCard';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { getWeather, cityFromLocation } from '@/services/weather';
import { getEmptyGuide, EmptyGuideResult } from '@/services/emptyGuide';
import { buildOutfits, SCENE_OPTIONS, SceneId, RecommendOutfit } from '@/services/recommend';
import { requestOutfitRecommend, composeAiReason } from '@/services/outfitRecommend';
import { DEFAULT_CITY } from '@/data/mockWeather';
import { COLOR_PRESETS, MATERIAL_PRESETS, themeVarsOf, getThemeById } from '@/data/presets';
import { ClothingItem, WeatherInfo } from '@/types';
import styles from './index.module.scss';

/** 分组类型顺序（自定义类型排在预设之后） */
const PLAN_TYPE_ORDER = ['上装', '外套', '裤装', '裙装', '连衣裙', '内衣', '家居服', '鞋履', '配饰', '其他'];

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
  // v1.2.1：空衣橱专属引导文案（云函数按性别/年龄动态生成，失败用兜底）
  // v1.4.1：附带来源（hunyuan/fallback），界面用绿/红角标区分，便于调试
  const [emptyGuide, setEmptyGuide] = useState<EmptyGuideResult | null>(null);
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
  useDidShow(() => {
    try {
      if (!Taro.getStorageSync(APP_GEO_FLAG)) return;
      Taro.removeStorageSync(APP_GEO_FLAG);
      Taro.getLocation({
        type: 'gcj02',
        success: async (res) => {
          try {
            const locCity = await cityFromLocation(res.latitude, res.longitude);
            if (!locCity) return;
            const curCity = useWardrobeStore.getState().city;
            if (locCity !== curCity) {
              console.info('[Wardrobe] 启动定位刷新城市：', curCity || '(空)', '→', locCity);
              setCity(locCity, 'located'); // activeCity 变化后由下方 effect 自动重载天气，并标记来源为定位
            }
          } catch (e) {
            console.warn('[Wardrobe] 逆地理失败：', (e as Error).message);
          }
        },
        fail: (err) => {
          console.info('[Wardrobe] 用户未授权定位或定位失败，保留当前城市', err?.errMsg || '');
        }
      });
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
  usePullDownRefresh(() => {
    loadWeather();
    setTimeout(() => Taro.stopPullDownRefresh(), 600);
  });

  const customOf = (dimension: 'color' | 'material') =>
    customOptions.filter((o) => o.dimension === dimension).map((o) => o.value);

  // 当前衣橱风格主题（v0.5 用户意见 2：整体风格联动，含底色/卡片/文本/圆角）
  const currentWardrobe = useMemo(
    () => wardrobes.find((w) => w.id === currentWardrobeId),
    [wardrobes, currentWardrobeId]
  );

  const colorOptions = useMemo(() => [...COLOR_PRESETS.map((c) => c.name), ...customOf('color')], [customOptions]);
  const materialOptions = useMemo(() => [...MATERIAL_PRESETS, ...customOf('material')], [customOptions]);

  const colorHexMap = useMemo(() => COLOR_PRESETS.reduce((m, c) => ({ ...m, [c.name]: c.hex }), {}), []);

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

  // v1.4.0（B/D 模块）：规则引擎推荐——有天气且有衣物时生成 1–3 套穿搭（v1.4.1 改为基于明日天气）；
  // 天气失败或衣橱为空时返回空数组不展示（降级矩阵），空衣橱走 C 模块引导
  // v1.8.0（F-18）：城市切换后天气重载完成前（weatherCity !== activeCity）视为过期，不基于旧城市天气出推荐
  const weatherStale = weatherCity !== activeCity;
  const outfits = useMemo(
    () =>
      weather && !weatherFailed && !weatherStale ? buildOutfits(weather, currentItems, scene) : [],
    [weather, weatherFailed, weatherStale, currentItems, scene]
  );
  const [outfitIdx, setOutfitIdx] = useState(0);
  useEffect(() => {
    setOutfitIdx(0);
  }, [outfits]);
  const localOutfit = outfits.length > 0 ? outfits[outfitIdx % outfits.length] : null;
  // v1.5.0：明日推荐改由云函数 outfitRecommend 调用混元按场景选搭
  // v1.8.1：兜底策略调整——云函数未返回或失败期间，不再转圈等待，直接展示本地规则引擎搭配
  //（无网络 / 云函数出错均走此兜底，卡片不再显示「兜底推荐」角标）；云函数正常返回后无缝替换为生成方案
  // v1.8.0（F-18）：城市切换（当地/出差）后联动重新生成——weatherStale 期间先清空旧推荐，
  // 新城市天气返回后按新天气重新请求，保证推荐与当前城市一致
  const [aiOutfit, setAiOutfit] = useState<RecommendOutfit | null>(null);
  const [aiSource, setAiSource] = useState<'hunyuan' | 'fallback'>('fallback');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNonce, setAiNonce] = useState(0);
  const aiExcludeRef = useRef<string[]>([]);
  const aiReqRef = useRef(0);
  const recommendReady = !!weather && !weatherFailed && !weatherStale && currentItems.length > 0;
  useEffect(() => {
    if (!recommendReady || !weather) {
      setAiOutfit(null);
      setAiLoading(false);
      return;
    }
    const reqId = ++aiReqRef.current;
    let alive = true;
    setAiLoading(true);
    setAiOutfit(null);
    setAiSource('fallback');
    // 「换一件」排除上一次组合：只对本次请求生效，用后即清空
    const excludeIds = aiExcludeRef.current;
    aiExcludeRef.current = [];
    requestOutfitRecommend({
      scene,
      weather,
      items: currentItems,
      gender: currentWardrobe?.gender,
      age: currentWardrobe?.age ?? null,
      excludeIds
    })
      .then((res) => {
        if (!alive || reqId !== aiReqRef.current || !res) return;
        const itemMap = new Map(currentItems.map((it) => [it.id, it]));
        const picked = res.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as ClothingItem[];
        if (!picked.length) return;
        const sceneLabel = (SCENE_OPTIONS.find((s) => s.id === res.scene) || SCENE_OPTIONS[0]).label;
        setAiSource(res.source);
        setAiOutfit({
          items: picked,
          scene: res.scene,
          sceneLabel,
          reason: composeAiReason(weather, sceneLabel, picked, res.advice)
        });
        console.info(`[Wardrobe] 明日推荐来源 = ${res.source}, 场景 = ${sceneLabel}`);
      })
      .catch((e) => console.warn('[Wardrobe] 明日推荐生成失败：', (e as Error).message))
      .finally(() => {
        if (alive && reqId === aiReqRef.current) setAiLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [recommendReady, weather, weatherFailed, weatherStale, activeCity, currentItems, scene, currentWardrobe?.gender, currentWardrobe?.age, aiNonce]);
  const outfit = aiOutfit || localOutfit;
  const outfitAdopted = !!outfit && outfit.items.every((it) => tomorrowIds.includes(it.id));
  const handleShuffle = useCallback(() => {
    if (aiLoading) return;
    // AI 结果：带上当前组合排除，重新请求混元；本地兜底：轮换规则引擎结果
    if (aiOutfit) {
      aiExcludeRef.current = aiOutfit.items.map((it) => it.id);
      setAiNonce((n) => n + 1);
      return;
    }
    setOutfitIdx((i) => (i + 1) % Math.max(outfits.length, 1));
  }, [aiLoading, aiOutfit, outfits.length]);
  const handleAdopt = useCallback(() => {
    if (!outfit) return;
    adoptTomorrowItems(outfit.items.map((it) => it.id));
    Taro.showToast({ title: '已加入明日穿搭', icon: 'success' });
  }, [outfit, adoptTomorrowItems]);

  // v1.4.2：穿搭建议重新生成的显性加载态——选择风格、切换城市共用同一套提示逻辑。
  // 规则引擎本身是同步计算，这里保留约 600ms 最短展示时间，避免加载态一闪而过；
  // 切换城市时若天气仍在请求，等天气返回后再开始计时，保证提示覆盖整个重算过程。
  const [recLoading, setRecLoading] = useState(false);
  useEffect(() => {
    if (!recLoading) return;
    if (weatherLoading) return;
    const t = setTimeout(() => setRecLoading(false), 600);
    return () => clearTimeout(t);
  }, [recLoading, weatherLoading, scene, weather]);
  const handleSelectScene = useCallback(
    (next: SceneId) => {
      if (next === scene) return;
      setScene(next);
      setOutfitIdx(0);
      setAiOutfit(null);
      aiExcludeRef.current = [];
      setRecLoading(true);
    },
    [scene]
  );

  // v1.4.3：小程序启动后首次进入首页，自动执行一次穿搭推荐
  // （推荐为天气 + 衣物 + 场景的同步规则计算；此处重置轮换位并展示生成态，天气返回后立即得到结果）
  useDidShow(() => {
    try {
      if (Taro.getStorageSync(APP_LAUNCH_FLAG)) {
        Taro.removeStorageSync(APP_LAUNCH_FLAG);
        setOutfitIdx(0);
        setRecLoading(true);
        console.info('[Wardrobe] 启动自动执行穿搭推荐');
      }
    } catch (e) {
      console.warn('[Wardrobe] 读取启动标记失败', e);
    }
  });

  // v1.2.1：空衣橱时加载专属引导文案（性别/年龄取自当前衣橱主人，PRD 9.1.2）
  // v1.4.0（C 模块天气增强）：天气加载完成后再请求引导，传入当前天气生成天气适配建议；
  // 天气失败（weatherFailed）时降级为无天气上下文，引导照常展示
  const emptyGender = currentWardrobe?.gender;
  const emptyAge = currentWardrobe?.age ?? null;
  const weatherResolved = weather !== null || weatherFailed;
  useEffect(() => {
    if (currentItems.length > 0 || isFiltering) {
      setEmptyGuide(null);
      return;
    }
    if (!weatherResolved || weatherStale) return; // 等天气首次加载完成（成功或失败）再取建议；v1.8.0（F-18）：城市切换重载期间不基于旧城市天气取建议
    let alive = true;
    getEmptyGuide(emptyGender, emptyAge, weather).then((res) => {
      if (alive) setEmptyGuide(res);
    });
    return () => {
      alive = false;
    };
  }, [currentItems.length, isFiltering, emptyGender, emptyAge, weatherResolved, weatherStale, weather]);

  // v1.7.0：空衣橱时推荐卡默认展示天气建议——复用 C 模块空衣橱引导
  // （云函数按性别/年龄/明日天气生成 → hunyuan 绿标；本地兜底 → fallback 红标）
  const emptyAdvice = useMemo(() => {
    if (currentItems.length > 0 || !emptyGuide) return null;
    return { text: emptyGuide.tip, source: emptyGuide.source };
  }, [currentItems.length, emptyGuide]);

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
        onSwitchMode={(m) => {
          setMode(m);
          setWeatherTick((t) => t + 1);
          setRecLoading(true);
        }}
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
          setRecLoading(true);
        }}
        onRetry={() => setWeatherTick((t) => t + 1)}
      />
      {/* weatherTick 变化触发重新加载 */}
      <LoadTrigger tick={weatherTick} onLoad={loadWeather} />

      {/* v1.4.3：推荐卡片移至天气卡片下方（筛选/明日穿搭勾选模式下不展示）
          v1.7.0：卡片默认展示——空衣橱时进入建议模式，显示按天气生成的着装建议（不再整卡隐藏） */}
      {!planMode && !isFiltering && (
        <RecommendCard
          outfit={outfit}
          advice={outfit ? null : emptyAdvice}
          scenes={SCENE_OPTIONS}
          scene={scene}
          onSelectScene={handleSelectScene}
          adopted={outfitAdopted}
          loading={outfit ? recLoading : !emptyAdvice}
          source={aiOutfit ? aiSource : 'fallback'}
          tripMode={mode === 'trip'}
          onShuffle={handleShuffle}
          onAdopt={handleAdopt}
        />
      )}

      {/* v1.7.0：当季推荐卡——按当季与衣橱主人性别/年龄段展示时尚着装照片跑马灯（暂定 5 张） */}
      {!planMode && !isFiltering && (
        <SeasonalCard gender={currentWardrobe?.gender} age={currentWardrobe?.age ?? null} />
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
              {tomorrowIds.length > 0 ? `已选 ${tomorrowIds.length} 件` : '从衣柜勾选明天要穿的衣物'}
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
            <Text className={styles.planTitle}>🧳 明日穿搭（点击勾选）</Text>
            <Text className={styles.planCount}>已选 {tomorrowIds.length} 件</Text>
          </View>
          {/* v1.7.0：空衣橱进入勾选页时给出引导，避免整页空白 */}
          {planGroups.length === 0 && (
            <EmptyState
              icon='🧳'
              title='衣柜还没有衣物'
              desc='先添加几件衣物，再来安排明日穿搭吧'
              actionText='添加衣物'
              onAction={goAdd}
            />
          )}
          {planGroups.map((g) => (
            <View key={g.type} className={styles.planGroup}>
              <Text className={styles.planGroupTitle}>{g.type}</Text>
              <View className={styles.planGrid}>
                {g.list.map((it) => {
                  const selected = tomorrowIds.includes(it.id);
                  return (
                    <View
                      key={it.id}
                      className={`${styles.planItem} ${selected ? styles.planItemSelected : ''}`}
                      onClick={() => toggleTomorrowItem(it.id)}
                    >
                      <Image className={styles.planPhoto} src={it.photos[0]} mode='aspectFill' />
                      <Text className={styles.planName} numberOfLines={1}>
                        {it.name}
                      </Text>
                      {selected && (
                        <View className={styles.planCheck}>
                          <Text className={styles.planCheckText}>✓</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
          <View className={styles.planDone} onClick={() => setPlanMode(false)}>
            <Text className={styles.planDoneText}>完成（已选 {tomorrowIds.length} 件）</Text>
          </View>
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
              <Text className={styles.sheetTitle}>切换衣橱</Text>
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
