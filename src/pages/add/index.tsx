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
  checkBudget,
  ensurePrivacyOk
} from '@/services/recognize';
import { RecognizeResult } from '@/services/recognize';
import { canAutoRecognize, batchImportQuota } from '@/services/entitlement';
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
  COLOR_HEX_MAP,
  getTypePresetsByGender,
  suggestSize,
  themeVarsOf
} from '@/data/presets';
import { CustomDimension, NewItemInput, PurchaseInfo } from '@/types';
import styles from './index.module.scss';

/** v1.4.3：按当前月份给出合理季节默认值（识别结果或用户修改前一直生效） */
const currentSeason = (): string => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
};

/** v1.4.3：新增衣物属性默认值——降低录入成本，识别结果仅在用户未改动时覆盖 */
const DEFAULT_TYPE = '上装';
const DEFAULT_LAYER = '外穿';
const DEFAULT_COLOR = '白色';
const DEFAULT_MATERIAL = '棉';
const DEFAULT_BRAND = '未知品牌';
const DEFAULT_OCCASION = '日常';
const DEFAULT_SIZE = 'M';

/** 属性字段 key（识别覆盖判断与编辑态保护共用） */
type AttrKey = 'type' | 'layer' | 'color' | 'material' | 'seasons' | 'size' | 'brand';
const ATTR_KEYS: AttrKey[] = ['type', 'layer', 'color', 'material', 'seasons', 'size', 'brand'];

