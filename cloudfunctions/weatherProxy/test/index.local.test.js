/** weatherProxy 本地测试（无需网络/密钥）：node cloudfunctions/weatherProxy/test/index.local.test.js
 * 覆盖：ping、参数校验、缺密钥返回 NOT_CONFIGURED、非法 action */
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
  check('W1 ping 返回双密钥状态', () => {
    assert.strictEqual(ping.code, 'OK');
    assert.strictEqual(typeof ping.hasMapKey, 'boolean');
    assert.strictEqual(typeof ping.hasWeatherKey, 'boolean');
  });

  const badAction = await fn.main({ action: 'nope' });
  check('W2 非法 action 返回 BAD_PARAM', () => {
    assert.strictEqual(badAction.code, 'BAD_PARAM');
  });

  const noCoord = await fn.main({ action: 'city' });
  check('W3 city 缺坐标返回 BAD_PARAM', () => {
    assert.strictEqual(noCoord.code, 'BAD_PARAM');
  });

  const noCity = await fn.main({ action: 'weather', city: '   ' });
  check('W4 weather 缺城市返回 BAD_PARAM', () => {
    assert.strictEqual(noCity.code, 'BAD_PARAM');
  });

  const noKey = await fn.main({ action: 'weather', city: '北京' });
  check('W5 未配置和风 Key 时返回 NOT_CONFIGURED', () => {
    if (process.env.QWEATHER_KEY) {
      assert.notStrictEqual(noKey.code, 'BAD_PARAM');
    } else {
      assert.strictEqual(noKey.code, 'NOT_CONFIGURED');
    }
  });

  console.log(`\nweatherProxy: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run();
