/**
 * 阶段 3 · Yellow 留痕插桩副本（不改引擎、不改在册扫表脚本；只在内存里加计表）
 *
 *   T1 落定格抢占计数：triggerEnding 在「本局已有落支」时被拒的 (既有 -> 被拒) 对，按结局汇总。
 *      只统计真实卡路径：定向试算 probe() 打卡前会把 triggeredEnding 置空、打完即回滚，
 *      因此试算期间不可能出现「既有落支」，天然不计入 T1。
 *   T2 第6章结算入口快照（结算侧无试算，读数即真实局）：进入 ch6 结算时
 *      已落支 / c6m10Played / Qualified_M05 / Qualified_H08 等关键位，以及结算之后的落支。
 *      用途：把「M05 的兜底位在 C6-M10 默认 M01 之后」这件事从推理变成计数。
 *
 * 用法：SCAN_RUNS=10000 node scripts/yellow_instrumented_scan.mjs   （与在册扫表同一次运行、同一批种子）
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = f => pathToFileURL(path.join(ROOT, 'scripts/engine', f)).href;

const { GameState } = await import(url('gameState.mjs'));
const stMod = await import(url('stageSettlement.mjs'));

// ---------------- 快照/回滚跟踪（T1 的真实-试算分流与 T3 共用）
// 全仓唯一的 rollbackCardSnapshot 调用点是扫表脚本里的 probe()，于是「快照后被回滚」= 试算，未回滚 = 真实打出。
const SNAP = { cur: 0, rolled: new Set(), inCall: null, landedUnder: undefined };

// ---------------- T1 落定格抢占
// 注意口径：probe() 打卡前会把 triggeredEnding 置 null，所以「既有落支」只可能是
// 同一次打卡内部先写的那一支（例如掉热度判定写 D04、随后卡面直触写 D24）。
// 于是 T1 的每一条都发生在「同一次 selectOption 内两次写入」或「结算侧写入撞上卡面已落的支」，
// 跑完后按 SNAP.rolled 把试算那一次与真实打出那一次分开计数，避免把试算现象当成真实行为汇报。
const T1EV = [];
const origTrigger = GameState.prototype.triggerEnding;
GameState.prototype.triggerEnding = function (eid) {
  if (this.triggeredEnding && this.triggeredEnding !== eid) {
    T1EV.push({
      k: `${this.triggeredEnding}->${eid}`,
      snap: SNAP.inCall,
      sameCall: SNAP.landedUnder === SNAP.inCall,                       // 既有落支与本次被拒写入出自同一次打卡（同一次卡内两次写入）
      afterDeal: Boolean(this.isCleared || this.isDead),                 // 拒写时本局结局其实已定（通关/已暴毙，扫表循环还在继续打本章剩余卡）
    });
    return;
  }
  const r = origTrigger.call(this, eid);
  if (this.triggeredEnding === eid) SNAP.landedUnder = SNAP.inCall;
  return r;
};

// ---------------- T2 第6章结算入口/出口快照
const T2 = {
  enter: 0, c6m10: 0, qualM05: 0, qualM05BlockedByM01: 0,
  landedFromChain: new Map(), qualM05Final: new Map(),
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
  const r = origSettle.call(this, gs, adDoubleUsed);
  if (isCh6) {
    const after = gs.triggeredEnding;
    T2.landedFromChain.set(after, (T2.landedFromChain.get(after) || 0) + 1);
    if (hadQualM05) {
      const k = `Qualified_M05=1 → 实落 ${after}`;
      T2.qualM05Final.set(k, (T2.qualM05Final.get(k) || 0) + 1);
      if (after === 'M01') T2.qualM05BlockedByM01++;
    }
  }
  return r;
};

// ---------------- T3 真实卡路径 vs 定向试算探针 的分离计数（只算没被回滚的那次打卡）
const origSnap = GameState.prototype.takeCardSnapshot;
GameState.prototype.takeCardSnapshot = function (card) { SNAP.cur++; return origSnap.call(this, card); };
const origRoll = GameState.prototype.rollbackCardSnapshot;
GameState.prototype.rollbackCardSnapshot = function () { SNAP.rolled.add(SNAP.cur); return origRoll.call(this); };

const WATCH = { 'X-EGG-01': 'D22', 'C6-M08': 'M05', 'C5-M04': 'M05' };
const PENDING = [];   // {snapId, key, hadEnding, landed}
const cMod = await import(url('cardEngine.mjs'));
const origSelect = cMod.CardEngine.prototype.selectOption;
cMod.CardEngine.prototype.selectOption = function (card, optionKey, gs, timing) {
  const snapId = SNAP.cur + 1;          // 本次 selectOption 内部会 takeCardSnapshot
  const outer = SNAP.inCall;
  SNAP.inCall = snapId;
  const before = gs.triggeredEnding;
  try {
    const r = origSelect.call(this, card, optionKey, gs, timing);
    if (WATCH[card.card_id]) PENDING.push({ snapId, key: `${card.card_id}:${optionKey}`, hadEnding: !!before, landed: gs.triggeredEnding !== before });
    return r;
  } finally { SNAP.inCall = outer; }
};

await import(pathToFileURL(path.join(ROOT, 'scripts/simulate_stage3.mjs')).href);

// 收尾判类：探针的回滚发生在打卡之后，所以只在整轮跑完后用 rolled 集合区分真实/试算
const T3 = new Map();
for (const p of PENDING) {
  if (SNAP.rolled.has(p.snapId)) continue;      // 定向试算 probe()，非真实卡路径
  const rec = T3.get(p.key) || { real: 0, realWithEnding: 0, realLanded: 0 };
  rec.real++;
  if (p.hadEnding) rec.realWithEnding++;
  if (p.landed) rec.realLanded++;
  T3.set(p.key, rec);
}

const line = '─'.repeat(104);
console.log('\n' + line);
console.log('【Yellow 插桩附加读数】与上方在册 stdout 同一次运行、同一批种子');
const T1 = new Map(), T1real = new Map(), T1realLive = new Map(), T1sameCall = new Map();
for (const e of T1EV) {
  T1.set(e.k, (T1.get(e.k) || 0) + 1);
  if (e.snap === null || !SNAP.rolled.has(e.snap)) {          // 真实打卡（非试算回滚的那一次）
    T1real.set(e.k, (T1real.get(e.k) || 0) + 1);
    if (e.sameCall) T1sameCall.set(e.k, (T1sameCall.get(e.k) || 0) + 1);
    if (!e.afterDeal) T1realLive.set(e.k, (T1realLive.get(e.k) || 0) + 1);
  }
}
const sum = m => [...m.values()].reduce((a, b) => a + b, 0);
const t1 = [...T1.entries()].sort((a, b) => b[1] - a[1]);
console.log(`T1 落定格抢占（既有落支 -> 被拒写入）全量 ${t1.length} 种、${sum(T1)} 次；剔除定向试算后属真实打卡 ${T1real.size} 种、${sum(T1real)} 次；其中「同一次打卡内两次写入」${T1sameCall.size} 种、${sum(T1sameCall)} 次，「真实且被拒时本局结局还没定」${T1realLive.size} 种、${sum(T1realLive)} 次：`);
for (const [k, n] of t1.slice(0, 20)) console.log(`     ${k} = 全量 ${n} / 真实 ${T1real.get(k) || 0} / 真实同卡内 ${T1sameCall.get(k) || 0} / 真实且结局未定 ${T1realLive.get(k) || 0}`);
const extra = [...T1realLive.keys()].filter(k => !t1.slice(0, 20).some(([x]) => x === k));
if (extra.length) console.log('     未进 Top20 的「真实且结局未定」抢占：' + extra.map(k => `${k}=${T1realLive.get(k)}`).join('  '));
console.log('     口径提醒：在册扫表脚本的每章卡循环只在 isDead 时 break、不在 isCleared 时 break，所以通关后本局还会把本章剩余卡打完；这些多余打卡的写入都被落定格拒了，计入上面「真实」、不计入「结局未定」。');
const watchRows = t1.filter(([k]) => /->(D22|D01|D05|M05)$/.test(k));
console.log(`   点名尾巴的被拒记录：${watchRows.length ? watchRows.map(([k, n]) => `${k}=${n}`).join('  ') : '（->D22 / ->D01 / ->D05 / ->M05 一次都没有 → 这三项不是被落定格抢掉的）'}`);
console.log(`T2 第6章结算入口（分母 = 无落支进入 ch6 结算的局数）= ${T2.enter}   其中 c6m10Played=true ${T2.c6m10}   Qualified_M05=1 ${T2.qualM05}   →被兜底判成 M01 ${T2.qualM05BlockedByM01}`);
console.log('   Qualified_M05=1 的局在结算后的实落分布：', [...T2.qualM05Final.entries()].map(([k, n]) => `${k} = ${n}`).join('  ') || '（无）');
console.log('   ch6 结算出口落支分布：', [...T2.landedFromChain.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join('  '));
console.log('T3 载体卡真实打出计数（已剔除定向试算 probe 的那一次打卡）：');
for (const [k, v] of [...T3.entries()].sort((a, b) => b[1].real - a[1].real)) {
  console.log(`     ${k.padEnd(14)} 真实打出 ${String(v.real).padEnd(6)} 打出时本局已有落支 ${String(v.realWithEnding).padEnd(6)} 本次写入落支 ${v.realLanded}`);
}
if (!T3.size) console.log('     （三张载体卡在 30,000 局的真实路径里一次都没被打出）');

