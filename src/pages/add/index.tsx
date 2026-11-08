import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, Image, Input, Textarea, Picker } from '@tarojs/components';
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
  ITEM_NAME_MAX_LEN,
  COLOR_HEX_MAP,
  SAMPLE_PHOTO_IDS,
  samplePhoto,
  buildBrandOptions
} from '@/data/presets';
import { CustomDimension, NewItemInput, PurchaseInfo } from '@/types';
import styles from './index.module.scss';

/** 添加/编辑衣物（PRD FR-02/FR-03/FR-05）：照片组 + 属性控件 + 备注 */
const AddItemPage: React.FC = () => {
  const router = useRouter();
  const editId = router.params.id;

  const items = useWardrobeStore((s) => s.items);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const customOptions = useWardrobeStore((s) => s.customOptions);
  const favoriteBrands = useWardrobeStore((s) => s.favoriteBrands);
  const addItem = useWardrobeStore((s) => s.addItem);
  const updateItem = useWardrobeStore((s) => s.updateItem);
  const addCustomOption = useWardrobeStore((s) => s.addCustomOption);
  const removeCustomOption = useWardrobeStore((s) => s.removeCustomOption);
  const isCustomOptionUsed = useWardrobeStore((s) => s.isCustomOptionUsed);
  const toggleFavoriteBrand = useWardrobeStore((s) => s.toggleFavoriteBrand);
  const isFavoriteBrand = useWardrobeStore((s) => s.isFavoriteBrand);

  const editing = useMemo(() => items.find((it) => it.id === editId), [items, editId]);
  const curWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  const bodyInfo = curWardrobe?.bodyInfo || {};

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
  const [purchasePhoto, setPurchasePhoto] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchaseLocation, setPurchaseLocation] = useState('');

  // 品牌联想提示：收藏优先 + 常用品牌 + 输入匹配
  const brandSuggestions = useMemo(() => {
    const kw = brand.trim();
    // 取本衣橱已使用过的品牌
    const existingBrands = items
      .filter((it) => it.wardrobeId === currentWardrobeId && (it.brand || '').trim())
      .map((it) => it.brand.trim());
    const all = buildBrandOptions(existingBrands, favoriteBrands);
    if (!kw) return all.slice(0, 24);
    return all.filter((b) => b.toLowerCase().includes(kw.toLowerCase()) && b !== kw).slice(0, 24);
  }, [brand, items, currentWardrobeId, favoriteBrands]);

  const favoriteBrandsOnTop = useMemo(
    () => favoriteBrands.filter((b) => b !== brand.trim()).slice(0, 8),
    [favoriteBrands, brand]
  );

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
      const p = editing.purchase || {};
      setPurchasePhoto(p.photo || '');
      setPurchaseDate(p.date || '');
      setPurchaseLocation(p.location || '');
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
    if (seasons.length === 0) return '请选择穿着季节（至少 1 项）';
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
      remark: remark.trim(),
      purchase: { date: purchaseDate, location: purchaseLocation, photo: purchasePhoto } as PurchaseInfo
    };
    if (editing) {
      // 仅在实际改名时传 name，避免用空值/旧值覆盖已有名称
      const trimmedName = name.trim();
      const nameChanged = trimmedName !== '' && trimmedName !== editing.name;
      updateItem(editing.id, nameChanged ? { ...payload, name: trimmedName } : payload);
      console.info('[Add] 更新衣物, id =', editing.id, 'nameChanged =', nameChanged);
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
          {editing ? (
            <Input
              className={styles.nameInput}
              value={name}
              maxlength={ITEM_NAME_MAX_LEN}
              placeholder={`名称（≤${ITEM_NAME_MAX_LEN}字），留空则保持原名`}
              onInput={(e) => setName(e.detail.value)}
            />
          ) : (
            <Text className={styles.namePreviewValue}>
              保存后按「用户-服装类型-编号」自动生成
            </Text>
          )}
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
          mode='chips'
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
          label='穿着季节'
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
          placeholder='选填 · 留空则按衣橱默认'
          onChange={(v) => setSize(v as string)}
        />

        <View className={styles.section}>
          <Text className={styles.brandLabel}>品牌（选填）</Text>
          <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx' }}>
            <Input
              className={styles.brandInput}
              value={brand}
              maxlength={BRAND_MAX_LEN}
              placeholder='输入品牌或点选下方常用品牌'
              style={{ flex: 1 }}
              onInput={(e) => setBrand(e.detail.value)}
            />
            {brand.trim() && (
              <Text
                style={{ fontSize: '44rpx', color: isFavoriteBrand(brand) ? '#F5A623' : '#D4CBC0', padding: '0 8rpx' }}
                onClick={() => toggleFavoriteBrand(brand)}
              >{isFavoriteBrand(brand) ? '★' : '☆'}</Text>
            )}
          </View>
          {favoriteBrandsOnTop.length > 0 && (
            <View className={styles.brandSuggest}>
              <Text style={{ fontSize: '22rpx', color: '#a39385', marginRight: '10rpx' }}>收藏：</Text>
              {favoriteBrandsOnTop.map((b) => (
                <View key={b} className={styles.brandChip} onClick={() => setBrand(b)}>
                  <Text className={styles.brandChipText}>★ {b}</Text>
                </View>
              ))}
            </View>
          )}
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

        <View className={styles.section} style={{ marginTop: '8rpx' }}>
          <Text className={styles.brandLabel}>购入信息（选填）</Text>

          <View style={{ display: 'flex', alignItems: 'center', marginBottom: '14rpx' }}>
            <Text style={{ width: '140rpx', fontSize: '26rpx', color: '#6b5e52' }}>购入日期</Text>
            <Picker mode='date' value={purchaseDate} onChange={(e) => setPurchaseDate(e.detail.value)}>
              <View style={{ flex: 1, height: '72rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: '28rpx', color: purchaseDate ? '#3a2e25' : '#d4cbc0' }}>{purchaseDate || '选择日期'}</Text>
                <Text style={{ color: '#a39385' }}>▾</Text>
              </View>
            </Picker>
          </View>

          <View style={{ display: 'flex', alignItems: 'center', marginBottom: '14rpx' }}>
            <Text style={{ width: '140rpx', fontSize: '26rpx', color: '#6b5e52' }}>购入地点</Text>
            <Input
              style={{ flex: 1, height: '72rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx', fontSize: '28rpx' }}
              value={purchaseLocation}
              placeholder='门店 / 电商平台 / 代购'
              maxlength={30}
              onInput={(e) => setPurchaseLocation(e.detail.value)}
            />
          </View>

          <View style={{ display: 'flex', alignItems: 'center' }}>
            <Text style={{ width: '140rpx', fontSize: '26rpx', color: '#6b5e52' }}>购入凭证</Text>
            {purchasePhoto ? (
              <View style={{ position: 'relative', marginRight: '12rpx' }}>
                <Image src={purchasePhoto} style={{ width: '140rpx', height: '140rpx', borderRadius: '12rpx' }} mode='aspectFill' />
                <Text onClick={() => setPurchasePhoto('')} style={{ position: 'absolute', top: '-8rpx', right: '-8rpx', background: '#f24b4b', color: '#fff', width: '36rpx', height: '36rpx', borderRadius: '18rpx', fontSize: '28rpx', lineHeight: '36rpx', textAlign: 'center' }}>×</Text>
              </View>
            ) : (
              <View onClick={async () => {
                try {
                  const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'] });
                  if (res.tempFilePaths?.[0]) setPurchasePhoto(res.tempFilePaths[0]);
                } catch {}
              }} style={{ width: '140rpx', height: '140rpx', background: '#faf6f1', border: '2rpx dashed #d4cbc0', borderRadius: '12rpx', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48rpx', color: '#a39385' }}>+</View>
            )}
          </View>
        </View>

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
