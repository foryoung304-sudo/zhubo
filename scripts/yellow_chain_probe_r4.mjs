/**
 * 阶段 3 · 修复轮四 Yellow 结算链反事实 + 特别法外溢普查（引擎与在册脚本字节不动，只在内存里加计表）
 *
 *   T4  把 stageSettlement.mjs@HEAD 的第 6 章链逐条转写（含原运算符优先级），
 *       先证「转写首匹配 == 引擎实落」，再跑两个反事实：
 *         cf-clause 摘掉 Orange 裁定的 M05 两分句支（保留末尾 else → M05 死尾）
 *         cf-tail   摘掉末尾 else → M05 死尾（保留两分句支）
 *         cf-both   两支都摘
 *       用途：分清「M05 落支」到底来自裁定的两分句，还是来自那条没人裁过的兜底 else。
 *   T5  M05 落支归因：C6-M08:C / Flag_榜一恋爱+C6-M10:C / 二者皆非（= 死尾喂的）。
 *   T6 ★特别法外溢普查：每一次真实打卡里，「卡面特别法已落支」把哪一条通用阈值暴毙压住了
 *       （would-fire 按 gameState.checkFiveDimDeath 同一判序现算），逐 (卡:选项 → 实落 / 被压住的 D) 汇总。
 *       这是 Gemini「全池仅 X-EGG-03:B 与 C4-M05:A 两处竞争」那句话的对账表。
 *   T7 isDead 侧漏：阈值已破但因已有落支而没置 isDead 的局，之后有没有照样通关（带伤通关）。
 *
 * 用法：SCAN_RUNS=10000 node scripts/yellow_chain_probe_r4.mjs   （与在册扫表同一次运行、同一批种子）
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = f => pathToFileURL(path.join(ROOT, 'scripts/engine', f)).href;
const { GameState } = await import(url('gameState.mjs'));
const stMod = await import(url('stageSettlement.mjs'));
const cMod = await import(url('cardEngine.mjs'));
const configData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config_and_screens.json'), 'utf8'));
const CH6_GATE = (configData.chapters || []).find(c => c.chapter === 6)?.fans_gate_to;

// ---------------- 快照/回滚跟踪（真实 vs 定向试算分流）
const SNAP = { cur: 0, rolled: new Set(), inCall: null, landedUnder: undefined, settleDepth: 0, cardLabel: new Map() };
const origSnap = GameState.prototype.takeCardSnapshot;
GameState.prototype.takeCardSnapshot = function (card) { SNAP.cur++; return origSnap.call(this, card); };
const origRoll = GameState.prototype.rollbackCardSnapshot;
GameState.prototype.rollbackCardSnapshot = function () { SNAP.rolled.add(SNAP.cur); return origRoll.call(this); };

// ---------------- T4 结算链转写（抄自 HEAD stageSettlement.mjs:179-241）
function makeF(gs, { dropClause = false, dropTail = false } = {}) {
  const v = gs.variables || {}, cd = gs.cardDecisions || {}, attrs = gs.attributes || {};
  const mc = gs.modeChapterCounts || {}, mode = gs.selectedSchedule?.mode || '全模式', fd = gs.fiveDim;
  const TAIL = ['M05', () => true, '兜底:末尾 else（没人裁过的死尾）'];
  const F = [
    ['H08', () => (v['Qualified_H08'] === 1 || v['Flag_老粉'] === 1) &&
      (cd['C6-M09'] === 'A' || (gs.cardHistory || []).includes('C6-M09')), '彩蛋:H08'],
    ['H06', () => (gs.durationHistory?.length >= 6) && gs.durationHistory.every(d => d === 6) &&
      (gs.sleepActionCount || 0) === 0 && !gs.isDead, '彩蛋:H06'],
    ['H04', () => v['Qualified_H04'] === 1 || (v['Count_猫上镜'] || 0) >= 3, '彩蛋:H04'],
    ['H10', () => v['Qualified_H10'] === 1 || (v['Count_考编'] || 0) >= 3, '彩蛋:H10'],
    ['H05', () => v['Qualified_H05'] === 1 || ((v['Count_算法异常'] || 0) >= 3 && attrs['运气'] === 10), '彩蛋:H05'],
    ['H01', () => v['Qualified_H01'] === 1 || ((v['Count_黑粉不对线'] || 0) >= 3 && (attrs['情商'] || 0) >= 7), '彩蛋:H01'],
    ['H07', () => (v['Qualified_H07'] === 1 || v['Flag_零粉快乐'] === 1) && fd.fans < 10000 && fd.rep >= 90, '彩蛋:H07'],
    ['M06', () => v['Qualified_M06'] === 1 || ((mc['电台'] || 0) >= 3 && (attrs['嗓音'] || 0) >= 8), '专精:M06'],
    ['M03', () => v['Qualified_M03'] === 1 || ((v['Flag_野生主播'] === 1 && (attrs['情商'] || 0) >= 8) && fd.wallet >= 3000000), '专精:M03'],
    ['M07', () => v['Qualified_M07'] === 1 || (mode === '团播' || (mc['团播'] || 0) >= 3) && (attrs['才艺'] || 0) >= 8 && v['Flag_公款雷'] !== 1, '专精:M07'],
    ['M08', () => v['Qualified_M08'] === 1 || (((mc['游戏'] || 0) >= 3 || mode === '游戏') && (attrs['游戏技术'] || 0) >= 8), '专精:M08'],
    ['M09', () => ((mc['户外'] || 0) >= 3 || mode === '户外') && fd.stamina >= 75, '专精:M09'],
    ['M02', () => v['Qualified_M02'] === 1 || ((mc['带货'] || 0) >= 3 && (attrs['口才'] || 0) >= 8) || (v['Flag_选品减伤'] === 1 && mode === '带货'), '专精:M02'],
    ['M10', () => v['Qualified_M10'] === 1 || ((attrs['颜值'] || 0) <= 4 && (attrs['情商'] || 0) >= 7 && (attrs['口才'] || 0) >= 7), '专精:M10'],
    ['M11', () => v['Qualified_M11'] === 1 || (fd.wallet >= 1000000 && fd.rep >= 65 && cd['C6-M10'] === 'C'), '专精:M11'],
    ['M01', () => v['Tag_清白账本'] === 1 && fd.rep >= 80, '兜底:M01-清白账本'],
    ['M05', () => cd['C6-M08'] === 'C' || (v['Flag_榜一恋爱'] === 1 && cd['C6-M10'] === 'C'), '裁定:M05-两分句'],
    ['M12', () => cd['C6-M10'] === 'C', '兜底:M12-C6M10选C'],
    ['M01', () => fd.fans >= 10000000 && fd.rep >= 85, '兜底:M01-加冕'],
    ['M01', () => gs.c6m10Played, '兜底:M01-c6m10Played'],
    ['M04', () => v['Tag_流派'] === '整活', '兜底:M04-整活'],
  ];
  if (!dropTail) F.push(TAIL);
  for (let i = 0; i < F.length; i++) {
    const [eid, fn, label] = F[i];
    if (dropClause && eid === 'M05' && fn !== TAIL[1]) continue;
    if (fn()) return { eid, label };
  }
  return null;
}

// ---------------- T11 落支 vs 正本行保真（逐条按 endings_and_talents.json 的 trigger_condition 现判）
// 正本行里引擎没有对应字段的子句记 NA（不臆判），只按可判子句给出「可判部分是否成立」。
function canonRow(eid, gs) {
  const v = gs.variables || {}, cd = gs.cardDecisions || {}, a = gs.attributes || {};
  const mc = gs.modeChapterCounts || {}, fd = gs.fiveDim, hist = gs.cardHistory || [];
  const has = k => (v[k] || 0) >= 1;
  switch (eid) {
    case 'M06': return { ok: (mc['电台'] || 0) >= 3 && (a['嗓音'] || 0) >= 8, na: [], fail: `${(mc['电台'] || 0) < 3 ? '主修电台<3 ' : ''}${(a['嗓音'] || 0) < 8 ? '嗓音<8' : ''}` };
    case 'M07': return { ok: (mc['团播'] || 0) >= 3 && (a['才艺'] || 0) >= 8 && v['Flag_公款雷'] !== 1, na: [], fail: `${(mc['团播'] || 0) < 3 ? '主修团播=' + (mc['团播'] || 0) + ' ' : ''}${(a['才艺'] || 0) < 8 ? '才艺=' + (a['才艺'] || 0) : ''}` };
    case 'M08': return { ok: (mc['游戏'] || 0) >= 3 && (a['游戏技术'] || 0) >= 8, na: ['通过开挂质疑自证（C3-M03/X-ATTR-04）：代码无此门'], fail: `${(mc['游戏'] || 0) < 3 ? '主修游戏=' + (mc['游戏'] || 0) + ' ' : ''}${(a['游戏技术'] || 0) < 8 ? '游戏技术<8' : ''}` };
    case 'M09': return { ok: (mc['户外'] || 0) >= 3 && fd.stamina >= 75, na: ['户外失控值未爆：代码无此门'], fail: `${(mc['户外'] || 0) < 3 ? '主修户外=' + (mc['户外'] || 0) + ' ' : ''}${fd.stamina < 75 ? '状态=' + Math.round(fd.stamina) : ''}` };
    case 'M03': return { ok: fd.wallet >= 3000000 && (cd['C5-M03'] !== undefined || (v['Flag_野生主播'] === 1 && (a['情商'] || 0) >= 8)), na: [], fail: `钱包=${Math.round(fd.wallet / 10000)}万<300万` };
    case 'M11': return { ok: fd.wallet >= 1000000 && fd.rep >= 65 && (has('Qualified_M11') || hist.includes('X-EGG-06') || cd['C6-M10'] === 'C'), na: [], fail: `钱包=${Math.round(fd.wallet / 10000)}万<100万 或 口碑=${fd.rep}<65` };
    case 'M02': return { ok: (mc['带货'] || 0) >= 3, na: ['Total_Income ≥ ¥5,000,000：代码无累计营收字段', '全程未触发带货死雷：代码无此门'], fail: `主修带货=${mc['带货'] || 0}<3` };
    case 'M10': return { ok: (a['颜值'] || 0) <= 4 && (a['情商'] || 0) >= 7 && (a['口才'] || 0) >= 7, na: ['剪切片≥3 或 X-ATTR-10：代码无此门'], fail: '属性组不成立' };
    case 'M01': return { ok: fd.fans >= 10000000 && fd.rep >= 85, na: ['顶流之夜全过且未踩红线：代码无此门'], fail: `粉丝=${Math.round(fd.fans / 10000)}万<1000万 或 口碑=${fd.rep}<85` };
    case 'M05': return { ok: cd['C6-M08'] === 'C' || (v['Flag_榜一恋爱'] === 1 && cd['C6-M10'] === 'C'), na: ['「恋爱对象好感满值」用 Flag_榜一恋爱 代理（字典无好感计数）'], fail: '两分句皆不成立（= 死尾喂的）' };
    case 'M04': return { ok: fd.fans < 1000000 && fd.rep >= 80 && fd.stamina >= 80, na: [], fail: '粉丝≥100万 或 口碑<80 或 状态<80' };
    case 'M12': return { ok: true, na: ['「无任何专精路线达标，全程中庸平安」无可判字段'], fail: '' };
    default: return { ok: null, na: [], fail: '' };   // H 系列本轮不重判（上一轮已有读数）
  }
}

// ---------------- T5 M05 落支归因（在 triggerEnding 现场算，状态与引擎所见一致）
const T5 = new Map();
const origTrigger = GameState.prototype.triggerEnding;
GameState.prototype.triggerEnding = function (eid) {
  if (this.triggeredEnding && this.triggeredEnding !== eid) return;
  if (SNAP.settleDepth > 0 && !this.triggeredEnding) t8Record(this, eid);   // 链内落支瞬间的精确归类
  if (eid === 'M05' && SNAP.settleDepth > 0 && !this.triggeredEnding) {
    const cd = this.cardDecisions || {}, v = this.variables || {};
    const c1 = cd['C6-M08'] === 'C';
    const c2 = v['Flag_榜一恋爱'] === 1 && cd['C6-M10'] === 'C';
    const k = c1 ? '① C6-M08:C 退圈结婚' : c2 ? '② Flag_榜一恋爱=1 + C6-M10:C' : '③ 两分句皆不成立 → 末尾 else 死尾喂的 M05';
    T5.set(k, (T5.get(k) || 0) + 1);
    if (!c1 && !c2) {
      const q = v['Qualified_M05'] === 1 ? '（该局手里有 Qualified_M05=1，已无人消费）' : '（连 Qualified_M05 都没有）';
      T5.set('③ 细分' + q, (T5.get('③ 细分' + q) || 0) + 1);
    }
  }
  const r = origTrigger.call(this, eid);
  if (this.triggeredEnding === eid) { SNAP.landedUnder = SNAP.inCall; if (this.__landedAtSnap === undefined) this.__landedAtSnap = SNAP.cur; }
  return r;
};

// ---------------- T4 结算入口/出口 + 反事实
const T4 = {
  population: 0, mismatch: 0, mismatchRows: new Map(),
  landed: new Map(), cfClause: new Map(), cfTail: new Map(), cfBoth: new Map(),
  clauseLandings: 0, tailOnlyLandings: 0,
  cfClauseWhereStillM05: 0, cfTailWhereStillM05: 0,
  gracefulExit: 0, gracefulLanded: new Map(),
  displacedLayer: { 彩蛋层: 0, 专精层: 0, 兜底M01: 0, 兜底M12: 0, 兜底M04: 0 },
  m01Sub: new Map(),        // T5b：被两分句吃掉的局，摘掉后落 M01 时走的是哪一条 M01 分句
  displacedDetail: new Map(),  // T5b：摘掉两分句后每个落支的明细
  observedQual: new Map(),   // T9：链样本局手里实际存在的 Qualified_ 键（与「谁读它」对账）
  evidence: new Map(),        // T10：专精/表外键落支局的逐局证据（真实牌序、零手置）——每个结局留一条
  lexSplit: new Map(),       // T8c：★只靠旗标落支的局，正本行的各条 AND 条件分别成不成立
  branch: new Map(),         // T11b：实落结局 ← 命中的代码分支（逐支归属表）
  canon: new Map(),          // T11：落支 vs 正本行可判子句
  canonNa: new Map(),        // T11：正本行里引擎没有对应字段的子句计数
  canonFailDetail: new Map(),
};
// T5b：M01 在本链里有三条分句（:223 清白账本、:231 加冕、:233 c6m10Played），按引擎原序判首匹配
function m01SubClause(gs) {
  if (gs.variables['Tag_清白账本'] === 1 && gs.fiveDim.rep >= 80) return '① Tag_清白账本=1 + 口碑≥80（:223）';
  if (gs.fiveDim.fans >= 10000000 && gs.fiveDim.rep >= 85) return '② 粉丝≥1e7 + 口碑≥85（:231）';
  if (gs.c6m10Played) return '③ C6-M10 打过牌即默认终局（:233）';
  return '★三条 M01 分句皆不成立（该走更后面的支，转写需复核）';
}
// ---------------- T8 逐键：链内落支是靠「Qualified_ 旗标」还是靠「正本行的条件」
// qual = 只读 Qualified_ 的那个析取支；cond = 正本行其余条件（表源/计数/属性/五维）。
const CHAIN_CLAUSES = [
  ['H04', (gs) => (gs.variables['Qualified_H04'] === 1), (gs) => (gs.variables['Count_猫上镜'] || 0) >= 3],
  ['H10', (gs) => (gs.variables['Qualified_H10'] === 1), (gs) => (gs.variables['Count_考编'] || 0) >= 3],
  ['H05', (gs) => (gs.variables['Qualified_H05'] === 1), (gs) => ((gs.variables['Count_算法异常'] || 0) >= 3 && gs.attributes['运气'] === 10)],
  ['H01', (gs) => (gs.variables['Qualified_H01'] === 1), (gs) => ((gs.variables['Count_黑粉不对线'] || 0) >= 3 && (gs.attributes['情商'] || 0) >= 7)],
  ['H07', (gs) => (gs.variables['Qualified_H07'] === 1), (gs) => (gs.variables['Flag_零粉快乐'] === 1)],
  ['M06', (gs) => (gs.variables['Qualified_M06'] === 1), (gs) => ((gs.modeChapterCounts?.['电台'] || 0) >= 3 && (gs.attributes['嗓音'] || 0) >= 8)],
  ['M03', (gs) => (gs.variables['Qualified_M03'] === 1), (gs) => ((gs.variables['Flag_野生主播'] === 1 && (gs.attributes['情商'] || 0) >= 8) && gs.fiveDim.wallet >= 3000000)],
  ['M07', (gs) => (gs.variables['Qualified_M07'] === 1), (gs) => { const mode = gs.selectedSchedule?.mode || '全模式'; return (mode === '团播' || (gs.modeChapterCounts?.['团播'] || 0) >= 3) && (gs.attributes['才艺'] || 0) >= 8 && gs.variables['Flag_公款雷'] !== 1; }],
  ['M08', (gs) => (gs.variables['Qualified_M08'] === 1), (gs) => { const mode = gs.selectedSchedule?.mode || '全模式'; return (((gs.modeChapterCounts?.['游戏'] || 0) >= 3 || mode === '游戏') && (gs.attributes['游戏技术'] || 0) >= 8); }],
  ['M02', (gs) => (gs.variables['Qualified_M02'] === 1), (gs) => { const mode = gs.selectedSchedule?.mode || '全模式'; return ((gs.modeChapterCounts?.['带货'] || 0) >= 3 && (gs.attributes['口才'] || 0) >= 8) || (gs.variables['Flag_选品减伤'] === 1 && mode === '带货'); }],
  ['M10', (gs) => (gs.variables['Qualified_M10'] === 1), (gs) => ((gs.attributes['颜值'] || 0) <= 4 && (gs.attributes['情商'] || 0) >= 7 && (gs.attributes['口才'] || 0) >= 7)],
  ['M11', (gs) => (gs.variables['Qualified_M11'] === 1), (gs) => (gs.fiveDim.wallet >= 1000000 && gs.fiveDim.rep >= 65 && gs.cardDecisions?.['C6-M10'] === 'C')],
];
const T8 = new Map();
const T8b = new Map();   // 只靠正本条件的专精落支：「主修计数≥3」还是「当章 mode 捷径」挣来的
const MODE_SHORTCUT = { M07: '团播', M08: '游戏', M09: '户外', M02: '带货' };
function t8Record(gs, eid) {
  for (const [id, qual, cond] of CHAIN_CLAUSES) {
    if (id !== eid) continue;
    const q = qual(gs), c = cond(gs);
    const k = q && c ? '旗标+条件都成立' : q ? '★只靠 Qualified_ 旗标（正本条件不成立）' : c ? '只靠正本条件' : '两者都不成立(不该落此支)';
    T8.set(`${eid} ${k}`, (T8.get(`${eid} ${k}`) || 0) + 1);
    if (q && !c) {   // T8c：旗标单独落支时，正本行的 AND 条件还成立吗（成立=表内 OR 支路，不成立=绕过正本门）
      const cr = canonRow(eid, gs);
      const kk = cr.ok === null ? `${eid} 正本行本轮不判` : cr.ok ? `${eid} 正本行仍成立（旗标=表内 OR 支路，合规）`
        : `★${eid} 正本行也不成立（旗标绕过正本门）：${cr.fail}`;
      T4.lexSplit.set(kk, (T4.lexSplit.get(kk) || 0) + 1);
    }
    if (c && !q && MODE_SHORTCUT[eid]) {
      const cnt = (gs.modeChapterCounts?.[MODE_SHORTCUT[eid]] || 0);
      const shortcut = (gs.selectedSchedule?.mode || '全模式') === MODE_SHORTCUT[eid];
      const lab = cnt >= 3 ? `主修[${MODE_SHORTCUT[eid]}]计数=${cnt}（引擎逐章累积，≥3 成立）`
                           : shortcut ? `★计数=${cnt}<3，只靠「当章 mode===${MODE_SHORTCUT[eid]}」捷径支`
                                      : '★计数与 mode 都不成立（转写需复核）';
      T8b.set(`${eid} ${lab}`, (T8b.get(`${eid} ${lab}`) || 0) + 1);
    }
    return;
  }
}
const ZHUANJING = new Set(['M06', 'M03', 'M07', 'M08', 'M09', 'M02', 'M10', 'M11']);
const CAIDAN = new Set(['H08', 'H06', 'H04', 'H10', 'H05', 'H01', 'H07']);
const origSettle = stMod.StageSettlement.prototype.settleChapter;
stMod.StageSettlement.prototype.settleChapter = function (gs, adDoubleUsed) {
  const isCh6 = gs.currentChapter === 6;
  const pre = isCh6 && !gs.triggeredEnding && !gs.isDead;
  SNAP.settleDepth++;
  const r = origSettle.call(this, gs, adDoubleUsed);
  SNAP.settleDepth--;
  // 只有 isPromoted（第6章达标）的局才进加冕链；未达标走「体面收场」支，落 M04/M12/H07，不入链样本
  if (pre && !r.isPromoted) { T4.gracefulExit++; if (gs.triggeredEnding) T4.gracefulLanded.set(gs.triggeredEnding, (T4.gracefulLanded.get(gs.triggeredEnding) || 0) + 1); }
  if (isCh6 && pre && r.isPromoted && gs.triggeredEnding) {
    const actual = gs.triggeredEnding;
    const t = makeF(gs, {});
    const tClause = makeF(gs, { dropClause: true });
    const tTail = makeF(gs, { dropTail: true });
    const tBoth = makeF(gs, { dropClause: true, dropTail: true });
    T4.population++;
    if (!t || t.eid !== actual) {
      T4.mismatch++;
      const k = `转写=${t ? t.eid : null} 实落=${actual}`;
      T4.mismatchRows.set(k, (T4.mismatchRows.get(k) || 0) + 1);
    }
    const bump = (m, x) => m.set(x, (m.get(x) || 0) + 1);
    bump(T4.landed, actual); bump(T4.cfClause, tClause ? tClause.eid : null);
    bump(T4.cfTail, tTail ? tTail.eid : null); bump(T4.cfBoth, tBoth ? tBoth.eid : null);
    bump(T4.branch, `${actual} ← ${t ? t.label : '(无匹配支)'}`);
    for (const [k, val] of Object.entries(gs.variables || {})) {
      if (/^Qualified_/.test(k) && val === 1) bump(T4.observedQual, k.slice('Qualified_'.length));
    }
    // T11：落支与正本行 trigger_condition 的可判子句是否一致
    const c = canonRow(actual, gs);
    if (c.ok !== null) {
      bump(T4.canon, `${actual} ${c.ok ? '可判子句全部成立' : '★可判子句不成立：' + c.fail}`);
      if (c.na.length) bump(T4.canonNa, `${actual} 表内未接子句 ${c.na.length} 条`);
      if (!c.ok && T4.canonFailDetail.size < 40) {
        const d = `${actual} 主修=${JSON.stringify(gs.modeChapterCounts || {})} 钱包=${Math.round(gs.fiveDim.wallet / 10000)}万 口碑=${gs.fiveDim.rep} 状态=${Math.round(gs.fiveDim.stamina)} 才艺=${gs.attributes['才艺']} 粉丝=${Math.round(gs.fiveDim.fans / 10000)}万 Qualified_=${JSON.stringify(Object.keys(gs.variables).filter(k => /^Qualified_/.test(k)))}`;
        T4.canonFailDetail.set(d, (T4.canonFailDetail.get(d) || 0) + 1);
      }
    }
    if (/M0[2-9]|M1[01]/.test(String(actual))) {
      const txt = `${actual} 主修=${JSON.stringify(gs.modeChapterCounts || {})} 状态=${Math.round(gs.fiveDim.stamina)} 口碑=${gs.fiveDim.rep} 钱包=${Math.round(gs.fiveDim.wallet / 10000)}万 时长=${JSON.stringify(gs.durationHistory)} 手牌${gs.cardHistory.length}张 旗标=${JSON.stringify(Object.keys(gs.variables).filter(k => /^Qualified_/.test(k)))}`;
      if (!T4.evidence.has(actual)) T4.evidence.set(actual, { n: 1, txt });
      else T4.evidence.get(actual).n++;
    }
    if (actual === 'M05') {
      const ce = tClause ? tClause.eid : null;
      const te = tTail ? tTail.eid : null;
      if (ce === 'M05') T4.cfClauseWhereStillM05++;
      if (te === 'M05') T4.cfTailWhereStillM05++;
      if (ce !== 'M05') T4.clauseLandings++;
      else T4.tailOnlyLandings++;
      if (ce !== 'M05') {
        bump(T4.displacedDetail, ce);
        if (ce === 'M01') bump(T4.m01Sub, m01SubClause(gs));
      }
      if (CAIDAN.has(ce)) T4.displacedLayer.彩蛋层++;
      else if (ZHUANJING.has(ce)) T4.displacedLayer.专精层++;
      else if (ce === 'M01') T4.displacedLayer.兜底M01++;
      else if (ce === 'M12') T4.displacedLayer.兜底M12++;
      else if (ce === 'M04') T4.displacedLayer.兜底M04++;
    }
  }
  return r;
};

// ---------------- T6 特别法外溢普查
const T6 = new Map();
const T7 = { suppressedButCleared: 0, samples: [] };
function wouldFireD(gs) {
  const fd = gs.fiveDim;
  if (fd.stamina <= 0) return 'D01';
  if (fd.wallet <= 0 && gs.currentChapter >= 2) return 'D02';
  if (fd.rep <= -20) return 'D03';
  if (fd.heat <= 0 && gs.currentChapter >= 2) return 'D04';
  if (gs.haterPct >= 100 && (gs.attributes['心态'] || 0) < 8) return 'D05';
  return null;
}
const origDeath = GameState.prototype.checkFiveDimDeath;
GameState.prototype.checkFiveDimDeath = function () {
  const wf = wouldFireD(this);
  if (wf && (this.isDead || this.triggeredEnding)) {            // 被入口守卫压住
    // T6c：谁在这一刻压住了阈值——按快照号回查当前正在执行的 (卡:选项)，
    //       并区分「落支与破阈值同一张卡」还是「先落了支、后面另一张卡才把五维打穿」
    const src = SNAP.inCall === null ? '结算/非打卡' : (SNAP.cardLabel.get(SNAP.inCall) || '打卡内(未登记)');
    const landedFirst = SNAP.inCall !== null && this.__landedAtSnap !== undefined && this.__landedAtSnap < SNAP.inCall;
    const landed = this.triggeredEnding || '(isDead 已置)';
    const k = `${landedFirst ? '后手卡' : '同卡/落支当刻'} ${src} 落 ${landed} 压住 ${wf}`;
    if (!T6.has(k)) T6.set(k, { real: 0, probe: 0, byCard: new Map() });
    const rec = T6.get(k);
    if (SNAP.inCall !== null && SNAP.rolled.has(SNAP.inCall)) rec.probe++;
    else {
      rec.real++;
      if (this.isCleared) { T7.suppressedButCleared++; if (T7.samples.length < 5) T7.samples.push(`${landed}  yet isCleared, ${wf} 已破`); }
    }
  }
  return origDeath.call(this);
};
// 逐卡归属：selectOption 维度记录 (卡:选项) → 被压住的 D
const WATCHCARD = new Map();
const origSelect = cMod.CardEngine.prototype.selectOption;
cMod.CardEngine.prototype.selectOption = function (card, optionKey, gs, timing) {
  const snapId = SNAP.cur + 1;
  SNAP.cardLabel.set(snapId, `${card.card_id}:${optionKey}`);
  const outer = SNAP.inCall;
  SNAP.inCall = snapId;
  const before = gs.triggeredEnding;
  const r = origSelect.call(this, card, optionKey, gs, timing);
  if (gs.triggeredEnding && gs.triggeredEnding !== before) {
    const wf = wouldFireD(gs);
    if (wf && wf !== gs.triggeredEnding) {
      const k = `${card.card_id}:${optionKey} → 实落 ${gs.triggeredEnding}（同选项阈值本应落 ${wf}）`;
      WATCHCARD.set(k, (WATCHCARD.get(k) || 0) + (SNAP.rolled.has(snapId) ? 0 : 1));
    }
  }
  SNAP.inCall = outer;
  return r;
};

await import(pathToFileURL(path.join(ROOT, 'scripts/simulate_stage3.mjs')).href);

const line = '─'.repeat(108);
const top = (m, n = 14) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log('\n' + line);
console.log('【Yellow 修复轮四 · 反事实与外溢读数】与上方在册 stdout 同一次运行、同一批种子');
console.log(line);
console.log(`T4 第6章结算链转写保真：样本 ${T4.population} 局，转写首匹配 ≠ 引擎实落 = ${T4.mismatch} 局` +
  (T4.mismatch ? '   ★失配：' + top(T4.mismatchRows, 8).map(([k, v]) => `${k}=${v}`).join('  ') : '   ✓ 保真成立，反事实可用'));
console.log('   引擎实落分布：  ' + top(T4.landed, 12).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('   cf-clause（摘两分句、留死尾）：' + top(T4.cfClause, 12).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('   cf-tail  （摘死尾、留两分句）：' + top(T4.cfTail, 12).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('   cf-both  （两支全摘）        ：' + top(T4.cfBoth, 12).map(([k, v]) => `${k}:${v}`).join('  '));
console.log(`   M05 落支 ${[...T4.landed].filter(([k]) => k === 'M05').map(([, v]) => v)[0] || 0} 局里：两分句挣来的 ${T4.clauseLandings}，摘掉两分句后照样是 M05（死尾喂）的 ${T4.cfClauseWhereStillM05}，摘掉死尾后不再是 M05 的 ${T4.cfTailWhereStillM05}`);
console.log(`   被 M05 吃掉的层位（cf-clause 口径）：彩蛋层 ${T4.displacedLayer.彩蛋层} / 专精层 ${T4.displacedLayer.专精层} / 兜底M01 ${T4.displacedLayer.兜底M01} / 兜底M12 ${T4.displacedLayer.兜底M12} / 兜底M04 ${T4.displacedLayer.兜底M04}`);
console.log('T5b 摘掉两分句后这批局的去向明细（M01 还要分是哪条 M01 分句）：');
for (const [k, v] of top(T4.displacedDetail, 12)) console.log(`     原样会落 ${String(k).padEnd(4)} = ${v}`);
for (const [k, v] of top(T4.m01Sub, 6)) console.log(`     其中 M01 的分句：${k} = ${v}`);
console.log(line);
console.log('T5 M05 落支归因（在 triggerEnding 现场按裁定原文两分句判）：');
for (const [k, v] of [...T5.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${k} = ${v}`);
console.log(line);
console.log(`T6 特别法压住一般法（真实局 / 定向试算），共 ${T6.size} 种：`);
for (const [k, v] of top(T6, 20)) console.log(`     ${k}   真实 ${v.real}  试算 ${v.probe}`);
console.log('T6b 逐 (卡:选项) 归属（只计真实打出，已剔除定向试算）：');
for (const [k, v] of top(WATCHCARD, 20)) console.log(`     ${k}  ×${v}`);
if (!WATCHCARD.size) console.log('     （无）');
console.log(line);
console.log(`T7 阈值已破但 isDead 没置、该局随后仍被判通关：${T7.suppressedButCleared} 次` + (T7.samples.length ? '   样例：' + T7.samples.join(' | ') : ''));
console.log(line);
console.log(`T4b 第6章未达标体面收场（不入链样本；上一版把这里误计进链样本，造成 336 条「转写≠实落」假失配，本轮已修）= ${T4.gracefulExit} 局，落支分布：` +
  top(T4.gracefulLanded, 8).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('T8 链内落支归类：旗标（Qualified_）vs 正本行条件（★=只靠旗标，即 Orange 通则下的残留泄漏）');
for (const [k, v] of [...T8.entries()].sort((a, b) => (/★/.test(a[0]) ? -1 : /★/.test(b[0]) ? 1 : b[1] - a[1]))) {
  if (/★|两者都不成立/.test(k)) console.log(`     ${k} = ${v}`);
}
const okQ = [...T8.entries()].filter(([k]) => !/★|两者都不成立/.test(k));
console.log('     （非★项合计 ' + okQ.reduce((a, [, v]) => a + v, 0) + ' 局：' + okQ.map(([k, v]) => `${k}=${v}`).join('  ') + '）');
console.log(line);
console.log('T8b 专精落支里「只靠正本条件」的，是引擎逐章累积的主修计数≥3，还是当章排班 mode 捷径（★=只靠捷径，主修计数<3）：');
for (const [k, v] of [...T8b.entries()].sort((a, b) => (/★/.test(a[0]) ? -1 : /★/.test(b[0]) ? 1 : b[1] - a[1]))) console.log(`     ${k} = ${v}`);
if (!T8b.size) console.log('     （无：本轮专精落支全部走旗标或双成立）');
console.log(line);
console.log('T9 链样本局手里实际存在的 Qualified_ 键（=1 的局数），与「逐键写入方对表」交叉：');
for (const [k, v] of top(T4.observedQual, 20)) console.log(`     Qualified_${k} = ${v} 局`);
if (!T4.observedQual.size) console.log('     （链样本里一个 Qualified_ 键都没有）');
console.log(line);
console.log('T8c ★只靠旗标落支时，正本行（trigger_condition）的 AND 条件还成立吗（成立=表内 OR 支路；★=旗标绕过正本门）：');
for (const [k, v] of [...T4.lexSplit.entries()].sort((a, b) => (/★/.test(a[0]) ? -1 : /★/.test(b[0]) ? 1 : b[1] - a[1]))) console.log(`     ${k} = ${v}`);
if (!T4.lexSplit.size) console.log('     （无 ★ 旗标落支）');
console.log(line);
console.log('T11 落支 vs 正本行可判子句（只判 endings 表里引擎有对应字段的部分；表内无对应字段的子句另计，见 T11c）：');
for (const [k, v] of [...T4.canon.entries()].sort((a, b) => (/★/.test(a[0]) ? -1 : /★/.test(b[0]) ? 1 : b[1] - a[1]))) console.log(`     ${k} = ${v}`);
console.log('T11c 正本行里引擎没有对应字段的子句（这些局即便判「成立」也少一道门，属阶段 4 待接）：');
for (const [k, v] of top(T4.canonNa, 12)) console.log(`     ${k} = ${v} 局`);
console.log('T11d ★可判子句不成立的局现场读数（前 40 组，逐组给主修/五维/旗标）：');
for (const [k, v] of [...T4.canonFailDetail.entries()].slice(0, 14)) console.log(`     ${k} ×${v}`);
console.log(line);
console.log('T11b 实落结局 ← 命中的代码分支（逐支归属，Orange 要的「谁把谁吃了」总表）：');
for (const [k, v] of top(T4.branch, 26)) console.log(`     ${k} = ${v}`);
console.log(line);
console.log('T10 专精落支局的逐局证据（真实牌序、零手置：主修计数由 stageSettlement:26-27 逐章累积，五维由卡与下播行动落入）每个结局留一条、右侧是该结局在链样本里的落支局数：');
for (const [k, v] of [...T4.evidence].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`     ${String(v.n).padStart(5)} 局 ${v.txt}`);
if (!T4.evidence.has('M09')) console.log('     ★链样本里没有 M09 落支局：M09 正本路径无真实牌序证据');
console.log(line);
console.log('T12 静态条款对账（代码支多出的门 / 少掉的正本门；逐条给 stageSettlement 行号，非读数，供裁定用）：');
console.log(`     多出门（表里没有、代码里当条件用）：
       :205 M07 「当章 mode===团播」捷径（正本只写 主修≥3 章）
       :208 M08 「当章 mode===游戏」捷径（同上）
       :210 M09 「当章 mode===户外」捷径（同上）
       :212 M02 代码用「口才≥8」，正本该行写的是「Total_Income ≥ ¥5,000,000」
       :214 M02 「Flag_选品减伤=1 且 当章带货」整条为表外支路
       :223 M01 「Tag_清白账本=1 且 口碑≥80」，正本 M01 行无此支
       :233 M01 「C6-M10 只要打过牌即默认终局」，正本 M01 行无此支
       :226 M05 分句②「Flag_榜一恋爱=1」代理正本的「恋爱对象好感满值」（字典无好感计数键）`);
console.log(`     少掉的门（正本想约束、代码没接）：
       :199 M06 正本无卡源，代码仍留着 Qualified_M06 的读（写入方 0 个 = 死读）
       :207 M08 正本「通过开挂质疑自证（C3-M03/X-ATTR-04）」未接
       :210 M09 正本「户外失控值未爆」未接（引擎无该字段）
       :212 M02 正本「Total_Income ≥ ¥5,000,000」「全程未触发带货死雷」未接
       :216 M10 正本「剪切片≥3 或 触发过 X-ATTR-10」未接（代码只看属性组）
       :231 M01 正本「顶流之夜全过且未踩红线」未接
       :237 M05 「末尾 else → M05」死尾（本轮读数：真实牌序里喂了 0 局，但注释仍写「常规兜底」，与裁定后的新位不符）
       :235 M04 正本「粉丝<1,000,000 + 口碑≥80 + 状态≥80」，代码只用 Tag_流派==='整活'`);
