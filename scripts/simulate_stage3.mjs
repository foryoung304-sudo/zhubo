/**
 * 阶段 3 · 无头扫表（三策略 × ≥10,000 局）
 *
 * 规格出处：maker-zhubo-build-order-20261104.md · Orange 九轮裁定「阶段 3 闸门（最终）」
 *   无头模拟 ≥10,000 局，三种策略：随机、贪心、定向收集
 *   验：六章闸门可达率、50 结局各自命中率、四类数值暴毙可达性、整活流派收益是否穿 Cap
 *   复核修正裁定 7：单局时长实测（含加时完整局，报中位与 P90，对照单局 5–10 分钟）
 *   判「不可达」前必须先按定向收集策略复跑；三种策略全 0 命中才可报不可达
 *   出现不可达结局或闸门死锁，停手回报并附分布数据，不许自行调数值
 *
 * 读数说明（Orange 九轮预写三条，先于任何结论列出）：
 *   ① 钱包默认线 +9%（Z4）：默认排班的钱包线在漂移补全后天然偏高约 9%，属既有口径，非本次扫表引入。
 *   ② 构成副作用未建模：粉丝构成对流量池的一阶反馈正本未给公式，扫表按现行「只读构成、结算后重漂」处理。
 *   ③ Runtime 字体项与扫表无关：MiSans 缺失属阶段 4 字体包，本扫表全程 Node 逻辑核，不经 UrhoX 运行时。
 *
 * 保真红线（本脚本自缚）：
 *   - 不手置 five_dim / variables / Tag：状态一律经 cardEngine.selectOption 真实卡路径与真实下播行动落入。
 *   - 不强推闸门：章节不达标只走引擎自带的加时与体面结算，绝不用 fans = gate 兜底。
 *   - 不调数值：只读 data/*.json，不写文件，不改引擎常数。
 *   - 策略不自造死亡判据：贪心/定向的「这一步会不会死」一律用引擎自身的快照—回滚通道试算（probe），
 *     不复制 checkFiveDimDeath 的阈值；试算后把 rollback 自带 +1 的 adUsage.reviveOrRepick 复位，
 *     保证探针零留痕。随机策略不试算，照单全收，用于观测真实暴毙面。
 *   - 可复现：引擎内有四处裸 Math.random（抽卡权重 drawEngine:136、整活 35% cardEngine:141、
 *     翻样 sampleInspect:10、时机条 center timingBar:19）。本脚本在入口处把全局 Math.random 换成
 *     带种子 PRNG（仅测试夹具，不改引擎源码、不落盘），使同一命令逐字节可复现。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = name => path.join(ROOT, 'data', name);
const ENG = name => pathToFileURL(path.join(ROOT, 'scripts', 'engine', name)).href;

const BASE_SEED = 20261106;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 测试夹具：引擎裸随机统一走种子流（详见文件头「可复现」条）
const engineRng = mulberry32(BASE_SEED);
Math.random = () => engineRng();

const { GameState } = await import(ENG('gameState.mjs'));
const { DrawEngine } = await import(ENG('drawEngine.mjs'));
const { CardEngine } = await import(ENG('cardEngine.mjs'));
const { TimingBar } = await import(ENG('timingBar.mjs'));
const { SampleInspect } = await import(ENG('sampleInspect.mjs'));
const { OffStreamActions } = await import(ENG('offStreamActions.mjs'));
const { StageSettlement } = await import(ENG('stageSettlement.mjs'));

const cardsData = JSON.parse(fs.readFileSync(DATA('cards.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(DATA('config_and_screens.json'), 'utf8'));
const stateDict = JSON.parse(fs.readFileSync(DATA('state_dictionary.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(DATA('endings_and_talents.json'), 'utf8'));

const timingBar = new TimingBar(configData);
const cardEngine = new CardEngine(configData, timingBar, new SampleInspect());
const drawEngine = new DrawEngine(cardsData, configData);
const offStreamActions = new OffStreamActions(configData);
const stageSettlement = new StageSettlement(configData);

const ALL_ENDINGS = endingsData.endings.map(e => e.ending_id);
const CHAPTERS = [1, 2, 3, 4, 5, 6];
const chCfg = ch => configData.chapters.find(c => c.chapter === ch);
const MODES = configData.mode_vocabulary.schedule_modes;
const SLOTS = configData.schedules.time_slots.map(s => s.id);
const DURATIONS = (configData.schedules.durations || []).map(d => d.hours || d);

// 策略侧常量（策略定义，非引擎口径）：§2.6B 属性→模式常识映射，仅用于排班
const MODE_CORE_ATTR = { 游戏: '游戏技术', 才艺: '才艺', 电台: '嗓音', 团播: '颜值', PK: '口才', 带货: '口才', 户外: '体力' };

// 结局直接触发索引（含 check_fail 支）
const triggerCards = new Map();
for (const card of cardsData) {
  for (const opt of card.options) {
    for (const list of [(opt.effects && opt.effects.ending_triggers) || [],
                       (opt.check_fail && opt.check_fail.ending_triggers) || []]) {
      for (const eid of list) {
        if (!triggerCards.has(eid)) triggerCards.set(eid, new Set());
        triggerCards.get(eid).add(card.card_id);
      }
    }
  }
}
const CHANNEL_DEATH = { D01: 'stamina', D02: 'wallet', D03: 'rep', D04: 'heat' };

/**
 * 定向前置追索表（策略侧，逐条注明出处 = endings_and_talents.json 的 trigger_condition 原文）。
 * 目的：让「定向收集」对这五个结局做**真实尝试**，而不是撞不到就当不可达。
 *   D05 「任意阶段 黑粉浓度 ≥ 100% 且心态检定失败」             → 猛堆 hater_pct
 *   D08 「Count_违规警告 ≥ 2（C2-M09 选 A、C2-S06、C4-S11 等）」 → 专挑写入 Count_违规警告 的选项
 *   D18 「Param_观众当真度 ≥ 40 +（C4-M06 或 C5-M10 且 情商<7）」 → 专挑写入 Param_观众当真度 的选项
 *   H06 「全程 6 章全部排 6 小时超长档 + 0 次下播补觉 + 打通六章」  → 时长锁 6h、禁补觉
 *   M06 「打通第六章 + 主修[电台] ≥ 3 章 + 嗓音 ≥ 8」            → 前段锁电台 + 零和加点顶嗓音
 */
