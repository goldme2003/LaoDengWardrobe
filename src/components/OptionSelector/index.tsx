import React, { useState } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import classnames from 'classnames';
import styles from './index.module.scss';

interface Props {
  label: string;
  required?: boolean;
  /** 展示模式：picker=转盘选择（单选）；multi=勾选多选；chips=色卡标签（颜色专用） */
  mode: 'picker' | 'multi' | 'chips';
  /** 可选值列表（预设 + 自定义） */
  options: string[];
  /** 单选值或多选值数组 */
  value: string | string[];
  /** 色值映射（颜色维度展示色点） */
  colorHexMap?: Record<string, string>;
  /** 允许新增自定义选项 */
  allowCustom?: boolean;
  /** 自定义选项列表（allowCustom 时传入） */
  customValues?: string[];
  /** 已被使用的自定义选项（不可删除） */
  usedValues?: string[];
  customMaxLength?: number;
  /** 转盘展示占位文案 */
  placeholder?: string;
  onChange: (value: string | string[]) => void;
  onAddCustom?: (value: string) => string | null;
  onRemoveCustom?: (value: string) => void;
}

/** 兜底选项：选中后直接展开内联输入框，输入内容实时替代「其他」（v0.5 用户意见 4 修复） */
const FALLBACK_OPTION = '其他';

/** 选项选择器（PRD FR-03 / v0.5 调整）：
 * 单选属性用转盘（Picker），多选属性用勾选标签，颜色保留色卡标签；
 * 选中项高亮强化（勾角/描边/放大）；选中「其他」后直接内联输入自定义内容；
 * 已选非兜底项可经「✎ 改为自定义内容」改写；「+ 新增选项」可入库自定义值 */
