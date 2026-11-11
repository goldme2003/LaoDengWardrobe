import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro, { usePullDownRefresh, useDidShow, usePageScroll, useTabItemTap } from '@tarojs/taro';
import WeatherCard from '@/components/WeatherCard';
import WardrobeSwitcher from '@/components/WardrobeSwitcher';
import FilterBar, { Filters, EMPTY_FILTERS } from '@/components/FilterBar';
import AccordionList, { AccordionGroup } from '@/components/AccordionList';
import ItemCard from '@/components/ItemCard';
import EmptyState from '@/components/EmptyState';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { getWeather } from '@/services/weather';
import { CITY_OPTIONS, DEFAULT_CITY } from '@/data/mockWeather';
import { COLOR_PRESETS, MATERIAL_PRESETS, themeVarsOf, getThemeById } from '@/data/presets';
import { ClothingItem, WeatherInfo } from '@/types';
import styles from './index.module.scss';

/** 分组类型顺序（自定义类型排在预设之后） */
const PLAN_TYPE_ORDER = ['上装', '外套', '裤装', '裙装', '连衣裙', '内衣', '家居服', '鞋履', '配饰', '其他'];

/** 滚动联动：方向反转需累计超过该位移才切换方向（避免抖动） */
const DIRECTION_HYSTERESIS = 20;
/** 滚动联动：手动操作后短时间不再触发自动逻辑 */
const MANUAL_GUARD_MS = 800;
/** 滚动联动：自动收起/展开的最小触发间隔（节流，保证平滑不卡顿） */
const AUTO_THROTTLE_MS = 160;

