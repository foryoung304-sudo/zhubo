/**
 * 阶段 3 · 修复轮四 Yellow 直构探针（逐项 A/B；ROOT 相对路径，可整包拷进 git archive 沙箱跑基线）
 *
 *   P1 M09 真实牌序（零手置状态）：排班→抽卡→打卡→下播行动→章结算全走引擎接口，
 *      选项策略 =「优先不声明结局、其次不写彩蛋计数、再次不扣状态」的纯读卡面排序，5 张全打（与在册扫表同口径，不跳牌）。
 *      对账在册断言 98.8b 的手置写法：这里要拿到 modeChapterCounts 由引擎逐章累积、stamina 由真实卡与真实行动落出的 M09。
 *   P2 M09 捷径支：户外只在终章排班，主修计数 = 1 < 3，看 `mode === '户外'` 这一支单独能不能落 M09。
 *      （正本 M09 行条件只有「主修[户外] ≥ 3 章」，没有「当章 mode」——这是表外第五输入。）
 *   P3 Qualified_ 写入方穷举（全池 6 章 × 卡 × 选项，走真实 selectOption）。
 *   P4 ★lex-specialis 外溢全池普查：凡是「同一选项既声明卡面 D 支、又把某条五维打到通用阈值」的 (卡:选项 × 维度) 全列出。
 *      这是 Gemini 在册「全池仅 X-EGG-03:B 与 C4-M05:A 两处竞争」那句话的对账表。
 *   P5 后手卡破阈值：结局已落之后再打一张把五维打穿的卡；HEAD（新增入口守卫）不置 isDead、基线置，
 *      并继续跑到第 6 章看带伤局能不能照样判通关。killer 由 P4 结果程序化选出，不手挑。
 *   P6 M05 死尾可达性：构造一个「链走到末尾 else」的状态（C6-M10 没打、专精全不够、非整活、清白账本不够）。
 *
 * 用法：node scripts/stage3_yellow_probe_fix4.mjs
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENG = f => pathToFileURL(path.join(ROOT, 'scripts/engine', f)).href;
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const { GameState } = await import(ENG('gameState.mjs'));
const { CardEngine } = await import(ENG('cardEngine.mjs'));
const { StageSettlement } = await import(ENG('stageSettlement.mjs'));
const { DrawEngine } = await import(ENG('drawEngine.mjs'));
const { OffStreamActions } = await import(ENG('offStreamActions.mjs'));

const configData = rd('config_and_screens.json'), stateDict = rd('state_dictionary.json');
const endingsData = rd('endings_and_talents.json'), cardsData = rd('cards.json');
const cards = cardsData.cards || cardsData;
const byId = id => cards.find(c => c.card_id === id);
const eng = new CardEngine(configData, cardsData, endingsData);
const settle = new StageSettlement(configData);
const draw = new DrawEngine(cardsData, configData);
const off = new OffStreamActions(configData);
const line = '─'.repeat(104);

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 与 gameState.checkFiveDimDeath 同判序的「阈值本应落谁」现算（只读，不改状态）
function wouldFireD(gs) {
  const fd = gs.fiveDim;
  if (fd.stamina <= 0) return 'D01';
  if (fd.wallet <= 0 && gs.currentChapter >= 2) return 'D02';
  if (fd.rep <= -20) return 'D03';
  if (fd.heat <= 0 && gs.currentChapter >= 2) return 'D04';
  if (gs.haterPct >= 100 && (gs.attributes['心态'] || 0) < 8) return 'D05';
  return null;
}
const DELTA_DIMS = ['stamina', 'wallet', 'rep', 'heat', 'fans'];

// 选项策略：纯读卡面排序（不注入状态），5 张全打
//   1) 不声明卡面结局（声明了就会抢在结算链之前落支）
//   2) 不写彩蛋/专精的计数与旗标键（否则被链上游支吃掉）
//   3) 不扣五维（保命）
//   4) 状态增益最大
const PREEMPT_WRITE_KEYS = new Set([
  'Count_猫上镜', 'Count_考编', 'Count_算法异常', 'Count_黑粉不对线',
  'Flag_老粉', 'Flag_零粉快乐', 'Flag_野生主播', 'Flag_公款雷', 'Tag_清白账本',
]);
function rankOption(o) {
  const trig = (o.effects?.ending_triggers || []).length ? 1 : 0;
  const writes = (o.effects?.state_writes || []).map(s => String(s).split(/[ =+]/)[0].trim());
  const egg = writes.some(w => PREEMPT_WRITE_KEYS.has(w)) ? 1 : 0;
  const d = o.effects?.delta_five_dim || {};
  const hurt = DELTA_DIMS.reduce((a, k) => a + Math.min(0, d[k] ?? 0), 0);
  const gain = (d.stamina ?? 0) * 3 + (d.wallet ?? 0) / 100000 + (d.rep ?? 0) * 0.5 + (d.heat ?? 0) * 0.2;
  return [trig, egg, hurt < 0 ? 1 : 0, -gain];
}
function cmpRank(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
function pickOption(card, gs, { maxPreempt = true } = {}) {
  let best = null, bestR = null;
  for (const o of card.options) {
    if (o.req_expr && !gs.evalCondition(o.req_expr)) continue;
    const r = rankOption(o);
    if (maxPreempt && (r[0] === 1 || r[1] === 1)) continue;
    if (!bestR || cmpRank(r, bestR) < 0) { bestR = r; best = o; }
  }
  return best ? best.opt_key : null;
}

// P1 / P2：真实牌序跑一整局（全打 5 张，不跳牌；不手置 modeChapterCounts / stamina）
function playThrough({ modeOf, seed, focus, lenient = false }) {
  const rng = mulberry32(seed);
  const gs = new GameState(configData, stateDict, endingsData);
  if (focus) { gs.allocateAttribute(focus.donor, -(focus.to - focus.attr)); gs.allocateAttribute(focus.attr, focus.to - focus.attr); }
  let died = false, skips = 0;
  for (let ch = 1; ch <= 6 && !died; ch++) {
    gs.currentChapter = ch;
    gs.selectedSchedule.mode = modeOf(ch);
    gs.selectedSchedule.timeSlot = 'slot_evening';
    gs.selectedSchedule.duration = 4;
    for (const card of draw.drawChapterCards(ch, gs, 5)) {
      const key = pickOption(card, gs, { maxPreempt: !lenient });
      if (!key) { skips++; continue; }                 // 全选项被 req 锁 / 全选项都会抢落支
      eng.selectOption(card, key, gs);
      if (gs.isDead) break;
    }
    if (gs.isDead) { died = true; break; }
    off.executeAction(gs.fiveDim.stamina < 50 ? 1 : 2, gs, focus ? focus.attr : null);
    settle.settleChapter(gs, false);
    if (gs.isDead || gs.triggeredEnding) break;
  }
  if (!died && !gs.isDead && !gs.triggeredEnding && gs.currentChapter === 6) {
    gs.selectedSchedule.mode = modeOf(6);
    settle.settleChapter(gs, false);
  }
  return {
    seed, ending: gs.triggeredEnding, isCleared: gs.isCleared, isDead: gs.isDead, skips,
    mc: { ...(gs.modeChapterCounts || {}) }, stamina: Math.round(gs.fiveDim.stamina),
    fans: Math.round(gs.fiveDim.fans), wallet: Math.round(gs.fiveDim.wallet), rep: gs.fiveDim.rep,
    qualM09: gs.variables['Qualified_M09'], hands: gs.cardHistory.length,
    eggCounts: ['Count_猫上镜', 'Count_考编', 'Count_算法异常', 'Count_黑粉不对线'].map(k => `${k.split('_')[1]}=${gs.variables[k] || 0}`).join(','),
    qualKeys: Object.keys(gs.variables).filter(k => /^Qualified_/.test(k)),
    gs,
  };
}

console.log(line);
console.log('P1a 参照组：只按「状态增益最大」选牌（上一版写法，会被彩蛋计数抢跑）');
for (const s of [7, 11, 13, 17, 19]) {
  const r = playThrough({ modeOf: () => '户外', seed: s, lenient: true });
  console.log(`   seed=${String(s).padEnd(3)} 落支=${String(r.ending).padEnd(5)} dead=${r.isDead} 主修=${JSON.stringify(r.mc)} 状态=${r.stamina} 彩蛋计数=${r.eggCounts}`);
}
console.log(line);
console.log('P1b M09 真实牌序（每章排「户外」，策略=不声明结局/不写彩蛋计数/不扣状态，5 张全打，零手置 modeChapterCounts 与 stamina）');
{
  const dist = new Map(); let hit = null; const rows = [];
  for (let s = 1; s <= 400; s++) {
    const r = playThrough({ modeOf: () => '户外', seed: s });
    dist.set(String(r.ending), (dist.get(String(r.ending)) || 0) + 1);
    if (r.ending === 'M09') { if (!hit) hit = r; if (rows.length < 5) rows.push(r); }
  }
  console.log('   400 局落支分布：' + [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  if (!hit) console.log('   ★本策略 400 局零命中 M09（按通则「判不可达前先复跑三策略」，这只算单一策略零命中，不可据此报不可达）');
  for (const r of rows) {
    console.log(`   ✓ seed=${String(r.seed).padEnd(3)} 落支=M09 cleared=${r.isCleared} 主修计数=${JSON.stringify(r.mc)}（引擎逐章累积）状态=${r.stamina} 手牌=${r.hands} 跳牌=${r.skips} 彩蛋计数=${r.eggCounts} Qualified_=${JSON.stringify(r.qualKeys)}`);
  }
  if (hit) {
    const gate = configData.chapters.find(c => c.chapter === 6).fans_gate_to;
    console.log(`   证据链回读：modeChapterCounts 由 stageSettlement:26-27 逐章累积=${JSON.stringify(hit.mc)}（无手置）；` +
      `结算入口 fans=${hit.fans} ≥ gate=${gate} → isPromoted=true，stamina=${hit.stamina} ≥ 75 → M09 支成立`);
  }
}
console.log(line);
console.log('P2 M09 捷径支（前 5 章排「电台」，只有第 6 章排「户外」→ 主修户外计数=1 < 3）');
for (const s of [7, 11, 13, 17, 19, 23, 29, 31]) {
  const r = playThrough({ modeOf: ch => (ch === 6 ? '户外' : '电台'), seed: s });
  console.log(`   seed=${String(s).padEnd(3)} 落支=${String(r.ending).padEnd(5)} cleared=${String(r.isCleared).padEnd(5)} 主修计数=${JSON.stringify(r.mc)} 状态=${r.stamina}` +
    (r.ending === 'M09' ? '   ★主修计数<3 仍落 M09 → 只靠 mode===户外 捷径支（表外第五输入）' : ''));
}
console.log(line);
console.log('P3 Qualified_ 写入方穷举（全池 6 章 × 卡 × 选项，走真实 selectOption）');
// 播种键：字典键 ∪ 卡面/配置里出现过的 Count_/Flag_/Param_ 键。
// 自我更正两处：
//   (1) 上一版「Qualified_M02 一次都没写出来」是探针的锅，不是引擎的锅——C5-M07:A 的 check 要 Count_验货命中>=1，没播种就进不了分支。
//   (2) 再上一版把原因写成「Count_验货命中 不在字典里」也是错的：state_dictionary.variables 是【数组】，
//       键名在 x.key 上，Object.keys() 只能拿到 0..37 的下标，所以字典数被误读成 0。字典实登记 38 键（21 Flag / 9 Count / 6 Tag / 1 Param / 1 Total）。
const DICT_KEYS = new Set((stateDict.variables || []).map(x => (x && x.key) || x));
const ALL_STATE_KEYS = new Set(DICT_KEYS);
{
  const re = /\b(Count_|Flag_|Param_)[\u4e00-\u9fa5A-Za-z0-9_]+/g;
  const blob = JSON.stringify(cardsData) + JSON.stringify(configData) + JSON.stringify(endingsData);
  for (const m of blob.match(re) || []) ALL_STATE_KEYS.add(m);
}
const SEED_KEYS = [...ALL_STATE_KEYS].filter(k => /^(Count_|Flag_|Param_)/.test(k));
const NOT_IN_DICT = SEED_KEYS.filter(k => !DICT_KEYS.has(k));
console.log(`   播种键 ${SEED_KEYS.length} 个（字典实登记 Count_/Flag_/Param_ ${[...DICT_KEYS].filter(k => /^(Count_|Flag_|Param_)/.test(k)).length} 个 + 数据文本用到但字典未登记 ${NOT_IN_DICT.length} 个：${NOT_IN_DICT.join(' ')}）`);
{
  const EIDS = ['M01', 'M02', 'M03', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'H01', 'H02', 'H04', 'H05', 'H07', 'H08', 'H10'];
  const writers = Object.fromEntries(EIDS.map(e => [e, []]));
  for (let ch = 1; ch <= 6; ch++) for (const c of cards) for (const o of (c.options || [])) {
    for (const seedVar of [0, 3]) {
      const gs = new GameState(configData, stateDict, endingsData);
      gs.currentChapter = ch;
      if (seedVar) for (const k of SEED_KEYS) gs.variables[k] = k.startsWith('Param_') ? 45 : seedVar;
      for (const a of ['才艺', '嗓音', '游戏技术', '口才', '情商', '心态']) gs.attributes[a] = 9;
      gs.attributes['颜值'] = 3; gs.attributes['运气'] = 10;
      try { eng.selectOption(c, o.opt_key, gs); } catch (e) { continue; }
      for (const eid of EIDS) {
        if (gs.variables[`Qualified_${eid}`] === 1 && !writers[eid].includes(`${c.card_id}:${o.opt_key}@ch${ch}`)) writers[eid].push(`${c.card_id}:${o.opt_key}@ch${ch}`);
      }
    }
  }
  for (const eid of EIDS) {
    const w = writers[eid];
    console.log(`   Qualified_${eid.padEnd(3)} 实际写入方 ${w.length ? w.slice(0, 4).join('  ') + (w.length > 4 ? ` …(${w.length})` : '') : '★一次都没写出来'}`);
  }
}
console.log(line);
console.log('P4 ★lex-specialis 外溢全池普查：同一选项既声明卡面 D 支、又把某条五维打到通用阈值');
const P4 = [];
{
  // 每一维单独卡「阈值上方一格」，其余四维给安全值：只有这一个选项能把这一维打穿
  // 卡面有两种写法：增量（delta < 0）和清零（delta `${dim}_target`）——X-EGG-03:B 就是 heat_target:0，上一版只看增量把它漏了
  const DEATH_DIMS = [['stamina', 'D01', 3, 0], ['wallet', 'D02', 3, 0], ['rep', 'D03', -19, -20], ['heat', 'D04', 3, 0]];
  for (const c of cards) for (const o of (c.options || [])) {
    const trig = (o.effects?.ending_triggers || []).filter(e => /^D/.test(e));
    const d = o.effects?.delta_five_dim || {};
    for (const [dim, expectD, startVal, limit] of DEATH_DIMS) {
      const isTarget = `${dim}_target` in d;
      if (!isTarget && !(dim in d)) continue;
      if (!isTarget && d[dim] >= 0) continue;                       // 该维只涨不跌 → 破不了阈值
      if (isTarget && d[`${dim}_target`] > limit) continue;          // 清零支没把这一维压到阈值以下
      const gs = new GameState(configData, stateDict, endingsData);
      gs.currentChapter = 3;                            // D02/D04 需要 ch≥2
      gs.fiveDim.stamina = 60; gs.fiveDim.wallet = 100000; gs.fiveDim.rep = 50; gs.fiveDim.heat = 60; gs.fiveDim.fans = 100000;
      gs.fiveDim[dim] = startVal;
      for (const k of SEED_KEYS) gs.variables[k] = k.startsWith('Param_') ? 45 : 3;
      for (const a of ['才艺', '嗓音', '游戏技术', '口才', '情商', '心态']) gs.attributes[a] = 9;
      gs.attributes['颜值'] = 3;
      try { eng.selectOption(c, o.opt_key, gs); } catch (e) { continue; }
      const wf = wouldFireD(gs);
      if (!wf) continue;                                 // 没真把阈值打穿，不算竞争
      P4.push({
        key: `${c.card_id}:${o.opt_key}`, label: `${c.card_id}:${o.opt_key} ×${dim}${isTarget ? '(清零支)' : ''}`,
        declared: trig.join('/'), hasTrig: trig.length > 0, dim, expectD, after: gs.fiveDim[dim], breachD: wf,
        landed: gs.triggeredEnding, isDead: gs.isDead, conflict: trig.length > 0 && wf !== trig[0],
      });
    }
  }
}
const byKey = new Map();
for (const x of P4) byKey.set(x.label, x);
const withTrig = [...byKey.values()].filter(x => x.hasTrig);
const noTrig = [...byKey.values()].filter(x => !x.hasTrig);
const conflicts = withTrig.filter(x => x.conflict);
console.log(`   能把阈值打穿的 (卡:选项 × 维度) 共 ${byKey.size} 组：其中「同选项还声明了卡面 D 支」= ${withTrig.length} 组（特别法与一般法正面相遇），「只打穿阈值、不声明结局」= ${noTrig.length} 组（入口守卫压住的就是这一类）`);
console.log(`   P4-a 声明支 ≠ 阈值支（卡面特别法抢一般法）= ${conflicts.length} 组；Gemini 在册只报了 2 组（X-EGG-03:B、C4-M05:A）`);
for (const v of withTrig.sort((a, b) => (b.conflict - a.conflict) || a.label.localeCompare(b.label))) {
  console.log(`   ${v.label.padEnd(30)} 声明 ${v.declared.padEnd(4)} | ${v.dim}→${String(Math.round(v.after)).padStart(8)} 阈值本应 ${v.breachD} | HEAD 实落 ${String(v.landed).padEnd(4)} isDead=${v.isDead} ${v.conflict ? '★卡面特别法抢一般法' : '（同一条，无冲突）'}`);
}
console.log(`   P4-b 只打穿阈值不声明结局的组（列前 12，这些是「后手卡」候选）：` + noTrig.slice(0, 12).map(v => `${v.label}→${v.breachD}`).join('  '));
console.log(line);
console.log('P5 后手卡破阈值：结局已落 → 再打一张「只把五维打穿、不声明结局」的卡（killer 取自 P4-b，不手挑）');
{
  const killer = noTrig.find(x => x.dim === 'wallet') || noTrig[0];
  if (!killer) console.log('   （P4 无「不声明只打穿阈值」的组，构不出后手卡）');
  else {
    const [kid, kopt] = killer.key.split(':');
    const kc = byId(kid), ko = kc.options.find(x => x.opt_key === kopt);
    const landers = cards.filter(c => (c.options || []).some(o => (o.effects?.ending_triggers || []).some(e => !/^D/.test(e))));
    let done = false;
    for (const lc of landers) {
      for (const lo of lc.options) {
        const declared = (lo.effects?.ending_triggers || []).find(e => !/^D/.test(e));
        if (!declared) continue;
        const gs = new GameState(configData, stateDict, endingsData);
        gs.currentChapter = 2;
        for (const k of SEED_KEYS) gs.variables[k] = k.startsWith('Param_') ? 45 : 3;
        for (const a of ['才艺', '嗓音', '游戏技术', '口才', '情商', '心态']) gs.attributes[a] = 9;
        gs.fiveDim.stamina = 60; gs.fiveDim.wallet = 100000; gs.fiveDim.rep = 50; gs.fiveDim.heat = 60;
        try { eng.selectOption(lc, lo.opt_key, gs); } catch (e) { continue; }
        if (gs.triggeredEnding !== declared) continue;
        const first = `${gs.triggeredEnding}/dead=${gs.isDead}`;
        gs.currentChapter = 5;
        gs.fiveDim[killer.dim] = killer.dim === 'rep' ? -19 : 3;
        try { eng.selectOption(kc, ko.opt_key, gs); } catch (e) { continue; }
        console.log(`   先打 ${lc.card_id}:${lo.opt_key}（卡面声明 ${declared}）→ ${first}`);
        console.log(`   再打 ${killer.key}（声明 ${killer.declared}，把 ${killer.dim}→${Math.round(gs.fiveDim[killer.dim])}，阈值本应 ${killer.expectD}）→ 落支 ${gs.triggeredEnding} / isDead=${gs.isDead}`);
        console.log('   HEAD 口径：gameState.checkFiveDimDeath 入口新增 `if (this.isDead || this.triggeredEnding) return;` → 阈值已破也不置 isDead（基线同构造会置）；这就是「带伤通关」的机制源头，A/B 见沙箱 stdout');
        for (let ch = 5; ch <= 6; ch++) {
          gs.currentChapter = ch;
          gs.selectedSchedule.mode = '全模式'; gs.selectedSchedule.timeSlot = 'slot_evening'; gs.selectedSchedule.duration = 4;
          for (const card of draw.drawChapterCards(ch, gs, 5)) { const key = pickOption(card, gs); if (key) { try { eng.selectOption(card, key, gs); } catch (e) { } } }
          off.executeAction(1, gs, null);
          settle.settleChapter(gs, false);
        }
        console.log(`   带伤跑到第 6 章结算后：isDead=${gs.isDead} isCleared=${gs.isCleared} 落支=${gs.triggeredEnding} ${killer.dim}=${Math.round(gs.fiveDim[killer.dim])} fans=${Math.round(gs.fiveDim.fans)}（基线在这里应是 dead=true 不入结算链）`);
        done = true; break;
      }
      if (done) break;
    }
    if (!done) console.log('   （未构成：需要一个「先落支、后把五维打穿」且 req 放行的组合）');
  }
}
console.log(line);
console.log('P6 M05 死尾（末尾 else → M05）可达性：不满足任何前支、且 C6-M10 没打');
{
  const gs = new GameState(configData, stateDict, endingsData);
  gs.currentChapter = 6;
  gs.fiveDim.fans = configData.chapters.find(c => c.chapter === 6).fans_gate_to;   // 刚够达标线，避开 fans≥1e7 的 M01
  gs.fiveDim.rep = 50;                                                            // 避开 清白账本/加冕 M01、避开 rep≥85
  gs.fiveDim.stamina = 20;                                                        // 避开 M09
  gs.attributes['嗓音'] = 1; gs.attributes['才艺'] = 1; gs.attributes['游戏技术'] = 1; gs.attributes['口才'] = 1;
  gs.attributes['情商'] = 1; gs.attributes['颜值'] = 9; gs.attributes['运气'] = 1;
  settle.settleChapter(gs, false);
  console.log(`   纯空局（没打 C6-M10、没任何 Qualified_、非整活）→ 落支 ${gs.triggeredEnding}  ← 若为 M05 即末尾 else 喂的`);
  console.log(`   该局手里 Qualified_/Tag_ 键：${JSON.stringify(Object.keys(gs.variables).filter(k => /^(Qualified_|Tag_)/.test(k)))}`);
}
console.log(line);