const OptionSelector: React.FC<Props> = ({
  label,
  required,
  mode,
  options,
  value,
  colorHexMap,
  allowCustom,
  customValues,
  usedValues,
  customMaxLength,
  placeholder,
  onChange,
  onAddCustom,
  onRemoveCustom
}) => {
  const selected: string[] = multiSafe(mode, value);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [fallbackActive, setFallbackActive] = useState(false);
  const [fallbackDraft, setFallbackDraft] = useState('');

  const allOptions = [...options, ...(customValues || [])];
  const singleValue = typeof value === 'string' ? value : '';
  const pickerIndex = Math.max(0, allOptions.indexOf(singleValue));

  // 单选赋值统一入口：选中「其他」时自动展开内联输入（修复无法自定义问题）
  const applySingle = (opt: string) => {
    const isFallback = allowCustom && mode !== 'multi' && opt === FALLBACK_OPTION;
    setFallbackActive(isFallback);
    setFallbackDraft('');
    onChange(opt);
  };

  const tapOption = (opt: string) => {
    if (mode === 'multi') {
      const list = value as string[];
      onChange(list.includes(opt) ? list.filter((v) => v !== opt) : [...list, opt]);
    } else {
      // 单选：再次点击取消选择（保存时校验必填）
      applySingle(singleValue === opt ? '' : opt);
    }
  };

  const onPickerChange = (e) => {
    const idx = Number(e.detail.value);
    const opt = allOptions[idx];
    if (opt) applySingle(opt);
  };

  const confirmAdd = () => {
    if (!onAddCustom) return;
    const trimmed = draft.trim();
    const err = onAddCustom(trimmed);
    if (err) {
      setError(err);
      return;
    }
    // v0.5：新增自定义选项后自动选中（含将「其他」改为自定义内容的场景）
    if (mode !== 'multi') {
      setFallbackActive(false);
      onChange(trimmed);
    } else if (Array.isArray(value) && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setDraft('');
    setError('');
    setAdding(false);
  };

  const renderChip = (opt: string, isCustom: boolean) => {
    const active = selected.includes(opt);
    const canDelete = isCustom && !active && !(usedValues || []).includes(opt);
    const dot = colorHexMap && colorHexMap[opt];
    return (
      <View key={opt} className={classnames(styles.chip, active && styles.chipActive)}>
        <View className={styles.chipLabel} onClick={() => tapOption(opt)}>
          {dot ? (
            <View className={styles.dotWrap}>
              <View className={styles.dot} style={{ background: dot }} />
              {active && <View className={styles.dotCheck}>✓</View>}
            </View>
          ) : null}
          <Text className={classnames(styles.chipText, active && styles.chipTextActive)}>{opt}</Text>
        </View>
        {canDelete && (
          <Text
            className={styles.chipDelete}
            onClick={() => onRemoveCustom && onRemoveCustom(opt)}
          >
            ×
          </Text>
        )}
      </View>
    );
  };

  // v0.5：非兜底选项的「改为自定义内容」入口（兜底「其他」已直接展开输入框）
  const showEditCustom =
    allowCustom && mode !== 'multi' && singleValue !== '' && singleValue !== FALLBACK_OPTION && !adding;

  return (
    <View className={styles.section}>
      <View className={styles.labelRow}>
        <Text className={styles.label}>
          {label}
          {required && <Text className={styles.required}> *</Text>}
        </Text>
      </View>

      {/* 转盘/下拉选择（单选属性） */}
      {mode === 'picker' && (
        <Picker mode='selector' range={allOptions} value={pickerIndex} onChange={onPickerChange}>
          <View className={styles.pickerRow}>
            {singleValue ? (
              <Text className={styles.pickerValue}>{singleValue}</Text>
            ) : (
              <Text className={styles.pickerPlaceholder}>{placeholder || `请选择${label}`}</Text>
            )}
            <Text className={styles.pickerArrow}>▾</Text>
          </View>
        </Picker>
      )}

      {/* 色卡 / 勾选多选 */}
      {(mode === 'chips' || mode === 'multi') && (
        <View className={styles.chips}>{allOptions.map((opt) => renderChip(opt, (customValues || []).includes(opt)))}</View>
      )}

      {/* 未使用的自定义选项删除区（转盘模式下展示） */}
      {mode === 'picker' && allowCustom && customValues && customValues.length > 0 && (
        <View className={styles.customRow}>
          {customValues
            .filter((v) => !(usedValues || []).includes(v) && v !== singleValue)
            .map((v) => (
              <View key={v} className={styles.customChip}>
                <Text className={styles.customChipText}>{v}</Text>
                <Text
                  className={styles.customChipDelete}
                  onClick={() => onRemoveCustom && onRemoveCustom(v)}
                >
                  删除×
                </Text>
              </View>
            ))}
        </View>
      )}

      {/* v0.5 修复：选中「其他」后直接展开内联输入，输入内容实时替代「其他」 */}
      {fallbackActive && !adding && (
        <View className={styles.fallbackForm}>
          <Input
            className={styles.fallbackInput}
            value={fallbackDraft}
            maxlength={customMaxLength || 10}
            placeholder={`输入${label}的具体内容（≤${customMaxLength || 10}字，替代「其他」）`}
            onInput={(e) => {
              const v = e.detail.value.trim();
              setFallbackDraft(v);
              // 有内容实时替代「其他」；清空则恢复为「其他」
              onChange(v || FALLBACK_OPTION);
            }}
          />
          <Text className={styles.fallbackHint}>输入内容后自动替代「{FALLBACK_OPTION}」，无需点击确定</Text>
        </View>
      )}

      {/* v0.5：将已选的非兜底选项改为自定义内容 */}
      {showEditCustom && (
        <View className={styles.editCustomRow} onClick={() => setAdding(true)}>
          <Text className={styles.editCustomText}>✎ 将「{singleValue}」改为自定义内容</Text>
        </View>
      )}

      {allowCustom && !adding && !showEditCustom && !fallbackActive && (
        <View className={styles.addRow} onClick={() => setAdding(true)}>
          <Text className={styles.addRowText}>+ 新增选项</Text>
        </View>
      )}

      {allowCustom && adding && (
        <View className={styles.addForm}>
          <Input
            className={styles.addInput}
            value={draft}
            maxlength={customMaxLength || 10}
            placeholder={`输入自定义内容（≤${customMaxLength || 10}字）`}
            onInput={(e) => {
              setDraft(e.detail.value);
              setError('');
            }}
          />
          <View className={styles.addConfirm} onClick={confirmAdd}>
            <Text className={styles.addConfirmText}>确定</Text>
          </View>
          <View
            className={styles.addCancel}
            onClick={() => {
              setAdding(false);
              setDraft('');
              setError('');
            }}
          >
            <Text className={styles.addCancelText}>取消</Text>
          </View>
        </View>
      )}
      {!!error && <Text className={styles.error}>{error}</Text>}
    </View>
  );
};

/** 从 value 提取选中数组（multi 用） */
function multiSafe(mode: string, value: string | string[]): string[] {
  return mode === 'multi' && Array.isArray(value) ? value : [];
}

export default OptionSelector;
