import React, { useEffect } from 'react';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
import { CLOUD_ENV_ID, RECOGNIZE_AVAILABLE } from '@/config/cloud';
// 全局样式
import './app.scss';

function App(props) {
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