const PURSUIT = {
  D05: { delta: 'hater_pct' },
  D08: { stateKey: 'Count_违规警告' },
  D18: { stateKey: 'Param_观众当真度' },
  D09: { stateKey: 'Flag_数字人线开放' },
  H03: { stateKey: 'Flag_数字人线开放' },
  H06: { duration: 6, avoidAction: 1 },
  H08: { stateKey: 'Flag_老粉' },
  H04: { stateKey: 'Count_猫上镜' },
  H10: { stateKey: 'Count_考编' },
  H05: { stateKey: 'Count_算法异常', focus: { attr: '运气', to: 10, donor: '体力' } },
  M02: { mode: '带货', focus: { attr: '口才', to: 8, donor: '体力' } },
  M06: { mode: '电台', focus: { attr: '嗓音', to: 8, donor: '体力' } },
  M07: { mode: '团播', focus: { attr: '才艺', to: 8, donor: '体力' } },
  M08: { mode: '游戏', focus: { attr: '游戏技术', to: 8, donor: '体力' } },
  M09: { mode: '户外' },
};
const CIRCUS_TARGETS = new Set(['M04']); // stageSettlement:165 Tag_流派==='整活' → M04（§2.3 整活流分支）

const writesKey = (o, key) => ((o.effects && o.effects.state_writes) || []).some(w => w.includes(key));

// 发牌预算取证：里程碑卡在卡池数组里的 deck 序（第几号），以及本局实际进手的最大号位。
// drawEngine 只把里程碑卡补进「保证位」，正档 minMilestone=2、加时=1，随机池明确排除 milestone，
// 所以理论上每章里程碑进手 = deck 序前几张；这里用实测把「没抽到」和「没接线」分开。
const milestoneDeckIdx = new Map();
const cardChapter = new Map();
for (const c of cardsData) cardChapter.set(c.card_id, c.chapter);
for (const ch of CHAPTERS) {
  cardsData.filter(c => c.chapter === ch && c.pool_type === 'milestone')
    .forEach((c, i) => milestoneDeckIdx.set(c.card_id, i + 1));
}

// ---------------------------------------------------------------- 探针：引擎快照—回滚试算
// Yellow 复验自纠（2026-11-07）：rollbackCardSnapshot 把 triggeredEnding 无条件置 null，且
// Snapshot_BeforeCard 不含 isCleared；试算一次就把上一张卡已落的结局抹掉、把 isCleared 留在 true。
// 修复轮后 H04/H10/C6-M10 等即时落支变多，该留痕污染了结局分布与「打通」计数，故在此显式复位。
function probe(card, opt, st, timing) {
  const adUsage = { ...st.adUsage };
  const prevEnding = st.triggeredEnding;
  const prevCleared = st.isCleared;
  st.triggeredEnding = null;   // 让 out.ending 只反映本选项自身的落支，不混入已落结局
  const b = { ...st.fiveDim, hater: st.haterPct };
  const res = cardEngine.selectOption(card, opt.opt_key, st, timing);
  const out = {
    opt, res,
    gain: st.fiveDim.fans - b.fans,
    dWallet: st.fiveDim.wallet - b.wallet,
    dHater: st.haterPct - b.hater,
    dies: st.isDead,
    ending: st.triggeredEnding,
  };
  st.rollbackCardSnapshot();
  st.triggeredEnding = prevEnding;
  st.isCleared = prevCleared;
  st.adUsage = adUsage; // 复位回滚自带 +1 的 reviveOrRepick，保证探针零留痕
  return out;
}