/** v1.11.0：批量添加单次任务照片上限（每张照片存为一件衣物） */
const BATCH_MAX_PHOTOS = 9;

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
  // v1.11.0：会员档位（自动识别 / 批量添加权益门控）与批量添加计次
  const memberTier = useWardrobeStore((s) => s.memberTier);
  const memberUsage = useWardrobeStore((s) => s.memberUsage);
  const recordBatchImportUse = useWardrobeStore((s) => s.recordBatchImportUse);

  const editing = useMemo(() => items.find((it) => it.id === editId), [items, editId]);
  const fromTryout = useMemo(
    () => tryoutItems.find((t) => t.id === fromTryoutId),
    [tryoutItems, fromTryoutId]
  );
  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);
  // v0.5：页面整体风格主题（底色/卡片/文本/圆角随衣橱主题变化）
  const themeStyle = themeVarsOf(currentWardrobe) as unknown as React.CSSProperties;

  const [photos, setPhotos] = useState<string[]>([]);
  // v1.4.3：所有属性字段均预填合理默认值；识别结果只覆盖「用户尚未手动修改」的字段
  const [type, setType] = useState(DEFAULT_TYPE);
  const [layer, setLayer] = useState(DEFAULT_LAYER);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [material, setMaterial] = useState(DEFAULT_MATERIAL);
  const [seasons, setSeasons] = useState<string[]>([currentSeason()]);
  const [size, setSize] = useState(() => suggestSize(currentWardrobe?.gender, bodyProfile?.height) || DEFAULT_SIZE);
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [occasions, setOccasions] = useState<string[]>([DEFAULT_OCCASION]);
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePlace, setPurchasePlace] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchasePhoto, setPurchasePhoto] = useState('');
  const [remark, setRemark] = useState('');
  const [name, setName] = useState('');
  // v1.11.0：「衣物详细信息」折叠区（内外穿/材质/尺码/品牌/场合/购入信息/备注），默认收起
  const [detailOpen, setDetailOpen] = useState(false);

  // v1.2 识别功能（PRD 9.3）：自动识别状态与手动入口
  const [recognizing, setRecognizing] = useState(false);
  const [recognTip, setRecognTip] = useState('');
  const recogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v1.4.3：用户手动改过的字段集合——识别结果不覆盖这些字段
  const touchedRef = useRef<Set<AttrKey>>(new Set());
  // v1.4.3：并发保护（识别中不重复触发）与主图快照（主图变化后丢弃过期识别结果）
  const recognizingRef = useRef(false);
  const mainPhotoRef = useRef('');
  const markTouched = (key: AttrKey) => {
    touchedRef.current.add(key);
  };
  const isUntouched = (key: AttrKey) => !touchedRef.current.has(key);

  // v1.2：自动识别主图（v1.11.0 起：仅 VIP 及以上 + 新增模式 + 功能可用 + 开关开启）；
  // 800ms 防抖 + 同图结果缓存；失败/超时不自动重试（避免浪费调用），提供「重新识别」手动入口
  // 普通版（free）不自动识别：不发起请求、不展示开关与重新识别入口（PRD 9.3 v1.11.0 权益调整）
  const isVipPlus = canAutoRecognize(memberTier);
  const mainPhoto = photos[0] || '';
  // v1.4.3：主图快照同步——识别返回时若主图已变，丢弃过期结果
  useEffect(() => {
    mainPhotoRef.current = mainPhoto;
  }, [mainPhoto]);
  useEffect(() => {
    if (editing || fromTryoutId) return; // 编辑/备选转正式已有预填，不自动触发
    if (!isVipPlus) return; // v1.11.0：普通版不自动识别
    if (!recognizeAvailable() || !isAutoRecognizeOn()) return;
    if (!mainPhoto || /^https?:/.test(mainPhoto)) return;
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

  // v1.2：执行识别并预填；v1.4.3：仅覆盖用户未手动修改的字段，并丢弃主图变更后的过期结果
  const runRecognize = async (photo: string, silent: boolean) => {
    if (recognizingRef.current) return;
    recognizingRef.current = true;
    setRecognizing(true);
    setRecognTip('');
    // 方案 2.4-2：5s 未返回时给出「可继续手动填写」提示，不中断请求、不阻塞录入
    const slowTimer = setTimeout(() => {
      setRecognTip('识别较慢，可继续手动填写（已填写内容不会被覆盖）');
    }, 5000);
    const outcome = await recognizePhoto(photo);
    clearTimeout(slowTimer);
    recognizingRef.current = false;
    setRecognizing(false);
    // v1.4.3：识别期间用户换了主图，本次结果不再适用
    if (photo !== mainPhotoRef.current) {
      console.info('[Add] 主图已变更，忽略本次识别结果');
      setRecognTip('主图已更换，本次识别结果已忽略');
      return;
    }
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
    if (
      outcome.code === 'BUDGET_EXCEEDED' ||
      outcome.code === 'NOT_DEPLOYED' ||
      outcome.code === 'NOT_CONFIGURED' ||
      outcome.code === 'TIMEOUT' ||
      outcome.code === 'RECOGNIZE_FAILED'
    ) {
      // 直接展示云函数回传的分阶段原因，便于真机排障
      setRecognTip(outcome.message);
      return;
    }
    setRecognTip('识别不可用，请手动填写');
  };

  // v1.4.3：识别结果只更新未被用户手动修改的字段；识别值缺失时保留默认值
  const applyRecognize = (data: RecognizeResult) => {
    let applied = 0;
    if (isUntouched('type') && data.category) {
      setType(data.category);
      applied++;
    }
    if (isUntouched('layer') && data.layer) {
      setLayer(data.layer);
      applied++;
    }
    if (isUntouched('color') && (data.color || (data.colors && data.colors[0]))) {
      setColor(data.color || (data.colors && data.colors[0]) || '');
      applied++;
    }
    if (isUntouched('material') && data.material) {
      setMaterial(data.material);
      applied++;
    }
    if (isUntouched('seasons') && data.seasons && data.seasons.length > 0) {
      setSeasons(data.seasons.slice(0, 2));
      applied++;
    }
    if (isUntouched('size') && data.size) {
      setSize(data.size);
      applied++;
    }
    if (isUntouched('brand') && data.brand) {
      setBrand(data.brand);
      applied++;
    }
    console.info('[Add] 识别预填完成, 覆盖字段数 =', applied);
    const extra = [data.careText ? `清洗：${data.careText}` : '', data.remarkExtra || '']
      .filter(Boolean)
      .join('；');
    if (extra) setRemark((prev) => (prev ? prev : extra.slice(0, REMARK_MAX_LEN)));
    const warn = data.warnings && data.warnings.length > 0 ? data.warnings[0] : '';
    setRecognTip(
      applied === 0
        ? warn || '识别完成，你已修改的字段保持原值'
        : warn
          ? `已预填（保留你改过的字段），注意：${warn}`
          : '已自动预填，请核对并修改'
    );
    if (data.warnings && data.warnings.length > 0) {
      console.info('[Add] 识别提示', data.warnings);
    }
    Taro.showToast({ title: applied === 0 ? '已保留你的修改' : '识别完成，已预填', icon: 'none' });
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
      // v1.4.3：编辑态已有值视为用户数据，手动重新识别也不覆盖
      ATTR_KEYS.forEach((k) => touchedRef.current.add(k));
      Taro.setNavigationBarTitle({ title: '编辑衣物' });
    } else if (fromTryout) {
      setPhotos(fromTryout.photos || []);
      setType(fromTryout.type || DEFAULT_TYPE);
      setColor(fromTryout.color || DEFAULT_COLOR);
      setBrand(fromTryout.brand || DEFAULT_BRAND);
      setSize(fromTryout.size || DEFAULT_SIZE);
      setPurchasePrice(fromTryout.price || '');
      setRemark(fromTryout.note || '');
      // v1.4.3：备选已带的字段不参与识别覆盖
      (['type', 'color', 'brand', 'size'] as AttrKey[]).forEach((k) => {
        if (fromTryout[k as 'type' | 'color' | 'brand' | 'size']) touchedRef.current.add(k);
      });
      console.info('[Add] 备选转正式预填, tryoutId =', fromTryout.id);
    } else {
      // v0.5 用户意见 10：尺码选填，根据性别与身高预填默认值（可修改）
      const suggested = suggestSize(currentWardrobe?.gender, bodyProfile?.height);
      if (suggested) setSize(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // v1.11.0：批量添加（VIP 会员功能，PRD 8.6/10.6）——每张照片独立存为一件衣物，
  // 类型/颜色/穿着季节由自动识别填充，其余属性取默认值；处理期间展示「正在处理 x/y，请稍候」
  const handleBatchAdd = () => {
    if (editing || fromTryoutId) {
      Taro.showToast({ title: '批量添加仅用于新增衣物', icon: 'none' });
      return;
    }
    const quota = batchImportQuota(memberTier);
    if (quota.kind === 'blocked') {
      // 普通版：入口可见但受限，点击弹窗引导开通
      Taro.showModal({
        title: '批量添加为会员功能',
        content: '批量添加为 VIP/SVIP 专属权益：一次选择多张照片，每张照片自动存为一件衣物，并自动识别服装类型、颜色、穿着季节（VIP 5 次/月，SVIP 15 次/月）。',
        confirmText: '去开通',
        cancelText: '取消',
        success: (r) => {
          if (r.confirm) Taro.navigateTo({ url: '/pages/member/index' });
        }
      });
      return;
    }
    if ((memberUsage.batchImportUsed || 0) >= quota.limit) {
      Taro.showToast({ title: `本月批量添加额度已用尽（${quota.limit} 次/月），下月恢复`, icon: 'none' });
      return;
    }
    Taro.chooseImage({
      count: BATCH_MAX_PHOTOS,
      sizeType: ['compressed'],
      sourceType: ['album']
    })
      .then((res) => runBatchImport(res.tempFilePaths || []))
      .catch(() => console.info('[Add] 批量添加选图取消'));
  };

  const runBatchImport = async (paths: string[]) => {
    if (paths.length === 0) return;
    // 云识别可用时先完成隐私确认（蒙层展示期间无法弹窗，需前置完成）
    const canRecog = recognizeAvailable() && isVipPlus;
    if (canRecog) {
      const privacyOk = await ensurePrivacyOk();
      if (!privacyOk) {
        Taro.showToast({ title: '已取消批量添加（需同意照片识别说明）', icon: 'none' });
        return;
      }
    }
    console.info('[Add] 批量添加开始, 张数 =', paths.length, '自动识别 =', canRecog);
    Taro.showLoading({ title: `正在处理 1/${paths.length}，请稍候`, mask: true });
    let recognized = 0;
    for (let i = 0; i < paths.length; i++) {
      Taro.showLoading({ title: `正在处理 ${i + 1}/${paths.length}，请稍候`, mask: true });
      // 默认值（其他属性均为默认）：类型/颜色/季节由识别结果覆盖（识别成功时）
      let type = DEFAULT_TYPE;
      let color = DEFAULT_COLOR;
      let seasons = [currentSeason()];
      if (canRecog) {
        const outcome = await recognizePhoto(paths[i]);
        if (outcome.code === 'OK') {
          recognized++;
          const d = outcome.data;
          if (d.category) type = d.category;
          if (d.color || (d.colors && d.colors[0])) color = d.color || (d.colors && d.colors[0]) || color;
          if (d.seasons && d.seasons.length > 0) seasons = d.seasons.slice(0, 2);
        } else {
          console.warn('[Add] 批量识别失败, 以默认属性入库, path =', paths[i], 'code =', outcome.code);
        }
      }
      const created = addItem({
        photos: [paths[i]],
        type,
        layer: DEFAULT_LAYER,
        color,
        material: DEFAULT_MATERIAL,
        seasons,
        size: suggestSize(currentWardrobe?.gender, bodyProfile?.height) || DEFAULT_SIZE,
        brand: DEFAULT_BRAND,
        occasions: [DEFAULT_OCCASION],
        remark: ''
      });
      console.info('[Add] 批量添加入库, name =', created.name, 'type =', type, 'color =', color);
    }
    Taro.hideLoading();
    // 按次计数：单次批量任务 = 1 次
    recordBatchImportUse();
    const quotaTip = canRecog ? `（识别成功 ${recognized} 件）` : '';
    Taro.showToast({ title: `已添加 ${paths.length} 件衣物${quotaTip}`, icon: 'none', duration: 2000 });
    setTimeout(() => Taro.navigateBack(), 1200);
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
    if (!layer) {
      // v1.11.0：内外穿在折叠区内，校验失败自动展开
      setDetailOpen(true);
      return '请选择内外穿（衣物详细信息）';
    }
    if (!color) return '请选择颜色';
    if (!material) {
      setDetailOpen(true);
      return '请选择材质（衣物详细信息）';
    }
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
      // v1.2.0：记录新增衣物类型，衣柜页返回后由右侧标签栏定位到对应分组
      Taro.setStorageSync('ldw_jump_type', created.type);
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
          {/* v1.11.0：批量添加（VIP 会员功能），替代原「添加示例照片」入口；
              v1.11.2：已开通 VIP 及以上时不再展示 VIP 角标 */}
          <View className={styles.actionBtn} onClick={handleBatchAdd}>
            <Text className={styles.actionBtnText}>批量添加多件衣物</Text>
            {!isVipPlus && (
              <View className={styles.vipBadge}>
                <Text className={styles.vipBadgeText}>VIP</Text>
              </View>
            )}
          </View>
        </View>
        <Text className={styles.remarkCount}>
          点击照片设为主图，第 1 张为列表展示图；批量添加时每张照片将存为一件衣物，自动识别类型、颜色、季节
        </Text>

        {/* v1.11.0（PRD 9.3）：自动识别为 VIP 及以上专属功能，普通版不自动识别 */}
        {recognizeAvailable() && !isVipPlus && (
          <View className={styles.recognRow}>
            <Text className={styles.recognTip}>衣物属性自动识别为 VIP/SVIP 专属功能，普通版请手动选择属性</Text>
            <View
              className={styles.recognAction}
              onClick={() => Taro.navigateTo({ url: '/pages/member/index' })}
            >
              <Text className={styles.recognActionText}>去开通</Text>
            </View>
          </View>
        )}
        {recognizeAvailable() && isVipPlus && (
          <View className={styles.recognRow}>
            <Text className={styles.recognTip}>
              {recognizing
                ? '正在识别衣物属性…（可继续填写，已改字段不会被覆盖）'
                : recognTip || '已开启自动识别（主图）'}
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
            markTouched('type');
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
          label='颜色'
          required
          mode='chips'
          columns={4}
          options={COLOR_PRESETS.map((c) => c.name)}
          customValues={customOf('color')}
          usedValues={usedOf('color')}
          allowCustom
          customMaxLength={6}
          colorHexMap={COLOR_HEX_MAP}
          value={color}
          onChange={(v) => {
            markTouched('color');
            setColor(v as string);
          }}
          onAddCustom={(v) => addCustomOption('color', v)}
          onRemoveCustom={(v) => removeCustomOption('color', v)}
        />

        <OptionSelector
          label='穿着季节'
          required
          mode='multi'
          options={['春', '夏', '秋', '冬']}
          value={seasons}
          onChange={(v) => {
            markTouched('seasons');
            setSeasons(v as string[]);
          }}
        />

        {/* v1.11.0：仅服装类型/颜色/穿着季节默认展开，其余选项收进「衣物详细信息」折叠区 */}
        <View className={styles.detailHeader} onClick={() => setDetailOpen(!detailOpen)}>
          <Text className={styles.detailTitle}>衣物详细信息（选填）</Text>
          <Text className={styles.detailArrow}>{detailOpen ? '▴ 收起' : '▾ 展开'}</Text>
        </View>
        {detailOpen && (
          <>
        <OptionSelector
          label='内外穿'
          required
          mode='picker'
          options={LAYER_OPTIONS}
          customValues={customOf('layer')}
          usedValues={usedOf('layer')}
          allowCustom
          customMaxLength={6}
          value={layer}
          onChange={(v) => {
            markTouched('layer');
            setLayer(v as string);
          }}
          onAddCustom={(v) => addCustomOption('layer', v)}
          onRemoveCustom={(v) => removeCustomOption('layer', v)}
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
          onChange={(v) => {
            markTouched('material');
            setMaterial(v as string);
          }}
          onAddCustom={(v) => addCustomOption('material', v)}
          onRemoveCustom={(v) => removeCustomOption('material', v)}
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
          onChange={(v) => {
            markTouched('size');
            setSize(v as string);
          }}
          onAddCustom={(v) => addCustomOption('size', v)}
          onRemoveCustom={(v) => removeCustomOption('size', v)}
        />

        <BrandPicker
          value={brand}
          onChange={(v) => {
            markTouched('brand');
            setBrand(v);
          }}
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
          </>
        )}
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
