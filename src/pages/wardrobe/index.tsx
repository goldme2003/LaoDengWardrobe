import React, { useState, useCallback, useMemo } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { usePullDownRefresh, useDidShow } from '@tarojs/taro';
import WeatherCard from '@/components/WeatherCard';
import WardrobeSwitcher from '@/components/WardrobeSwitcher';
import FilterBar, { Filters, EMPTY_FILTERS } from '@/components/FilterBar';
import ItemCard from '@/components/ItemCard';
import EmptyState from '@/components/EmptyState';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { getWeather } from '@/services/weather';
import { CITY_OPTIONS, DEFAULT_CITY } from '@/data/mockWeather';
import { COLOR_PRESETS, TYPE_PRESETS, MATERIAL_PRESETS, themeVarsOf } from '@/data/presets';
import { ClothingItem, WeatherInfo } from '@/types';
import styles from './index.module.scss';

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

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const [weatherTick, setWeatherTick] = useState(0);

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

  const typeOptions = useMemo(() => [...TYPE_PRESETS, ...customOf('type')], [customOptions]);
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
  const currentWardrobe = useMemo(
    () => wardrobes.find((w) => w.id === currentWardrobeId),
    [wardrobes, currentWardrobeId]
  );
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

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
