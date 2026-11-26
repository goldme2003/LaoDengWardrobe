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
  check('W1 ping 返回三密钥状态（华风爱科为主）', () => {
    assert.strictEqual(ping.code, 'OK');
    assert.strictEqual(typeof ping.hasMapKey, 'boolean');
    assert.strictEqual(typeof ping.hasWeatherCnKey, 'boolean');
    assert.strictEqual(typeof ping.hasQWeatherKey, 'boolean');
    assert.ok(/weathercn-pro/.test(ping.provider));
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
  check('W5 无和风 Key 时走免密钥数据源或明确降级', () => {
    assert.ok(['OK', 'WEATHER_UNAVAILABLE', 'NOT_CONFIGURED'].includes(noKey.code), `code=${noKey.code}`);
  });

  check('W6 北京天气字段完整（联网时）', () => {
    if (noKey.code !== 'OK') {
      console.log(`    跳过：当前网络不可达（${noKey.code}）`);
      return;
    }
    const d = noKey.data;
    assert.ok(d.today && d.today.cond && Number.isFinite(d.today.high) && Number.isFinite(d.today.low));
    assert.strictEqual(d.days.length, 3);
    assert.ok(['weathercn-pro', 'qweather', 'weather.com.cn'].includes(noKey.source));
    console.log(`    北京 ${d.today.cond} ${d.today.low}~${d.today.high}℃ 来源=${noKey.source}`);
  });

  // v1.6.0 新增测试城市：永州、哈密、桂林、齐齐哈尔
  const testCities = ['永州', '哈密', '桂林', '齐齐哈尔'];
  for (const city of testCities) {
    const r = await fn.main({ action: 'weather', city });
    check(`W7-${city} 天气字段完整`, () => {
      if (r.code !== 'OK') {
        console.log(`    跳过 ${city}：${r.code} ${r.message || ''}`);
        return;
      }
      const d = r.data;
      assert.ok(d.today && d.today.cond && Number.isFinite(d.today.high) && Number.isFinite(d.today.low));
      assert.strictEqual(d.days.length, 3);
      assert.ok(['weathercn-pro', 'qweather', 'weather.com.cn'].includes(r.source));
      console.log(`    ${city} ${d.today.cond} ${d.today.low}~${d.today.high}℃ 来源=${r.source}`);
    });
  }

  console.log(`\nweatherProxy: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run();
