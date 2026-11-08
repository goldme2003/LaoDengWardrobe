import React, { useState } from 'react';
import { View, Text, Input, Picker, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useWardrobeStore } from '@/store/useWardrobeStore';
import { GENDER_OPTIONS, AGE_MIN, AGE_MAX, WARDROBE_NAME_MAX_LEN, THEME_SETS, BODY_FIELDS, getTheme } from '@/data/presets';
import { Gender, ThemeId } from '@/types';

const WardrobesPage: React.FC = () => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const currentWardrobeId = useWardrobeStore((s) => s.currentWardrobeId);
  const items = useWardrobeStore((s) => s.items);
  const addWardrobe = useWardrobeStore((s) => s.addWardrobe);
  const updateWardrobe = useWardrobeStore((s) => s.updateWardrobe);
  const deleteWardrobe = useWardrobeStore((s) => s.deleteWardrobe);
  const setCurrentWardrobe = useWardrobeStore((s) => s.setCurrentWardrobe);

  const [tab, setTab] = useState<'create' | 'current'>('create');
  const [name, setName] = useState(''); const [themeIdx, setThemeIdx] = useState(0);
  const [genderIdx, setGenderIdx] = useState(0); const [ageStr, setAgeStr] = useState('');

  const cur = wardrobes.find((w) => w.id === currentWardrobeId);
  const themeStyle = { '--w-color': cur?.color || '#E8684A' } as React.CSSProperties;

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > WARDROBE_NAME_MAX_LEN) { Taro.showToast({ title: `≤${WARDROBE_NAME_MAX_LEN} 字`, icon: 'none' }); return; }
    const gender: Gender = GENDER_OPTIONS[genderIdx].value;
    let age: number | null = null;
    if (ageStr.trim()) {
      const n = Number(ageStr.trim());
      if (Number.isNaN(n) || n < AGE_MIN || n > AGE_MAX) { Taro.showToast({ title: `${AGE_MIN}–${AGE_MAX} 岁`, icon: 'none' }); return; }
      age = Math.round(n);
    }
    if (!addWardrobe(trimmed, THEME_SETS[themeIdx].id, gender, age)) { Taro.showToast({ title: '名称已存在', icon: 'none' }); return; }
    setName(''); setAgeStr(''); setGenderIdx(0); setThemeIdx(0);
    Taro.showToast({ title: '已创建', icon: 'success' });
  };
  const handleDelete = (id: string, wardrobeName: string) => {
    if (wardrobes.length <= 1) { Taro.showToast({ title: '至少保留一个', icon: 'none' }); return; }
    Taro.showModal({ title: '删除衣橱', content: `将同时删除「${wardrobeName}」下全部衣物与备选，确定？`,
      confirmColor: '#F53F3F', success: (res) => { if (res.confirm) { deleteWardrobe(id); Taro.showToast({ title: '已删除', icon: 'success' }); } } });
  };

  return (
    <View style={{ minHeight: '100vh', background: '#faf6f1' }}>
      <View style={themeStyle}>
        <View style={{ display: 'flex', background: '#fff', padding: '20rpx' }}>
          {(['create', 'current'] as const).map((t) => (
            <View key={t} onClick={() => setTab(t)} style={{
              flex: 1, textAlign: 'center', padding: '16rpx 0',
              borderBottom: tab === t ? '4rpx solid var(--w-color)' : '4rpx solid transparent',
              fontSize: '30rpx', fontWeight: tab === t ? '600' : '400', color: '#3a2e25'
            }}>
              {t === 'create' ? '新建衣橱' : '当前衣橱档案'}
            </View>
          ))}
        </View>

        {tab === 'create' ? (
          <ScrollView scrollY style={{ padding: '20rpx', height: 'calc(100vh - 100rpx)' }}>
            <View style={{ background: '#fff', borderRadius: '16rpx', padding: '24rpx' }}>
              <Text style={{ fontSize: '30rpx', fontWeight: '600', display: 'block', marginBottom: '16rpx' }}>🧺 新建衣橱</Text>
              <LabelText t='用户名称（≤10 字）' />
              <Input value={name} maxlength={WARDROBE_NAME_MAX_LEN} placeholder='如：老王'
                style={{ height: '80rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx' }}
                onInput={(e) => setName(e.detail.value)} />

              <LabelText t='主题风格（每个衣橱一个主题）' />
              <View style={{ display: 'flex', flexWrap: 'wrap' }}>
                {THEME_SETS.map((t, i) => (
                  <View key={t.id} onClick={() => setThemeIdx(i)} style={{
                    width: '128rpx', height: '96rpx', margin: '0 16rpx 16rpx',
                    background: t.bgCard,
                    border: themeIdx === i ? `4rpx solid ${t.color}` : '1rpx solid #ece3d7',
                    borderRadius: '16rpx', display: 'flex', alignItems: 'center', padding: '0 12rpx',
                    boxShadow: themeIdx === i ? t.shadow : 'none', transform: themeIdx === i ? 'scale(1.05)' : 'scale(1)', transition: 'all .15s'
                  }}>
                    <View style={{ width: '36rpx', height: '36rpx', borderRadius: '18rpx', background: t.color, marginRight: '10rpx' }} />
                    <Text style={{ fontSize: '22rpx', color: '#3a2e25' }}>{t.label}</Text>
                  </View>
                ))}
              </View>

              <LabelText t='性别' />
              <Picker mode='selector' range={GENDER_OPTIONS.map((g) => g.label)} value={genderIdx} onChange={(e) => setGenderIdx(Number(e.detail.value))}>
                <PickerRow v={GENDER_OPTIONS[genderIdx].label} />
              </Picker>

              <LabelText t={`年龄（选填，${AGE_MIN}–${AGE_MAX}岁）`} />
              <Input type='number' value={ageStr} placeholder='输入年龄'
                style={{ height: '80rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx' }}
                onInput={(e) => setAgeStr(e.detail.value)} />

              <View onClick={handleAdd} style={{
                height: '96rpx', marginTop: '32rpx', borderRadius: '48rpx',
                background: 'var(--w-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: '32rpx', fontWeight: '600'
              }}>＋ 新建衣橱</View>
              <Text style={{ fontSize: '22rpx', color: '#a39385', marginTop: '16rpx', display: 'block' }}>新建后也可在「当前衣橱档案」修改性别/年龄/主题</Text>
            </View>

            <View style={{ background: '#fff', borderRadius: '16rpx', padding: '24rpx', marginTop: '20rpx' }}>
              <Text style={{ fontSize: '30rpx', fontWeight: '600', display: 'block', marginBottom: '16rpx' }}>👥 全部衣橱</Text>
              {wardrobes.map((w) => {
                const t = getTheme(w.themeId);
                return (
                  <View key={w.id} style={{ display: 'flex', alignItems: 'center', padding: '18rpx 0', borderBottom: '1rpx solid #f2ede4' }}>
                    <View style={{ width: '24rpx', height: '24rpx', borderRadius: '12rpx', background: w.color, marginRight: '16rpx' }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: '30rpx', color: '#3a2e25' }}>{w.name}</Text>
                      <Text style={{ fontSize: '22rpx', color: '#a39385', marginLeft: '12rpx' }}>
                        「{t.label}」· {GENDER_OPTIONS.find((g) => g.value === w.gender)?.label || '未填'}
                        {w.age ? ` · ${w.age}岁` : ''} · {items.filter((it) => it.wardrobeId === w.id).length} 件
                      </Text>
                    </View>
                    {w.id === currentWardrobeId ? (
                      <Text style={{ fontSize: '22rpx', color: '#fff', background: w.color, padding: '4rpx 16rpx', borderRadius: '20rpx' }}>当前</Text>
                    ) : (
                      <Text style={{ fontSize: '26rpx', color: 'var(--w-color)', marginRight: '20rpx' }} onClick={() => setCurrentWardrobe(w.id)}>切换</Text>
                    )}
                    {wardrobes.length > 1 && (
                      <Text style={{ fontSize: '26rpx', color: '#f24b4b' }} onClick={() => handleDelete(w.id, w.name)}>删除</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <CurrentProfile id={currentWardrobeId} updateWardrobe={updateWardrobe} />
        )}
      </View>
    </View>
  );
};

const LabelText: React.FC<{ t: string }> = ({ t }) => (
  <Text style={{ fontSize: '26rpx', color: '#6b5e52', margin: '20rpx 0 12rpx', display: 'block' }}>{t}</Text>
);
const PickerRow: React.FC<{ v: string }> = ({ v }) => (
  <View style={{ height: '80rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <Text style={{ fontSize: '28rpx' }}>{v}</Text><Text style={{ color: '#a39385' }}>▾</Text>
  </View>
);

/** 当前衣橱档案：可修改性别/年龄/主题/个人版型 */
const CurrentProfile: React.FC<{ id: string; updateWardrobe: (id: string, patch: any) => void }> = ({ id, updateWardrobe }) => {
  const wardrobes = useWardrobeStore((s) => s.wardrobes);
  const w = wardrobes.find((x) => x.id === id);
  const [local, setLocal] = useState(w);
  React.useEffect(() => { setLocal(w); }, [w]);
  if (!local) return null;

  const genderIdx = Math.max(0, GENDER_OPTIONS.findIndex((g) => g.value === local.gender));
  const themeIdx = Math.max(0, THEME_SETS.findIndex((t) => t.id === local.themeId));

  const save = (patch: any) => {
    setLocal({ ...local, ...patch });
    updateWardrobe(id, patch);
    Taro.showToast({ title: '已保存', icon: 'success' });
  };

  return (
    <ScrollView scrollY style={{ padding: '20rpx', height: 'calc(100vh - 100rpx)' }}>
      <View style={{ background: '#fff', borderRadius: '16rpx', padding: '24rpx', marginBottom: '20rpx' }}>
        <Text style={{ fontSize: '32rpx', fontWeight: '700', display: 'block', marginBottom: '20rpx' }}>{local.name} · 衣橱档案</Text>

        <LabelText t='主题风格' />
        <View style={{ display: 'flex', flexWrap: 'wrap' }}>
          {THEME_SETS.map((t, i) => (
            <View key={t.id} onClick={() => save({ themeId: t.id as ThemeId, color: t.color })} style={{
              width: '128rpx', height: '96rpx', margin: '0 16rpx 16rpx',
              background: t.bgCard,
              border: themeIdx === i ? `4rpx solid ${t.color}` : '1rpx solid #ece3d7',
              borderRadius: '16rpx', display: 'flex', alignItems: 'center', padding: '0 12rpx'
            }}>
              <View style={{ width: '36rpx', height: '36rpx', borderRadius: '18rpx', background: t.color, marginRight: '10rpx' }} />
              <Text style={{ fontSize: '22rpx', color: '#3a2e25' }}>{t.label}</Text>
            </View>
          ))}
        </View>

        <LabelText t='性别' />
        <Picker mode='selector' range={GENDER_OPTIONS.map((g) => g.label)} value={genderIdx}
          onChange={(e) => save({ gender: GENDER_OPTIONS[Number(e.detail.value)].value as Gender })}>
          <PickerRow v={GENDER_OPTIONS[genderIdx].label} />
        </Picker>

        <LabelText t={`年龄（${AGE_MIN}–${AGE_MAX}岁）`} />
        <Input type='number' value={local.age ? String(local.age) : ''} placeholder='选填'
          style={{ height: '80rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx' }}
          onInput={(e) => {
            const trimmed = e.detail.value.trim();
            const n = Number(trimmed);
            const v = trimmed === '' ? null : (Number.isNaN(n) || n < AGE_MIN || n > AGE_MAX ? local.age : Math.round(n));
            save({ age: v });
          }} />
      </View>

      <View style={{ background: '#fff', borderRadius: '16rpx', padding: '24rpx' }}>
        <Text style={{ fontSize: '30rpx', fontWeight: '600', display: 'block', marginBottom: '16rpx' }}>👤 个人版型信息（缝纫基础）</Text>
        {BODY_FIELDS.map((f) => (
          <View key={String(f.key)} style={{ display: 'flex', alignItems: 'center', marginBottom: '14rpx' }}>
            <Text style={{ width: '150rpx', fontSize: '26rpx', color: '#6b5e52' }}>{f.label}（{f.unit}）</Text>
            <Input
              type='digit'
              value={(local.bodyInfo as any)[f.key] != null ? String((local.bodyInfo as any)[f.key]) : ''}
              placeholder='选填'
              style={{ flex: 1, height: '72rpx', background: '#faf6f1', border: '1rpx solid #ece3d7', borderRadius: '12rpx', padding: '0 20rpx', fontSize: '28rpx' }}
              onBlur={(e) => {
                const v = Number(e.detail.value.trim());
                const next = { ...local.bodyInfo, [f.key]: e.detail.value.trim() === '' || Number.isNaN(v) ? undefined : v };
                save({ bodyInfo: next });
              }}
            />
          </View>
        ))}
        <Text style={{ fontSize: '22rpx', color: '#a39385', marginTop: '12rpx', display: 'block' }}>留空的字段仍可在添加衣物时手动填写。</Text>
      </View>
    </ScrollView>
  );
};
export default WardrobesPage;
