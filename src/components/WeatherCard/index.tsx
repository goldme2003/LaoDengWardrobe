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

/** 天气卡片（PRD FR-09）：城市、今日天气与气温、未来 3 日简报
 * v0.7.0 用户意见 1：紧凑化布局，整卡高度控制在页面可视区约 30% 以内 */
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
      {/* 第一行：城市 + 状态/重试 + 切换城市 */}
      <View className={styles.header}>
        <Text className={styles.city}>{weather ? weather.city : '天气'}</Text>
        {/* v1.2.1：模拟数据角标——云端不可用回退时可见，便于真机判断云函数链路是否生效 */}
        {weather?.mock && !loading && (
          <Text className={styles.mockBadge}>模拟{weather.notice ? `·${weather.notice}` : ''}</Text>
        )}
        {loading && <Text className={styles.stateText}>加载中…</Text>}
        {failed && !loading && (
          <Text className={styles.retry} onClick={onRetry}>
            获取失败，点击重试
          </Text>
        )}
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

      {weather && !failed && (
        <>
          {/* 第二行：今日天气（左） + 未来 3 日简报（右），横向并排压缩高度 */}
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
        </>
      )}
    </View>
  );
};

export default WeatherCard;