function rollTiming(strategy, card, rng) {
  const inst = timingBar.createInstance(card);
  const p = timingBar.params;
  inst.center = 0.2 + rng() * 0.6;
  inst.sweetStart = inst.center - (p.sweet_width || 0.15) / 2;
  inst.sweetEnd = inst.center + (p.sweet_width || 0.15) / 2;
  inst.goodStart = inst.center - (p.good_width || 0.40) / 2;
  inst.goodEnd = inst.center + (p.good_width || 0.40) / 2;
  const skilled = strategy !== 'random' && rng() < 0.6;
  const res = timingBar.evaluateTap(inst, skilled ? inst.center : rng(), 'A');
  return { multiplier: res.multiplier, circusRoll: rng() };
}

function chooseOption(strategy, target, card, st, rng, m) {
  const selectable = card.options.filter(o => cardEngine.isOptionSelectable(o, st));
  const locked = selectable.length === 0;
  const pool = selectable.length ? selectable : card.options;
  if (strategy === 'random') {
    const opt = pool[Math.floor(rng() * pool.length)];
    return { opt, locked, probeUsed: false };
  }
  const timing = rollTiming(strategy, card, rng);
  const probes = pool.map(o => probe(card, o, st, timing));

  // ① 定向命中：试算直接落到目标结局的那一步
  if (strategy === 'targeted' && target) {
    const hit = probes.find(p => p.ending === target);
    if (hit) return { opt: hit.opt, locked, probeUsed: true, timing };
  }
  // ② 自保：优先不死的选项（阈值判定完全交给引擎，不在此复制）
  let live = probes.filter(p => !p.dies);
  if (!live.length) { m.doomedCards++; m.doomedIds.push(card.card_id); live = probes; }
  // ③ 定向前置追索 / 贪心涨粉
  const pur = strategy === 'targeted' ? PURSUIT[target] : null;
  if (pur && pur.stateKey) {
    const w = live.find(p => writesKey(p.opt, pur.stateKey));
    if (w) return { opt: w.opt, locked, probeUsed: true, timing };
  }
  if (pur && pur.delta) {
    const best = [...live].sort((a, b) => b.dHater - a.dHater)[0];
    if (best.dHater > 0) return { opt: best.opt, locked, probeUsed: true, timing };
  }
  if (CIRCUS_TARGETS.has(target) && strategy === 'targeted') {
    const tagIt = live.find(p => writesKey(p.opt, 'Tag_流派'));
    if (tagIt) return { opt: tagIt.opt, locked, probeUsed: true, timing };
  }
  if (CHANNEL_DEATH[target] && strategy === 'targeted') {
    const ch = CHANNEL_DEATH[target];
    const key = ch === 'wallet' ? 'dWallet' : null;
    if (key) {
      const worst = [...probes].sort((a, b) => a[key] - b[key])[0];
      if (worst.dWallet < 0) return { opt: worst.opt, locked, probeUsed: true, timing };
    }
  }
  const best = [...live].sort((a, b) => b.gain - a.gain)[0];
  return { opt: best.opt, locked, probeUsed: true, timing };
}

function chooseSchedule(strategy, target, st, rng) {
  if (strategy === 'random') {
    return {
      mode: MODES[Math.floor(rng() * MODES.length)],
      timeSlot: SLOTS[Math.floor(rng() * SLOTS.length)],
      duration: DURATIONS[Math.floor(rng() * DURATIONS.length)],
    };
  }
  const pur = strategy === 'targeted' ? PURSUIT[target] : null;
  let mode = pur && pur.mode ? pur.mode : null;
  let duration = pur && pur.duration ? pur.duration : 4;
  if (!mode && strategy === 'targeted' && triggerCards.has(target)) {
    const tally = new Map();
    for (const cid of triggerCards.get(target)) {
      const c = cardsData.find(x => x.card_id === cid);
      for (const t of (c && c.mode_tags) || []) tally.set(t, (tally.get(t) || 0) + 1);
    }
    let best = 0;
    for (const [mm, n] of tally) if (MODES.includes(mm) && n > best) { best = n; mode = mm; }
  }
  if (!mode) {
    mode = [...MODES].sort((a, b) =>
      (st.attributes[MODE_CORE_ATTR[b]] || 5) - (st.attributes[MODE_CORE_ATTR[a]] || 5))[0];
  }
  const slot = [...SLOTS].sort((a, b) => {
    const fa = configData.schedules.time_slots.find(s => s.id === a).fans_mult || 0;
    const fb = configData.schedules.time_slots.find(s => s.id === b).fans_mult || 0;
    return fb - fa;
  })[0];
  return { mode, timeSlot: slot, duration };
}

