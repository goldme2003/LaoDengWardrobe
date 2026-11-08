import React from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { APP_VERSION, APP_BUILD } from '@/types';
import { GENDER_OPTIONS, BODY_FIELDS, getTheme } from '@/data/presets';

/** 我的页（v0.5：衣橱档案入口、个人版型、版本号） */
const MinePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const tryouts = useWardrobeStore((s) => s.tryouts);
  const cur = wardrobes.find((w) => w.id === currentWardrobeId);
  const theme = cur ? getTheme(cur.themeId) : getTheme('warm');
  const themeStyle = { '--w-color': cur?.color || theme.color } as React.CSSProperties;
  const totalCount = items.filter((it) => it.wardrobeId === currentWardrobeId).length;
  const favCount = items.filter((it) => it.wardrobeId === currentWardrobeId && it.favorite).length;
  const tryoutCount = tryouts.filter((t) => t.wardrobeId === currentWardrobeId).length;

  const goManage = () => Taro.navigateTo({ url: '/pages/wardrobes/index' });
  const goWardrobe = () => Taro.switchTab({ url: '/pages/wardrobe/index' });
  const goTryout = () => Taro.switchTab({ url: '/pages/tryout/index' });

  return (
    <ScrollView scrollY style={{ background: '#faf6f1', minHeight: '100vh' }}>
      <View style={themeStyle}>
        <View style={{ background: theme.bgCard, padding: '48rpx 32rpx 40rpx' }}>
          <Text style={{ fontSize: '40rpx', fontWeight: '700', color: '#3a2e25', display: 'block' }}>
            {cur?.name || '我的'} 的衣橱
          </Text>
          <Text style={{ fontSize: '24rpx', color: '#a39385', marginTop: '6rpx', display: 'block' }}>
            「{theme.label}」主题 · {GENDER_OPTIONS.find((g) => g.value === cur?.gender)?.label || '未填性别'}
            {cur?.age ? ` · ${cur.age}岁` : ''}
          </Text>
        </View>

        <View style={{ display: 'flex', padding: '24rpx' }}>
          {[
            { label: '衣物', v: totalCount }, { label: '喜爱', v: favCount }, { label: '备选', v: tryoutCount }
          ].map((s, i) => (
            <View key={i} style={{ flex: 1, background: '#fff', borderRadius: '16rpx', padding: '24rpx 0', textAlign: 'center', marginRight: i < 2 ? '12rpx' : 0, boxShadow: '0 2rpx 12rpx rgba(0,0,0,0.04)' }}>
              <Text style={{ fontSize: '44rpx', fontWeight: '700', color: 'var(--w-color)' }}>{s.v}</Text>
              <Text style={{ fontSize: '24rpx', color: '#a39385', display: 'block', marginTop: '4rpx' }}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={{ background: '#fff', margin: '0 24rpx 20rpx', borderRadius: '16rpx', overflow: 'hidden', boxShadow: '0 2rpx 12rpx rgba(0,0,0,0.04)' }}>
          <EntryItem icon='🧺' title='衣橱档案' desc='主题 · 性别年龄 · 个人版型' dot={cur?.color} onClick={goManage} />
          <EntryItem icon='👕' title='衣柜首页' desc='查看与管理当前衣橱的全部衣物' onClick={goWardrobe} />
          <EntryItem icon='🛍️' title='备选/待购' desc='试穿图、商品图与选购前记录' onClick={goTryout} />
        </View>

        <View style={{ background: '#fff', margin: '0 24rpx 48rpx', borderRadius: '16rpx', padding: '24rpx', boxShadow: '0 2rpx 12rpx rgba(0,0,0,0.04)' }}>
          <Text style={{ fontSize: '28rpx', fontWeight: '600', color: '#3a2e25', display: 'block', marginBottom: '16rpx' }}>关于</Text>
          <Row label='版本' value={`${APP_VERSION} (build ${APP_BUILD})`} />
          <Row label='数据' value='本机存储（卸载/清缓存会丢失）' />
          <Row label='衣橱' value={`${wardrobes.length} 个用户档案`} />
          <Text style={{ fontSize: '22rpx', color: '#a39385', marginTop: '16rpx', display: 'block' }}>老登衣柜 · 让每一天都从衣柜开始 🧥</Text>
        </View>
      </View>
    </ScrollView>
  );
};
const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ display: 'flex', alignItems: 'center', marginBottom: '8rpx' }}>
    <Text style={{ width: '120rpx', fontSize: '26rpx', color: '#6b5e52' }}>{label}</Text>
    <Text style={{ flex: 1, fontSize: '26rpx', color: '#3a2e25' }}>{value}</Text>
  </View>
);
const EntryItem: React.FC<{ icon: string; title: string; desc: string; dot?: string; onClick?: () => void }> = ({ icon, title, desc, dot, onClick }) => (
  <View onClick={onClick} style={{ display: 'flex', alignItems: 'center', padding: '22rpx 24rpx', borderBottom: '1rpx solid #f2ede4' }}>
    <Text style={{ fontSize: '40rpx', marginRight: '16rpx' }}>{icon}</Text>
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: '30rpx', color: '#3a2e25', fontWeight: '500', display: 'block' }}>{title}</Text>
      <Text style={{ fontSize: '22rpx', color: '#a39385', display: 'block', marginTop: '2rpx' }}>{desc}</Text>
    </View>
    {dot && <View style={{ width: '20rpx', height: '20rpx', borderRadius: '10rpx', background: dot, marginRight: '12rpx' }} />}
    <Text style={{ fontSize: '30rpx', color: '#a39385' }}>›</Text>
  </View>
);
export default MinePage;
