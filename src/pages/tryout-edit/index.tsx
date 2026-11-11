import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, Image, Input, Textarea } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import OptionSelector from '@/components/OptionSelector';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  TYPE_PRESETS,
  COLOR_PRESETS,
  COLOR_HEX_MAP,
  SAMPLE_PHOTO_IDS,
  samplePhoto,
  themeVarsOf
} from '@/data/presets';
import styles from './index.module.scss';

const NOTE_MAX_LEN = 200;

/** 备选编辑页（v0.5 用户意见 7）：试穿/展示图片 + 名称/类型/颜色/品牌/尺码/价格/备注 */
const TryoutEditPage: React.FC = () => {
  const router = useRouter();
  const editId = router.params.id;

  const tryoutItems = useWardrobeStore((s) => s.tryoutItems);
  const addTryout = useWardrobeStore((s) => s.addTryout);
  const updateTryout = useWardrobeStore((s) => s.updateTryout);

  // v0.5：页面整体风格主题
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  const editing = useMemo(() => tryoutItems.find((t) => t.id === editId), [tryoutItems, editId]);

  const [photos, setPhotos] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [color, setColor] = useState('');
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (editing) {
      setPhotos(editing.photos || []);
      setName(editing.name === '未命名试穿' ? '' : editing.name);
      setType(editing.type || '');
      setColor(editing.color || '');
      setBrand(editing.brand || '');
      setSize(editing.size || '');
      setPrice(editing.price || '');
      setNote(editing.note || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sampleIndex = useState({ n: 0 })[0];

  const addPhoto = async (source: 'camera' | 'album') => {
    try {
      const res = await Taro.chooseImage({
        count: source === 'album' ? 9 - photos.length : 1,
        sizeType: ['compressed'],
        sourceType: [source === 'camera' ? 'camera' : 'album']
      });
      const paths = res.tempFilePaths || [];
      setPhotos((prev) => [...prev, ...paths].slice(0, 9));
    } catch (e) {
      console.warn('[TryoutEdit] 选择照片取消或失败', e);
    }
  };

  const addSamplePhoto = () => {
    const url = samplePhoto(sampleIndex.n);
    sampleIndex.n += 1;
    setPhotos((prev) => [...prev, url].slice(0, 9));
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (photos.length === 0) {
      Taro.showToast({ title: '请至少添加 1 张图片', icon: 'none' });
      return;
    }
    const payload = {
      photos,
      name: name.trim(),
      type,
      color,
      brand: brand.trim(),
      size,
      price: price.trim(),
      note: note.trim()
    };
    if (editing) {
      updateTryout(editing.id, payload);
    } else {
      addTryout(payload);
    }
    Taro.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => Taro.navigateBack(), 600);
  };

  return (
    <View className={styles.page} style={themeStyle}>
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>试穿/展示图片（{photos.length}/9）</Text>
        <View className={styles.photoGrid}>
          {photos.map((p, i) => (
            <View key={`${p}_${i}`} className={styles.photoItem}>
              <Image
                className={styles.photo}
                src={p}
                mode='aspectFill'
                onError={() => console.error('[TryoutEdit] 照片加载失败, src =', p)}
              />
              <View className={styles.photoDelete} onClick={() => removePhoto(i)}>
                <Text className={styles.photoDeleteText}>×</Text>
              </View>
            </View>
          ))}
        </View>
        <View className={styles.photoActions}>
          <View className={styles.actionBtn} onClick={() => addPhoto('camera')}>
            <Text className={styles.actionBtnText}>拍照</Text>
          </View>
          <View className={styles.actionBtn} onClick={() => addPhoto('album')}>
            <Text className={styles.actionBtnText}>从相册选择</Text>
          </View>
          <View className={styles.actionBtn} onClick={addSamplePhoto}>
            <Text className={styles.actionBtnText}>添加示例照片</Text>
          </View>
        </View>
        <Text className={styles.hint}>试穿照或卖家展示图，作为购入前的参考记录</Text>
      </View>

      <View className={styles.card}>
        <View className={styles.formRow}>
          <Text className={styles.formLabel}>名称</Text>
          <Input
            className={styles.formInput}
            value={name}
            maxlength={20}
            placeholder='如：春季风衣 候选（≤20 字）'
            onInput={(e) => setName(e.detail.value)}
          />
        </View>

        <OptionSelector
          label='期望类型'
          mode='picker'
          options={TYPE_PRESETS}
          value={type}
          placeholder='请选择期望类型（转正式时预填）'
          onChange={(v) => setType(v as string)}
        />

        <OptionSelector
          label='颜色'
          mode='chips'
          options={COLOR_PRESETS.map((c) => c.name)}
          colorHexMap={COLOR_HEX_MAP}
          value={color}
          onChange={(v) => setColor(v as string)}
        />

        <View className={styles.formRow}>
          <Text className={styles.formLabel}>品牌</Text>
          <Input
            className={styles.formInput}
            value={brand}
            maxlength={20}
            placeholder='品牌（选填）'
            onInput={(e) => setBrand(e.detail.value)}
          />
        </View>

        <View className={styles.formRow}>
          <Text className={styles.formLabel}>尺码</Text>
          <Input
            className={styles.formInput}
            value={size}
            maxlength={6}
            placeholder='尺码（选填）'
            onInput={(e) => setSize(e.detail.value)}
          />
        </View>

        <View className={styles.formRow}>
          <Text className={styles.formLabel}>期望价格</Text>
          <Input
            className={styles.formInput}
            type='digit'
            value={price}
            maxlength={12}
            placeholder='金额（元）'
            onInput={(e) => setPrice(e.detail.value)}
          />
        </View>

        <Text className={styles.formLabelBlock}>备注</Text>
        <Textarea
          className={styles.noteInput}
          value={note}
          maxlength={NOTE_MAX_LEN}
          placeholder='试穿感受、比价链接、购买计划等，≤200 字'
          onInput={(e) => setNote(e.detail.value)}
        />
        <Text className={styles.remarkCount}>
          {note.length}/{NOTE_MAX_LEN}
        </Text>
      </View>

      <View className={styles.bottomBar}>
        <View className={styles.saveBtn} onClick={handleSave}>
          <Text className={styles.saveBtnText}>{editing ? '保存修改' : '保存试穿'}</Text>
        </View>
      </View>
    </View>
  );
};

export default TryoutEditPage;