/** 衣柜首页（PRD FR-06/FR-09）：天气 + 衣橱切换 + 筛选 + 手风琴分组衣物列表 */
const WardrobePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const city = useWardrobeStore((s) => s.city);
  const customOptions = useWardrobeStore((s) => s.customOptions);
  const setCurrentWardrobe = useWardrobeStore((s) => s.setCurrentWardrobe);
  const toggleFavorite = useWardrobeStore((s) => s.toggleFavorite);
  const setCity = useWardrobeStore((s) => s.setCity);
  // v0.6：明日穿搭勾选（按衣橱归属）
  const tomorrowOutfits = useWardrobeStore((s) => s.tomorrowOutfits);
  const toggleTomorrowItem = useWardrobeStore((s) => s.toggleTomorrowItem);
  // v0.6：「我的」页跳转携带的筛选预设
  const wardrobeFilterPreset = useWardrobeStore((s) => s.wardrobeFilterPreset);
  const consumeWardrobeFilterPreset = useWardrobeStore((s) => s.consumeWardrobeFilterPreset);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const [weatherTick, setWeatherTick] = useState(0);
  // v0.6：明日穿搭勾选模式
  const [planMode, setPlanMode] = useState(false);
  // v0.7：手风琴分组收起状态（key = 类型名，true = 收起；不在表中 = 展开，默认全部展开）
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  // v0.7：再点「衣柜」标签弹出的衣橱切换弹层
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // 滚动联动状态（用 ref，避免高频渲染）
  const lastScrollTop = useRef(0);
  // down = 上滑（朝页面底部），up = 回滚（朝页面顶部）
  const scrollDir = useRef<'init' | 'down' | 'up'>('init');
  const oppoAcc = useRef(0);
  const lastManualTs = useRef(0);
  const lastAutoTs = useRef(0);
  const windowHeight = useRef(667);
  useEffect(() => {
    try {
      windowHeight.current = Taro.getSystemInfoSync().windowHeight || 667;
    } catch (e) {
      // 忽略，保留默认值
    }
  }, []);

  const activeCity = city || DEFAULT_CITY;

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherFailed(false);
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
    scrollDir.current = 'init';
    oppoAcc.current = 0;
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

  // 是否存在收起中的分组（滚动联动判断用，ref 同步）
  const collapsedMapRef = useRef(collapsedMap);
  useEffect(() => {
    collapsedMapRef.current = collapsedMap;
  }, [collapsedMap]);

  // v0.7.0 用户意见 2：滚动联动重构（移动端通用交互）——
  // 上滑浏览：组头滚出视口顶部的分组自动逐个收起（每次一组，节流防抖动）；
  // 回滚浏览：组头重新回到视口内的分组自动逐个展开；
  // 方向反转需超过迟滞阈值，手动操作后 800ms 内不触发，自动逻辑 160ms 节流。
  usePageScroll((res) => {
    if (!showAccordion) return;
    const y = res.scrollTop || 0;
    const delta = y - lastScrollTop.current;
    lastScrollTop.current = y;
    if (Math.abs(delta) < 2) return; // 过滤微小抖动
    const toward: 'down' | 'up' = delta > 0 ? 'down' : 'up';
    if (scrollDir.current === 'init') {
      scrollDir.current = toward;
      oppoAcc.current = 0;
      return;
    }
    if (scrollDir.current !== toward) {
      // 方向反转：累计位移超过迟滞阈值才切换方向
      oppoAcc.current += Math.abs(delta);
      if (oppoAcc.current < DIRECTION_HYSTERESIS) return;
      scrollDir.current = toward;
      oppoAcc.current = 0;
    } else {
      oppoAcc.current = 0;
    }
    // 手动操作后短时间内不触发自动逻辑
    if (Date.now() - lastManualTs.current < MANUAL_GUARD_MS) return;
    // 节流：降低测量频率，保证滚动平滑
    const now = Date.now();
    if (now - lastAutoTs.current < AUTO_THROTTLE_MS) return;
    lastAutoTs.current = now;

    // 测量各分组组头的视口位置
    Taro.createSelectorQuery()
      .selectAll('.ldw-acc-header')
      .boundingClientRect((rects) => {
        const list = (rects || []) as { top: number }[];
        if (list.length !== listGroups.length) return;
        if (toward === 'down') {
          // 上滑：第一个「组头已滚出视口顶部且仍展开」的分组 → 自动收起（一次一组）
          const idx = listGroups.findIndex((g, i) => !collapsedMapRef.current[g.type] && list[i].top < 0);
          if (idx >= 0) {
            lastManualTs.current = Date.now();
            setCollapsedMap((prev) => ({ ...prev, [listGroups[idx].type]: true }));
          }
        } else {
          // 回滚：第一个「组头回到视口内且已收起」的分组 → 自动展开（一次一组）
          const idx = listGroups.findIndex(
            (g, i) => collapsedMapRef.current[g.type] && list[i].top >= 0 && list[i].top < windowHeight.current
          );
          if (idx >= 0) {
            lastManualTs.current = Date.now();
            setCollapsedMap((prev) => ({ ...prev, [listGroups[idx].type]: false }));
          }
        }
      })
      .exec();
  });

  // v0.7：组头点击手动切换展开/收起
  const toggleGroup = useCallback((type: string) => {
    lastManualTs.current = Date.now();
    setCollapsedMap((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  // v0.7：再次点击底部「衣柜」标签时弹出衣橱切换弹层
  // useTabItemTap 仅在点击 tabBar 标签本身时触发，进入页面/switchTab 不会触发，无首次进入误触发问题
  // v0.7.0 用户意见 3：改为开关式切换——点击一次弹出菜单，再点击一次收回菜单
  useTabItemTap((res) => {
    // Taro 类型声明 index 为 string，微信端实际为 number，统一转数字比较
    if (Number(res.index) === 0) {
      setSwitcherOpen((open) => !open);
    }
  });

  const goAdd = () => Taro.navigateTo({ url: '/pages/add/index' });
  const goDetail = (id: string) => Taro.navigateTo({ url: `/pages/detail/index?id=${id}` });
  // v0.5：衣橱管理页已从底部标签改为普通页面，经切换器「管理」进入
  const goManage = () => Taro.navigateTo({ url: '/pages/wardrobes/index' });

  return (
    <View className={styles.page} style={themeStyle}>
      <WeatherCard
        weather={weather}
        loading={weatherLoading}
        failed={weatherFailed}
        cityOptions={CITY_OPTIONS}
        activeCity={activeCity}
        onSelectCity={(c) => {
          setCity(c);
          setWeatherTick((t) => t + 1);
        }}
        onRetry={() => setWeatherTick((t) => t + 1)}
      />
      {/* weatherTick 变化触发重新加载 */}
      <LoadTrigger tick={weatherTick} onLoad={loadWeather} />

      <WardrobeSwitcher
        wardrobes={counts}
        currentId={currentWardrobeId}
        onSelect={setCurrentWardrobe}
        onManage={goManage}
      />

      {/* v0.6 用户意见 6：明日穿搭入口（按分类勾选明天穿的衣物） */}
      {!planMode && currentItems.length > 0 && (
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
            <Text className={styles.planTitle}>🧳 明日穿搭（点击勾选）</Text>
            <Text className={styles.planCount}>已选 {tomorrowIds.length} 件</Text>
          </View>
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
            <EmptyState
              icon='🧥'
              title='衣橱还是空的'
              desc='拍几张照片，记录第一件衣物吧'
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

      {/* v0.7：再点「衣柜」标签弹出的衣橱切换底部弹层（样式与「我的」页弹层一致） */}
      {switcherOpen && (
        <View className={styles.sheetMask} onClick={() => setSwitcherOpen(false)}>
          <View className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <Text className={styles.sheetTitle}>切换衣橱</Text>
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
