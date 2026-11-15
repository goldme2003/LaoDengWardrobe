import React, { useEffect } from 'react';
import Taro, { useDidShow, useDidHide, useLaunch } from '@tarojs/taro';
import { CLOUD_ENV_ID, RECOGNIZE_AVAILABLE } from '@/config/cloud';
// 全局样式
import './app.scss';

/** v1.4.3：小程序启动标记，首页读取后自动执行一次穿搭推荐（storage key，与首页保持一致） */
const APP_LAUNCH_FLAG = 'ldw_app_launched';

function App(props) {
  // v1.4.3：冷启动标记（首页 useDidShow 消费并刷新推荐，tab 间切换不重复触发）
  useLaunch(() => {
    try {
      Taro.setStorageSync(APP_LAUNCH_FLAG, '1');
      console.info('[App] 小程序启动，已标记首页自动推荐');
    } catch (e) {
      console.warn('[App] 启动标记写入失败', e);
    }
  });

  // 可以使用所有的 React Hooks
  useEffect(() => {
    // v1.2.1：云开发在小程序启动时初始化（原在页面渲染期惰性初始化，调试环境下偶发调用失败）
    if (!RECOGNIZE_AVAILABLE) return;
    try {
      Taro.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
      console.info('[Cloud] 云开发初始化完成, env =', CLOUD_ENV_ID);
    } catch (e) {
      console.error('[Cloud] 云开发初始化失败，请检查环境 ID 与云开发开通状态', e);
    }
  }, []);

  // 对应 onShow
  useDidShow(() => {});

  // 对应 onHide
  useDidHide(() => {});

  return props.children;
}

export default App;
