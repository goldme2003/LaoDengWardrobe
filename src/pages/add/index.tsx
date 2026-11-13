import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, Image, Input, Textarea, Picker } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import OptionSelector from '@/components/OptionSelector';
import BrandPicker from '@/components/BrandPicker';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  recognizePhoto,
  recognizeAvailable,
  isAutoRecognizeOn,
  setAutoRecognize,
  checkBudget
} from '@/services/recognize';
import { RecognizeResult } from '@/services/recognize';
import {
  LAYER_OPTIONS,
  COLOR_PRESETS,
  MATERIAL_PRESETS,
  SIZE_OPTIONS,
  WAIST_SIZE_OPTIONS,
  OCCASION_OPTIONS,
  BRAND_PRESETS,
  PURCHASE_PLACE_PRESETS,
  MAX_PHOTOS,
  REMARK_MAX_LEN,
  ITEM_NAME_MAX_LEN,
  COLOR_HEX_MAP,
  samplePhoto,
  getTypePresetsByGender,
  suggestSize,
  themeVarsOf
} from '@/data/presets';
import { CustomDimension, NewItemInput, PurchaseInfo } from '@/types';
import styles from './index.module.scss';

/** 添加/编辑衣物（PRD FR-02/FR-03/FR-05 / v0.5）：照片组 + 属性控件 + 购入信息 + 备注 */
const AddItemPage: React.FC = () => {
  const router = useRouter();
  const editId = router.params.id;
  // v0.5：从备选页转入正式录入
  const fromTryoutId = router.params.fromTryout || '';

  const items = useWardrobeStore((s) => s.items);
  const tryoutItems = useWardrobeStore((s) => s.tryoutItems);
  const customOptions = useWardrobeStore((s) => s.customOptions);
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  // v0.6：个人身体数据按衣橱归属（当前衣橱主人）
  const bodyProfile = useWardrobeStore((s) => s.bodyProfiles[s.currentWardrobeId]);
  const favoriteBrands = useWardrobeStore((s) => s.favoriteBrands);
  const addItem = useWardrobeStore((s) => s.addItem);
  const updateItem = useWardrobeStore((s) => s.updateItem);
  const deleteTryout = useWardrobeStore((s) => s.deleteTryout);
  const addCustomOption = useWardrobeStore((s) => s.addCustomOption);
  const removeCustomOption = useWardrobeStore((s) => s.removeCustomOption);
  const isCustomOptionUsed = useWardrobeStore((s) => s.isCustomOptionUsed);
  const toggleFavoriteBrand = useWardrobeStore((s) => s.toggleFavoriteBrand);

  const editing = useMemo(() => items.find((it) => it.id === editId), [items, editId]);
  const fromTryout = useMemo(
    () => tryoutItems.find((t) => t.id === fromTryoutId),
    [tryoutItems, fromTryoutId]
  );
  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  // v0.5：页面整体风格主题（底色/卡片/文本/圆角随衣橱主题变化）
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  const [photos, setPhotos] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [layer, setLayer] = useState('');
  const [color, setColor] = useState('');
  const [material, setMaterial] = useState('');
  const [seasons, setSeasons] = useState<string[]>([]);
  const [size, setSize] = useState('');
  const [brand, setBrand] = useState('');
  const [occasions, setOccasions] = useState<string[]>([]);
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePlace, setPurchasePlace] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchasePhoto, setPurchasePhoto] = useState('');
  const [remark, setRemark] = useState('');
  const [name, setName] = useState('');

  // v1.2 识别功能（PRD 9.3）：自动识别状态与手动入口
  const [recognizing, setRecognizing] = useState(false);
  const [recognTip, setRecognTip] = useState('');
  const recogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v1.2：自动识别主图（仅新增模式 + 功能可用 + 开关开启）；800ms 防抖 + 同图结果缓存；
  // 失败/超时不自动重试（避免浪费调用），提供「重新识别」手动入口（方案 2.3/2.4，Q4 自动触发）
  const mainPhoto = photos[0] || '';
  useEffect(() => {
    if (editing || fromTryoutId) return; // 编辑/备选转正式已有预填，不自动触发
    if (!recognizeAvailable() || !isAutoRecognizeOn()) return;
    if (!mainPhoto || /^https?:/.test(mainPhoto)) return; // 示例图为网络图，不上传识别
    if (checkBudget() === 'exceeded') {
      setRecognTip('本月识别额度已用尽，下月自动恢复');
      return;
    }
    if (recogTimer.current) clearTimeout(recogTimer.current);
    setRecognTip('');
    recogTimer.current = setTimeout(() => {
      runRecognize(mainPhoto, true);
    }, 800);
    return () => {
      if (recogTimer.current) clearTimeout(recogTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainPhoto]);

  // v1.2：执行识别并预填（仅填充空字段；用户已填/已改的值一律不覆盖，方案 2.4-1）
  const runRecognize = async (photo: string, silent: boolean) => {
    if (recognizing) return;
    setRecognizing(true);
    setRecognTip('');
    const outcome = await recognizePhoto(photo);
    setRecognizing(false);
    if (outcome.code === 'OK') {
      applyRecognize(outcome.data);
      return;
    }
    if (outcome.code === 'NO_CLOTHING') {
      setRecognTip('未识别到衣物，请重新拍摄');
      if (!silent) Taro.showToast({ title: outcome.message, icon: 'none' });
      return;
    }
    if (outcome.code === 'PRIVACY_DENIED') {
      setRecognTip('已关闭自动识别');
      return;
    }
    setRecognTip(outcome.code === 'BUDGET_EXCEEDED' ? outcome.message : '识别不可用，请手动填写');
  };

  const applyRecognize = (data: RecognizeResult) => {
    setType((prev) => prev || data.category);
    setLayer((prev) => prev || data.layer);
    setColor((prev) => prev || data.color);
    setMaterial((prev) => prev || data.material);
    setSeasons((prev) => (prev.length > 0 ? prev : data.seasons.slice(0, 2)));
    setSize((prev) => prev || data.size);
    setBrand((prev) => prev || data.brand);
    const extra = [data.careText ? `清洗：${data.careText}` : '', data.remarkExtra || '']
      .filter(Boolean)
      .join('；');
    if (extra) setRemark((prev) => (prev ? prev : extra.slice(0, REMARK_MAX_LEN)));
    setRecognTip('已自动预填，请核对并修改');
    if (data.warnings && data.warnings.length > 0) {
      console.info('[Add] 识别提示', data.warnings);
    }
    Taro.showToast({ title: '识别完成，已预填', icon: 'none' });
  };

  // v1.2：手动重新识别（用户点按触发，受熔断限制但不受自动开关限制）
  const manualRecognize = () => {
    if (!mainPhoto || /^https?:/.test(mainPhoto)) {
      Taro.showToast({ title: '请先拍照或选择本地照片', icon: 'none' });
      return;
    }
    runRecognize(mainPhoto, false);
  };

  // 已有衣物使用过的品牌（下拉前置）
  const usedBrands = useMemo(
    () => Array.from(new Set(items.map((it) => it.brand).filter((b) => b && b.trim()))),
    [items]
  );
  const allBrands = useMemo(
    () => Array.from(new Set([...BRAND_PRESETS, ...usedBrands])),
    [usedBrands]
  );

  // 初次进入：备选转正式预填 / 编辑载入 / 尺码按个人信息默认值
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
      setPurchaseDate(editing.purchase?.date || '');
      setPurchasePlace(editing.purchase?.place || '');
      setPurchasePrice(editing.purchase?.price || '');
      setPurchasePhoto(editing.purchase?.photo || '');
      setRemark(editing.remark);
      setName(editing.name);
      Taro.setNavigationBarTitle({ title: '编辑衣物' });
    } else if (fromTryout) {
      setPhotos(fromTryout.photos || []);
      setType(fromTryout.type || '');
      setColor(fromTryout.color || '');
      setBrand(fromTryout.brand || '');
      setSize(fromTryout.size || '');
      setPurchasePrice(fromTryout.price || '');
      setRemark(fromTryout.note || '');
      console.info('[Add] 备选转正式预填, tryoutId =', fromTryout.id);
    } else {
      // v0.5 用户意见 10：尺码选填，根据性别与身高预填默认值（可修改）
      const suggested = suggestSize(currentWardrobe?.gender, bodyProfile?.height);
      if (suggested) setSize(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // v0.5 用户意见 6：购入凭证照片（购买时可拍照）
  const addPurchasePhoto = async (source: 'camera' | 'album') => {
    try {
      const res = await Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: [source === 'camera' ? 'camera' : 'album']
      });
      const path = (res.tempFilePaths || [])[0];
      if (path) {
        setPurchasePhoto(path);
        console.info('[Add] 选择购入凭证照片成功');
      }
    } catch (e) {
      console.warn('[Add] 选择购入凭证照片取消或失败', e);
    }
  };

  const customOf = (dimension: CustomDimension) =>
    customOptions.filter((o) => o.dimension === dimension).map((o) => o.value);

  const usedOf = (dimension: CustomDimension) =>
    customOf(dimension).filter((v) => isCustomOptionUsed(dimension, v));

  // v0.5：服装类型按性别过滤（男性不含裙装/连衣裙），已选值兜底保留
  const typeOptions = useMemo(() => {
    const list = getTypePresetsByGender(currentWardrobe?.gender);
    if (type && !list.includes(type)) {
      return [...list, type];
    }
    return list;
  }, [currentWardrobe?.gender, type, customOptions]);

  // v0.7.0：尺码选项随服装类型联动（裤装 = 腰围 24–40 英寸；其他 = XS–XXL）
  const isPants = type === '裤装';
  const sizeOptions = isPants ? WAIST_SIZE_OPTIONS : SIZE_OPTIONS;

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
    const purchase: PurchaseInfo | undefined =
      purchaseDate || purchasePlace.trim() || purchasePrice.trim() || purchasePhoto
        ? {
            ...(purchaseDate ? { date: purchaseDate } : {}),
            ...(purchasePlace.trim() ? { place: purchasePlace.trim() } : {}),
            ...(purchasePrice.trim() ? { price: purchasePrice.trim() } : {}),
            ...(purchasePhoto ? { photo: purchasePhoto } : {})
          }
        : undefined;
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
      ...(purchase ? { purchase } : {}),
      remark: remark.trim()
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
      // 备选转正式：保存成功后移除备选条目
      if (fromTryoutId) {
        deleteTryout(fromTryoutId);
        console.info('[Add] 备选已转正式, tryoutId =', fromTryoutId);
      }
    }
    Taro.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => Taro.navigateBack(), 600);
  };

  return (
    <View className={styles.page} style={themeStyle}>
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

        {/* v1.2（PRD 9.3）：自动识别状态行（仅微信端且已配置云环境时展示） */}
        {recognizeAvailable() && (
          <View className={styles.recognRow}>
            <Text className={styles.recognTip}>
              {recognizing ? '正在识别衣物属性…' : recognTip || '已开启自动识别（主图）'}
            </Text>
            <View
              className={styles.recognAction}
              onClick={() => {
                const next = !isAutoRecognizeOn();
                setAutoRecognize(next);
                setRecognTip(next ? '' : '已关闭自动识别，可点「重新识别」手动触发');
              }}
            >
              <Text className={styles.recognActionText}>{isAutoRecognizeOn() ? '关闭自动' : '开启自动'}</Text>
            </View>
            {!recognizing && (
              <View className={styles.recognAction} onClick={manualRecognize}>
                <Text className={styles.recognActionText}>重新识别</Text>
              </View>
            )}
          </View>
        )}
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
              保存后按「类型-编号」自动生成（如：上装-007）
            </Text>
          )}
        </View>

        <OptionSelector
          label='服装类型'
          required
          mode='picker'
          options={typeOptions}
          customValues={customOf('type')}
          usedValues={usedOf('type')}
          allowCustom
          customMaxLength={10}
          value={type}
          onChange={(v) => {
            const nextType = v as string;
            setType(nextType);
            // v0.7.0：切换类型后若当前尺码不在新选项集中则清空
            setSize((prev) => {
              if (!prev) return prev;
              const opts = nextType === '裤装' ? WAIST_SIZE_OPTIONS : SIZE_OPTIONS;
              return opts.includes(prev) ? prev : '';
            });
          }}
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
          label='穿着季节'
          required
          mode='multi'
          options={['春', '夏', '秋', '冬']}
          value={seasons}
          onChange={(v) => setSeasons(v as string[])}
        />

        <OptionSelector
          label={isPants ? '腰围尺码（选填）' : '尺码（选填）'}
          mode='picker'
          options={sizeOptions}
          customValues={customOf('size')}
          usedValues={usedOf('size')}
          allowCustom
          customMaxLength={6}
          value={size}
          placeholder={
            isPants
              ? '请选择腰围尺寸（英寸，选填）'
              : '请选择尺码（选填，已按个人信息预填）'
          }
          onChange={(v) => setSize(v as string)}
          onAddCustom={(v) => addCustomOption('size', v)}
          onRemoveCustom={(v) => removeCustomOption('size', v)}
        />

        <BrandPicker
          value={brand}
          onChange={setBrand}
          allBrands={allBrands}
          usedBrands={usedBrands}
          favoriteBrands={favoriteBrands}
          onToggleFavorite={toggleFavoriteBrand}
        />

        <OptionSelector
          label='适用场合'
          mode='multi'
          options={OCCASION_OPTIONS}
          customValues={customOf('occasion')}
          usedValues={usedOf('occasion')}
          allowCustom
          customMaxLength={10}
          value={occasions}
          onChange={(v) => setOccasions(v as string[])}
          onAddCustom={(v) => addCustomOption('occasion', v)}
          onRemoveCustom={(v) => removeCustomOption('occasion', v)}
        />

        {/* v0.5 用户意见 6：购入信息（时间/地点/价格/凭证照片） */}
        <View className={styles.purchaseCard}>
          <Text className={styles.purchaseTitle}>购入信息（选填）</Text>

          <View className={styles.purchaseRow}>
            <Text className={styles.purchaseLabel}>购入时间</Text>
            <Picker
              mode='date'
              value={purchaseDate || undefined}
              onChange={(e) => setPurchaseDate(e.detail.value)}
            >
              <View className={styles.purchasePickerRow}>
                {purchaseDate ? (
                  <Text className={styles.purchaseValue}>{purchaseDate}</Text>
                ) : (
                  <Text className={styles.purchasePlaceholder}>选择日期</Text>
                )}
                <Text className={styles.purchaseArrow}>▾</Text>
              </View>
            </Picker>
          </View>

          <View className={styles.purchaseRow}>
            <Text className={styles.purchaseLabel}>购入地点</Text>
            <Input
              className={styles.purchaseInput}
              value={purchasePlace}
              maxlength={30}
              placeholder='如：淘宝 / 线下商场'
              onInput={(e) => setPurchasePlace(e.detail.value)}
            />
          </View>
          <View className={styles.placeChips}>
            {PURCHASE_PLACE_PRESETS.map((p) => (
              <View
                key={p}
                className={`${styles.placeChip} ${purchasePlace === p ? styles.placeChipActive : ''}`}
                onClick={() => setPurchasePlace(purchasePlace === p ? '' : p)}
              >
                <Text className={styles.placeChipText}>{p}</Text>
              </View>
            ))}
          </View>

          <View className={styles.purchaseRow}>
            <Text className={styles.purchaseLabel}>价格</Text>
            <Input
              className={styles.purchaseInput}
              type='digit'
              value={purchasePrice}
              maxlength={12}
              placeholder='金额（元）'
              onInput={(e) => setPurchasePrice(e.detail.value)}
            />
          </View>

          <View className={styles.purchaseRow}>
            <Text className={styles.purchaseLabel}>凭证照片</Text>
            {purchasePhoto ? (
              <View className={styles.receiptBox}>
                <Image
                  className={styles.receiptImage}
                  src={purchasePhoto}
                  mode='aspectFill'
                  onClick={() =>
                    Taro.previewImage({ urls: [purchasePhoto] }).catch(() => undefined)
                  }
                />
                <View className={styles.receiptDelete} onClick={() => setPurchasePhoto('')}>
                  <Text className={styles.receiptDeleteText}>×</Text>
                </View>
              </View>
            ) : (
              <View className={styles.purchaseActions}>
                <View className={styles.purchaseActionBtn} onClick={() => addPurchasePhoto('camera')}>
                  <Text className={styles.purchaseActionText}>拍照</Text>
                </View>
                <View className={styles.purchaseActionBtn} onClick={() => addPurchasePhoto('album')}>
                  <Text className={styles.purchaseActionText}>相册</Text>
                </View>
              </View>
            )}
          </View>
          <Text className={styles.remarkCount}>购买时可现场拍照留存小票/凭证</Text>
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
