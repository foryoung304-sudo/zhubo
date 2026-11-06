/**
 * 阶段 3 · 结局接线审计（配合 simulate_stage3.mjs 的「三策略交叉后仍 0 命中」清单）
 *
 * 为什么要它：0 命中不止一种成因，混在一起报就等于把扫表器的能力边界当成游戏的能力边界。
 *   E 无接线        —— 引擎里没有这条结局的任何判定分支，卡面也没有任何选项写它。
 *   D 结构封死      —— 卡面写了它，但 cardEngine.mjs:304–318 规定「第 1–5 章的 M/H 触发只写
 *                      Qualified_${id}，唯有 currentChapter===6 才落成结局」；而 Qualified_* 在引擎里
 *                      零读取（本脚本当场取证），触发卡按 drawEngine 的入池规则又进不了第六章池。
 *   F 同选项互遮蔽  —— 触发位能进第六章，但同一个选项的 ending_triggers 里写了多个 id，
 *                      cardEngine.mjs:296–318 是「逐条覆盖 triggeredEnding + 遇 D 立即 break」，
 *                      于是只有数组里最后/最靠 D 的那支生效，前面的 id 永远落不下来。
 *   G req_expr 锁   —— 触发位本身没问题，但选项 req_expr 是隐藏成就式条件，扫表三策略都握不到。
 *   C 概率不足      —— 能进池、无遮蔽、无锁，只是本轮没抽到/没走到。
 *
 * 三路证据，全部只读，不改任何数值：
 *   ① 静态接线：data/cards.json 的 ending_triggers（含 check_fail 支）+ 引擎内建分支清单。
 *   ② 入池判定：逐字复刻 drawEngine.mjs:90–92 三条过滤（chapter / pool_type / entry_chapter_min·max），
 *               只判定「按卡面声明能否进第 6 章卡池」——不重新发明门槛。
 *   ③ 引擎原生落子实验：把触发卡交给 currentChapter=6 的真实 GameState，走 cardEngine.selectOption
 *               真实路径，读 triggeredEnding 到底落成了谁；req_expr 锁住的原话一并打出。
 *   另：三份扫表 stdout 的命中数按结局 join，「接线在」与「实测到」分列。
 *
 * 前一版曾用一个「中性通关态」真实抽样第六章卡池；那状态不是任何真到过第六章的局的状态，
 * 抽出来的池子既非真实分布也不能当卡池上界，已废弃。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = name => path.join(ROOT, 'data', name);
const ENG = name => pathToFileURL(path.join(ROOT, 'scripts', 'engine', name)).href;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const engineRng = mulberry32(20261106);
Math.random = () => engineRng();

const { GameState } = await import(ENG('gameState.mjs'));
const { CardEngine } = await import(ENG('cardEngine.mjs'));
const { TimingBar } = await import(ENG('timingBar.mjs'));
const { SampleInspect } = await import(ENG('sampleInspect.mjs'));

const cardsData = JSON.parse(fs.readFileSync(DATA('cards.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(DATA('config_and_screens.json'), 'utf8'));
const stateDict = JSON.parse(fs.readFileSync(DATA('state_dictionary.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(DATA('endings_and_talents.json'), 'utf8'));
const cardById = new Map(cardsData.map(c => [c.card_id, c]));

const cardEngine = new CardEngine(configData, new TimingBar(configData), new SampleInspect());

// ---------------------------------------------------------------- ① 引擎内建分支清单（逐行对照）
const SETTLEMENT_ENDINGS = {
  M01: 'ch6 达标 + Tag_清白账本=1 + 口碑≥80 (stageSettlement.mjs:162)',
  M02: 'ch6 达标 + Flag_选品减伤=1 + 本场模式=带货 (stageSettlement.mjs:164)',
  M04: 'ch6 达标 + Tag_流派=整活 (stageSettlement.mjs:165)；或加时未达标且口碑≥50 (:146)',
  M05: 'ch6 达标兜底 (stageSettlement.mjs:170)',
  M12: '加时未达标且口碑<50 (stageSettlement.mjs:148)',
  H05: 'ch6 达标 + Count_算法异常≥3 + 运气=10 (stageSettlement.mjs:168)',
};
const CHANNEL_DEATH = {
  D01: 'stamina≤0 (gameState.mjs:290 checkFiveDimDeath)',
  D02: 'wallet≤0 且 ch≥2 (gameState.mjs:290)',
  D03: 'rep≤−20 (gameState.mjs:290)',
  D04: 'heat≤0 且 ch≥2 (gameState.mjs:290)',
};
const IMMEDIATE_EXCEPTION_CARD = { H12: 'X-EGG-09', H05: 'C6-S19' }; // cardEngine.mjs:304 / :307

// Qualified_${id} 有没有人读：当场扫全引擎源码取证，不凭记忆
const engineDir = path.join(ROOT, 'scripts', 'engine');
const qualifiedHits = [];
for (const f of fs.readdirSync(engineDir)) {
  fs.readFileSync(path.join(engineDir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.includes('Qualified_')) qualifiedHits.push(`${f}:${i + 1}: ${line.trim()}`);
  });
}
const qualifiedInDict = JSON.stringify(stateDict).includes('Qualified_');

// ---------------------------------------------------------------- 触发索引（含 check_fail 支）
function triggersOf(eid) {
  const list = [];
  for (const card of cardsData) {
    for (const opt of card.options) {
      const eff = (opt.effects && opt.effects.ending_triggers) || [];
      const fail = (opt.check_fail && opt.check_fail.ending_triggers) || [];
      for (const [branch, arr] of [['effects', eff], ['check_fail', fail]]) {
        if (!arr.includes(eid)) continue;
        list.push({ card_id: card.card_id, opt_key: opt.opt_key, branch, arr,
          chapter: card.chapter, entry_min: card.entry_chapter_min, entry_max: card.entry_chapter_max,
          pool_type: card.pool_type, req_expr: opt.req_expr || null, prereq: card.prereq_expr || null });
      }
    }
  }
  return list;
}

// 逐字复刻 drawEngine.mjs:90–92：按卡面声明能否进第 6 章卡池
function canEnterSix(card) {
  if (card.chapter && card.chapter !== 6 && !(card.pool_type || '').startsWith('cross_')) return false;
  if (card.entry_chapter_min && card.entry_chapter_min > 6) return false;
  if (card.entry_chapter_max && card.entry_chapter_max < 6) return false;
  return true;
}
// cardEngine.mjs:296–318 的确定性语义：遇 D 立即 break，非 D 逐条覆盖 → 一支选项只落一个 id。
// 用它做判因（不依赖随机分支）；下面的引擎实验再逐条印证。
const effectiveLanding = arr => arr.find(x => x.startsWith('D')) ?? arr[arr.length - 1] ?? null;
const where = t => `${t.card_id}/${t.opt_key}(${t.branch})@${t.chapter ?? `跨章${t.entry_min}–${t.entry_max}/${t.pool_type}`}`;

// ---------------------------------------------------------------- ② 扫表命中数 join
const SCAN_TXT = path.join(ROOT, 'stage3', 'stage3_scan_20261106.txt');
const scanHits = {};
if (fs.existsSync(SCAN_TXT)) {
  const lines = fs.readFileSync(SCAN_TXT, 'utf8').split(/\r?\n/);
  let strat = null;
  for (let i = 0; i < lines.length; i++) {
    const mStrategy = lines[i].match(/策略【(\w+)】/);
    if (mStrategy) strat = mStrategy[1];
    if (/命中结局种数/.test(lines[i]) && strat) {
      const map = {};
      for (const tok of (lines[i + 1] || '').trim().split(/\s+/)) {
        const m = tok.match(/^([MDH]\d+):(\d+)$/);
        if (m) map[m[1]] = Number(m[2]);
      }
      scanHits[strat] = map;
    }
  }
}
const STRATS = Object.keys(scanHits);
const hitOf = eid => STRATS.map(s => (scanHits[s] || {})[eid] || 0);
const anyHit = eid => hitOf(eid).some(v => v > 0);

// 同一份 stdout 里还有「带结局触发位的卡进手率」一行，join 进来：
// 0 命中到底是「没抽到」还是「没接线」，要看这两个数，不是看结局数。
const scanHand = {};
if (fs.existsSync(SCAN_TXT)) {
  const lines = fs.readFileSync(SCAN_TXT, 'utf8').split(/\r?\n/);
  let strat = null;
  for (let i = 0; i < lines.length; i++) {
    const mStrategy = lines[i].match(/策略【(\w+)】/);
    if (mStrategy) strat = mStrategy[1];
    if (/^带结局触发位的卡进手率/.test(lines[i]) && strat) {
      const map = {};
      for (const tok of (lines[i + 1] || '').trim().split(/\s+/)) {
        const m = tok.match(/^(\S+?)=([\d.]+)%$/);
        if (m) map[m[1]] = Number(m[2]);
      }
      scanHand[strat] = map;
    }
  }
}
const handOf = id => STRATS.map(s => (scanHand[s] || {})[id] ?? 0);
const handText = id => `进手率 ${STRATS.map((s, i) => `${s}=${handOf(id)[i].toFixed(1)}%`).join('/')}`;

// ---------------------------------------------------------------- ③ 引擎原生落子实验
function landingProbe(t, eid) {
  const card = cardById.get(t.card_id);
  const opt = card.options.find(o => o.opt_key === t.opt_key);
  const st = new GameState(configData, stateDict, endingsData);
  st.currentChapter = 6; // 只把站姿放到 cardEngine:304–318 的落成侧，不参与任何数值结论
  if (!cardEngine.isOptionSelectable(opt, st)) return { locked: t.req_expr, landed: null };
  try {
    cardEngine.selectOption(card, t.opt_key, st, { circusRoll: 0.9 });
    return { locked: null, landed: st.triggeredEnding, cleared: st.isCleared, dead: st.isDead };
  } catch (err) {
    return { locked: null, error: String(err.message).slice(0, 90), landed: null };
  }
}

// ---------------------------------------------------------------- 逐条分类
const isPositionImmediate = (t, eid) => eid.startsWith('D') || IMMEDIATE_EXCEPTION_CARD[eid] === t.card_id;
const rows = [];
for (const e of endingsData.endings) {
  const eid = e.ending_id;
  const tg = triggersOf(eid);
  for (const t of tg) {
    t.probe = landingProbe(t, eid);
    t.entersSix = canEnterSix(cardById.get(t.card_id));
    t.immediate = isPositionImmediate(t, eid);
    t.staticLands = effectiveLanding(t.arr) === eid; // 卡面数组层面「这支选项最终落的是不是本结局」
  }
  const reachablePos = tg.filter(t => t.entersSix || t.immediate);
  const unlockedPos = reachablePos.filter(t => !t.probe.locked);
  const livePos = unlockedPos.filter(t => t.staticLands);

  let cls;
  if (SETTLEMENT_ENDINGS[eid]) cls = 'A 结算分支';
  else if (CHANNEL_DEATH[eid]) cls = 'A 四维死亡通道';
  else if (!tg.length) cls = 'E 无任何接线';
  else if (!reachablePos.length) cls = 'D 结构封死（触发卡进不了第六章池）';
  else if (!livePos.length && unlockedPos.length === 0) cls = 'G 触发位被 req_expr 锁死';
  else if (!livePos.length) cls = 'F 同选项互遮蔽（被别的 id 抢先落成）';
  else cls = 'C 可落成（本轮概率不足）';

  let why;
  if (SETTLEMENT_ENDINGS[eid]) why = SETTLEMENT_ENDINGS[eid];
  else if (CHANNEL_DEATH[eid]) why = CHANNEL_DEATH[eid];
  else if (!tg.length) why = '卡面无 ending_triggers，结算/死亡分支亦无此 id；trigger_condition 原文：' + (e.trigger_condition || '（空）');
  else why = tg.map(t => `${where(t)} 数组=[${t.arr.join(',')}]→实落 ${effectiveLanding(t.arr)}` +
    (t.probe.locked ? `｜req_expr 锁：${t.probe.locked}`
      : t.probe.error ? `｜实验抛错：${t.probe.error}`
        : `｜引擎实验=${t.probe.landed}`) +
    `｜${handText(t.card_id)}` +
    (t.prereq ? `｜进手前置：${t.prereq}` : '') +
    (t.entersSix || t.immediate ? '' : '｜进不了第六章池')).join('  ||  ');

  rows.push({ eid, tier: e.tier, cls, n: tg.length, why, hits: hitOf(eid),
    note: (livePos.length === 0 && unlockedPos.length ? `遮蔽者 = ${[...new Set(unlockedPos.map(t => effectiveLanding(t.arr)))].join('/')}` : '') +
      (reachablePos.length && unlockedPos.length === 0 ? ` 锁 = ${[...new Set(reachablePos.map(t => t.probe.locked))].join(' / ')}` : '') });
}

// ---------------------------------------------------------------- 输出
const LINE = '='.repeat(118);
const order = ['A 结算分支', 'A 四维死亡通道', 'C 可落成（本轮概率不足）',
  'F 同选项互遮蔽（被别的 id 抢先落成）', 'G 触发位被 req_expr 锁死',
  'D 结构封死（触发卡进不了第六章池）', 'E 无任何接线'];

console.log(LINE);
console.log('阶段 3 · 结局接线审计 (scripts/stage3_reachability_audit.mjs)');
console.log(`种子=20261106   50 结局逐条分类   扫表命中数来源 = ${path.relative(ROOT, SCAN_TXT)}`);
console.log('口径：A=引擎自有分支 / C=接线通且卡面数组层面确实落到本结局，仅本轮概率不足 / F=同选项多 id 互相抢先');
console.log('      G=触发位被 req_expr 锁住 / D=触发卡进不了第六章池 / E=引擎与卡面都不产这个 id');
console.log('      「接线可达」≠「本轮实测命中」：两者分列，不用接线结论顶替概率结论，也不用 0 命中顶替接线结论。');
console.log(LINE);

console.log(`\n【取证 · Qualified_ 机制】引擎源码命中 ${qualifiedHits.length} 处，state_dictionary 收录 = ${qualifiedInDict}`);
for (const h of qualifiedHits) console.log('      ' + h);
console.log('      → 只有写、没有读：第 1–5 章的 M/H 触发在 cardEngine.mjs:317 降级成 Qualified_{id} 之后无人认领，');
console.log('        既不参与第六章结算，也不是任何结局的落子条件——这是 D 类「结构封死」的机制根因。');
console.log('【取证 · 同选项多 id】cardEngine.mjs:296–318 逐条覆盖 triggeredEnding、遇 D 立即 break，');
console.log('        故一个选项的 ending_triggers 写了多个 id 时只有最后一支（或最先遇到的 D）真能落成。');

for (const cls of order) {
  const g = rows.filter(r => r.cls === cls);
  if (!g.length) continue;
  const zero = g.filter(r => !anyHit(r.eid)).map(r => r.eid);
  console.log(`\n【${cls}】 ${g.length} 个：${g.map(r => r.eid).join(' ')}`);
  console.log(`   三策略交叉后 0 命中：${zero.length} 个${zero.length ? ' → ' + zero.join(' ') : ''}`);
  for (const r of g) {
    console.log(`   ${r.eid} (${r.tier}) 触发位 ${r.n} 个 — ${STRATS.map((s, i) => `${s}=${r.hits[i]}`).join('  ')}`);
    console.log(`        接线：${r.why}`);
    if (r.note) console.log(`        判因：${r.note}`);
  }
}

const groups = cls => rows.filter(r => r.cls.startsWith(cls));
const zeroAll = rows.filter(r => !anyHit(r.eid));

// 「触发卡三策略都没进过一次手」单独成列：这类 0 命中的直接原因是发牌预算 / 进手前置，
// 不是结局接线，也不是运气——读表时必须和「概率不足」分开说。
const carryKeys = ['equipped_talents_count', 'total_endings_unlocked', 'cleared_main_endings_count'];
const neverDrawn = Object.keys(scanHand).length === STRATS.length
  ? zeroAll.filter(r => r.n > 0 && triggersOf(r.eid).every(t => handOf(t.card_id).every(v => v === 0)))
  : [];
console.log('\n' + LINE);
console.log(`【触发卡三策略 0 进手】的 0 命中结局 = ${neverDrawn.length} 个：${neverDrawn.map(r => r.eid).join(' ') || '(无)'}`);
for (const r of neverDrawn) {
  const cs = [...new Set(triggersOf(r.eid).map(t => t.card_id))];
  const carry = cs.some(id => carryKeys.some(k => (cardById.get(id).prereq_expr || '').includes(k)));
  console.log(`   ${r.eid} ← ${cs.join(', ')}${carry
    ? '   ※ 前置含跨局存档量（equipped_talents_count / total_endings_unlocked / cleared_main_endings_count）；'
      + '本轮按裁定「未启用存档天赋继承 carry_rules」，每局自 §2.9 初始态起 → 本扫表口径下结构性不可进手，不能据此判不可达' : ''}`);
}
console.log(LINE);
const bucket = c => zeroAll.filter(r => r.cls.startsWith(c)).map(r => r.eid).join(' ');
console.log('\n' + LINE);
console.log(`对账：三策略交叉 0 命中 = ${zeroAll.length} 个，逐桶归因（每桶互斥）：`);
for (const c of ['E', 'D', 'F', 'G', 'C', 'A']) {
  const g = zeroAll.filter(r => r.cls.startsWith(c));
  if (g.length) console.log(`   ${c} 类 ${g.length} 个：${g.map(r => r.eid).join(' ')}`);
}
console.log(`   分桶合计 ${['E', 'D', 'F', 'G', 'C', 'A'].reduce((a, c) => a + zeroAll.filter(r => r.cls.startsWith(c)).length, 0)} / ${zeroAll.length}`);
console.log(`   三策略有实测命中的结局 = ${rows.filter(r => anyHit(r.eid)).length} 个：${rows.filter(r => anyHit(r.eid)).map(r => r.eid).join(' ')}`);
console.log('\n结论口径（供回报用；判定权不在本脚本）：');
console.log(`   ⓪ 本轮三策略实测到的结局 = ${rows.filter(r => anyHit(r.eid)).length} 个；0 命中 = ${zeroAll.length} 个。`);
console.log(`   ① 扫表根本看不见这批（触发卡在 30,000 局里 0 次进手）= ${neverDrawn.length} 个：${neverDrawn.map(r => r.eid).join(' ')}`);
console.log(`      → 对这 ${neverDrawn.length} 个，任何「可达/不可达」的结论都不能由本轮扫表得出；约束在发牌预算与进手前置，不在结局接线。`);
console.log(`   · 可报「现行代码下不存在落成路径」= E(${groups('E').length}) + D(${groups('D').length}) = ${groups('E').length + groups('D').length} 个：`);
console.log(`     ${[...groups('E'), ...groups('D')].map(r => r.eid).join(' ')}`);
console.log(`     依据是接线声明与入池声明（drawEngine:90–92 + Qualified_* 零读取），不是「扫了没扫到」。`);
console.log(`   · 不许报「不可达」、只能报「本轮没撞出来」= C 且 0 命中(${zeroAll.filter(r => r.cls.startsWith('C')).length}) + A 类未达标(${zeroAll.filter(r => r.cls.startsWith('A')).length}) 个：`);
console.log(`     ${[...zeroAll.filter(r => r.cls.startsWith('C')), ...zeroAll.filter(r => r.cls.startsWith('A'))].map(r => r.eid).join(' ')}`);
console.log(`   · 待裁定（卡面写了，但被引擎语义吃掉或被 req_expr 锁住）= F(${groups('F').length}) + G(${groups('G').length}) = ${groups('F').length + groups('G').length} 个：`);
console.log(`     ${[...groups('F'), ...groups('G')].map(r => r.eid).join(' ')}`);
console.log('     这类属「接线写了 + 引擎落不下来」，按冻结正文只读口径一律只回报、不自改。');
console.log('   注：①与 ·/·/· 是按不同问题切的两个视图，允许重叠——前者答「扫表有没有能力看见」，后者答「代码有没有路径」。');
console.log(LINE);
