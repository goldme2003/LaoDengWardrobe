import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro, { usePullDownRefresh, useDidShow } from '@tarojs/taro';
import WeatherCard from '@/components/WeatherCard';
import WardrobeSwitcher from '@/components/WardrobeSwitcher';
import FilterBar, { Filters, EMPTY_FILTERS } from '@/components/FilterBar';
import ItemCard from '@/components/ItemCard';
import EmptyState from '@/components/EmptyState';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { getWeather } from '@/services/weather';
import { CITY_OPTIONS, DEFAULT_CITY } from '@/data/mockWeather';
import {
  COLOR_PRESETS,
  MATERIAL_PRESETS,
  themeVarsOf,
  getTypePresetsByGender
} from '@/data/presets';
import { ClothingItem, WeatherInfo } from '@/types';
import styles from './index.module.scss';

/** 明日穿搭分组的类型顺序（自定义类型排在预设之后） */
const PLAN_TYPE_ORDER = ['上装', '外套', '裤装', '裙装', '连衣裙', '内衣', '家居服', '鞋履', '配饰', '其他'];

/** 衣柜首页（PRD FR-06/FR-09）：天气 + 衣橱切换 + 筛选 + 衣物网格 */
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

  const customOf = (dimension: 'type' | 'color' | 'material') =>
    customOptions.filter((o) => o.dimension === dimension).map((o) => o.value);

  // 当前衣橱风格主题（v0.5 用户意见 2：整体风格联动，含底色/卡片/文本/圆角）
  const currentWardrobe = useMemo(
    () => wardrobes.find((w) => w.id === currentWardrobeId),
    [wardrobes, currentWardrobeId]
  );

  // v0.6：筛选类型选项与新增衣物一致（按当前衣橱性别过滤）
  const typeOptions = useMemo(
    () => [...getTypePresetsByGender(currentWardrobe?.gender), ...customOf('type')],
    [customOptions, currentWardrobe?.gender]
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
      if (filters.type && it.type !== filters.type) return false;
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

  // 当前衣橱风格主题（v0.5 用户意见 2：整体风格联动，含底色/卡片/文本/圆角）
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  // v0.6：消费「我的」页跳转携带的筛选预设（喜爱衣物）
  useEffect(() => {
    if (wardrobeFilterPreset === 'favorite') {
      setFilters({ ...EMPTY_FILTERS, onlyFavorite: true });
      consumeWardrobeFilterPreset();
    }
  }, [wardrobeFilterPreset, consumeWardrobeFilterPreset]);

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

  const goAdd = () => Taro.navigateTo({ url: '/pages/add/index' });
  const goDetail = (id: string) => Taro.navigateTo({ url: `/pages/detail/index?id=${id}` });
  // v0.5：衣橱管理页已从底部标签改为普通页面，经切换器「管理」进入
  const goManage = () => Taro.navigateTo({ url: '/pages/wardrobes/index' });

  const isFiltering = filters.type || filters.color || filters.material || filters.seasons.length > 0 || filters.onlyFavorite;

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
            typeOptions={typeOptions}
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
