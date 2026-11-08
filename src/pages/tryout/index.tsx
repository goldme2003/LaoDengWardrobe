import React from 'react';
import { View, Text, ScrollView, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';

/** 备选/待购 Tab（v0.5 / T-7） */
const TryoutPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const tryouts = useWardrobeStore((s) => s.tryouts);
  const addTryout = useWardrobeStore((s) => s.addTryout);
  const cur = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = { '--w-color': cur?.color || '#E8684A' } as React.CSSProperties;
  const mine = tryouts.filter((t) => t.wardrobeId === currentWardrobeId);

  const goNew = () => Taro.navigateTo({ url: '/pages/tryout-edit/index' });
  const goEdit = (id: string) => Taro.navigateTo({ url: `/pages/tryout-edit/index?id=${id}` });

  const quickAdd = async () => {
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'] });
      const src = res.tempFilePaths?.[0];
      if (src) { addTryout(src, ''); Taro.showToast({ title: '已加入备选', icon: 'success' }); }
    } catch {}
  };

  return (
    <View style={{ minHeight: '100vh', background: '#faf6f1', paddingBottom: '200rpx' }}>
      <View style={themeStyle}>
        <View style={{ background: '#fff', padding: '32rpx 28rpx', borderBottom: '1rpx solid #f2ede4' }}>
          <Text style={{ fontSize: '36rpx', fontWeight: '700', color: '#3a2e25', display: 'block' }}>🛍️ 备选 / 待购</Text>
          <Text style={{ fontSize: '24rpx', color: '#a39385', marginTop: '8rpx', display: 'block' }}>
            试穿图、商品图、犹豫点都记在这里，购入后再整理进衣柜
          </Text>
        </View>

        {mine.length === 0 ? (
          <View style={{ padding: '160rpx 60rpx', textAlign: 'center' }}>
            <Text style={{ fontSize: '96rpx', display: 'block' }}>🛍️</Text>
            <Text style={{ fontSize: '30rpx', color: '#a39385', display: 'block', marginTop: '20rpx' }}>还没有备选记录</Text>
            <Text style={{ fontSize: '24rpx', color: '#a39385', display: 'block', marginTop: '6rpx' }}>拍一张试穿图或者商品图，先记录下来</Text>
          </View>
        ) : (
          <ScrollView scrollY style={{ padding: '20rpx' }}>
            <View style={{ display: 'flex', flexWrap: 'wrap' }}>
              {mine.map((t) => (
                <View key={t.id} onClick={() => goEdit(t.id)} style={{
                  width: '48%', margin: '1%', background: '#fff',
                  borderRadius: '16rpx', overflow: 'hidden',
                  boxShadow: '0 2rpx 10rpx rgba(0,0,0,0.06)'
                }}>
                  <Image src={t.photo} style={{ width: '100%', height: '320rpx' }} mode='aspectFill' />
                  <View style={{ padding: '12rpx 16rpx' }}>
                    <Text style={{ fontSize: '26rpx', color: '#3a2e25', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {t.description || '（点击补充描述）'}
                    </Text>
                    {t.source && <Text style={{ fontSize: '20rpx', color: '#a39385', marginTop: '6rpx', display: 'block' }}>{t.source}</Text>}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        <View onClick={quickAdd} style={{
          position: 'fixed', right: '36rpx', bottom: '200rpx',
          width: '100rpx', height: '100rpx', borderRadius: '50rpx',
          background: 'var(--w-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8rpx 24rpx rgba(0,0,0,0.2)'
        }}>
          <Text style={{ color: '#fff', fontSize: '60rpx', lineHeight: 1 }}>+</Text>
        </View>

        <View onClick={goNew} style={{
          position: 'fixed', right: '150rpx', bottom: '212rpx',
          fontSize: '26rpx', color: '#6b5e52', padding: '12rpx 24rpx',
          background: '#fff', borderRadius: '32rpx', boxShadow: '0 4rpx 12rpx rgba(0,0,0,0.1)',
          border: '1rpx solid #ece3d7'
        }}>新建备选列表</View>
      </View>
    </View>
  );
};
export default TryoutPage;
