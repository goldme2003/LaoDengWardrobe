/** emptyGuide 本地测试（无需网络/密钥）：node cloudfunctions/emptyGuide/test/index.local.test.js
 * 覆盖：ping、参数归一化、缺密钥兜底、非法 action */
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
  check('E1 ping 返回密钥状态', () => {
    assert.strictEqual(ping.code, 'OK');
    assert.strictEqual(typeof ping.hasHunyuanKey, 'boolean');
    assert.strictEqual(ping.model, process.env.HUNYUAN_MODEL || 'hy4');
  });

  const bad = await fn.main({ action: 'unknown' });
  check('E2 非法 action 返回 BAD_PARAM', () => {
    assert.strictEqual(bad.code, 'BAD_PARAM');
    assert.deepStrictEqual(bad.tips, []);
  });

  // 本地无 HUNYUAN_API_KEY 时走兜底（有密钥环境会返回 hunyuan，同样校验结构）
  const guide = await fn.main({ action: 'guide', gender: 'male', age: 35, wardrobeName: '通勤衣橱' });
  check('E3 guide 返回 1 条 ≤50 字建议', () => {
    assert.strictEqual(guide.code, 'OK');
    assert.strictEqual(Array.isArray(guide.tips), true);
    assert.strictEqual(guide.tips.length, 1);
    assert.ok(guide.tips[0].length > 0 && guide.tips[0].length <= 50, `长度=${guide.tips[0].length}`);
    assert.ok(['hunyuan', 'fallback'].includes(guide.source));
  });

  const teen = await fn.main({ action: 'guide', gender: 'female', age: 15 });
  const senior = await fn.main({ action: 'guide', gender: 'female', age: 62 });
  check('E4 不同年龄段兜底文案不同', () => {
    if (teen.source === 'fallback' && senior.source === 'fallback') {
      assert.notStrictEqual(teen.tips[0], senior.tips[0]);
    }
  });

  const noAge = await fn.main({ action: 'guide' });
  check('E5 缺省参数走默认值不报错', () => {
    assert.strictEqual(noAge.code, 'OK');
    assert.strictEqual(noAge.tips.length, 1);
  });

  console.log(`\nemptyGuide: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run();
