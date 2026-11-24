/** 导出 JSON 兜底备份（v1.15.0，R-5 M1，见《云端同步设计方案》10/11）
 * 数据范围 = 同步范围数据（衣橱/衣物/日记/自定义项/场景/喜爱品牌/备选条目/身体数据/编号计数器），
 * 不含明日穿搭勾选、推荐缓存与推荐产物（与云端快照口径一致，见设计方案 4.4）。
 * 微信端：写入用户文件目录 → 通过微信转发保存（shareFileMessage）；
 * H5 端：浏览器 Blob 下载兜底（开发预览用）。 */
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { buildSnapshotData } from '@/services/sync';
import { APP_VERSION } from '@/data/presets';

const pad2 = (n: number) => String(n).padStart(2, '0');

const dateStamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};

const buildPayload = (): Record<string, unknown> => {
  const s = useWardrobeStore.getState();
  return {
    app: 'laodeng-wardrobe',
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    note: '老登衣柜数据备份（同步范围：衣橱、衣物、着装日记、自定义项、自定义场景、喜爱品牌、备选条目、身体数据、编号计数器；不含明日穿搭记录与推荐缓存）',
    data: buildSnapshotData(s)
  };
};

/**
 * 导出备份并交给用户保存/分享。
 * 返回是否成功；用户在分享面板取消不视为失败。
 */
export const exportBackup = async (): Promise<boolean> => {
  const content = JSON.stringify(buildPayload(), null, 2);
  const stamp = dateStamp();
  const fileName = `laodeng-backup-${stamp}.json`;

  // H5：浏览器下载（开发预览兜底）
  if (process.env.TARO_ENV !== 'weapp') {
    try {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      return true;
    } catch (e) {
      console.error('[Export] H5 导出失败', e);
      return false;
    }
  }

  // 微信端：写文件 → 微信转发保存
  try {
    const fs = Taro.getFileSystemManager();
    const filePath = `${Taro.env.USER_DATA_PATH}/${fileName}`;
    fs.writeFileSync(filePath, content, 'utf8');
    try {
      await Taro.shareFileMessage({
        filePath,
        fileName: `老登衣柜备份-${stamp}.json`
      });
      return true;
    } catch (e: any) {
      // 用户取消分享不算失败；其他异常提示文件已生成可重试
      if (e?.errMsg && String(e.errMsg).includes('cancel')) return true;
      console.warn('[Export] 分享失败:', e?.errMsg || e);
      Taro.showToast({ title: '备份已生成，但转发未完成，可重试', icon: 'none' });
      return false;
    }
  } catch (e) {
    console.error('[Export] 备份文件写入失败', e);
    Taro.showToast({ title: '备份文件写入失败', icon: 'none' });
    return false;
  }
};
