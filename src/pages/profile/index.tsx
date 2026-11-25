import React, { useMemo, useState } from 'react';
import { View, Text, Picker, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import {
  GENDER_OPTIONS,
  AGE_MIN,
  AGE_MAX,
  WARDROBE_NAME_MAX_LEN,
  BODY_FIELD_DEFS,
  BODY_TAILORING_KEYS,
  CLOTHING_SIZE_FIELD_DEFS,
  themeVarsOf
} from '@/data/presets';
import { BodyProfile, Gender } from '@/types';
import styles from './index.module.scss';

const UNFILLED = '未填写';
/** 身高合理区间（cm），与 BODY_FIELD_DEFS 中身高定义一致 */
const HEIGHT_MIN = 50;
const HEIGHT_MAX = 250;

/** 数字拨盘选项：['未填写', min..max] */
const buildNumberRange = (min: number, max: number): string[] => {
  const list = [UNFILLED];
  for (let i = min; i <= max; i += 1) list.push(String(i));
  return list;
};

/** 个人信息修改页（v0.7.0 用户意见 5）：由「我的」页信息卡与衣橱管理页「修改」入口进入。
 * 便捷化调整：身高改为文本框直接输入；新增常用衣物尺寸（上衣/裤装/鞋码）。 */
const ProfilePage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const bodyProfile = useWardrobeStore((s) => s.bodyProfiles[s.currentWardrobeId]) || {};
  const updateBodyProfile = useWardrobeStore((s) => s.updateBodyProfile);
  const updateWardrobe = useWardrobeStore((s) => s.updateWardrobe);

  const currentWardrobe = wardrobes.find((w) => w.id === currentWardrobeId);

  // 草稿态（保存时统一提交）
  const [draftName, setDraftName] = useState(currentWardrobe?.name || '');
  const [draftGender, setDraftGender] = useState<Gender>(currentWardrobe?.gender || 'male');
  const [draftAge, setDraftAge] = useState<number | null>(currentWardrobe?.age ?? null);
  const [draftBody, setDraftBody] = useState<BodyProfile>({ ...bodyProfile });
  // 身高文本框草稿（独立维护，保存时校验并入 draftBody）
  const [heightInput, setHeightInput] = useState(
    bodyProfile.height !== undefined ? String(bodyProfile.height) : ''
  );

  // 拨盘选项（年龄 + 身体数据，均为「未填写」+ 数字区间；身高改为文本框，不在拨盘之列）
  const ageRange = useMemo(() => buildNumberRange(AGE_MIN, AGE_MAX), []);
  const bodyRanges = useMemo(() => {
    const map: Record<string, string[]> = {};
    BODY_FIELD_DEFS.forEach((f) => {
      if (f.key === 'height') return; // v0.7.0：身高改为文本输入
      map[f.key] = buildNumberRange(f.min, f.max);
    });
    return map;
  }, []);
  // v1.20.2：身体数据改为可伸缩——默认收起，点击展开详细围度修改
  const [bodyExpanded, setBodyExpanded] = useState(false);
  // v1.20.2：身体数据仅展示服装裁剪常见项（体重/肩围/臂展/脚长不再展示，历史数据保留）
  const tailoringFields = useMemo(
    () =>
      BODY_TAILORING_KEYS.map((key) => BODY_FIELD_DEFS.find((f) => f.key === key)!).filter(Boolean),
    []
  );
  // 已填围度数（收起态摘要展示）
  const filledBodyCount = BODY_TAILORING_KEYS.filter((k) => draftBody[k] !== undefined && draftBody[k] !== '').length;

  const genderIndex = GENDER_OPTIONS.findIndex((g) => g.value === draftGender);

  const save = () => {
    if (!currentWardrobe) {
      Taro.showToast({ title: '衣橱不存在，无法保存', icon: 'none' });
      return;
    }
    // 身高校验：文本框输入，空 = 未填写；非空须为 50–250 的数字
    const trimmedHeight = heightInput.trim();
    let height: number | undefined;
    if (trimmedHeight !== '') {
      const parsed = Number(trimmedHeight);
      if (isNaN(parsed) || parsed < HEIGHT_MIN || parsed > HEIGHT_MAX) {
        Taro.showToast({ title: `身高需为 ${HEIGHT_MIN}–${HEIGHT_MAX} 的数字`, icon: 'none' });
        return;
      }
      height = parsed;
    }

    // 称呼修改（≤10 字，空值保持原名，store 内兜底校验）
    const trimmedName = draftName.trim();
    const nameChanged = trimmedName !== '' && trimmedName !== currentWardrobe.name;
    updateWardrobe(currentWardrobe.id, {
      ...(nameChanged ? { name: trimmedName } : {}),
      gender: draftGender,
      age: draftAge
    });
    // 空字符串统一转为 undefined（避免无效数据持久化）
    const bodyPatch: BodyProfile = { ...draftBody, ...(height !== undefined ? { height } : { height: undefined }) };
    Object.keys(bodyPatch).forEach((k) => {
      const key = k as keyof BodyProfile;
      if (bodyPatch[key] === '') delete bodyPatch[key];
    });
    updateBodyProfile(bodyPatch);
    console.info('[Profile] 个人信息已保存, wardrobeId =', currentWardrobe.id);
    Taro.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => Taro.navigateBack(), 600);
  };

  return (
    <View className={styles.page} style={themeVarsOf(currentWardrobe) as unknown as React.CSSProperties}>
      {/* 基本信息 */}
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>基本信息</Text>
        <View className={styles.row}>
          <Text className={styles.label}>衣橱主人称呼</Text>
          <Input
            className={styles.textInput}
            value={draftName}
            maxlength={WARDROBE_NAME_MAX_LEN}
            placeholder={`称呼（≤${WARDROBE_NAME_MAX_LEN} 字）`}
            onInput={(e) => setDraftName(e.detail.value)}
          />
        </View>
        <View className={styles.row}>
          <Text className={styles.label}>性别</Text>
          <Picker
            mode='selector'
            range={GENDER_OPTIONS.map((g) => g.label)}
            value={Math.max(0, genderIndex)}
            onChange={(e) => setDraftGender(GENDER_OPTIONS[Number(e.detail.value)].value)}
          >
            <View className={styles.picker}>
              <Text className={styles.value}>{GENDER_OPTIONS[Math.max(0, genderIndex)].label}</Text>
              <Text className={styles.arrow}>▾</Text>
            </View>
          </Picker>
        </View>
        <View className={styles.row}>
          <Text className={styles.label}>年龄（岁）</Text>
          <Picker
            mode='selector'
            range={ageRange}
            value={draftAge === null ? 0 : draftAge - AGE_MIN + 1}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              setDraftAge(idx === 0 ? null : AGE_MIN + idx - 1);
            }}
          >
            <View className={styles.picker}>
              <Text className={styles.value}>{draftAge === null ? UNFILLED : `${draftAge} 岁`}</Text>
              <Text className={styles.arrow}>▾</Text>
            </View>
          </Picker>
        </View>
        {/* v0.7.0 用户意见 5：身高改为文本框直接填写 */}
        <View className={styles.row}>
          <Text className={styles.label}>身高（cm）</Text>
          <Input
            className={styles.textInput}
            type='digit'
            value={heightInput}
            maxlength={5}
            placeholder={`直接输入，如 170`}
            onInput={(e) => setHeightInput(e.detail.value)}
          />
        </View>
      </View>

      {/* v1.20.2：常用衣物尺寸移到身材数据之前，改为手动填写 */}
      <View className={styles.card}>
        <Text className={styles.sectionTitle}>服装尺寸数据</Text>
        {CLOTHING_SIZE_FIELD_DEFS.map((f) => {
          const cur = draftBody[f.key];
          const placeholderMap: Record<string, string> = {
            topSize: '如 M / L / 175',
            pantsSize: '如 30（腰围档）',
            shoeSize: '如 38、40'
          };
          return (
            <View key={f.key} className={styles.row}>
              <Text className={styles.label}>{f.label}</Text>
              <Input
                className={styles.textInput}
                value={cur === undefined ? '' : String(cur)}
                placeholder={placeholderMap[f.key] || '手动填写'}
                onInput={(e) => {
                  const v = e.detail.value.trim();
                  setDraftBody((prev) => ({ ...prev, [f.key]: v === '' ? undefined : v }));
                }}
              />
            </View>
          );
        })}
        <Text className={styles.tip}>
          支持手动填写：上衣尺码如 M/L 等字母码或 170/175 等身高码；裤装为 24–40 腰围档位；鞋码如 38、40。均为选填。
        </Text>
      </View>

      {/* v1.20.2：身体数据——仅保留服装裁剪常见围度；可伸缩，默认收起，点击展开详细修改 */}
      <View className={styles.card}>
        <View className={styles.toggleRow} onClick={() => setBodyExpanded((v) => !v)}>
          <Text className={styles.sectionTitle}>身材数据</Text>
          <Text className={styles.toggleHint}>
            {bodyExpanded
              ? '收起 ▴'
              : filledBodyCount > 0
                ? `已填 ${filledBodyCount} 项 · 点击修改详细身材数据 ›`
                : '点击修改详细身材数据 ›'}
          </Text>
        </View>
        {bodyExpanded && (
          <View>
            {tailoringFields.map((f) => {
              const range = bodyRanges[f.key];
              const cur = draftBody[f.key] as number | undefined;
              const valueIdx = cur === undefined ? 0 : Math.max(0, Math.min(range.length - 1, cur - f.min + 1));
              return (
                <View key={f.key} className={styles.row}>
                  <Text className={styles.label}>
                    {f.label}（{f.unit}）
                  </Text>
                  <Picker
                    mode='selector'
                    range={range}
                    value={valueIdx}
                    onChange={(e) => {
                      const idx = Number(e.detail.value);
                      setDraftBody((prev) => ({
                        ...prev,
                        [f.key]: idx === 0 ? undefined : f.min + idx - 1
                      }));
                    }}
                  >
                    <View className={styles.picker}>
                      <Text className={styles.value}>{cur === undefined ? UNFILLED : `${cur} ${f.unit}`}</Text>
                      <Text className={styles.arrow}>▾</Text>
                    </View>
                  </Picker>
                </View>
              );
            })}
            <Text className={styles.tip}>
              保留服装裁剪所需常见项：胸围/腰围/臀围/肩宽/领围/裤长/腿围，均为选填，供缝纫与尺码参考。
            </Text>
          </View>
        )}
      </View>

      <View className={styles.saveBtn} onClick={save}>
        <Text className={styles.saveBtnText}>保存</Text>
      </View>
    </View>
  );
};

export default ProfilePage;
