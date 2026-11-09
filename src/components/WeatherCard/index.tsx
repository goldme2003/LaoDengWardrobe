import React from 'react';
import { View, Text, Picker } from '@tarojs/components';
import { weatherIcon } from '@/data/presets';
import { WeatherInfo } from '@/types';
import styles from './index.module.scss';

interface Props {
  weather: WeatherInfo | null;
  loading: boolean;
  failed: boolean;
  cityOptions: string[];
  activeCity: string;
  onSelectCity: (city: string) => void;
  onRetry: () => void;
}

/** 天气卡片（PRD FR-09）：城市、今日天气与气温、未来 3 日简报 */
const WeatherCard: React.FC<Props> = ({
  weather,
  loading,
  failed,
  cityOptions,
  activeCity,
  onSelectCity,
  onRetry
}) => {
  return (
    <View className={styles.card}>
      <View className={styles.header}>
        <Text className={styles.city}>{weather ? weather.city : '天气'}</Text>
        {loading && <Text className={styles.stateText}>加载中…</Text>}
        {failed && !loading && (
          <Text className={styles.retry} onClick={onRetry}>
            天气获取失败，点击重试
          </Text>
        )}
      </View>

      {weather && !failed && (
        <>
          <View className={styles.today}>
            <View className={styles.todayLeft}>
              <Text className={styles.todayIcon}>{weatherIcon(weather.today.cond)}</Text>
              <Text className={styles.todayCond}>{weather.today.cond}</Text>
              <Text className={styles.todayRange}>
                {weather.today.low}° ~ {weather.today.high}°
              </Text>
            </View>
            {/* v0.6：城市仅在拨盘选择器中切换一次，不再平铺常见城市 */}
            <Picker
              mode='selector'
              range={cityOptions}
              value={Math.max(0, cityOptions.indexOf(activeCity))}
              onChange={(e) => onSelectCity(cityOptions[Number(e.detail.value)])}
            >
              <View className={styles.citySwitch}>
                <Text className={styles.citySwitchText}>切换城市</Text>
                <Text className={styles.citySwitchArrow}>▾</Text>
              </View>
            </Picker>
          </View>
          <View className={styles.days}>
            {weather.days.map((d) => (
              <View key={d.date} className={styles.dayItem}>
                <Text className={styles.dayDate}>{d.date}</Text>
                <Text className={styles.dayIcon}>{weatherIcon(d.cond)}</Text>
                <Text className={styles.dayCond}>{d.cond}</Text>
                <Text className={styles.dayRange}>
                  {d.low}°/{d.high}°
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
};

export default WeatherCard;
