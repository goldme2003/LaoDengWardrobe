import React, { useMemo, useState } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import dayjs from 'dayjs';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { MAX_PHOTOS, samplePhoto, themeVarsOf } from '@/data/presets';
import styles from './index.module.scss';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 着装日记（v0.6 用户意见 5）：日历查看每日着装，拍照记录当天着装 */
const DiaryPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const diaryEntries = useWardrobeStore((s) => s.diaryEntries);
  const addDiaryEntry = useWardrobeStore((s) => s.addDiaryEntry);
  const deleteDiaryEntry = useWardrobeStore((s) => s.deleteDiaryEntry);

  const today = dayjs().format('YYYY-MM-DD');
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [selectedDate, setSelectedDate] = useState(today);

  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  // 当前衣橱的日记（按衣橱归属）
  const entries = useMemo(
    () => diaryEntries.filter((d) => d.wardrobeId === currentWardrobeId),
    [diaryEntries, currentWardrobeId]
  );
  const dateSet = useMemo(() => new Set(entries.map((d) => d.date)), [entries]);
  const selectedEntries = useMemo(
    () => entries.filter((d) => d.date === selectedDate).sort((a, b) => b.createdAt - a.createdAt),
    [entries, selectedDate]
  );

  // 月历格子：前置空白 + 当月天数
  const cells = useMemo(() => {
    const first = dayjs(`${month}-01`);
    const daysInMonth = first.daysInMonth();
    const leading = first.day();
    const list: (string | null)[] = [];
    for (let i = 0; i < leading; i += 1) list.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      list.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    return list;
  }, [month]);

  const shiftMonth = (delta: number) => {
    setMonth(dayjs(`${month}-01`).add(delta, 'month').format('YYYY-MM'));
  };

  const addPhotos = async (source: 'camera' | 'album') => {
    try {
      const res = await Taro.chooseImage({
        count: source === 'album' ? MAX_PHOTOS : 1,
        sizeType: ['compressed'],
        sourceType: [source === 'camera' ? 'camera' : 'album']
      });
      const paths = res.tempFilePaths || [];
      if (paths.length > 0) {
        addDiaryEntry(selectedDate, paths.slice(0, MAX_PHOTOS));
        console.info('[Diary] 记录着装, date =', selectedDate, '照片数 =', paths.length);
        Taro.showToast({ title: '已记录', icon: 'success' });
      }
    } catch (e) {
      console.warn('[Diary] 选择照片取消或失败', e);
    }
  };

  const addSample = () => {
    addDiaryEntry(selectedDate, [samplePhoto(Date.now() % 6)]);
    console.info('[Diary] 添加示例照片, date =', selectedDate);
    Taro.showToast({ title: '已记录', icon: 'success' });
  };

  const handleDelete = (id: string) => {
    Taro.showModal({
      title: '删除日记',
      content: '确定删除这条着装记录吗？',
      confirmColor: '#F53F3F',
      success: (res) => {
        if (res.confirm) {
          deleteDiaryEntry(id);
          Taro.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  };

  return (
    <View className={styles.page} style={themeStyle}>
      {/* 月历控件 */}
      <View className={styles.card}>
        <View className={styles.calHeader}>
          <Text className={styles.calNav} onClick={() => shiftMonth(-1)}>
            ‹
          </Text>
          <Text className={styles.calTitle}>{dayjs(`${month}-01`).format('YYYY 年 M 月')}</Text>
          <Text className={styles.calNav} onClick={() => shiftMonth(1)}>
            ›
          </Text>
        </View>
        <View className={styles.calWeekRow}>
          {WEEK_LABELS.map((w) => (
            <Text key={w} className={styles.calWeek}>
              {w}
            </Text>
          ))}
        </View>
        <View className={styles.calGrid}>
          {cells.map((date, i) =>
            date ? (
              <View
                key={date}
                className={`${styles.calCell} ${date === selectedDate ? styles.calCellActive : ''} ${
                  date === today ? styles.calCellToday : ''
                }`}
                onClick={() => setSelectedDate(date)}
              >
                <Text className={styles.calDay}>{Number(date.slice(-2))}</Text>
                {dateSet.has(date) && <View className={styles.calDot} />}
              </View>
            ) : (
              <View key={`blank_${i}`} className={styles.calCell} />
            )
          )}
        </View>
      </View>

      {/* 选中日期的着装记录 */}
      <View className={styles.card}>
        <View className={styles.dayHeader}>
          <Text className={styles.dayTitle}>
            {selectedDate === today ? '今天' : selectedDate} 的着装
          </Text>
          <Text className={styles.dayCount}>{selectedEntries.length} 条</Text>
        </View>

        {selectedEntries.length === 0 ? (
          <Text className={styles.empty}>这一天还没有着装记录，拍一张吧</Text>
        ) : (
          selectedEntries.map((entry) => (
            <View key={entry.id} className={styles.entry}>
              <View className={styles.photoGrid}>
                {entry.photos.map((p, i) => (
                  <Image
                    key={`${p}_${i}`}
                    className={styles.photo}
                    src={p}
                    mode='aspectFill'
                    onClick={() => Taro.previewImage({ urls: entry.photos, current: p }).catch(() => undefined)}
                  />
                ))}
              </View>
              <View className={styles.entryFooter}>
                <Text className={styles.entryTime}>
                  {dayjs(entry.createdAt).format('HH:mm')} 记录 · {entry.photos.length} 张
                </Text>
                <Text className={styles.entryDelete} onClick={() => handleDelete(entry.id)}>
                  删除
                </Text>
              </View>
            </View>
          ))
        )}

        <View className={styles.actions}>
          <View className={styles.actionBtn} onClick={() => addPhotos('camera')}>
            <Text className={styles.actionBtnText}>拍照记录</Text>
          </View>
          <View className={styles.actionBtn} onClick={() => addPhotos('album')}>
            <Text className={styles.actionBtnText}>从相册选择</Text>
          </View>
          <View className={styles.actionBtn} onClick={addSample}>
            <Text className={styles.actionBtnText}>添加示例照片</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

export default DiaryPage;
