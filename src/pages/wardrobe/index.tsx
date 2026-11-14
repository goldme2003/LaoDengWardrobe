import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro, { usePullDownRefresh, useDidShow, usePageScroll, useReachBottom } from '@tarojs/taro';
import WeatherCard from '@/components/WeatherCard';
import FilterBar, { Filters, EMPTY_FILTERS } from '@/components/FilterBar';
import AccordionList, { AccordionGroup } from '@/components/AccordionList';
import TypeSideBar from '@/components/TypeSideBar';
import ItemCard from '@/components/ItemCard';
import EmptyState from '@/components/EmptyState';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { getWeather } from '@/services/weather';
import { getEmptyGuide } from '@/services/emptyGuide';
import { CITY_OPTIONS, DEFAULT_CITY } from '@/data/mockWeather';
import { COLOR_PRESETS, MATERIAL_PRESETS, themeVarsOf, getThemeById } from '@/data/presets';
import { ClothingItem, WeatherInfo } from '@/types';
import styles from './index.module.scss';

/** 分组类型顺序（自定义类型排在预设之后） */
const PLAN_TYPE_ORDER = ['上装', '外套', '裤装', '裙装', '连衣裙', '内衣', '家居服', '鞋履', '配饰', '其他'];

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
  // v1.1：点击页内「切换衣橱」按钮弹出的衣橱切换弹层
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // v1.1：侧边标签栏选中类型（随滚动联动/手风琴展开收起同步更新）
  const [activeType, setActiveType] = useState('');
  // v1.2.1：空衣橱专属引导文案（云函数按性别/年龄动态生成，失败用兜底）
  const [emptyGuideTip, setEmptyGuideTip] = useState('');

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

  // v1.2.1：空衣橱时加载专属引导文案（性别/年龄取自当前衣橱主人，PRD 9.1.2）
  const emptyGender = currentWardrobe?.gender;
  const emptyAge = currentWardrobe?.age ?? null;
  useEffect(() => {
    if (currentItems.length > 0 || isFiltering) {
      setEmptyGuideTip('');
      return;
    }
    let alive = true;
    getEmptyGuide(emptyGender, emptyAge).then((tip) => {
      if (alive) setEmptyGuideTip(tip);
    });
    return () => {
      alive = false;
    };
  }, [currentItems.length, isFiltering, emptyGender, emptyAge]);

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

      {/* v1.2.0：移除上部横向「全衣橱展示区」，衣橱切换只保留独立「切换衣橱」入口 */}
      <View className={styles.wardSwitcherRow}>
        <View className={styles.wardSwitchBtn} onClick={() => setSwitcherOpen(true)}>
          <Text className={styles.wardSwitchBtnText}>切换衣橱</Text>
        </View>
      </View>

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
              title='这个衣橱还空着'
              desc={emptyGuideTip || '拍几张照片，记录第一件衣物吧'}
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
