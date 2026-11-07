/**
 * 阶段 3 · Yellow 表达式真抛错审计（独立于断言 99.4）
 *
 * 为什么要单独立这个脚本：断言 99.4 的写法是「在外部 try/catch 里调 evalCondition，数外部 catch 的次数」，
 * 而 gameState.evalCondition 内部自带 `catch { return false }`（gameState.mjs:272-273）——
 * 引擎把 ReferenceError / SyntaxError 全吞成 false，外部永远数不到抛错，99.4 的「零抛错」是构造保证、不是测量结果。
 * 上一轮 D09/H03/D12 卡住的正是同一类失效（表达式引用了引擎不认的东西 → 静默 false → 发牌门永不开）。
 *
 * 做法：把引擎整目录复制到临时沙箱，只在沙箱副本里把 evalCondition 的 catch 换成「记一笔再 return false」，
 *       然后拿 cards.json 全池的条件表达式逐条过引擎，看有多少条其实走的是 catch 支。
 * 在册 data 与 scripts/engine 字节不动。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = path.join(os.tmpdir(), 'zhubo_expr_audit');
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(path.join(SANDBOX, 'scripts/engine'), { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'data'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'scripts/engine'))) {
  fs.copyFileSync(path.join(ROOT, 'scripts/engine', f), path.join(SANDBOX, 'scripts/engine', f));
}
for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
  fs.copyFileSync(path.join(ROOT, 'data', f), path.join(SANDBOX, 'data', f));
}

const GS = path.join(SANDBOX, 'scripts/engine/gameState.mjs');
let src = fs.readFileSync(GS, 'utf8');
const target = src.match(/^([ \t]*)return Boolean\(Function\(`.*`\)\(\)\);/m);
if (!target) { console.error('未定位到 evalCondition 的 Function 求值行，拒绝盲改沙箱'); process.exit(2); }
src = src.replace(target[0], `${target[1]}try { return Boolean(Function(\`"use strict"; return (\${expr});\`)()); } catch (e) { (globalThis.__E = globalThis.__E || []).push({ expr, name: e.name, msg: String(e.message).slice(0, 90), after: expr }); return false; }`);
fs.writeFileSync(GS, src);

const { GameState } = await import(pathToFileURL(GS).href);
const cardsData = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data/cards.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data/config_and_screens.json'), 'utf8'));
const stateDict = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data/state_dictionary.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data/endings_and_talents.json'), 'utf8'));

// 表达式抽取：与断言 99.4 同源字段 + 我额外补的 ending/条件字段（口径差也一并报）
const uniq = new Map(); // expr -> [places]
const collect = (v, place) => { if (typeof v === 'string' && v.trim() && v !== 'null') { if (!uniq.has(v)) uniq.set(v, []); uniq.get(v).push(place); } };
const walk = (node, place) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const [i, x] of node.entries()) walk(x, `${place}[${i}]`); return; }
  for (const [k, v] of Object.entries(node)) {
    if (/^(prereq_expr|req_expr|check_expr|cond|condition|condition_expr)$/.test(k) || (k === 'if' && typeof v === 'string')) collect(v, `${place}.${k}`);
    else walk(v, `${place}.${k}`);
  }
};
for (const c of cardsData) walk(c, c.card_id);

const st = new GameState(configData, stateDict, endingsData);
st.selectedSchedule = { mode: '带货', timeSlot: 'evening', duration: 4 };

console.log('='.repeat(104));
console.log('阶段 3 · Yellow 表达式真抛错审计（沙箱只存在于临时目录；在册引擎字节不动）');
console.log('='.repeat(104));
console.log(`抽取口径：cards.json 全池递归取 prereq_expr / req_expr / check_expr / *.if / cond / condition → 唯一表达式 ${uniq.size} 条`);

globalThis.__E = [];
const results = [];
for (const [expr, places] of uniq) {
  const before = globalThis.__E.length;
  const val = st.evalCondition(expr);
  results.push({ expr, places, val, threw: globalThis.__E.length > before });
}
const threwList = globalThis.__E;
console.log(`外部 catch（断言 99.4 的数法）恒为 0 —— 引擎内部吞掉的才是真相：真走 catch 的表达式 ${threwList.length} 条 / ${uniq.size} 条`);
console.log('\n【真抛错清单】（表达式 → 异常类型 → 代入后仍留在式子里的自由标识符 → 出现位置数）');
const freeIds = s => [...new Set((s.match(/[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*/g) || []).filter(w => !['true', 'false', 'null', 'undefined', 'use', 'strict', 'return', 'Function', 'Boolean'].includes(w)))];
for (const e of threwList) {
  const leftover = freeIds(e.after).filter(w => !/^[<>!=]=?$/.test(w));
  console.log(`  · ${e.expr}`);
  console.log(`      ${e.name}: ${e.msg}`);
  console.log(`      代入后剩余 = ${e.after}`);
  console.log(`      可疑自由项 = ${leftover.slice(0, 8).join(', ') || '(无)'}     出现位置 ${uniq.get(e.expr).length} 处：${uniq.get(e.expr).slice(0, 3).join(', ')}${uniq.get(e.expr).length > 3 ? ' …' : ''}`);
}
if (!threwList.length) console.log('  （零条：本轮语法扩展后全池表达式确实都能被引擎代入求值，99.4 的结论成立，但它的数法仍然测不到东西）');

const silentFalse = results.filter(r => !r.threw && r.val === false);
console.log(`\n【静默 false 但未抛错】${silentFalse.length} 条（这些是「条件正常判定为不满足」，与语法无关）`);
const byKind = new Map();
for (const [expr] of uniq) {
  const kind = /\bmode\b\s*==/.test(expr) ? 'mode ==引用'
    : /\bC\d-[A-Z0-9]+/.test(expr) || /\bX-[A-Z0-9]+/.test(expr) ? '裸卡号引用'
      : /has_encountered/.test(expr) ? 'has_encountered'
        : /整活流|失控值高/.test(expr) ? '专有名词'
          : /cleared_main_endings_count|equipped_talents_count|total_endings_unlocked/.test(expr) ? '跨局继承键'
            : '纯键值比较';
  byKind.set(kind, (byKind.get(kind) || 0) + 1);
}
console.log('\n【引用形式分类计数（全形审计的独立口径）】');
for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  const sample = [...uniq.keys()].filter(e => k === 'mode ==引用' ? /\bmode\b\s*==/.test(e)
    : k === '裸卡号引用' ? (/\bC\d-[A-Z0-9]+/.test(e) || /\bX-[A-Z0-9]+/.test(e)) && !/has_encountered/.test(e)
      : k === 'has_encountered' ? /has_encountered/.test(e)
        : k === '专有名词' ? /整活流|失控值高/.test(e)
          : k === '跨局继承键' ? /cleared_main_endings_count|equipped_talents_count|total_endings_unlocked/.test(e)
            : !/\bmode\b\s*==/.test(e) && !/\bC\d-[A-Z0-9]+/.test(e) && !/\bX-[A-Z0-9]+/.test(e) && !/has_encountered/.test(e) && !/整活流|失控值高/.test(e) && !/cleared_main_endings_count|equipped_talents_count|total_endings_unlocked/.test(e))[0];
  console.log(`  ${k.padEnd(14)} ${String(n).padStart(3)} 条   例：${sample}`);
}
