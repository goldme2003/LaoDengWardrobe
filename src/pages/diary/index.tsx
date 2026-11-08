import React from 'react';
import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

/** 着装日记（PRD P1 占位页）：功能开发中 */
const DiaryPage: React.FC = () => {
  return (
    <View className={styles.page}>
      <Text className={styles.icon}>📔</Text>
      <Text className={styles.title}>着装日记</Text>
      <Text className={styles.desc}>
        按日期记录每一天的穿着搭配{'\n'}该功能正在开发中，将于后续版本上线
      </Text>
    </View>
  );
};

export default DiaryPage;
