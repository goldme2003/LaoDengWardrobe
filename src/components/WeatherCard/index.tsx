import React, { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { weatherIcon } from '@/data/presets';
import { WeatherInfo } from '@/types';
import { TRIP_CITIES } from '@/data/cities';
import styles from './index.module.scss';

export type WeatherMode = 'local' | 'trip';

interface Props {
  weather: WeatherInfo | null;
  loading: boolean;
  failed: boolean;
  /** 当前模式 */
  mode: WeatherMode;
  /** 模式切换（当展示切换 tab 时由卡片内部调用外部 onSwitchMode） */
  onSwitchMode: (m: WeatherMode) => void;
  activeCity: string;
  /** v1.8.0（F-17）：当前城市是否来自自动定位（当地模式下在城市名旁显示 📍） */
  located?: boolean;
  onSelectCity: (city: string) => void;
  onRetry: () => void;
}

/** 天气卡片（PRD FR-09）：城市、今日天气与气温、未来 3 日简报
 * v1.6.1：新增当地/出差模式切换 tab；城市选择弹层精简为顶部输入框 + 底部常用 15 城平铺，
 * 面板高度固定 1/3 屏，无滚动条无字母索引条。 */
const WeatherCard: React.FC<Props> = ({
  weather,
  loading,
  failed,
  mode,
  onSwitchMode,
  activeCity,
  located,
  onSelectCity,
  onRetry
}) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState('');

  const openSheet = () => {
    setCityDraft('');
    setSheetOpen(true);
  };
  const pick = (city: string) => {
    setSheetOpen(false);
    setCityDraft('');
    if (city !== activeCity) onSelectCity(city);
  };
  const confirmCity = () => {
    const city = cityDraft.trim();
    if (!city) {
      Taro.showToast({ title: '请输入城市名称', icon: 'none' });
      return;
    }
    if (city.length < 2 || city.length > 10) {
      Taro.showToast({ title: '城市名称需为 2–10 个字', icon: 'none' });
      return;
    }
    pick(city);
  };

  const isTrip = mode === 'trip';

  return (
    <View className={styles.card}>
      {/* v1.6.1：顶部模式切换 tab（当地天气 / 出差天气） */}
      <View className={styles.modeTab}>
        <View
          className={`${styles.modeItem} ${!isTrip ? styles.modeItemActive : ''}`}
          onClick={() => isTrip && onSwitchMode('local')}
        >
          <Text className={`${styles.modeText} ${!isTrip ? styles.modeTextActive : ''}`}>当地天气</Text>
        </View>
        <View
          className={`${styles.modeItem} ${isTrip ? styles.modeItemActive : ''}`}
          onClick={() => !isTrip && onSwitchMode('trip')}
        >
          <Text className={`${styles.modeText} ${isTrip ? styles.modeTextActive : ''}`}>出差天气</Text>
        </View>
      </View>

      {/* 第一行：城市 + 状态/重试 + 右上角城市选择按钮 */}
      <View className={styles.header}>
        <Text className={styles.city}>{weather ? weather.city : '天气'}</Text>
        {/* v1.8.0（F-17）：城市来自启动自动定位时显示定位图标，区别于手动选择/出差城市 */}
        {located && <Text className={styles.locateIcon}>📍</Text>}
        {weather?.mock && !loading && (
          <Text className={styles.mockBadge}>模拟{weather.notice ? `·${weather.notice}` : ''}</Text>
        )}
        {loading && <Text className={styles.stateText}>加载中…</Text>}
        {failed && !loading && (
          <Text className={styles.retry} onClick={onRetry}>
            获取失败，点击重试
          </Text>
        )}
        <View className={styles.citySwitch} onClick={openSheet}>
          <Text className={styles.citySwitchText}>{isTrip ? '出差城市' : '切换城市'}</Text>
          <Text className={styles.citySwitchArrow}>▾</Text>
        </View>
      </View>

      {weather && !failed && (
        <View className={styles.bodyRow}>
          <View className={styles.today}>
            <Text className={styles.todayIcon}>{weatherIcon(weather.today.cond)}</Text>
            <View className={styles.todayInfo}>
              <Text className={styles.todayCond}>{weather.today.cond}</Text>
              <Text className={styles.todayRange}>
                {weather.today.low}° ~ {weather.today.high}°
              </Text>
            </View>
          </View>
          <View className={styles.days}>
            {weather.days.map((d) => (
              <View key={d.date} className={styles.dayItem}>
                <Text className={styles.dayDate}>{d.date}</Text>
                <Text className={styles.dayIcon}>{weatherIcon(d.cond)}</Text>
                <Text className={styles.dayRange}>
                  {d.low}°/{d.high}°
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* v1.6.1：精简城市弹层——顶部输入框 + 底部常用 15 城，1/3 屏高，无滚动条 */}
      {sheetOpen && (
        <View className={styles.sheetMask} onClick={() => setSheetOpen(false)}>
          <View className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <View className={styles.sheetHeader}>
              <Text className={styles.sheetTitle}>{isTrip ? '选择出差城市' : '选择城市'}</Text>
              <Text className={styles.sheetClose} onClick={() => setSheetOpen(false)}>
                完成
              </Text>
            </View>
            {/* 手动输入 */}
            <View className={styles.cityInputRow}>
              <Input
                className={styles.cityInput}
                value={cityDraft}
                maxlength={10}
                placeholder={`手动输入城市名称（当前：${activeCity}）`}
                confirmType='done'
                onInput={(e) => setCityDraft(e.detail.value)}
                onConfirm={confirmCity}
              />
              <View className={styles.cityInputBtn} onClick={confirmCity}>
                <Text className={styles.cityInputBtnText}>确定</Text>
              </View>
            </View>
            {/* 常用 15 城平铺，无滚动 */}
            <View className={styles.tripList}>
              {TRIP_CITIES.map((c) => (
                <Text
                  key={c}
                  className={`${styles.tripCell} ${c === activeCity ? styles.tripCellActive : ''}`}
                  onClick={() => pick(c)}
                >
                  {c}
                </Text>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

export default WeatherCard;
