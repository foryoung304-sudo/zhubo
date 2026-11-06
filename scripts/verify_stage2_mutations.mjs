/**
 * 阶段 2 收尾项变异复验（Yellow 用；对应 Orange 九轮「Tag 真实卡路径变异验真咬」）
 *
 * 做法：把仓库整份复制到系统临时目录，只在副本上打变异并跑副本里的验收套件，正本全程只读。
 * 为什么必须在副本里跑：test_stage2_core_loop.mjs 顶部把 DATA_DIR 写成绝对路径，
 * 若只改引擎不改这一行，对 data/*.json 的变异进不了被测代码——v1 版复验就栽在这里，
 * 当时 M-A/M-B（数据口子两条）报出的「套件全绿」是空跑，不是证据。本脚本会把副本里的
 * DATA_DIR 重定向到副本自身，并在每次运行前自检一次。
 *
 * fail-fast 处理：assert() 首条失败即 throw，所以一个变异一次只能暴露一条击杀。
 * 本脚本用 SKIP_ASSERTS 把已暴露的断言逐条屏蔽后重跑，收集「完整击杀集」，
 * 判定口径 = 期望断言是否全部被杀；同时单独报「首个击杀」，即套件真实暴露的第一条。
 *
 * 用法：node scripts/verify_stage2_mutations.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DATA = 'E:/taptap/zhubo/data'; // 正本里被硬编码的那一行，副本内必须改掉
const SANDBOX = path.join(os.tmpdir(), 'zhubo_mutation_sandbox');

const MUTS = [
  {
    id: 'M-A 数据口子回退：C1-M01:C 不写 Tag_流派',
    file: 'data/cards.json',
    from: `"state_writes": ["Tag_流派 = 整活"]`,
    to: `"state_writes": []`,
    expect: ['59.1', '59.2', '59.4', '59.5'],
  },
  {
    id: 'M-B 卡面值改写：写成含糊处的另一值',
    file: 'data/cards.json',
    from: `"state_writes": ["Tag_流派 = 整活"]`,
    to: `"state_writes": ["Tag_流派 = 整活擦边"]`,
    expect: ['59.1', '59.5'],
  },
  {
    id: 'M-C cardEngine 整活读门被摘：×2.5 与 35% 全失效',
    file: 'scripts/engine/cardEngine.mjs',
    from: `const isCircus = gameState.variables['Tag_流派'] === '整活' || gameState.variables['Tag_流派'] === '整活擦边';`,
    to: `const isCircus = false;`,
    expect: ['59.2', '59.4'],
  },
  {
    id: 'M-D 整活 ×2.5 漏进钱包通道（Y1.② 反向）',
    file: 'scripts/engine/cardEngine.mjs',
    from: `let positiveWallet = Math.round((baseRevenue + cardBonus) * opsMultiplier);`,
    to: `let positiveWallet = Math.round((baseRevenue + cardBonus) * opsMultiplier * circusMultiplier);`,
    expect: ['59.3'],
  },
  {
    id: 'M-E stageSettlement 流派亲和被摘（Z4）',
    file: 'scripts/engine/stageSettlement.mjs',
    from: `const isCircus = gameState.variables && gameState.variables['Tag_流派'] === '整活';`,
    to: `const isCircus = false;`,
    expect: ['59.5'],
  },
  {
    id: 'M-F 收尾2① 回退：大哥权重丢掉才艺',
    file: 'scripts/engine/stageSettlement.mjs',
    from: `'大哥': (attrs['情商'] + attrs['颜值'] + attrs['才艺']) * m_da * s_da,`,
    to: `'大哥': (attrs['情商'] + attrs['颜值']) * m_da * s_da,`,
    expect: ['59.6'],
  },
  {
    id: 'M-G Z2 护栏回退：练功加成不看章节/模式',
    file: 'scripts/engine/cardEngine.mjs',
    from: `if (gameState.practiceBuff && gameState.practiceBuff.targetChapter === gameState.currentChapter && gameState.practiceBuff.mode === scheduledMode) {`,
    to: `if (gameState.practiceBuff) {`,
    expect: ['78.5a'],
  },
  {
    id: 'M-H Y0 乘区位置回退：经营项塞进 [0.4,3.0] 夹持之内',
    file: 'scripts/engine/cardEngine.mjs',
    from: `const mBusinessClamped = Math.max(clamp[0], Math.min(clamp[1], mBusiness));
    let totalMultiplier = mBusinessClamped * opsMultiplier * circusMultiplier;`,
    to: `const mBusinessClamped = Math.max(clamp[0], Math.min(clamp[1], mBusiness * opsMultiplier * circusMultiplier));
    let totalMultiplier = mBusinessClamped;`,
    expect: ['78.2'],
  },
];

const COPY_SKIP = new Set(['.git', 'node_modules', 'ui-mockups-20261105', 'spike']);
function copyInto(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(ent.name)) continue;
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyInto(s, d);
    else fs.copyFileSync(s, d);
  }
}

function idOf(s) {
  return String(s).split('. ')[0].replace(/\.$/, '').trim();
}

function buildSandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  copyInto(ROOT, SANDBOX);
  const testPath = path.join(SANDBOX, 'scripts', 'test_stage2_core_loop.mjs');
  let src = fs.readFileSync(testPath, 'utf8');
  if (!src.includes(`const DATA_DIR = '${REPO_DATA}';`)) throw new Error('未找到 DATA_DIR 硬编码行，副本改造口径已失效，停手核对');
  src = src.replace(`const DATA_DIR = '${REPO_DATA}';`, `const DATA_DIR = '${path.join(SANDBOX, 'data').replace(/\\/g, '/')}';`);
  src = src.replace(
    'function assert(cond, name, detail = \'\') {',
    'const __YELLOW_SKIP__ = new Set((process.env.SKIP_ASSERTS || \'\').split(\',\').filter(Boolean));\nfunction assert(cond, name, detail = \'\') {\n  if (__YELLOW_SKIP__.has(idOfY(name))) { assertions.push({ name, detail, pass: true }); return; }'
  );
  src = 'function idOfY(n){return String(n).split(". ")[0].replace(/\\.$/,"").trim();}\n' + src;
  fs.writeFileSync(testPath, src);
  return testPath;
}

function runSuite(skip) {
  let out = '';
  try {
    out = execFileSync(process.execPath, ['scripts/test_stage2_core_loop.mjs'], {
      cwd: SANDBOX, encoding: 'utf8', env: { ...process.env, SKIP_ASSERTS: (skip || []).join(',') },
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  return out;
}
function firstFail(out) {
  const m = out.match(/^Error: STAGE 2 TEST FAILED: ([^(\n]+)/m);
  return m ? idOf(m[1]) : null;
}

buildSandbox();

console.log('='.repeat(104));
console.log('阶段 2 收尾项变异复验 (scripts/verify_stage2_mutations.mjs)');
console.log(`正本 = ${ROOT}   副本沙箱 = ${SANDBOX}`);
console.log('='.repeat(104));

const baseOut = runSuite([]);
const baseSum = (baseOut.match(/Result: ([^\n]*)/) || [])[1];
const dataSelfCheck = fs.readFileSync(path.join(SANDBOX, 'data', 'cards.json'), 'utf8').includes('"Tag_流派 = 整活"');
console.log(`\n### 基线（副本未变异）: ${baseSum}`);
console.log(`### 自检：副本 data 含 Tag 写入 = ${dataSelfCheck}；副本 DATA_DIR 已重定向 = true`);
if (!/PASSED \(0 failed\)/.test(baseSum || '') || !dataSelfCheck) {
  console.log('\n停手：基线未全绿或数据路径自检未过，变异读数不可用。');
  process.exit(1);
}

let allTrue = true;
for (const m of MUTS) {
  const p = path.join(SANDBOX, m.file);
  const orig = fs.readFileSync(p, 'utf8');
  if (!orig.includes(m.from)) {
    console.log(`\n${m.id}\n   变异锚点未命中 → 读数作废，须人工核对（不可当作通过）`);
    allTrue = false;
    continue;
  }
  fs.writeFileSync(p, orig.replace(m.from, m.to));
  const skip = []; const kills = []; const strays = [];
  let firstKiller = null, green = false;
  for (let i = 0; i < 16; i++) {
    const f = firstFail(runSuite(skip));
    if (!f) { green = true; break; }
    if (!firstKiller) firstKiller = f;
    skip.push(f);
    (m.expect.includes(f) ? kills : strays).push(f);
  }
  fs.writeFileSync(p, orig);
  const uniq = [...new Set(kills)];
  const verdict = uniq.length === m.expect.length ? '真咬' : (uniq.length ? '部分' : (strays.length ? '被更早断言杀掉' : '未咬'));
  if (verdict !== '真咬') allTrue = false;
  console.log(`\n${m.id}`);
  console.log(`   首个击杀 = ${firstKiller || '(无——套件全绿，说明该变异无人认领)'}`);
  console.log(`   期望集内被杀 = ${uniq.join(', ') || '(无)'}   期望集之外被杀 = ${[...new Set(strays)].join(', ') || '(无)'}`);
  console.log(`   期望 [${m.expect.join(', ')}] → ${verdict}${green ? '' : '   ⚠ 屏蔽到 16 条仍未回到全绿，牵连面须人工看'}`);
}

console.log('\n' + '='.repeat(104));
console.log(`总判定：8 条变异${allTrue ? '全部被验收套件杀掉（真咬）' : '存在未被杀掉或锚点未命中者，见上'}`);
console.log('口径提醒：本脚本只读正本、只在临时副本上打变异；正本 data 与 scripts 字节不动。');
console.log('='.repeat(104));
