/**
 * 阶段 3 · Yellow 独立探针（配合任务 #7 扩围；不依赖 Gemini 的 probe_trigger_cards.mjs）
 *
 *   P0 落支覆盖率：卡面 ending_triggers（含 check_fail 支）+ 引擎硬编码落支，同 50 结局做集合差，
 *      指出「没有任何代码能把这个结局落出来」的名单。
 *   P1 兜底语义与默认 true：cardEngine:297-328 只对 9 个 id 写了谓词，其余一律 return true；
 *      cardEngine:337-339 在全体谓词为假时把 appliedEndings[0] 直接落成。逐个对卡面文本取证。
 *   P2 「主修[X]模式 ≥ 3 章」代偿：正本 M02/M06/M07/M08/M09 与 D09 的第二路都写 ≥3 章，
 *      引擎侧全仓无主修计数（grep 主修|modeHistory|chapterModes|modeCounts = 0 命中），
 *      结算只看本章 mode。验一章能否顶替三章。
 *   P3 剩余 5 个未分类结局（M06 D05 D08 D18 H06）直构探针：把 trigger_condition 的字面条件
 *      构到状态里，走真实结算/真实卡路径，回报各自的绑定约束（接线死 / 数值饥饿 / 稀有合取）。
 *
 * 本脚本只读取仓与引擎，不改 data、不改引擎；构造状态只为取证「有没有落支」。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = n => path.join(ROOT, 'data', n);
const ENG = n => pathToFileURL(path.join(ROOT, 'scripts', 'engine', n)).href;

const { GameState } = await import(ENG('gameState.mjs'));
const { CardEngine } = await import(ENG('cardEngine.mjs'));
const { StageSettlement } = await import(ENG('stageSettlement.mjs'));

const cardsData = JSON.parse(fs.readFileSync(DATA('cards.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(DATA('config_and_screens.json'), 'utf8'));
const stateDict = JSON.parse(fs.readFileSync(DATA('state_dictionary.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(DATA('endings_and_talents.json'), 'utf8'));
const cardEngine = new CardEngine(configData, cardsData);
const stageSettlement = new StageSettlement(configData);
const cardById = new Map(cardsData.map(c => [c.card_id, c]));
const endingsList = Array.isArray(endingsData) ? endingsData : (endingsData.endings || endingsData.data || []);
const canonOf = id => endingsList.find(e => (e.ending_id || e.id) === id) || {};
const nameOf = id => canonOf(id).name || canonOf(id).ending_name || '';
const condOf = id => canonOf(id).trigger_conditions || canonOf(id).trigger_condition || '(正本无条件文本)';

const fresh = (ch = 6) => {
  const st = new GameState(configData, stateDict, endingsData);
  st.currentChapter = ch;
  return st;
};
const play = (st, cardId, optKey, tr) => cardEngine.selectOption(cardById.get(cardId), optKey, st, tr);
const revive = st => { st.isDead = false; st.triggeredEnding = null; };

console.log('='.repeat(104));
console.log('阶段 3 · Yellow 独立探针 (scripts/stage3_yellow_probe.mjs)  —— Gemini 修复轮之后');
console.log('='.repeat(104));

// ------------------------------------------------------------------ P0 落支覆盖率
console.log('\n【P0】50 个结局的落支来源（卡面 ending_triggers 含 check_fail / 引擎硬编码落支）');
const cardRefs = new Map();
const addRef = (id, where) => { if (!cardRefs.has(id)) cardRefs.set(id, []); cardRefs.get(id).push(where); };
for (const c of cardsData) for (const o of c.options) {
  for (const t of ((o.effects || {}).ending_triggers || [])) addRef(t, `${c.card_id}:${o.opt_key}[选]`);
  const cf = o.check_fail;
  if (cf && cf.ending_triggers) for (const t of cf.ending_triggers) addRef(t, `${c.card_id}:${o.opt_key}[检定失败]`);
}
const engSrc = ['cardEngine.mjs', 'stageSettlement.mjs', 'gameState.mjs']
  .map(f => fs.readFileSync(path.join(ROOT, 'scripts', 'engine', f), 'utf8')).join('\n');
const engIds = new Set();
for (const m of engSrc.matchAll(/triggeredEnding = '([DMH]\d{2})'/g)) engIds.add(m[1]);
const allIds = endingsList.map(e => e.ending_id || e.id);
const dead = allIds.filter(id => !cardRefs.has(id) && !engIds.has(id));
console.log(`  卡面可引用 ${cardRefs.size} 个 ｜ 引擎硬编码 ${engIds.size} 个 ｜ 结局总数 ${allIds.length} 个`);
console.log(`  【两侧都无来源＝接线死】${dead.length} 个：`);
for (const id of dead) console.log(`     ${id} ${nameOf(id)} ← 正本：${condOf(id)}`);

// ------------------------------------------------------------------ P1 兜底与默认 true
console.log('\n【P1】谓词表只覆盖 9 个 id（D09 D15 D16 D19 D20 D21 H03 H04 H10），其余 return true');
console.log('  → 多 id 数组在默认 true 下「首个满足者」恒等于数组首项：');
const HANDLED = ['D09', 'D15', 'D16', 'D19', 'D20', 'D21', 'H03', 'H04', 'H10'];
for (const c of cardsData) for (const o of c.options) {
  const t = (o.effects || {}).ending_triggers || [];
  if (t.length < 2) continue;
  const unhandled = t.filter(id => !HANDLED.includes(id));
  console.log(`     ${c.card_id}:${o.opt_key} [${t.join(', ')}] 未覆盖项: ${unhandled.join(', ') || '(全被覆盖)'}｜卡面文本：${((o.effects || {}).summary || '').slice(0, 44)}`);
}
const p1cases = [
  {
    name: 'C5-M08:B 两支 Flag 都不写（卡面文本「B直通D20/D21」；该卡 prereq 已锁 卖惨||造假，故属体外构造）',
    build: () => fresh(5), fire: st => play(st, 'C5-M08', 'B', {}),
    peek: st => ({ 卖惨人设: st.variables['Flag_卖惨人设'], 造假剧本: st.variables['Flag_造假剧本'] })
  },
  {
    name: 'C5-M08:B 仅 造假剧本=1（真实卡 C2-M04:A 写入）',
    build: () => { const s = fresh(2); play(s, 'C2-M04', 'A', {}); revive(s); s.currentChapter = 5; return s; },
    fire: st => play(st, 'C5-M08', 'B', {}),
    peek: st => ({ 卖惨人设: st.variables['Flag_卖惨人设'], 造假剧本: st.variables['Flag_造假剧本'] })
  },
  {
    name: 'C5-M10:A 手置 协议=1（卡面 state_writes 自带 Flag_账号协议 = 0，写入先于落支判定）',
    build: () => { const s = fresh(5); play(s, 'C5-M02', 'A', {}); play(s, 'C5-M02', 'A', {}); revive(s); s.variables['Flag_账号协议'] = 1; return s; },
    fire: st => play(st, 'C5-M10', 'A', {}),
    peek: st => ({ 复盘留档: st.variables['Count_复盘留档'], 偷拍素材: st.variables['Count_偷拍素材'], 协议: st.variables['Flag_账号协议'] })
  },
  {
    name: 'C6-M10:A 终局扳机（卡面文本「按五维、主修模式与Flag结算进入M01–M12」，非即时落支）',
    build: () => { const s = fresh(6); s.fiveDim.fans = 9_000_000; return s; },
    fire: st => play(st, 'C6-M10', 'A', {}),
    peek: st => ({ 清白账本: st.variables['Tag_清白账本'], 口碑: st.fiveDim.rep })
  }
];
for (const c of p1cases) {
  const st = c.build();
  const before = c.peek(st);
  c.fire(st);
  console.log(`  ${c.name}`);
  console.log(`     前置=${JSON.stringify(before)} → 落成=${st.triggeredEnding || '(无)'} isDead=${st.isDead} isCleared=${st.isCleared}`);
}

// ------------------------------------------------------------------ P2 主修 ≥3 章
console.log('\n【P2】正本要求「主修[X]模式 ≥ 3 章」，结算只看本章 mode —— 一章顶三章实测');
const p2 = [
  { eid: 'M07', mode: '团播', extra: st => { st.attributes['才艺'] = 9; } },
  { eid: 'M08', mode: '游戏', extra: st => { st.attributes['游戏技术'] = 9; } },
  { eid: 'M09', mode: '户外', extra: st => { st.attributes['才艺'] = 9; st.fiveDim.stamina = 80; } },
  { eid: 'M02', mode: '带货', extra: st => { st.variables['Flag_选品减伤'] = 1; } }
];
for (const c of p2) {
  const st = fresh(6);
  st.fiveDim.fans = 9_000_000;
  st.selectedSchedule = { mode: c.mode, timeSlot: 'slot_noon', duration: 4 };
  c.extra(st);
  stageSettlement.settleChapter(st);
  console.log(`  仅本章排「${c.mode}」→ 落 ${st.triggeredEnding || '(无)'}（该支由本章 mode 的 inline 谓词命中，主修计数不存在；正本：${condOf(c.eid).slice(0, 44)}…）`);
}
console.log('  主修计数字段实测：GameState 上匹配 /mode|主修|chapter/ 的键 =',
  JSON.stringify(Object.keys(fresh(1)).filter(k => /mode|主修|chapter/i.test(k))));

// ------------------------------------------------------------------ P3 未分类 5 结局
console.log('\n【P3】D 类未分类 5 个：字段路径按 gameState 真实结构构造（haterPct 在根、心态/嗓音是 attributes），验有没有落支');
const P3 = [
  {
    eid: 'M06', canon: '打通第六章 + 主修[电台]模式 ≥ 3 章 + 嗓音 ≥ 8',
    build: () => {
      const st = fresh(6);
      st.fiveDim.fans = 9_000_000;
      st.attributes['嗓音'] = 9;
      st.selectedSchedule = { mode: '电台', timeSlot: 'slot_night', duration: 4 };
      st.variables['Qualified_M06'] = 1;
      return st;
    },
    via: 'settleChapter(ch6 达标)'
  },
  {
    eid: 'D05', canon: '任意阶段 黑粉浓度 ≥ 100% 且 心态检定失败',
    build: () => {
      const st = fresh(3);
      st.haterPct = 100;            // 真实路径：gameState 根，不是 fiveDim
      st.attributes['心态'] = 0;
      return st;
    },
    via: 'checkFiveDimDeath + 真实卡结算'
  },
  {
    eid: 'D08', canon: 'Count_违规警告 ≥ 2（C2-M09 选 A、C2-S06、C4-S11 等累加）',
    build: () => {
      const st = fresh(5);
      play(st, 'C2-M09', 'A', {});
      st.isDead = false; st.triggeredEnding = null;
      play(st, 'C2-M09', 'A', {});
      st.isDead = false; st.triggeredEnding = null;
      st.fiveDim.fans = 9_000_000;
      st.selectedSchedule = { mode: '才艺', timeSlot: 'slot_noon', duration: 4 };
      return st;
    },
    via: '两张真卡累加违规警告后 settleChapter'
  },
  {
    eid: 'D18', canon: 'Param_观众当真度 ≥ 40 +（C4-M06 官宣真恋情 或 C5-M10 拆 CP 且 情商 < 7）',
    build: () => {
      const st = fresh(5);
      play(st, 'C2-M05', 'A', {});           // 当真度 +40
      st.isDead = false; st.triggeredEnding = null;
      play(st, 'C4-M06', 'A', {});           // 官宣真恋情
      st.isDead = false; st.triggeredEnding = null;
      st.attributes['情商'] = 3;
      return st;
    },
    via: '两张真卡构出「当真度≥40 + 官宣」后 settleChapter'
  },
  {
    eid: 'H06', canon: '全程 6 章全部排 6 小时超长档 + 0 次下播补觉 + 打通第六章且状态未跌穿',
    build: () => {
      const st = fresh(6);
      st.fiveDim.fans = 9_000_000;
      st.selectedSchedule = { mode: '才艺', timeSlot: 'slot_noon', duration: 6 };
      st.attributes['才艺'] = 9;
      return st;
    },
    via: '六小时超长档直落第六章结算'
  },
];
for (const c of P3) {
  const st = c.build();
  st.currentChapter = 6;   // 把结算支链（stageSettlement:170-207）整条压满再读落支
  const snapshotVars = { 违规警告: st.variables['Count_违规警告'], 当真度: st.variables['Param_观众当真度'], 黑粉: st.haterPct };
  let landed = null, note = '';
  if (c.via.startsWith('checkFiveDim')) {
    st.checkFiveDimDeath();
    landed = st.triggeredEnding;
    const d2 = c.build();
    d2.currentChapter = 6;
    stageSettlement.settleChapter(d2);
    note = `结算读回=${d2.triggeredEnding || '(无落支)'}`;
  } else {
    const cardLanded = st.triggeredEnding;
    stageSettlement.settleChapter(st);
    landed = st.triggeredEnding;
    note = `卡面已落=${cardLanded || '(无)'}`;
  }
  console.log(`  ${c.eid} 构造态=${JSON.stringify(snapshotVars)}  落成=${landed || '(无落支)'}  ${note}`);
  console.log(`     绑定约束（正本）：${c.canon}`);
  console.log(`     落支来源：卡面 ${cardRefs.get(c.eid) ? cardRefs.get(c.eid).join(', ') : '(无引用)'}｜引擎硬编码 ${engIds.has(c.eid) ? '有' : '无'}｜Qualified 消费点 ${/M07|M08|M09|H04|H07|H10|H08|H01|M03/.test(c.eid) && ['M07','M08','M09','H04','H07','H10','H08','H01','M03'].includes(c.eid) ? '有' : '无'}`);
}

console.log('\n' + '='.repeat(104));
console.log('取证提醒：本探针回答「代码里有没有落支」，不回答「自然局撞不撞得到」；后者看 simulate_stage3 的分布。');
console.log('='.repeat(104));