function playCard(card, strategy, target, st, rng, m) {
  const pick = chooseOption(strategy, target, card, st, rng, m);
  if (pick.locked) m.lockedCards++;
  const timing = pick.timing || rollTiming(strategy, card, rng);
  const fansBefore = st.fiveDim.fans;
  const res = cardEngine.selectOption(card, pick.opt.opt_key, st, timing);
  m.cardsPlayed++; m.decisions++;
  const gain = st.fiveDim.fans - fansBefore;
  const cap = chCfg(st.currentChapter).Cap_Fans;
  const d = (pick.opt.effects && pick.opt.effects.delta_five_dim) || {};
  if (st.variables['Tag_流派'] === '整活' && ((d.fans_pct || 0) > 0 || (d.fans || 0) > 0)) {
    m.circusCards++;
    if (gain === 0 && res.appliedDeltas && res.appliedDeltas.fans_pct === undefined && res.appliedDeltas.fans === undefined) m.zeroRevenueHits++;
  }
  if (cap && gain > cap) { m.capExceed++; m.maxGainOverCapRatio = Math.max(m.maxGainOverCapRatio, gain / cap); }
}

function playOneRun(strategy, target, seed) {
  const rng = mulberry32(seed);
  const st = new GameState(configData, stateDict, endingsData);
  const m = {
    strategy, target: target || null, cardsPlayed: 0, decisions: 0, lockedCards: 0, doomedCards: 0, doomedIds: [],
    chapterReached: 0, gatePass: {}, overtimeChapters: 0, cleared: false,
    died: false, deathEnding: null, deathChapter: null, ending: null,
    circusCards: 0, zeroRevenueHits: 0, capExceed: 0, maxGainOverCapRatio: 0,
    hands: [], // 本局实际进过手的卡（含加时），用来把「概率不足」和「接线不足」分开取证
    landingSrc: null, // 最后写入者：engine:<卡> / settle:ch<章> / settle:ch<章>_fail
    settleWrites: [], // 章结算真的改写落支的章号（F = 该章未达标）
    dimMin: { ...st.fiveDim }, // 本局内四维实测谷底；只观察、不判定
  };
  const observe = () => {
    for (const k of Object.keys(m.dimMin)) if (st.fiveDim[k] < m.dimMin[k]) m.dimMin[k] = st.fiveDim[k];
  };
  // 落支来源取证：按「最后一个写入者」归属（卡面即时分支可被后续卡的暴毙支覆写，章结算支只在
  // triggeredEnding 为空时才写），并单独记录章结算是否真的动过落支——用来直接量第 6 章优先链的可达性。
  let landingSrc = null;
  const settleWrites = [];
  const tagLanding = (src, before) => { if (st.triggeredEnding !== before) landingSrc = src; };

  // 开局加点（仅定向收集）：走引擎 allocateAttribute 真实接口，并做零和守恒（+3 主项 / −3 让点项），
  // 保证 base_points_total 45 不变——引擎本身不扣池，这里由策略侧自己守住，不给扫表开后门。
  const pur0 = strategy === 'targeted' ? PURSUIT[target] : null;
  if (pur0 && pur0.focus) {
    const { attr, to, donor } = pur0.focus;
    const step = to - st.attributes[attr];
    if (step > 0 && st.attributes[donor] - step >= 1) {
      st.allocateAttribute(donor, -step);
      st.allocateAttribute(attr, step);
    }
  }

  for (const ch of CHAPTERS) {
    if (st.isDead) break;
    st.currentChapter = ch;
    m.chapterReached = ch;
    const sched = chooseSchedule(strategy, target, st, rng);
    st.selectedSchedule.mode = sched.mode;
    st.selectedSchedule.timeSlot = sched.timeSlot;
    st.selectedSchedule.duration = sched.duration;

    for (const card of drawEngine.drawChapterCards(ch, st, 5)) {
      m.hands.push(card.card_id);
      const e0 = st.triggeredEnding;
      playCard(card, strategy, target, st, rng, m);
      observe();
      tagLanding('engine:' + card.card_id, e0);
      if (st.isDead) break;
    }
    if (st.isDead) { m.died = true; m.deathEnding = st.triggeredEnding; m.deathChapter = ch; break; }

    // 下播行动：每章 1 点（正本 §2.8C 每章 1–2 点，扫表取保守 1 点）
    let actionId = strategy === 'random' ? 1 + Math.floor(rng() * 8) : (st.fiveDim.stamina < 50 ? 1 : 2);
    const pur = strategy === 'targeted' ? PURSUIT[target] : null;
    if (pur && pur.avoidAction && actionId === pur.avoidAction) actionId = 2;
    offStreamActions.executeAction(actionId, st, pur && pur.attr ? pur.attr : null);
    m.decisions++;

    const e1 = st.triggeredEnding;
    let res = stageSettlement.settleChapter(st, false);
    observe();
    tagLanding('settle:ch' + ch + (res.isPromoted ? '' : '_fail'), e1);
    if (st.triggeredEnding !== e1) settleWrites.push(ch + (res.isPromoted ? '' : 'F'));
    if (!res.isPromoted && res.canOvertime) {
      m.overtimeChapters++;
      for (const card of drawEngine.drawChapterCards(ch, st, 3)) {
        m.hands.push(card.card_id);
        const e0 = st.triggeredEnding;
        playCard(card, strategy, target, st, rng, m);
        observe();
        tagLanding('engine:' + card.card_id, e0);
        if (st.isDead) break;
      }
      if (st.isDead) { m.died = true; m.deathEnding = st.triggeredEnding; m.deathChapter = ch; break; }
      const e2 = st.triggeredEnding;
      res = stageSettlement.settleChapter(st, false);
      observe();
      tagLanding('settle:ch' + ch + (res.isPromoted ? '' : '_fail'), e2);
      if (st.triggeredEnding !== e2) settleWrites.push(ch + (res.isPromoted ? '' : 'F'));
    }
    m.gatePass[ch] = Boolean(res.isPromoted);
    const cap = chCfg(ch).Cap_Fans;
    if (cap && res.netFansGain > cap) { m.capExceed++; m.maxGainOverCapRatio = Math.max(m.maxGainOverCapRatio, res.netFansGain / cap); }
    if (st.isCleared) { m.cleared = true; break; }
    if (!res.isPromoted) break;                    // 加时后仍未达标 → 引擎已判体面收场（M04/M12），本局终止
    if (ch < 6) stageSettlement.advanceChapter(st);
  }

  if (st.isDead) { m.died = true; m.deathEnding = m.deathEnding || st.triggeredEnding; }
  m.landingSrc = landingSrc;
  m.settleWrites = settleWrites;
  m.ending = st.triggeredEnding || (st.isCleared ? 'CLEARED_NO_ENDING' : 'NO_ENDING');
  m.cleared = Boolean(st.isCleared);
  m.outcomeClass = m.cleared ? 'cleared'
    : (m.died ? 'death' : (['M04', 'M12'].includes(m.ending) ? 'graceful' : 'halted'));
  return m;
}

