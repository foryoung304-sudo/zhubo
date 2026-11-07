/**
 * 阶段 3 · 修复轮三 Yellow 留痕插桩副本（引擎与在册脚本字节不动，只在内存里加计表）
 *
 *   T1 落定格抢占四档读数（全量 / 真实 / 真实同卡内 / 真实且结局未定）——验新支有没有误吃活局。
 *   T2 第 6 章结算入口快照 + Qualified_M05 实落分布。
 *   T3 载体卡真实打出计数（剔除定向试算 probe 那一次打卡）。
 *   T4 ★本轮新增：第六章结算链反事实。按 stageSettlement:179-240 逐条转写判据，
 *      先证「转写首匹配 == 引擎实落」，再摘掉新 M05 支复算，量化 M05 吃掉了哪一层；
 *      同时按 Qualified_M05 / C6-M08:C / Flag_榜一恋爱+C6-M10:C 三个判据与写入来源分流。
 *   T5 ★本轮新增：X-EGG-03 真实打出时的「选时存款」分布，验 D24 在真实牌桌还有没有活路。
 *
 * 用法：SCAN_RUNS=10000 node scripts/yellow_chain_probe_r3.mjs   （与在册扫表同一次运行、同一批种子）
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = f => pathToFileURL(path.join(ROOT, 'scripts/engine', f)).href;

const { GameState } = await import(url('gameState.mjs'));
const stMod = await import(url('stageSettlement.mjs'));
const configData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config_and_screens.json'), 'utf8'));
const CH6_GATE = (configData.chapters || configData.chapter_config || []).find
  ? (configData.chapters || configData.chapter_config).find(c => c.chapter === 6)?.fans_gate_to
  : null;

// ---------------- 快照/回滚跟踪（真实 vs 定向试算分流）
const SNAP = { cur: 0, rolled: new Set(), inCall: null, landedUnder: undefined };

// ---------------- T1 落定格抢占
const T1EV = [];
const origTrigger = GameState.prototype.triggerEnding;
GameState.prototype.triggerEnding = function (eid) {
  if (this.triggeredEnding && this.triggeredEnding !== eid) {
    T1EV.push({
      k: `${this.triggeredEnding}->${eid}`,
      snap: SNAP.inCall,
      sameCall: SNAP.landedUnder === SNAP.inCall,
      afterDeal: Boolean(this.isCleared || this.isDead),
    });
    return;
  }
  const r = origTrigger.call(this, eid);
  if (this.triggeredEnding === eid) SNAP.landedUnder = SNAP.inCall;
  return r;
};

// ---------------- T4 结算链转写（逐条抄自 stageSettlement.mjs:179-240，含原有运算符优先级）
const ZHUANJING = new Set(['M06', 'M03', 'M07', 'M08', 'M09', 'M02', 'M10', 'M11']);
function chainOf(gs, { skipM05 = false } = {}) {
  const v = gs.variables || {};
  const cd = gs.cardDecisions || {};
  const attrs = gs.attributes || {};
  const mc = gs.modeChapterCounts || {};
  const mode = gs.selectedSchedule?.mode || '全模式';
  const fd = gs.fiveDim;
  const F = [
    ['H08', () => (v['Qualified_H08'] === 1 || v['Flag_老粉'] === 1) &&
      (cd['C6-M09'] === 'A' || (gs.cardHistory || []).includes('C6-M09'))],
    ['H06', () => (gs.durationHistory?.length >= 6) && gs.durationHistory.every(d => d === 6) &&
      (gs.sleepActionCount || 0) === 0 && !gs.isDead],
    ['H04', () => v['Qualified_H04'] === 1 || (v['Count_猫上镜'] || 0) >= 3],
    ['H10', () => v['Qualified_H10'] === 1 || (v['Count_考编'] || 0) >= 3],
    ['H05', () => v['Qualified_H05'] === 1 || ((v['Count_算法异常'] || 0) >= 3 && attrs['运气'] === 10)],
    ['H01', () => v['Qualified_H01'] === 1 || ((v['Count_黑粉不对线'] || 0) >= 3 && (attrs['情商'] || 0) >= 7)],
    ['H07', () => (v['Qualified_H07'] === 1 || v['Flag_零粉快乐'] === 1) && fd.fans < 10000 && fd.rep >= 90],
    ['M05', () => v['Qualified_M05'] === 1 || cd['C6-M08'] === 'C' ||
      (v['Flag_榜一恋爱'] === 1 && cd['C6-M10'] === 'C')],
    ['M06', () => v['Qualified_M06'] === 1 || ((mc['电台'] || 0) >= 3 && (attrs['嗓音'] || 0) >= 8)],
    ['M03', () => v['Qualified_M03'] === 1 || ((v['Flag_野生主播'] === 1 && (attrs['情商'] || 0) >= 8) && fd.wallet >= 3000000)],
    ['M07', () => v['Qualified_M07'] === 1 || (mode === '团播' || (mc['团播'] || 0) >= 3) && (attrs['才艺'] || 0) >= 8 && v['Flag_公款雷'] !== 1],
    ['M08', () => v['Qualified_M08'] === 1 || (((mc['游戏'] || 0) >= 3 || mode === '游戏') && (attrs['游戏技术'] || 0) >= 8)],
    ['M09', () => v['Qualified_M09'] === 1 || (((mc['户外'] || 0) >= 3 || mode === '户外') && fd.stamina >= 75)],
    ['M02', () => v['Qualified_M02'] === 1 || ((mc['带货'] || 0) >= 3 && (attrs['口才'] || 0) >= 8) || (v['Flag_选品减伤'] === 1 && mode === '带货')],
    ['M10', () => v['Qualified_M10'] === 1 || ((attrs['颜值'] || 0) <= 4 && (attrs['情商'] || 0) >= 7 && (attrs['口才'] || 0) >= 7)],
    ['M11', () => v['Qualified_M11'] === 1 || (fd.wallet >= 1000000 && fd.rep >= 65 && cd['C6-M10'] === 'C')],
    ['M01', () => v['Tag_清白账本'] === 1 && fd.rep >= 80],
    ['M12', () => cd['C6-M10'] === 'C'],
    ['M01', () => fd.fans >= 10000000 && fd.rep >= 85],
    ['M01', () => gs.c6m10Played],
    ['M04', () => v['Tag_流派'] === '整活'],
    ['M05', () => true],
  ];
  for (const [eid, fn] of F) {
    if (skipM05 && eid === 'M05' && fn !== F[F.length - 1][1]) continue;
    if (fn()) return eid;
  }
  return null;
}

// ---------------- T2 + T4 结算入口/出口
const T2 = { enter: 0, c6m10: 0, qualM05: 0, landedFromChain: new Map(), qualM05Final: new Map() };
const T4 = {
  population: 0, mismatch: 0, mismatchRows: new Map(),
  landed: new Map(),                     // 引擎实落分布
  wouldBe: new Map(),                    // 摘掉 M05 支后的复算分布
  displaced: new Map(),                  // 实落 M05 → 复算落到谁
  displacedLayer: { 彩蛋层: 0, 专精层: 0, 兜底层: 0, 仍是M05末位兜底: 0 },
  byClause: new Map(),                   // M05 三个判据命中组合
  byQualSource: new Map(),               // Qualified_M05 写入来源
  m05NoClause: 0,
};
const origSettle = stMod.StageSettlement.prototype.settleChapter;
stMod.StageSettlement.prototype.settleChapter = function (gs, adDoubleUsed) {
  const isCh6 = gs.currentChapter === 6;
  const before = gs.triggeredEnding;
  const hadQualM05 = gs.variables['Qualified_M05'] === 1 && isCh6 && !before;
  if (isCh6 && !before) {
    T2.enter++;
    if (gs.c6m10Played) T2.c6m10++;
    if (hadQualM05) T2.qualM05++;
  }
  const inChainPop = isCh6 && !before && !gs.isDead && (gs.fiveDim.fans >= CH6_GATE || gs.isCleared);
  const r = origSettle.call(this, gs, adDoubleUsed);
  if (isCh6) {
    const after = gs.triggeredEnding;
    T2.landedFromChain.set(after, (T2.landedFromChain.get(after) || 0) + 1);
    if (hadQualM05) {
      const k = `Qualified_M05=1 → 实落 ${after}`;
      T2.qualM05Final.set(k, (T2.qualM05Final.get(k) || 0) + 1);
    }
    if (inChainPop) {
      T4.population++;
      const pred = chainOf(gs);
      if (pred !== after) {
        T4.mismatch++;
        const k = `转写 ${pred} ≠ 实落 ${after}`;
        T4.mismatchRows.set(k, (T4.mismatchRows.get(k) || 0) + 1);
      }
      T4.landed.set(after, (T4.landed.get(after) || 0) + 1);
      if (after === 'M05') {
        const v = gs.variables || {}, cd = gs.cardDecisions || {};
        const without = chainOf(gs, { skipM05: true });
        T4.wouldBe.set(without, (T4.wouldBe.get(without) || 0) + 1);
        T4.displaced.set(without, (T4.displaced.get(without) || 0) + 1);
        if (ZHUANJING.has(without)) T4.displacedLayer.专精层++;
        else if (without === 'M05') T4.displacedLayer.仍是M05末位兜底++;
        else if (String(without).startsWith('H')) T4.displacedLayer.彩蛋层++;
        else T4.displacedLayer.兜底层++;
        const cl = [
          v['Qualified_M05'] === 1 ? 'Qualified_M05' : null,
          cd['C6-M08'] === 'C' ? 'C6-M08:C' : null,
          (v['Flag_榜一恋爱'] === 1 && cd['C6-M10'] === 'C') ? 'Flag_榜一恋爱+C6-M10:C' : null,
        ].filter(Boolean);
        const key = cl.length ? cl.join(' + ') : '（三判据都不成立却落了 M05 → 末位 else 兜底）';
        T4.byClause.set(key, (T4.byClause.get(key) || 0) + 1);
        if (!cl.length) T4.m05NoClause++;
        const src = [
          (cd['C5-M04'] === 'B' || cd['C5-M04'] === 'C') ? 'C5-M04:B/C(卡面写「进入C5-M05道歉质量判定」的前向引用)' : null,
          cd['C6-M08'] === 'C' ? 'C6-M08:C(卡面写「直通主结局M05」)' : null,
        ].filter(Boolean);
        const sk = src.length ? src.join(' + ') : '（Qualified_M05 未置位）';
        T4.byQualSource.set(sk, (T4.byQualSource.get(sk) || 0) + 1);
      }
    }
  }
  return r;
};

// ---------------- T3/T5 打卡跟踪
const origSnap = GameState.prototype.takeCardSnapshot;
GameState.prototype.takeCardSnapshot = function (card) { SNAP.cur++; return origSnap.call(this, card); };
const origRoll = GameState.prototype.rollbackCardSnapshot;
GameState.prototype.rollbackCardSnapshot = function () { SNAP.rolled.add(SNAP.cur); return origRoll.call(this); };

const WATCH = { 'X-EGG-01': 'D22', 'C6-M08': 'M05', 'C5-M04': 'M05', 'X-EGG-03': 'D24' };
const PENDING = [];
const EGG3 = [];
const cMod = await import(url('cardEngine.mjs'));
const origSelect = cMod.CardEngine.prototype.selectOption;
cMod.CardEngine.prototype.selectOption = function (card, optionKey, gs, timing) {
  const snapId = SNAP.cur + 1;
  const outer = SNAP.inCall;
  SNAP.inCall = snapId;
  const before = gs.triggeredEnding;
  const walletBefore = gs.fiveDim.wallet;
  try {
    const r = origSelect.call(this, card, optionKey, gs, timing);
    if (WATCH[card.card_id]) {
      PENDING.push({ snapId, key: `${card.card_id}:${optionKey}`, hadEnding: !!before, landed: gs.triggeredEnding !== before });
      if (card.card_id === 'X-EGG-03') {
        EGG3.push({ snapId, opt: optionKey, walletBefore, landed: gs.triggeredEnding, isDead: gs.isDead });
      }
    }
    return r;
  } finally { SNAP.inCall = outer; }
};

await import(pathToFileURL(path.join(ROOT, 'scripts/simulate_stage3.mjs')).href);

// ---------------- 汇总
const isReal = s => !(s === null || SNAP.rolled.has(s));
const T3 = new Map();
for (const p of PENDING) {
  if (!isReal(p.snapId)) continue;
  const rec = T3.get(p.key) || { real: 0, realWithEnding: 0, realLanded: 0 };
  rec.real++;
  if (p.hadEnding) rec.realWithEnding++;
  if (p.landed) rec.realLanded++;
  T3.set(p.key, rec);
}
const eggReal = EGG3.filter(e => isReal(e.snapId));
const eggProbe = EGG3.length - eggReal.length;

const line = '─'.repeat(104);
const sum = m => [...m.values()].reduce((a, b) => a + b, 0);
const mp = (m, f = x => x) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${f(k)}=${n}`).join('  ') || '（无）';

console.log('\n' + line);
console.log('【Yellow 修复轮三插桩读数】与上方在册 stdout 同一次运行、同一批种子');

const T1 = new Map(), T1real = new Map(), T1realLive = new Map(), T1sameCall = new Map();
for (const e of T1EV) {
  T1.set(e.k, (T1.get(e.k) || 0) + 1);
  if (isReal(e.snap)) {
    T1real.set(e.k, (T1real.get(e.k) || 0) + 1);
    if (e.sameCall) T1sameCall.set(e.k, (T1sameCall.get(e.k) || 0) + 1);
    if (!e.afterDeal) T1realLive.set(e.k, (T1realLive.get(e.k) || 0) + 1);
  }
}
const t1 = [...T1.entries()].sort((a, b) => b[1] - a[1]);
console.log(`T1 落定格抢占 全量 ${t1.length} 种/${sum(T1)} 次；真实打卡 ${T1real.size} 种/${sum(T1real)} 次；真实同卡内 ${T1sameCall.size} 种/${sum(T1sameCall)} 次；真实且被拒时结局未定 ${T1realLive.size} 种/${sum(T1realLive)} 次：`);
for (const [k, n] of t1.slice(0, 14)) console.log(`     ${k} = 全量 ${n} / 真实 ${T1real.get(k) || 0} / 真实同卡内 ${T1sameCall.get(k) || 0} / 真实且结局未定 ${T1realLive.get(k) || 0}`);
console.log(`   点名项被拒记录：${mp(new Map([...T1realLive].filter(([k]) => /->(M05|D24|H07|D22|D01|D05)$/.test(k))), k => '真实且结局未定 ' + k)}`);

console.log(`\nT2 ch6 结算入口（无落支进入）= ${T2.enter}  c6m10Played=true ${T2.c6m10}  Qualified_M05=1 ${T2.qualM05}`);
console.log('   Qualified_M05=1 的局结算后实落：' + mp(T2.qualM05Final));
console.log('   ch6 结算出口落支分布：' + mp(T2.landedFromChain));

console.log(`\nT4 结算链反事实（分母 = 进入 ch6 结算链的局 ${T4.population}）`);
const rate = T4.population ? (100 * (T4.population - T4.mismatch) / T4.population).toFixed(2) : '0';
console.log(`   转写保真度：首匹配 != 引擎实落 ${T4.mismatch} 局（${rate}% 一致）${T4.mismatch ? '：' + mp(T4.mismatchRows) : ' → 转写可信，反事实可用'}`);
console.log('   引擎实落分布：' + mp(T4.landed));
console.log(`   实落 M05 = ${T4.landed.get('M05') || 0} 局；摘掉新 M05 支后这些局会落到：` + mp(T4.wouldBe));
console.log(`   被 M05 吃掉的层位：彩蛋层 ${T4.displacedLayer.彩蛋层} / 专精层 ${T4.displacedLayer.专精层} / 兜底层 ${T4.displacedLayer.兜底层} / 仍是末位 else→M05 ${T4.displacedLayer.仍是M05末位兜底}`);
console.log('   实落 M05 的判据组合：' + mp(T4.byClause));
console.log('   其中 Qualified_M05 的写入来源：' + mp(T4.byQualSource));

console.log(`\nT5 X-EGG-03 打卡：真实 ${eggReal.length} 次 / 定向试算 ${eggProbe} 次`);
for (const opt of ['A', 'B']) {
  const rows = eggReal.filter(e => e.opt === opt);
  if (!rows.length) { console.log(`     ${opt}: 真实 0 次`); continue; }
  const w = rows.map(r => r.walletBefore).sort((a, b) => a - b);
  const dead = rows.filter(r => r.isDead).length;
  console.log(`     ${opt}: 真实 ${rows.length} 次  选时存款 min=${w[0]} 中位=${w[Math.floor(w.length / 2)]} max=${w[w.length - 1]}  ≤0 的次数=${w.filter(x => x <= 0).length}  打完即死=${dead}  实落：` +
    mp(new Map([...rows.reduce((m, r) => m.set(r.landed || 'null', (m.get(r.landed || 'null') || 0) + 1), new Map())])));
}

console.log('T3 载体卡真实打出（已剔除定向试算）：');
for (const [k, v] of [...T3.entries()].sort((a, b) => b[1].real - a[1].real)) {
  console.log(`     ${k.padEnd(14)} 真实打出 ${String(v.real).padEnd(6)} 打出时本局已有落支 ${String(v.realWithEnding).padEnd(6)} 本次写入落支 ${v.realLanded}`);
}
console.log(line);
