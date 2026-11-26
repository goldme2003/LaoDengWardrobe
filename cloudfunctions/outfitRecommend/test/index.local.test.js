/** outfitRecommend 本地测试（无需网络/密钥）：node cloudfunctions/outfitRecommend/test/index.local.test.js
 * 覆盖：ping（模型标识）、非法 action、空清单兜底（v1.11.5 模型换 hy4-flash 时补建） */
const assert = require('assert');
const fn = require('../index.js');

let pass = 0;
let fail = 0;
function check(name, fnCase) {
  try {
    fnCase();
    pass += 1;
    console.log(`  PASS ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL ${name} -> ${e.message}`);
  }
}

async function run() {
  const ping = await fn.main({ action: 'ping' });
  check('O1 ping 返回模型标识 hy4-flash', () => {
    assert.strictEqual(ping.code, 'OK');
    assert.strictEqual(typeof ping.hasHunyuanKey, 'boolean');
    assert.strictEqual(ping.model, 'hy4-flash');
    assert.strictEqual(ping.endpoint, 'tokenhub.tencentmaas.com/v1/chat/completions');
  });

  const bad = await fn.main({ action: 'unknown' });
  check('O2 非法 action 返回 BAD_PARAM', () => {
    assert.strictEqual(bad.code, 'BAD_PARAM');
    assert.deepStrictEqual(bad.itemIds, []);
  });

  const empty = await fn.main({ action: 'recommend', items: [] });
  check('O3 空衣物清单返回 BAD_PARAM + fallback 提示', () => {
    assert.strictEqual(empty.code, 'BAD_PARAM');
    assert.strictEqual(empty.itemIds.length, 0);
    assert.strictEqual(empty.source, 'fallback');
  });

  // v1.12.1：自定义场景兜底时返回场景必须与请求一致（修复 fallbackOutfit 推断回预设导致的场景漂移）
  const custom = await fn.main({
    action: 'recommend',
    scene: '相亲',
    weather: { cond: '晴', low: 10, high: 18 },
    items: [
      { id: 'i1', name: '白衬衫', type: '上装', layer: '内穿', color: '白色', material: '棉', occasions: ['通勤'] },
      { id: 'i2', name: '西裤', type: '裤装', layer: '内穿', color: '黑色', material: '西装', occasions: ['正式'] },
      { id: 'i3', name: '皮鞋', type: '鞋履', layer: '外穿', color: '黑色', material: '皮革', occasions: ['正式'] }
    ]
  });
  check('O4 自定义场景（相亲）返回场景与请求一致', () => {
    assert.strictEqual(custom.code, 'OK');
    assert.strictEqual(custom.scene, '相亲');
    assert.ok(custom.itemIds.length > 0);
  });

  console.log(`\noutfitRecommend: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run();
