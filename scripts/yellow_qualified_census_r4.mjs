/**
 * 阶段 3 · 修复轮四 Yellow 逐键 Qualified_ 写入方对表核（Orange 9d068ca 指派的关闭条件之一）
 *
 * 口径：
 *   W  = 真实引擎写入方。逐 (章 × 卡 × 选项) 全池穷举：干净档 selectOption 一次，记下本次新写入的 Qualified_ 键。
 *        另跑「条件放大档」（把卡面判据会读到的 Count_/Flag_ 预置到能进分支的值）补枚举那些需要前置状态才写的键，
 *        放大档只是「枚举可达写入方」的辅助，不作验收断言（通则 收尾1 管的是断言，不管普查）。
 *   C  = 结算消费方。直接从 stageSettlement.mjs 源码正则抓 Qualified_<eid>。
 *   T  = 正本名录。data/endings_and_talents.json 每行的 trigger_sources + trigger_condition 里点名的卡源。
 *
 * 判定：
 *   死条件   = 有消费方、写入方为零（读了没人写的键）
 *   表外写入 = 有写入方、但正本该行没点名该卡源（前向引用/编号撞车误读的残留）
 *   零消费   = 有写入方、结算根本不读（写了没人用；无害但要登记，因为它会污染「Qualified 泄漏」类统计）
 *
 * 用法：node scripts/yellow_qualified_census_r4.mjs
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = f => pathToFileURL(path.join(ROOT, 'scripts/engine', f)).href;
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const cardsData = read('cards.json');
const stateDict = read('state_dictionary.json');
const endingsData = read('endings_and_talents.json');
const configData = read('config_and_screens.json');

const { GameState } = await import(url('gameState.mjs'));
const { CardEngine } = await import(url('cardEngine.mjs'));
const { StageSettlement } = await import(url('stageSettlement.mjs'));
const settlementSrc = fs.readFileSync(path.join(ROOT, 'scripts/engine/stageSettlement.mjs'), 'utf8');
const engineSrc = fs.readFileSync(path.join(ROOT, 'scripts/engine/cardEngine.mjs'), 'utf8');

const cards = Array.isArray(cardsData) ? cardsData : cardsData.cards;
const endings = endingsData.endings;
const dictVars = stateDict.variables || {};
// 自我更正：variables 是【数组】，键名在 x.key；上一版用 Object.keys() 取到的是 0..37 下标，
// 于是「字典里有几个 Count_/Flag_ 键」被误读成 0，放大档一个键都没播，「动态可达」列随之假报 0。
const DICT_KEYS = new Set(Array.isArray(dictVars) ? dictVars.map(x => (x && x.key) || x) : Object.keys(dictVars));
const dictKeys = [...DICT_KEYS];
// 放大档播种键：字典实登记 38 键，但卡面/配置还写着几个字典外的键（如 Count_剪切片运营），
// 所以再按文本收割一遍取并集，否则「动态可达」列会漏掉需要前置状态才写得出的键。
const SEED_KEYS = new Set();
for (const f of ['cards.json', 'config_and_screens.json', 'endings_and_talents.json', 'state_dictionary.json']) {
  const txt = fs.readFileSync(path.join(ROOT, 'data', f), 'utf8');
  for (const mm of txt.matchAll(/\b(Count_|Flag_|Param_)[\u4e00-\u9fa5A-Za-z0-9_]+/g)) SEED_KEYS.add(mm[0]);
}
for (const k of dictKeys) if (/^(Count_|Flag_|Param_)/.test(k)) SEED_KEYS.add(k);

// ---------- C：结算消费方
const consumers = new Map();
for (const m of settlementSrc.matchAll(/Qualified_([A-Z]\d{2})/g)) {
  const eid = m[1];
  const ln = settlementSrc.slice(0, m.index).split('\n').length;
  if (!consumers.has(eid)) consumers.set(eid, []);
  consumers.get(eid).push(ln);
}

// ---------- T：正本名录（trigger_sources + 触发条件文本里点名的卡号）
const CARDID_RE = /\b(?:C[1-6]-(?:M|S)\d{2}|X-[A-Z]+-\d{2})\b/g;
const table = new Map();
for (const e of endings) {
  const named = new Set();
  const src = e.trigger_sources;
  const srcText = src == null ? '' : (typeof src === 'string' ? src : JSON.stringify(src));
  for (const s of [srcText, e.trigger_condition || '']) {
    for (const mm of s.matchAll(CARDID_RE)) named.add(mm[0]);
  }
  table.set(e.ending_id, { named, hasSources: src != null, cond: e.trigger_condition || '', rarity: e.rarity, srcType: typeof src });
}

// ---------- W：真实引擎写入方（全池穷举）
function seed(gs, amp) {
  if (!amp) return;
  for (const k of SEED_KEYS) gs.variables[k] = k.startsWith('Param_') ? 45 : (k.startsWith('Count_') ? 3 : 1);
  for (const k of dictKeys) if (/^Qualified_/.test(k)) gs.variables[k] = 1;
  gs.attributes['才艺'] = 9; gs.attributes['游戏技术'] = 9; gs.attributes['情商'] = 9;
  gs.attributes['口才'] = 9; gs.attributes['嗓音'] = 9; gs.attributes['运气'] = 10;
}
const census = new Map();     // eid -> Map('card:opt' -> '干净' | '干净+放大' )
const writerOnlyAmp = new Map();
for (const amp of [false, true]) {
  for (let ch = 1; ch <= 6; ch++) {
    for (const card of cards) {
      for (const opt of (card.options || [])) {
        const gs = new GameState(configData, stateDict, endingsData);
        const engine = new CardEngine(configData, cardsData, endingsData);
        gs.currentChapter = ch;
        seed(gs, amp);
        const before = new Set(Object.keys(gs.variables));
        try { engine.selectOption(card, opt.opt_key, gs); } catch (e) { continue; }
        for (const k of Object.keys(gs.variables)) {
          if (!/^Qualified_/.test(k) || before.has(k)) continue;
          const eid = k.slice('Qualified_'.length);
          if (!census.has(eid)) census.set(eid, new Map());
          const key = `${card.card_id}:${opt.opt_key}@ch${ch}`;
          const prev = census.get(eid).get(key);
          if (prev === undefined && !amp) census.get(eid).set(key, '干净');
          else if (prev === undefined) census.get(eid).set(key, '仅放大档');
        }
      }
    }
  }
}

// ---------- 前向引用探测器（机械判据：选项声明的非 D 结局号 == 该选项 next_cards 里某个卡号的尾号）
const forwardRef = [];
for (const card of cards) {
  for (const opt of (card.options || [])) {
    const trig = (opt.effects && opt.effects.ending_triggers) || opt.ending_triggers || [];
    const nexts = opt.next_cards || (opt.effects && opt.effects.next_cards) || [];
    for (const eid of trig) {
      if (eid.startsWith('D')) continue;
      for (const nc of nexts) {
        const m = String(nc).match(/-([MH]\d{2})$/i);
        if (m && m[1].toUpperCase() === eid) forwardRef.push({ card: card.card_id, opt: opt.opt_key, eid, next: nc, summary: opt.summary || '' });
      }
    }
  }
}

// ---------- W0：静态声明写入方（卡面 ending_triggers 原文，减去 cardEngine 硬编码黑名单）
const BLACK = new Set(['C5-M04|M05', 'C4-M01|M02', 'C5-M01|M02', 'C1-M04|M09']);
const staticWriters = new Map();
for (const card of cards) {
  for (const opt of (card.options || [])) {
    for (const eid of ((opt.effects && opt.effects.ending_triggers) || [])) {
      if (eid.startsWith('D')) continue;
      const banned = BLACK.has(`${card.card_id}|${eid}`);
      if (!staticWriters.has(eid)) staticWriters.set(eid, []);
      staticWriters.get(eid).push({ k: `${card.card_id}:${opt.opt_key}`, banned, req: opt.req_expr || '', chk: opt.check_expr || '' });
    }
  }
}

// ---------- 输出
const line = '─'.repeat(110);
console.log(line);
console.log('【Yellow 修复轮四 · Qualified_ 逐键对表】HEAD 引擎真跑全池穷举（6 章 × 全部卡 × 全部选项）');
console.log(`字典登记 ${DICT_KEYS.size} 键（Flag ${[...DICT_KEYS].filter(k => /^Flag_/.test(k)).length} / Count ${[...DICT_KEYS].filter(k => /^Count_/.test(k)).length} / Tag ${[...DICT_KEYS].filter(k => /^Tag_/.test(k)).length} / Param ${[...DICT_KEYS].filter(k => /^Param_/.test(k)).length} / Total ${[...DICT_KEYS].filter(k => /^Total_/.test(k)).length}），放大档实际播种 ${SEED_KEYS.size} 键（其中数据用到但字典未登记 ${[...SEED_KEYS].filter(k => !DICT_KEYS.has(k)).length} 个：${[...SEED_KEYS].filter(k => !DICT_KEYS.has(k)).join(' ') || '（无）'}）`);
console.log(line);
console.log('■ 逐键名单（W=引擎写入方条数, C=结算消费行号, T=正本该行点名的卡源）');
const allEids = [...new Set([...census.keys(), ...consumers.keys(), ...staticWriters.keys()])].sort();
const rows = [];
for (const eid of allEids) {
  const w = [...(census.get(eid)?.entries() || [])].sort();
  const clean = w.filter(([, t]) => t === '干净').map(([k]) => k);
  const ampOnly = w.filter(([, t]) => t === '仅放大档').map(([k]) => k);
  const stat = (staticWriters.get(eid) || []);
  const live = stat.filter(s => !s.banned);
  const banned = stat.filter(s => s.banned);
  const c = consumers.get(eid) || [];
  const t = table.get(eid) || { named: new Set(), hasSources: false, cond: '(表中无此行)', rarity: '' };
  const named = [...t.named];
  const verdict = [];
  if (c.length && !live.length) verdict.push('★死条件（消费但卡池零写入方）');
  if (live.length && !named.length) verdict.push('★表外写入（正本该行未点名卡源）');
  if (live.length && !c.length) verdict.push('☆零消费');
  rows.push({ eid, n: w.length, clean, ampOnly, live, banned, c, named, cond: t.cond, rarity: t.rarity, verdict: verdict.join(' ') || 'OK' });
}
for (const r of rows) {
  console.log(`  ${r.eid}  静态写入方 ${String(r.live.length).padEnd(2)}+黑名单${r.banned.length}  动态可达 ${String(r.n).padEnd(3)} 消费行[${r.c.join(',') || '—'}] 正点名[${r.named.join(',') || '—'}] ${r.verdict}`);
  if (r.live.length) console.log(`        静态: ${r.live.map(s => `${s.k}${s.req ? `[req ${s.req}]` : ''}${s.chk ? `[check ${s.chk}]` : ''}`).join('  ')}`);
  if (r.banned.length) console.log(`        已过滤: ${r.banned.map(s => s.k).join('  ')}`);
  if (/★/.test(r.verdict)) console.log(`        正本触发条件: ${r.cond}（稀有度 ${r.rarity}）`);
}
console.log(line);
console.log(`■ 前向引用机械探测（选项声明的 M/H 号 == 该选项 next_cards 尾号）共 ${forwardRef.length} 处：`);
for (const f of forwardRef) console.log(`     ${f.card}:${f.opt} 声明 ${f.eid} / next_cards=${f.next}  「${f.summary}」`);
console.log(line);
console.log('■ cardEngine 里硬编码的卡号（本轮新增的过滤是否只靠卡号白名单）：');
const hard = [...engineSrc.matchAll(/card\.card_id === '([A-Z0-9-]+)'/g)].map(m => m[1]);
console.log('     ' + [...new Set(hard)].join('  '));
console.log(line);
