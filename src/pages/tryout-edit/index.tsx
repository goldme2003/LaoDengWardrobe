import React, { useState, useMemo } from 'react';
import { View, Text, Image, Input, Textarea } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { MAX_PHOTOS } from '@/data/presets';

const TryoutEditPage: React.FC = () => {
  const router = useRouter();
  const editId = router.params.id;
  const tryouts = useWardrobeStore((s) => s.tryouts);
  const currentWardrobe = useWardrobeStore((s) => s.currentWardrobe());
  const addTryout = useWardrobeStore((s) => s.addTryout);
  const updateTryout = useWardrobeStore((s) => s.updateTryout);
  const deleteTryout = useWardrobeStore((s) => s.deleteTryout);

  const editing = useMemo(() => tryouts.find((t) => t.id === editId), [tryouts, editId]);
  const [photo, setPhoto] = useState('');
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');

  React.useEffect(() => {
    if (editing) {
      setPhoto(editing.photo); setExtraPhotos(editing.extraPhotos);
      setDescription(editing.description); setSource(editing.source || '');
      Taro.setNavigationBarTitle({ title: '编辑备选' });
    }
  }, [editing]);

  const themeStyle = { '--w-color': currentWardrobe?.color || '#E8684A' } as React.CSSProperties;

  const pickMain = async () => {
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'] });
      if (res.tempFilePaths?.[0]) setPhoto(res.tempFilePaths[0]);
    } catch {}
  };
  const pickExtra = async () => {
    if (extraPhotos.length >= MAX_PHOTOS - 1) { Taro.showToast({ title: `附加图最多 ${MAX_PHOTOS - 1} 张`, icon: 'none' }); return; }
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'] });
      if (res.tempFilePaths?.[0]) setExtraPhotos([...extraPhotos, res.tempFilePaths[0]]);
    } catch {}
  };
  const removeExtra = (i: number) => setExtraPhotos(extraPhotos.filter((_, idx) => idx !== i));

  const save = () => {
    if (!photo) { Taro.showToast({ title: '请先添加主图', icon: 'none' }); return; }
    if (editing) {
      updateTryout(editing.id, { photo, extraPhotos, description, source });
    } else {
      addTryout(photo, description, extraPhotos, source);
    }
    Taro.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => Taro.navigateBack(), 400);
  };
  const remove = () => {
    if (!editing) return;
    Taro.showModal({ title: '删除备选', content: '删除后无法恢复，确定？', confirmColor: '#F53F3F',
      success: (res) => { if (res.confirm) { deleteTryout(editing.id); Taro.navigateBack(); } } });
  };

  return (
    <View style={{ minHeight: '100vh', background: '#faf6f1' }}>
      <View style={themeStyle}>
        <View style={{ background: '#fff', margin: '20rpx', borderRadius: '16rpx', padding: '24rpx' }}>
          <Text style={{ fontSize: '28rpx', fontWeight: '600', marginBottom: '14rpx', display: 'block' }}>主图</Text>
          {photo ? (
            <View style={{ position: 'relative' }}>
              <Image src={photo} style={{ width: '100%', height: '460rpx', borderRadius: '12rpx' }} mode='aspectFill' />
              <Text onClick={() => setPhoto('')} style={{ position: 'absolute', top: '16rpx', right: '16rpx', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '24rpx', padding: '6rpx 16rpx', borderRadius: '20rpx' }}>更换</Text>
            </View>
          ) : (
            <View onClick={pickMain} style={{ height: '360rpx', background: '#faf6f1', borderRadius: '12rpx', border: '2rpx dashed #d4cbc0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <Text style={{ fontSize: '60rpx' }}>📷</Text>
              <Text style={{ fontSize: '26rpx', color: '#a39385', marginTop: '8rpx' }}>点击拍照或选择主图</Text>
            </View>
          )}

          <Text style={{ fontSize: '26rpx', margin: '24rpx 0 12rpx', display: 'block' }}>附加图片（试穿图 / 细节图，最多 {MAX_PHOTOS - 1} 张）</Text>
          <View style={{ display: 'flex', flexWrap: 'wrap' }}>
            {extraPhotos.map((p, i) => (
              <View key={`${p}_${i}`} style={{ margin: '8rpx', position: 'relative' }}>
                <Image src={p} style={{ width: '160rpx', height: '160rpx', borderRadius: '12rpx' }} mode='aspectFill' />
                <Text onClick={() => removeExtra(i)} style={{ position: 'absolute', top: '-4rpx', right: '-4rpx', background: '#f24b4b', color: '#fff', width: '36rpx', height: '36rpx', borderRadius: '18rpx', fontSize: '28rpx', lineHeight: '36rpx', textAlign: 'center' }}>×</Text>
              </View>
            ))}
            {extraPhotos.length < MAX_PHOTOS - 1 && (
              <View onClick={pickExtra} style={{ width: '160rpx', height: '160rpx', margin: '8rpx', background: '#faf6f1', border: '2rpx dashed #d4cbc0', borderRadius: '12rpx', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '60rpx', color: '#a39385' }}>+</View>
            )}
          </View>

          <Text style={{ fontSize: '26rpx', margin: '24rpx 0 12rpx', display: 'block' }}>描述 / 犹豫点</Text>
          <Textarea
            value={description} maxlength={200}
            placeholder='款式、价格、纠结点、试穿感受……'
            style={{ width: '100%', height: '200rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '16rpx', fontSize: '28rpx', boxSizing: 'border-box' }}
            onInput={(e) => setDescription(e.detail.value)}
          />

          <Text style={{ fontSize: '26rpx', margin: '20rpx 0 12rpx', display: 'block' }}>来源 / 链接（选填）</Text>
          <Input value={source} placeholder='电商链接 / 门店名 / 品牌'
            style={{ height: '72rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx', fontSize: '28rpx' }}
            onInput={(e) => setSource(e.detail.value)} />
        </View>

        <View style={{ padding: '20rpx' }}>
          <View onClick={save} style={{ height: '96rpx', background: 'var(--w-color)', borderRadius: '48rpx', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '32rpx', fontWeight: '600' }}>
            {editing ? '保存修改' : '加入备选清单'}
          </View>
          {editing && (
            <View onClick={remove} style={{ height: '72rpx', marginTop: '16rpx', borderRadius: '36rpx', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f24b4b', fontSize: '26rpx', border: '1rpx solid #f24b4b' }}>
              删除此备选
            </View>
          )}
        </View>
      </View>
    </View>
  );
};
export default TryoutEditPage;
