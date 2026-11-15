#!/usr/bin/env node
/** 校验微信开发者工具读取的产物与源码是否同步（提交 / 真机预览前必跑）。
 *
 * 背景：微信开发者工具的项目目录固定为仓库根目录，project.config.json 中
 *   miniprogramRoot = dist/、cloudfunctionRoot = cloudfunctions/
 * 即工具读取的是「构建产物 dist/」而不是 src/，因此每次改完源码必须重新构建，
 * 否则工具里看到的仍是旧代码。
 *
 * 用法：npm run verify:sync
 * 退出码 0 = 已同步；1 = 不同步（按提示重新构建后重试）。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

/** 递归取目录内最新修改时间 */
const newestMtime = (dir) => {
  let newest = 0;
  let file = '';
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const t = fs.statSync(p).mtimeMs;
        if (t > newest) {
          newest = t;
          file = p;
        }
      }
    }
  };
  if (!fs.existsSync(dir)) return { newest: 0, file: '' };
  walk(dir);
  return { newest, file };
};

const src = newestMtime(path.join(root, 'src'));
const dist = newestMtime(path.join(root, 'dist'));

if (!fs.existsSync(path.join(root, 'dist', 'app.json'))) {
  failures.push('dist/ 缺少 app.json：请先运行 npm run build:weapp');
} else if (src.newest > dist.newest) {
  failures.push(
    `dist/ 落后于 src/（src ${new Date(src.newest).toLocaleString()} / dist ${new Date(dist.newest).toLocaleString()}）：请运行 npm run build:weapp`
  );
}

/** 关键标记：确认产物包含已交付功能；新增功能时在此追加一条 */
const markers = [
  ['dist/pages/wardrobe/index.js', 'sceneChip', '推荐卡片场景标签'],
  ['dist/pages/wardrobe/index.js', 'planBack', '明日穿搭返回控件'],
  ['dist/pages/wardrobe/index.js', 'hunyuan', '空态建议来源角标'],
  ['dist/pages/wardrobe/index.js', 'spinner', '推荐生成加载态'],
  ['dist/pages/tryout/index.js', 'backRow', '试穿页返回控件']
];
for (const [file, needle, label] of markers) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) failures.push(`缺少产物 ${file}`);
  else if (!fs.readFileSync(abs, 'utf8').includes(needle)) failures.push(`产物 ${file} 未包含「${label}」（${needle}）`);
}

// 云函数目录由开发者工具直读（cloudfunctionRoot），无需构建，但云端生效仍需人工「上传并部署」
const fn = path.join(root, 'cloudfunctions', 'emptyGuide', 'index.js');
if (!fs.existsSync(fn)) failures.push('缺少 cloudfunctions/emptyGuide/index.js');
else if (!fs.readFileSync(fn, 'utf8').includes("source: 'fallback'")) {
  failures.push('cloudfunctions/emptyGuide/index.js 未返回兜底来源标识');
}

if (failures.length) {
  console.error('构建产物与源码不同步：');
  failures.forEach((f) => console.error(' - ' + f));
  process.exit(1);
}
console.log('dist/ 与 src/ 已同步，关键标记齐全');
console.log(`  src 最新：${path.relative(root, src.file)}  ${new Date(src.newest).toLocaleString()}`);
console.log(`  dist 最新：${path.relative(root, dist.file)}  ${new Date(dist.newest).toLocaleString()}`);
console.log('  提示：cloudfunctions/ 改动需在微信开发者工具「上传并部署」后才在云端生效');
