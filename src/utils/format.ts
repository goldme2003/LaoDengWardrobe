import dayjs from 'dayjs';

/** 3 位流水号（001 起） */
export const pad3 = (n: number): string => String(n).padStart(3, '0');

/** 生成唯一 id */
export const genId = (): string => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** 格式化日期：2026-11-07 */
export const formatDate = (ts: number): string => dayjs(ts).format('YYYY-MM-DD');

/** 格式化日期时间 */
export const formatDateTime = (ts: number): string => dayjs(ts).format('YYYY-MM-DD HH:mm');
