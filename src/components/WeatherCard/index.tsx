import React, { useState } from 'react';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { weatherIcon } from '@/data/presets';
import { WeatherInfo } from '@/types';
import { CityGroup } from '@/data/cities';
import styles from './index.module.scss';

interface Props {
  weather: WeatherInfo | null;
  loading: boolean;
  failed: boolean;
  cityGroups: CityGroup[];
  activeCity: string;
  onSelectCity: (city: string) => void;
  onRetry: () => void;
  /** v1.4.3：切换衣橱入口移至天气卡片右上角 */
  wardrobeName?: string;
  onSwitchWardrobe: () => void;
}

/** 天气卡片（PRD FR-09）：城市、今日天气与气温、未来 3 日简报
 * v1.3.0：城市切换由转盘 Picker 改为底部弹层列表——按拼音首字母分组排序，
 * 面板高度不超过屏幕 1/3，带右侧字母索引条 */
const WeatherCard: React.FC<Props> = ({
  weather,
  loading,
  failed,
  cityGroups,
  activeCity,
  onSelectCity,
  onRetry,
  wardrobeName,
  onSwitchWardrobe
}) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrollInto, setScrollInto] = useState('');
  // v1.4.3：城市列表外支持手动输入
  const [cityDraft, setCityDraft] = useState('');

  const openSheet = () => {
    setScrollInto('');
    setCityDraft('');
    setSheetOpen(true);
  };
  const pick = (city: string) => {
    setSheetOpen(false);
    setCityDraft('');
    if (city !== activeCity) onSelectCity(city);
  };
  // v1.4.3：手动输入城市（2–10 字），与列表点击走同一套切换逻辑
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
    console.info('[WeatherCard] 手动输入城市, city =', city);
    pick(city);
  };

  return (
    <View className={styles.card}>
      {/* 第一行：城市 + 状态/重试 + 右上角「切换城市 / 切换衣橱」 */}
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
        <View className={styles.headerRight}>
          <View className={styles.citySwitch} onClick={openSheet}>
            <Text className={styles.citySwitchText}>切换城市</Text>
            <Text className={styles.citySwitchArrow}>▾</Text>
          </View>
          {/* v1.4.3：切换衣橱按钮移至天气卡片右上角 */}
          <View className={styles.wardSwitch} onClick={onSwitchWardrobe}>
            <Text className={styles.wardSwitchText}>{wardrobeName ? `衣橱·${wardrobeName}` : '切换衣橱'}</Text>
            <Text className={styles.wardSwitchArrow}>▾</Text>
          </View>
        </View>
      </View>

      {weather && !failed && (
        <View className={styles.bodyRow}>
          {/* 第二行：今日天气（左） + 未来 3 日简报（右），横向并排压缩高度 */}
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

      {/* v1.3.0：城市选择弹层（≤1/3 屏高，拼音首字母分组 + 右侧索引条） */}
      {sheetOpen && (
        <View className={styles.sheetMask} onClick={() => setSheetOpen(false)}>
          <View className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <View className={styles.sheetHeader}>
              <Text className={styles.sheetTitle}>选择城市</Text>
              <Text className={styles.sheetClose} onClick={() => setSheetOpen(false)}>
                完成
              </Text>
            </View>
            {/* v1.4.3：手动输入城市（列表外的城市可直接填写） */}
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
            <View className={styles.sheetBody}>
              <ScrollView
                className={styles.sheetScroll}
                scrollY
                enhanced
                showScrollbar={false}
                scrollIntoView={scrollInto}
              >
                {cityGroups.map((g) => (
                  <View key={g.letter} id={`city-group-${g.letter}`} className={styles.group}>
                    <Text className={styles.groupLetter}>{g.letter}</Text>
                    <View className={styles.groupGrid}>
                      {g.cities.map((c) => (
                        <Text
                          key={c}
                          className={`${styles.cityCell} ${c === activeCity ? styles.cityCellActive : ''}`}
                          onClick={() => pick(c)}
                        >
                          {c}
                        </Text>
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <View className={styles.indexBar}>
                {cityGroups.map((g) => (
                  <Text
                    key={g.letter}
                    className={styles.indexLetter}
                    onClick={() => setScrollInto(`city-group-${g.letter}`)}
                  >
                    {g.letter}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

export default WeatherCard;