function runStrategy(strategy, count, perTarget) {
  const runs = [];
  let s = 1;
  if (strategy !== 'targeted') {
    for (let i = 0; i < count; i++) runs.push(playOneRun(strategy, null, BASE_SEED * 100003 + s++));
  } else {
    for (const eid of ALL_ENDINGS) {
      for (let i = 0; i < perTarget; i++) runs.push(playOneRun('targeted', eid, BASE_SEED * 100003 + s++));
    }
  }
  return runs;
}

const pct = (n, d) => (d ? (100 * n / d).toFixed(2) + '%' : 'n/a');
function quantile(arr, q) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))];
}

function summarize(runs) {
  const gate = {};
  for (const ch of CHAPTERS) {
    gate[ch] = {
      reached: runs.filter(r => r.chapterReached >= ch).length,
      passed: runs.filter(r => r.gatePass[ch]).length,
    };
    gate[ch].rate = pct(gate[ch].passed, gate[ch].reached);
  }
  const endings = new Map(ALL_ENDINGS.map(e => [e, 0]));
  let noEnding = 0, clearedNoEnding = 0;
  const other = {};
  for (const r of runs) {
    if (endings.has(r.ending)) endings.set(r.ending, endings.get(r.ending) + 1);
    else if (r.ending === 'CLEARED_NO_ENDING') clearedNoEnding++;
    else { noEnding++; other[r.ending] = (other[r.ending] || 0) + 1; }
  }
  const deaths = {};
  for (const r of runs) if (r.died && r.deathEnding) deaths[r.deathEnding] = (deaths[r.deathEnding] || 0) + 1;
  // 落支来源汇总：最后一个写入者归属；settleWrites 单独统计「章结算真的改写过落支」的局与章号。
  const landSrc = {};
  for (const r of runs) { const k = r.landingSrc || 'none'; landSrc[k] = (landSrc[k] || 0) + 1; }
  const rollup = pred => Object.entries(landSrc).filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0);
  const settleWrites = {};
  for (const r of runs) for (const w of r.settleWrites) settleWrites[w] = (settleWrites[w] || 0) + 1;
  const chain6Endings = {};
  for (const r of runs) if (r.landingSrc === 'settle:ch6') chain6Endings[r.ending] = (chain6Endings[r.ending] || 0) + 1;
  const landing = {
    engine: rollup(k => k.startsWith('engine:')),
    settleChain6: landSrc['settle:ch6'] || 0,
    settleFail: rollup(k => k.startsWith('settle:') && k.endsWith('_fail')),
    settleOther: rollup(k => k.startsWith('settle:') && k !== 'settle:ch6' && !k.endsWith('_fail')),
    none: landSrc['none'] || 0,
    settleWriteRuns: runs.filter(r => r.settleWrites.length > 0).length,
    settleWrites,
    topEngine: Object.entries(landSrc).filter(([k]) => k.startsWith('engine:')).sort((a, b) => b[1] - a[1]).slice(0, 8),
    chain6Endings,
  };
  const bucket = cls => {
    const a = runs.filter(r => r.outcomeClass === cls).map(r => r.cardsPlayed);
    return { n: a.length, median: quantile(a, 0.5), p90: quantile(a, 0.9), max: a.length ? Math.max(...a) : 0 };
  };
  const complete = runs.filter(r => r.outcomeClass === 'cleared' || r.outcomeClass === 'graceful').map(r => r.cardsPlayed);
  const all = runs.map(r => r.cardsPlayed);
  return {
    n: runs.length,
    cleared: runs.filter(r => r.cleared).length,
    clearedEarly: runs.filter(r => r.cleared && r.chapterReached < 6).length,
    died: runs.filter(r => r.died).length,
    gate, deaths, noEnding, clearedNoEnding, other, landing,
    durAll: { n: all.length, median: quantile(all, 0.5), p90: quantile(all, 0.9), max: all.length ? Math.max(...all) : 0 },
    durComplete: { n: complete.length, median: quantile(complete, 0.5), p90: quantile(complete, 0.9), max: complete.length ? Math.max(...complete) : 0 },
    durCleared: bucket('cleared'), durGraceful: bucket('graceful'), durDeath: bucket('death'),
    zeroHitEndings: [...endings].filter(([, v]) => v === 0).map(([k]) => k),
    hitEndings: [...endings].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    lockedCards: runs.reduce((a, r) => a + r.lockedCards, 0),
    doomedCards: runs.reduce((a, r) => a + r.doomedCards, 0),
    doomedIdTally: (() => {
      const t = {};
      for (const r of runs) for (const id of r.doomedIds) t[id] = (t[id] || 0) + 1;
      return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + '=' + v).join('  ');
    })(),
    overtimeRuns: runs.filter(r => r.overtimeChapters > 0).length,
    dimFloor: (() => {
      const o = {};
      for (const k of ['stamina', 'wallet', 'rep', 'heat']) {
        const a = runs.map(r => r.dimMin[k]);
        o[k] = { min: Math.min(...a), p5: quantile(a, 0.05), median: quantile(a, 0.5),
          le0: a.filter(v => v <= 0).length, leNeg20: a.filter(v => v <= -20).length };
      }
      return o;
    })(),
    handTally: (() => {
      // 只统计「带结局触发位的卡」进手率——把「这局没抽到」和「引擎没接线」两件事分开取证
      const ids = new Set();
      for (const s of triggerCards.values()) for (const id of s) ids.add(id);
      const rows = [...ids].map(id => {
        const n = runs.reduce((a, r) => a + (r.hands.includes(id) ? 1 : 0), 0);
        return [id, n];
      }).sort((a, b) => a[1] - b[1]);
      return rows.map(([id, n]) => `${id}=${(100 * n / runs.length).toFixed(1)}%`).join('  ');
    })(),
    milestoneReach: (() => {
      // 每章里程碑卡按 deck 号位（卡池数组序）的进手率；分母 = 进入该章的局数。
      // drawEngine 的随机池明确排除 pool_type==='milestone'，里程碑只能占「保证位」，故号位越深越进不来。
      const out = [];
      for (const ch of CHAPTERS) {
        const ids = [...milestoneDeckIdx.keys()].filter(id => cardChapter.get(id) === ch);
        const denom = runs.filter(r => r.chapterReached >= ch).length;
        const cells = ids.map(id => {
          const n = runs.filter(r => r.chapterReached >= ch && r.hands.includes(id)).length;
          return `#${milestoneDeckIdx.get(id)}=${denom ? (100 * n / denom).toFixed(1) + '%' : '—'}`;
        });
        const deepest = Math.max(0, ...runs.flatMap(r => r.hands
          .filter(id => cardChapter.get(id) === ch)
          .map(id => milestoneDeckIdx.get(id)).filter(Boolean)));
        out.push({ ch, total: ids.length, denom, cells: cells.join(' '), deepest });
      }
      return out;
    })(),
    circusCards: runs.reduce((a, r) => a + r.circusCards, 0),
    zeroRevenueHits: runs.reduce((a, r) => a + r.zeroRevenueHits, 0),
    capExceed: runs.reduce((a, r) => a + r.capExceed, 0),
    maxGainOverCapRatio: runs.reduce((a, r) => Math.max(a, r.maxGainOverCapRatio), 0),
  };
}

