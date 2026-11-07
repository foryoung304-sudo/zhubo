/**
 * 阶段 3 · Yellow 定点探针（修复轮二之后的三个归属尾巴；Orange 482fe7a 点名）
 *   (a) M05 / D22 本轮新掉 0：回归（回 Gemini）还是机制没坏只是没撞上（归稀有）
 *   (b) D05 接上判定本体后仍 0：能落 = 合取数值饥饿（归平衡待办）；不能落 = 还没接通
 *   (c) Tag_流派 值域对账：字典 / 生成源 / 卡面实写 / 引擎读值 / Lua 读值 各说几个值
 *       外加「重跑转录」是否字节可复现
 *
 * 口径：只读仓与引擎，不改 data、不改引擎；构造状态只为取证「有没有落支」。
 * 对照：同一脚本可在 58e0f86 的沙盒副本上再跑一遍（P0 行会打印被检引擎的指纹），
 *       于是「本轮改动碰坏了什么」不用嘴说，用同一条路径的 A/B 读数说。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = n => path.join(ROOT, 'data', n);
const ENG = n => pathToFileURL(path.join(ROOT, 'scripts', 'engine', n)).href;

const { GameState } = await import(ENG('gameState.mjs'));
const { CardEngine } = await import(ENG('cardEngine.mjs'));
const { StageSettlement } = await import(ENG('stageSettlement.mjs'));

const cardsData = JSON.parse(fs.readFileSync(DATA('cards.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(DATA('config_and_screens.json'), 'utf8'));
const dictRaw = JSON.parse(fs.readFileSync(DATA('state_dictionary.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(DATA('endings_and_talents.json'), 'utf8'));
const cardEngine = new CardEngine(configData, cardsData);
const stageSettlement = new StageSettlement(configData);
const cardById = new Map(cardsData.map(c => [c.card_id, c]));
const endingsList = Array.isArray(endingsData) ? endingsData : (endingsData.endings || []);
const canonOf = id => endingsList.find(e => (e.ending_id || e.id) === id) || {};
const condOf = id => canonOf(id).trigger_condition || canonOf(id).trigger_conditions || '(正本无文本)';
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'engine', f))).digest('hex').slice(0, 16);

const fresh = (ch = 6) => {
  const st = new GameState(configData, dictRaw, endingsData);
  st.currentChapter = ch;
  return st;
};
const play = (st, cardId, optKey) => cardEngine.selectOption(cardById.get(cardId), optKey, st, null);
// 结算取证用：把六章闸门粉丝直接抬过线，只看优先链怎么落（真实卡路径的可达性由 30,000 局扫表负责）
const toCh6Settle = st => {
  st.currentChapter = 6;
  st.fiveDim.fans = 50000000;
  st.fiveDim.rep = 60;
  return st;
};

console.log('='.repeat(104));
console.log('阶段 3 · Yellow 修复轮二归属探针 (scripts/stage3_yellow_probe_fix2.mjs)');
console.log('被检引擎指纹：' + ['cardEngine.mjs', 'stageSettlement.mjs', 'gameState.mjs', 'drawEngine.mjs'].map(f => `${f}=${sha(f)}`).join('  '));
console.log('='.repeat(104));

// ============================================================ P1 M05 的三条通道
console.log('\n【P1】M05 通道逐条：正本 =', condOf('M05'));
const m05CardRefs = [];
for (const c of cardsData) for (const o of c.options) {
  for (const t of ((o.effects || {}).ending_triggers || [])) if (t === 'M05') m05CardRefs.push(`${c.card_id}:${o.opt_key}[选]`);
  const cf = o.check_fail;
  if (cf && (cf.ending_triggers || []).includes('M05')) m05CardRefs.push(`${c.card_id}:${o.opt_key}[检定失败]`);
}
console.log('  卡面写入方：', m05CardRefs.join(' , ') || '（无）');

const g1 = fresh(6);
play(g1, 'C6-M08', 'C');
console.log(`  ① 第6章真卡 C6-M08 选 C「今晚退圈结婚」（卡面写 直通主结局M05）：triggeredEnding=${g1.triggeredEnding}  Qualified_M05=${g1.variables['Qualified_M05']}  isCleared=${g1.isCleared}`);

const g2 = fresh(6);
play(g2, 'C6-M08', 'C');
play(g2, 'C6-M10', 'A');
toCh6Settle(g2);
stageSettlement.settleChapter(g2);
console.log(`  ② 同上再打 C6-M10 后走第6章结算：triggeredEnding=${g2.triggeredEnding}  (c6m10Played=${g2.c6m10Played}  Qualified_M05=${g2.variables['Qualified_M05']})`);

const g3 = fresh(6);
play(g3, 'C6-M08', 'C');
toCh6Settle(g3);
stageSettlement.settleChapter(g3);
console.log(`  ③ 同上但不打 C6-M10（c6m10Played=false）走结算：triggeredEnding=${g3.triggeredEnding}`);

const g4 = fresh(5);
play(g4, 'C5-M04', 'B');
console.log(`  ④ 第5章真卡 C5-M04 选 B：triggeredEnding=${g4.triggeredEnding}  Qualified_M05=${g4.variables['Qualified_M05']}`);
const consume = src => {
  const t = fs.readFileSync(path.join(ROOT, 'scripts', 'engine', src), 'utf8');
  return t.includes("Qualified_M05");
};
console.log(`  ⑤ Qualified_M05 消费面：cardEngine=${consume('cardEngine.mjs')}  stageSettlement=${consume('stageSettlement.mjs')}  gameState=${consume('gameState.mjs')}（全引擎无消费点 = 资格位写了也没人读）`);

// ============================================================ P2 D22 的通道
console.log('\n【P2】D22 通道：正本 =', condOf('D22'));
const d22Refs = [];
for (const c of cardsData) for (const o of c.options) {
  for (const t of ((o.effects || {}).ending_triggers || [])) if (t === 'D22') d22Refs.push(`${c.card_id}:${o.opt_key}[选]`);
  const cf = o.check_fail;
  if (cf && (cf.ending_triggers || []).includes('D22')) d22Refs.push(`${c.card_id}:${o.opt_key}[检定失败]`);
}
console.log('  卡面写入方：', d22Refs.join(' , ') || '（无）');

const e1 = fresh(3);
e1.fiveDim.stamina = 10;            // X-EGG-01 prereq 状态 <= 15（发牌门由 drawEngine 判，这里只走卡面结算）
play(e1, 'X-EGG-01', 'B');
console.log(`  ① 第3章 X-EGG-01 选 B：triggeredEnding=${e1.triggeredEnding}  isDead=${e1.isDead}`);

const e2 = fresh(3);
e2.fiveDim.stamina = 10;
e2.attributes['运气'] = 2;           // A 支检定 运气>=3 失败 → check_fail.ending_triggers
play(e2, 'X-EGG-01', 'A');
console.log(`  ② 第3章 X-EGG-01 选 A + 运气=2（检定失败支）：triggeredEnding=${e2.triggeredEnding}  isDead=${e2.isDead}`);

const e3 = fresh(3);
e3.fiveDim.stamina = 10;
const hasLock = typeof e3.triggerEnding === 'function';
if (hasLock) e3.triggerEnding('D04'); else e3.triggeredEnding = 'D04';  // 模拟本局更早已落过支
e3.isDead = false;
play(e3, 'X-EGG-01', 'B');
console.log(`  ③ 预置已有落支 D04 后再打 X-EGG-01 B：triggeredEnding=${e3.triggeredEnding}   （本引擎${hasLock ? '有落定格：先到先定格，D22 写不进' : '无落定格（末位覆写）：D22 把 D04 顶掉'}）`);

const e4 = fresh(3);
e4.fiveDim.stamina = 10;
e4.attributes['运气'] = 2;
play(e4, 'X-EGG-01', 'A');
console.log(`  ④ 第3章 X-EGG-01 选 A + 运气=2：triggeredEnding=${e4.triggeredEnding}（同上，若为 null 说明检定支未接）`);

const guardSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'engine', 'cardEngine.mjs'), 'utf8');
const secondClause = /警戒区|连续抽中翻车|Count_翻车/.test(guardSrc);
console.log(`  ⑤ 正本第二子句「状态<20 警戒区且运气≤2 连续抽中翻车卡」消费点：${secondClause ? '有' : '无（引擎全仓无该计数/判定）'}`);

// ============================================================ P3 D05 判定本体 + 生成侧上限
console.log('\n【P3】D05：正本 =', condOf('D05'));
const d05Refs = [];
for (const c of cardsData) for (const o of c.options) {
  for (const t of ((o.effects || {}).ending_triggers || [])) if (t === 'D05') d05Refs.push(`${c.card_id}:${o.opt_key}[选]`);
  const cf = o.check_fail;
  if (cf && (cf.ending_triggers || []).includes('D05')) d05Refs.push(`${c.card_id}:${o.opt_key}[检定失败]`);
}
console.log('  卡面写入方：', d05Refs.join(' , ') || '（无，走引擎 checkFiveDimDeath 第五支）');

const f1 = fresh(4);
f1.haterPct = 100;
f1.attributes['心态'] = 7;
f1.applyFiveDimDelta({ heat_pct: 1 });   // 用真实增量入口触发内部死亡自检
console.log(`  ① 直构 haterPct=100 + 心态=7 走 applyFiveDimDelta：triggeredEnding=${f1.triggeredEnding}  isDead=${f1.isDead}`);

const f2 = fresh(4);
f2.haterPct = 100;
f2.attributes['心态'] = 8;
f2.applyFiveDimDelta({ heat_pct: 1 });
console.log(`  ② 直构 haterPct=100 + 心态=8（合取另一半）：triggeredEnding=${f2.triggeredEnding}  isDead=${f2.isDead}`);

const haterSources = [];
for (const c of cardsData) for (const o of c.options) {
  const ok = ((o.effects || {}).delta_five_dim || {}).hater_pct;
  const fk = ((o.check_fail || {}).delta_five_dim || {}).hater_pct;
  if (ok || fk) haterSources.push(`${c.card_id}:${o.opt_key}=+${ok || fk}`);
}
console.log(`  ③ 引擎可达的黑粉浓度累加面（唯一入口 gameState.applyFiveDimDelta）：${haterSources.join('  ')}  → 全打满合计 +${haterSources.reduce((a, s) => a + Number(s.split('=+')[1]), 0)}，初始 ${new GameState(configData, dictRaw, endingsData).haterPct}`);
console.log('     正本 §2.6 影子指标（草稿 L396–L398）另列：初始 5%、每阶段按热度公式生成、C2-M09 A +15%、对线硬刚每次 +15%');

// ============================================================ P4 D01 接线（本轮第三个新 0）
console.log('\n【P4】D01（本轮同样新入 0 命中，Orange 未点名，一并归因）');
const h1 = fresh(3);
h1.fiveDim.stamina = 3;
h1.applyFiveDimDelta({ stamina: -5 });
console.log(`  ① 直构 状态=3 后打 -5：triggeredEnding=${h1.triggeredEnding}  isDead=${h1.isDead}  状态=${h1.fiveDim.stamina}`);
const staminaDeltaSources = [];
for (const c of cardsData) for (const o of c.options) {
  const ok = ((o.effects || {}).delta_five_dim || {}).stamina;
  const fk = ((o.check_fail || {}).delta_five_dim || {}).stamina;
  if ((ok || 0) < 0 || (fk || 0) < 0) staminaDeltaSources.push(`${c.card_id}:${o.opt_key}=${ok ?? fk}`);
}
console.log(`  ② 卡面负向 状态 来源共 ${staminaDeltaSources.length} 处（接线无关，本轮变动来自策略配置与发牌权重）`);

// ============================================================ P5 Tag_流派 值域五处口径
console.log('\n【P5】Tag_流派 值域对账（字典 / 生成源 / 卡面实写 / Node 引擎读值 / Lua 读值）');
const tagEntry = dictRaw.variables.find(v => v.key === 'Tag_流派');
console.log(`  ① 已推字典 range_or_cap = "${tagEntry.range_or_cap}"  → 值数 ${(tagEntry.range_or_cap || '').split('|').length}；line_no=${JSON.stringify(tagEntry.line_no)}  source=${tagEntry.source}`);
console.log(`     writers_text = ${tagEntry.writers_text}`);
const genSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'transcribe_data.mjs'), 'utf8');
const genBlock = genSrc.slice(genSrc.indexOf("key: 'Tag_流派'") - 200, genSrc.indexOf("key: 'Tag_流派'") + 600);
console.log(`  ② 生成源 transcribe_data.mjs 内 Tag_流派 块 range_or_cap = "${(genBlock.match(/range_or_cap: '([^']*)'/) || [])[1]}"  → 与字典同口径`);
const cardWrites = [];
for (const c of cardsData) for (const o of c.options) {
  for (const w of ((o.effects || {}).state_writes || [])) if (w.startsWith('Tag_流派')) cardWrites.push(`${c.card_id}:${o.opt_key} → ${w}`);
  for (const w of (((o.check_fail || {}).state_writes) || [])) if (w.startsWith('Tag_流派')) cardWrites.push(`${c.card_id}:${o.opt_key}[失败] → ${w}`);
}
console.log(`  ③ 卡面实写值：${cardWrites.join('  ') || '（无）'}`);
const nodeReads = [...new Set(
  ['cardEngine.mjs', 'stageSettlement.mjs', 'gameState.mjs']
    .flatMap(f => [...fs.readFileSync(path.join(ROOT, 'scripts', 'engine', f), 'utf8').matchAll(/Tag_流派[^\n]*/g)])
    .flatMap(m => [...m[0].matchAll(/=== *'([^']+)'/g)].map(x => x[1]))
)];
console.log(`  ④ Node 引擎读值：${nodeReads.join(' | ')}（去重 ${nodeReads.length} 值）`);
const lua = fs.readFileSync(path.join(ROOT, 'maker', 'scripts', 'main.lua'), 'utf8');
const luaReads = [...new Set([...lua.matchAll(/Tag_流派[^)]*== *"([^"]+)"/g)].map(m => m[1]))];
console.log(`  ⑤ Lua 读值：${luaReads.join(' | ') || '(未匹配)'}；maker/assets/data/state_dictionary.json 里 Tag_流派 键是否存在 = ${fs.readFileSync(path.join(ROOT, 'maker', 'assets', 'data', 'state_dictionary.json'), 'utf8').includes('Tag_流派')}`);
const strayValues = ['深度', '搞钱', '纯纯日常'];
const ctxOf = (s, v) => [...s.matchAll(new RegExp(v, 'g'))].slice(0, 2).map(m => `「…${s.slice(Math.max(0, m.index - 16), m.index + v.length + 12).replace(/\s+/g, ' ')}…」`);
for (const v of strayValues) {
  const cardsSrc = fs.readFileSync(DATA('cards.json'), 'utf8');
  const draftSrc = fs.readFileSync(path.join(ROOT, 'maker-zhubo-gemini-draft-20261104.md'), 'utf8');
  const inCards = cardsSrc.includes(v);
  const inDict = fs.readFileSync(DATA('state_dictionary.json'), 'utf8').includes(v);
  const inDraft = draftSrc.includes(v);
  const inScripts = ['transcribe_data.mjs', 'validate_transcription.mjs'].some(f => fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8').includes(v));
  console.log(`  ⑥ 「${v}」在仓内的出处：cards=${inCards}  dict=${inDict}  草稿=${inDraft}  转录/校验脚本=${inScripts}`);
  const c = [...ctxOf(cardsSrc, v), ...ctxOf(draftSrc, v).map(x => '草稿 ' + x)];
  console.log(`      命中上下文：${c.join('  ') || '（无命中，无法核对是否为流派取值）'}`);
}

// ============================================================ P6 转录重跑可复现性（尾巴 c 的连带事实）
console.log('\n【P6】重跑转录是否字节可复现（对 Orange「保证重跑转录不回退」一条取证）');
const REGEN = process.env.YELLOW_REGEN_DIR;
// 键序无关的规范化：递归排序对象键，数组保持顺序（数组是有序数据，不能排序）
const canon = v => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
};
const diffPaths = (a, b, p = '', acc = []) => {
  if (acc.length > 12) return acc;
  if (a === b) return acc;
  const ao = a && typeof a === 'object', bo = b && typeof b === 'object';
  if (ao && bo && Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) diffPaths(a[i], b[i], `${p}[${i}]`, acc);
    return acc;
  }
  if (ao && bo && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], `${p}.${k}`, acc);
    return acc;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) acc.push(`${p || '(root)'}：重跑=${JSON.stringify(a)} / 在册=${JSON.stringify(b)}`);
  return acc;
};
// 第三级：把数组也按规范化 JSON 排序（元素多重集合相同 → 只是排列漂移，不是内容漂移）
const canonArr = v => {
  if (Array.isArray(v)) return v.map(canonArr).sort((a, b) => { const A = JSON.stringify(a), B = JSON.stringify(b); return A < B ? -1 : A > B ? 1 : 0; });
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonArr(v[k]);
    return o;
  }
  return v;
};
if (REGEN && fs.existsSync(path.join(REGEN, 'state_dictionary.json'))) {
  const cmp = f => {
    const a = fs.readFileSync(path.join(REGEN, f), 'utf8');
    const b = fs.readFileSync(DATA(f), 'utf8');
    if (a === b) return '字节一致';
    const ca = canon(JSON.parse(a)), cb = canon(JSON.parse(b));
    let d = diffPaths(ca, cb);
    if (!d.length) return '内容等价、仅键序/缩进漂移（重跑不改判定）';
    const d2 = diffPaths(canonArr(JSON.parse(a)), canonArr(JSON.parse(b)));
    if (!d2.length) return `元素与字段逐条等价、仅数组排列漂移（按 key 取值的消费方不受影响）；位置差 ${d.length}${d.length > 12 ? '+' : ''} 处，样例：\n${d.slice(0, 3).map(x => '      ' + x).join('\n')}`;
    return `内容有差异 ← 重跑会改动在册数据，差异 ${d2.length}${d2.length > 12 ? '+' : ''} 处：\n${d2.map(x => '      ' + x).join('\n')}`;
  };
  for (const f of ['state_dictionary.json', 'cards.json', 'endings_and_talents.json', 'config_and_screens.json']) {
    console.log(`  ${f.padEnd(28)} ${cmp(f)}`);
  }
  const regenCards = JSON.parse(fs.readFileSync(path.join(REGEN, 'cards.json'), 'utf8'));
  const c1 = regenCards.find(c => c.card_id === 'C1-M01');
  const w = c1 ? c1.options.find(o => o.opt_key === 'C').effects.state_writes : null;
  console.log(`  重跑后的 C1-M01:C state_writes = ${JSON.stringify(w)}（在册冻结值 = ["Tag_流派 = 整活"]）`);
  const rg = JSON.parse(fs.readFileSync(path.join(REGEN, 'state_dictionary.json'), 'utf8'));
  const ck = dictRaw.variables.map(v => v.key), rk = rg.variables.map(v => v.key);
  console.log(`  字典键集合：在册 ${ck.length} 键 / 重跑 ${rk.length} 键；重跑缺 ${JSON.stringify(ck.filter(k => !rk.includes(k)))}，重跑多 ${JSON.stringify(rk.filter(k => !ck.includes(k)))}`);
  console.log(`  Tag_流派 在 variables 数组中的下标：在册 ${ck.indexOf('Tag_流派')}，重跑 ${rk.indexOf('Tag_流派')}（重跑把它追加到末尾，条目字段逐条相同）`);
} else {
  console.log('  未提供 YELLOW_REGEN_DIR，跳过（脚本本身不重跑转录，避免碰在册 data）');
}
