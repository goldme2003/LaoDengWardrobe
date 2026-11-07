import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, Image, Textarea } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import OptionSelector from '@/components/OptionSelector';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  TYPE_PRESETS,
  LAYER_OPTIONS,
  COLOR_PRESETS,
  MATERIAL_PRESETS,
  SIZE_OPTIONS,
  OCCASION_OPTIONS,
  BRAND_PRESETS,
  MAX_PHOTOS,
  REMARK_MAX_LEN,
  BRAND_MAX_LEN,
  COLOR_HEX_MAP,
  SAMPLE_PHOTO_IDS,
  samplePhoto
} from '@/data/presets';
import { CustomDimension, NewItemInput } from '@/types';
import styles from './index.module.scss';

/** 添加/编辑衣物（PRD FR-02/FR-03/FR-05）：照片组 + 属性控件 + 备注 */
const AddItemPage: React.FC = () => {
  const router = useRouter();
  const editId = router.params.id;

  const items = useWardrobeStore((s) => s.items);
  const customOptions = useWardrobeStore((s) => s.customOptions);
  const addItem = useWardrobeStore((s) => s.addItem);
  const updateItem = useWardrobeStore((s) => s.updateItem);
  const addCustomOption = useWardrobeStore((s) => s.addCustomOption);
  const removeCustomOption = useWardrobeStore((s) => s.removeCustomOption);
  const isCustomOptionUsed = useWardrobeStore((s) => s.isCustomOptionUsed);

  const editing = useMemo(() => items.find((it) => it.id === editId), [items, editId]);

  const [photos, setPhotos] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [layer, setLayer] = useState('');
  const [color, setColor] = useState('');
  const [material, setMaterial] = useState('');
  const [seasons, setSeasons] = useState<string[]>([]);
  const [size, setSize] = useState('');
  const [brand, setBrand] = useState('');
  const [occasions, setOccasions] = useState<string[]>([]);
  const [remark, setRemark] = useState('');
  const [name, setName] = useState('');

  // 品牌联想提示：输入时显示匹配的常用品牌；未输入时展示全部常用品牌
  const brandSuggestions = useMemo(() => {
    const kw = brand.trim();
    if (!kw) return BRAND_PRESETS;
    return BRAND_PRESETS.filter((b) => b.toLowerCase().includes(kw.toLowerCase()) && b !== kw);
  }, [brand]);

  // 编辑模式：载入现有数据
  useEffect(() => {
    if (editing) {
      setPhotos(editing.photos);
      setType(editing.type);
      setLayer(editing.layer);
      setColor(editing.color);
      setMaterial(editing.material);
      setSeasons(editing.seasons);
      setSize(editing.size || '');
      setBrand(editing.brand || '');
      setOccasions(editing.occasions || []);
      setRemark(editing.remark);
      setName(editing.name);
      Taro.setNavigationBarTitle({ title: '编辑衣物' });
    }
  }, [editing]);

  const sampleIndex = useState({ n: 0 })[0];

  const addPhoto = async (source: 'camera' | 'album') => {
    const remain = MAX_PHOTOS - photos.length;
    if (remain <= 0) {
      Taro.showToast({ title: `最多 ${MAX_PHOTOS} 张照片`, icon: 'none' });
      return;
    }
    try {
      const res = await Taro.chooseImage({
        count: source === 'album' ? remain : 1,
        sizeType: ['compressed'],
        sourceType: [source === 'camera' ? 'camera' : 'album']
      });
      const paths = res.tempFilePaths || [];
      console.info('[Add] 选择照片成功, 数量 =', paths.length);
      setPhotos((prev) => [...prev, ...paths].slice(0, MAX_PHOTOS));
    } catch (e) {
      console.warn('[Add] 选择照片取消或失败', e);
    }
  };

  const addSamplePhoto = () => {
    if (photos.length >= MAX_PHOTOS) {
      Taro.showToast({ title: `最多 ${MAX_PHOTOS} 张照片`, icon: 'none' });
      return;
    }
    const url = samplePhoto(sampleIndex.n);
    sampleIndex.n += 1;
    setPhotos((prev) => [...prev, url]);
    console.info('[Add] 添加示例照片, url =', url);
  };

  const removePhoto = (index: number) => {
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    if (next.length === 0) {
      // 照片组清空：返回衣柜页，不产生条目（PRD FR-02 第 6 条）
      Taro.showToast({ title: '已清空全部照片', icon: 'none' });
    }
  };

  const setMainPhoto = (index: number) => {
    if (index === 0) return;
    const next = [...photos];
    const [picked] = next.splice(index, 1);
    next.unshift(picked);
    setPhotos(next);
    Taro.showToast({ title: '已设为主图', icon: 'none' });
  };

  const customOf = (dimension: CustomDimension) =>
    customOptions.filter((o) => o.dimension === dimension).map((o) => o.value);

  const usedOf = (dimension: CustomDimension) =>
    customOf(dimension).filter((v) => isCustomOptionUsed(dimension, v));

  const validate = (): string | null => {
    if (photos.length === 0) return '请至少添加 1 张照片';
    if (!type) return '请选择服装类型';
    if (!layer) return '请选择内外穿';
    if (!color) return '请选择颜色';
    if (!material) return '请选择材质';
    if (seasons.length === 0) return '请选择季节（至少 1 项）';
    return null;
  };

  const handleSave = () => {
    const err = validate();
    if (err) {
      Taro.showToast({ title: err, icon: 'none' });
      return;
    }
    const payload: NewItemInput = {
      photos,
      type,
      layer,
      color,
      material,
      seasons,
      size,
      brand,
      occasions,
      remark: remark.trim()
    };
    if (editing) {
      updateItem(editing.id, { ...payload, name: name !== editing.name ? name : undefined });
      console.info('[Add] 更新衣物, id =', editing.id);
    } else {
      const created = addItem(payload);
      console.info('[Add] 保存衣物, name =', created.name);
    }
    Taro.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => Taro.navigateBack(), 600);
  };

  return (
    <View className={styles.page}>
      <View className={styles.photoSection}>
        <Text className={styles.sectionTitle}>
          照片组（{photos.length}/{MAX_PHOTOS}）
        </Text>
        <View className={styles.photoGrid}>
          {photos.map((p, i) => (
            <View key={`${p}_${i}`} className={styles.photoItem}>
              <Image
                className={styles.photo}
                src={p}
                mode='aspectFill'
                onClick={() => setMainPhoto(i)}
                onError={() => console.error('[Add] 照片加载失败, src =', p)}
              />
              {i === 0 && (
                <View className={styles.mainBadge}>
                  <Text className={styles.mainBadgeText}>主图</Text>
                </View>
              )}
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
        <Text className={styles.remarkCount}>点击照片设为主图，第 1 张为列表展示图</Text>
      </View>

      <View className={styles.formCard}>
        <View className={styles.namePreview}>
          <Text className={styles.namePreviewLabel}>名称</Text>
          <Text className={styles.namePreviewValue}>
            {name || '保存后按「用户-服装类型-编号」自动生成'}
          </Text>
        </View>

        <OptionSelector
          label='服装类型'
          required
          mode='picker'
          options={TYPE_PRESETS}
          customValues={customOf('type')}
          usedValues={usedOf('type')}
          allowCustom
          customMaxLength={10}
          value={type}
          onChange={(v) => setType(v as string)}
          onAddCustom={(v) => addCustomOption('type', v)}
          onRemoveCustom={(v) => removeCustomOption('type', v)}
        />

        <OptionSelector
          label='内外穿'
          required
          mode='picker'
          options={LAYER_OPTIONS}
          value={layer}
          onChange={(v) => setLayer(v as string)}
        />

        <OptionSelector
          label='颜色'
          required
          mode='chips'
          options={COLOR_PRESETS.map((c) => c.name)}
          customValues={customOf('color')}
          usedValues={usedOf('color')}
          allowCustom
          customMaxLength={6}
          colorHexMap={COLOR_HEX_MAP}
          value={color}
          onChange={(v) => setColor(v as string)}
          onAddCustom={(v) => addCustomOption('color', v)}
          onRemoveCustom={(v) => removeCustomOption('color', v)}
        />

        <OptionSelector
          label='材质'
          required
          mode='picker'
          options={MATERIAL_PRESETS}
          customValues={customOf('material')}
          usedValues={usedOf('material')}
          allowCustom
          customMaxLength={10}
          value={material}
          onChange={(v) => setMaterial(v as string)}
          onAddCustom={(v) => addCustomOption('material', v)}
          onRemoveCustom={(v) => removeCustomOption('material', v)}
        />

        <OptionSelector
          label='季节'
          required
          mode='multi'
          options={['春', '夏', '秋', '冬']}
          value={seasons}
          onChange={(v) => setSeasons(v as string[])}
        />

        <OptionSelector
          label='尺码'
          mode='picker'
          options={SIZE_OPTIONS}
          value={size}
          placeholder='请选择尺码（选填）'
          onChange={(v) => setSize(v as string)}
        />

        <View className={styles.section}>
          <Text className={styles.brandLabel}>品牌（选填）</Text>
          <Input
            className={styles.brandInput}
            value={brand}
            maxlength={BRAND_MAX_LEN}
            placeholder='输入品牌或点选下方常用品牌，≤20 字'
            onInput={(e) => setBrand(e.detail.value)}
          />
          {brandSuggestions.length > 0 && (
            <View className={styles.brandSuggest}>
              {brandSuggestions.map((b) => (
                <View key={b} className={styles.brandChip} onClick={() => setBrand(b)}>
                  <Text className={styles.brandChipText}>{b}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <OptionSelector
          label='适用场合'
          mode='multi'
          options={OCCASION_OPTIONS}
          value={occasions}
          onChange={(v) => setOccasions(v as string[])}
        />

        <View className={styles.sectionTitle}>
          <Text className={styles.sectionTitle}>备注（选填）</Text>
        </View>
        <Textarea
          className={styles.remarkInput}
          value={remark}
          maxlength={REMARK_MAX_LEN}
          placeholder='清洗方法、衣物来源、购买渠道等，≤200 字'
          onInput={(e) => setRemark(e.detail.value)}
        />
        <Text className={styles.remarkCount}>
          {remark.length}/{REMARK_MAX_LEN}
        </Text>
      </View>

      <View className={styles.bottomBar}>
        <View className={styles.saveBtn} onClick={handleSave}>
          <Text className={styles.saveBtnText}>{editing ? '保存修改' : '保存衣物'}</Text>
        </View>
      </View>
    </View>
  );
};

export default AddItemPage;