const N = Number(process.env.SCAN_RUNS || 10000);
const PER_TARGET = Math.max(1, Math.ceil(N / ALL_ENDINGS.length));

console.log('#'.repeat(104));
console.log('《从小主播到顶流》阶段 3 · 无头扫表 (scripts/simulate_stage3.mjs)');
console.log(`种子基值=${BASE_SEED}   随机/贪心各 ${N} 局   定向收集 ${PER_TARGET} 局/结局 × ${ALL_ENDINGS.length} 结局 = ${PER_TARGET * ALL_ENDINGS.length} 局`);
console.log('读数说明（预写三条，先于任何结论）：');
console.log('  ① 钱包默认线 +9%（Z4 漂移补全后的既有口径，非本次扫表引入）');
console.log('  ② 构成副作用未建模（正本未给「构成→流量池再分配」公式，扫表按现行只读构成）');
console.log('  ③ Runtime 字体项与扫表无关（MiSans 属阶段 4 字体包，本扫表全程 Node 逻辑核）');
console.log('  ④ Yellow 自纠（11-07）：探针 probe() 原会抹掉本局已落结局、并漏还原 isCleared（引擎 rollback 无条件置 null，Snapshot_BeforeCard 不含该字段），');
console.log('     已改为存档/还原二者；本 stdout 为修正后重扫，贪心/定向两列不可与 20261106 版直接对照，随机列不含探针、可逐字节对照（已验证一致）。');
console.log('#'.repeat(104));

const t0 = Date.now();
const out = {
  random: summarize(runStrategy('random', N)),
  greedy: summarize(runStrategy('greedy', N)),
  targeted: summarize(runStrategy('targeted', N, PER_TARGET)),
};

for (const [name, s] of Object.entries(out)) {
  console.log('\n' + '='.repeat(104));
  console.log(`策略【${name}】 局数=${s.n}  通关（引擎 isCleared）=${s.cleared} (${pct(s.cleared, s.n)})  中途暴毙=${s.died} (${pct(s.died, s.n)})`);
  console.log(`  ├ 其中止步于第 1–5 章的即时彩蛋通关（非六章打通）= ${s.clearedEarly} (${pct(s.clearedEarly, s.n)})   六章内通关 = ${s.cleared - s.clearedEarly} (${pct(s.cleared - s.clearedEarly, s.n)})`);
  console.log('-'.repeat(104));
  console.log('六章闸门可达率（达标 = 引擎 isPromoted，全程无强推）：');
  for (const ch of CHAPTERS) {
    console.log(`  第${ch}章  进入 ${String(s.gate[ch].reached).padStart(6)}  达标 ${String(s.gate[ch].passed).padStart(6)}  达标率 ${s.gate[ch].rate}`);
  }
  console.log('-'.repeat(104));
  console.log(`加时局数=${s.overtimeRuns}   全卡不可选（潜在死锁）次数=${s.lockedCards}   全选项皆死（必死卡）次数=${s.doomedCards}${s.doomedIdTally ? '\n  必死卡 Top：' + s.doomedIdTally : ''}`);
  console.log(`整活流派涨粉卡次=${s.circusCards}   其中 Δfans 归零（35% 清零的可观测代理）=${s.zeroRevenueHits}`);
  console.log(`涨粉穿 Cap 次数=${s.capExceed}   最大 增益/Cap=${s.maxGainOverCapRatio.toFixed(4)}${s.capExceed === 0 ? '   → 未见穿 Cap' : '   → 出现穿 Cap，停手回报'}`);
  const mins = c => `${(c * 10 / 60).toFixed(1)}–${(c * 20 / 60).toFixed(1)} 分`;
  console.log('单局时长实测（口径 = 本局实际抽到的卡数，含加时；正本 §1.7：30 卡/局 ↔ 5–10 分钟 ⇒ 10–20 秒/卡）：');
  for (const [label, b] of [['全部局', s.durAll], ['完整局（打通+体面收场）', s.durComplete],
    ['  · 通关（六章打通 + 即时彩蛋）', s.durCleared], ['  · 加时未达标体面收场', s.durGraceful], ['  · 中途暴毙截断', s.durDeath]]) {
    console.log(`  ${label.padEnd(26)} n=${String(b.n).padStart(6)}  卡数 中位=${String(b.median).padStart(3)} P90=${String(b.p90).padStart(3)} max=${String(b.max).padStart(3)}` +
      `  → 中位≈${mins(b.median)}  P90≈${mins(b.p90)}`);
  }
  console.log(`未落任何结局的局数=${s.noEnding}   通关但无结局=${s.clearedNoEnding}` +
    (Object.keys(s.other).length ? '   非 50 表内标签=' + JSON.stringify(s.other) : ''));
  console.log('落支来源（最后一个写入者归属；探针零留痕修正后才有此块，旧 stdout 无）：');
  console.log(`  卡面即时分支(cardEngine) = ${String(s.landing.engine).padStart(5)}   第6章结算优先链(stageSettlement) = ${String(s.landing.settleChain6).padStart(5)}   结算未达标体面收场 = ${String(s.landing.settleFail).padStart(5)}   其他章结算 = ${String(s.landing.settleOther).padStart(5)}   全程未落支 = ${String(s.landing.none).padStart(5)}`);
  console.log(`  章结算实际改写落支的局数 = ${s.landing.settleWriteRuns}   分布(章号, F=该章未达标)：` +
    (Object.keys(s.landing.settleWrites).length ? Object.entries(s.landing.settleWrites).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ') : '(零)'));
  console.log('  卡面即时落支 Top：' + s.landing.topEngine.map(([k, v]) => `${k.replace('engine:', '')}=${v}`).join('  '));
  console.log('  结算优先链（第6章）命中结局：' + (Object.keys(s.landing.chain6Endings).length
    ? Object.entries(s.landing.chain6Endings).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ') : '(零——链从未成为任何一局的最终落支点)'));
  console.log('-'.repeat(104));
  console.log('四类数值暴毙通道（引擎 checkFiveDimDeath 四支；正本 §2.2 的「黑粉」通道在引擎内无死亡分支，见文末附注）：');
  for (const [eid, chName] of Object.entries(CHANNEL_DEATH)) {
    console.log(`  ${eid} ← ${chName} 触底 = ${String(s.deaths[eid] || 0).padStart(6)}  (${pct(s.deaths[eid] || 0, s.n)})`);
  }
  const cardD = Object.entries(s.deaths).filter(([k]) => k.startsWith('D') && !CHANNEL_DEATH[k]).sort((a, b) => b[1] - a[1]);
  console.log(`  卡面直触的其他 D 结局（${cardD.length} 种）：` + (cardD.map(([k, v]) => k + '=' + v).join('  ') || '(无)'));
  console.log('  四维谷底实测（本局内实测最小值，只观察不参与判定）：');
  for (const [k, label] of [['stamina', 'D01 ≤0'], ['wallet', 'D02 ≤0 且 ch≥2'], ['rep', 'D03 ≤−20'], ['heat', 'D04 ≤0 且 ch≥2']]) {
    const f = s.dimFloor[k];
    console.log(`    ${k.padEnd(8)} ${label.padEnd(18)} 全局最低=${String(f.min).padStart(8)}  P5=${String(f.p5).padStart(8)}  局内最低中位=${String(f.median).padStart(8)}  触阈值局数=${String(k === 'rep' ? f.leNeg20 : f.le0).padStart(6)}`);
  }
  console.log('-'.repeat(104));
  console.log('带结局触发位的卡进手率（% = 该卡至少进手一次的局数占比，升序；用来把「没抽到」和「没接线」分开）：');
  console.log('  ' + s.handTally);
  console.log('里程碑卡 deck 号位进手率（分母 = 进入该章的局数；#k = 该章卡池数组里的第 k 张里程碑）：');
  for (const mr of s.milestoneReach) {
    console.log(`  第${mr.ch}章 共${String(mr.total).padStart(2)}张  进章局数=${String(mr.denom).padStart(6)}  实测最深号位=#${mr.deepest}  ${mr.cells}`);
  }
  console.log('-'.repeat(104));
  console.log(`命中结局种数 = ${s.hitEndings.length}/${ALL_ENDINGS.length}`);
  const hits = s.hitEndings.map(([k, v]) => `${k}:${v}`);
  for (let i = 0; i < hits.length; i += 10) console.log('  ' + hits.slice(i, i + 10).join('  '));
  console.log(`  0 命中 ${s.zeroHitEndings.length} 个：${s.zeroHitEndings.join(' ') || '(无)'}`);
}

const allZero = ALL_ENDINGS.filter(e =>
  out.random.zeroHitEndings.includes(e) && out.greedy.zeroHitEndings.includes(e) && out.targeted.zeroHitEndings.includes(e));
console.log('\n' + '#'.repeat(104));
console.log(`三策略交叉后仍 0 命中的结局 = ${allZero.length}：${allZero.join(' ') || '(无)'}`);
console.log(`合计局数 = ${out.random.n + out.greedy.n + out.targeted.n}   耗时 = ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
console.log('附注：未启用存档天赋继承（carry_rules），每局自 §2.9 初始状态起，状态变更全部走真实卡路径。');
console.log('      Math.random 仅在扫表进程内被替换为种子流，引擎源码与 data 未改动。');
console.log('#'.repeat(104));
