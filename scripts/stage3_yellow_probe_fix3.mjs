/**
 * 阶段 3 · Yellow 定点探针（修复轮三四件清单；Orange 12f6d38 裁定口径）
 *   P1 M05 新支的三个判据各能不能落 + 「只经 C5-M04:B/C 前向引用」是否也落（结局表 M05 行不含它）
 *   P2 H07 局终前评：第 1/2/3/5 章体面收场各一次，数值边界（口碑 89/90、粉丝 9999/10000）
 *   P3 99.4 可观测性独立自证：不靠在册变异脚本，自己喂坏表达式看计数器会不会涨
 *   P4 X-EGG-03 生路边界：存款 1 / 0 / 负、A 与 B、+2 千是否照给
 *   P5 优先序对撞：同时满足 M05 判据与专精判据时谁落（第六章结算链）
 *
 * 口径：只读仓与引擎，不改 data、不改引擎。同一脚本可在 3edb69a 父提交沙盒副本上再跑一遍，
 *       P0 行打印被检引擎指纹，于是四件的「改前 / 改后」用同一条路径的 A/B 读数说。
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
const { TimingBar } = await import(ENG('timingBar.mjs'));
const { StageSettlement } = await import(ENG('stageSettlement.mjs'));

const cardsData = JSON.parse(fs.readFileSync(DATA('cards.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(DATA('config_and_screens.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(DATA('endings_and_talents.json'), 'utf8'));
const cardEngine = new CardEngine(configData, new TimingBar(configData), null);
const stageSettlement = new StageSettlement(configData);
const find = id => cardsData.find(c => c.card_id === id);

const fp = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts/engine', f))).digest('hex').slice(0, 16);
console.log('P0 被检引擎指纹：', ['gameState', 'cardEngine', 'stageSettlement', 'drawEngine'].map(m => `${m}=${fp(m + '.mjs')}`).join('  '));
console.log('   data/cards.json =', crypto.createHash('sha256').update(fs.readFileSync(DATA('cards.json'))).digest('hex').slice(0, 16));

const newGs = () => {
  const g = new GameState(configData, JSON.parse(fs.readFileSync(DATA('state_dictionary.json'), 'utf8')), endingsData);
  g.selectedSchedule = { mode: '带货', timeSlot: '晚', duration: 4 };
  return g;
};
// 让某一章「通关」：把粉丝顶过门槛，口碑按需
const promote = (g, ch, { fans, rep = 70 } = {}) => {
  g.currentChapter = ch;
  if (fans !== undefined) g.fiveDim.fans = fans;
  g.fiveDim.rep = rep;
};
const gateOf = ch => configData.chapters.find(c => c.chapter === ch).fans_gate_to;
const play = (g, id, opt) => cardEngine.selectOption(find(id), opt, g);
const R = [];
const rec = (k, v) => R.push(`${k} = ${v}`);

// ───────────────────────── P1 M05 三判据
console.log('\n【P1 M05 新支判据逐个能不能落】');
const hasBranch = fs.readFileSync(path.join(ROOT, 'scripts/engine/stageSettlement.mjs'), 'utf8').includes("Qualified_M05");
console.log('   引擎里是否存在 Qualified_M05 消费点：', hasBranch);

// P1① 只走 C5-M04:B（卡面 summary 写「进入C5-M05道歉质量判定」，ending_triggers 里挂的是 M05）
{
  const g = newGs();
  g.currentChapter = 5;
  play(g, 'C5-M04', 'B');
  rec('P1① C5-M04:B 打完 Qualified_M05', g.variables['Qualified_M05']);
  rec('P1① C5-M04:B 打完 triggeredEnding', g.triggeredEnding || 'null');
  rec('P1① C5-M04:B 是否打过 C6-M08', g.cardDecisions['C6-M08'] || '没打');
  promote(g, 6, { fans: gateOf(6) + 1, rep: 88 });
  g.c6m10Played = true;
  stageSettlement.settleChapter(g, false);
  rec('P1① 终章结算实落（只经 C5-M04 前向引用，结局表 M05 行不含它）', g.triggeredEnding);
}
// P1② C6-M08:C（结局表第一分句）
{
  const g = newGs();
  g.currentChapter = 6;
  play(g, 'C6-M08', 'C');
  promote(g, 6, { fans: gateOf(6) + 1, rep: 88 });
  g.c6m10Played = true;
  stageSettlement.settleChapter(g, false);
  rec('P1② C6-M08:C 终章结算实落', `${g.triggeredEnding}（Qualified_M05=${g.variables['Qualified_M05']}）`);
}
// P1③ Flag_榜一恋爱 + C6-M10:C（结局表第二分句；好感满值在字典里只有布尔 Flag 可用）
{
  const g = newGs();
  g.currentChapter = 3;
  play(g, 'C3-M06', 'A');
  rec('P1③ C3-M06:A 之后 Flag_榜一恋爱', g.variables['Flag_榜一恋爱']);
  g.currentChapter = 6;
  play(g, 'C6-M10', 'C');
  promote(g, 6, { fans: gateOf(6) + 1, rep: 88 });
  stageSettlement.settleChapter(g, false);
  rec('P1③ 榜一恋爱 + C6-M10:C 终章结算实落', `${g.triggeredEnding}（C6-M10:C 在卡面只挂 M01/M12，结局表把它算作 M05 第二分句）`);
}
// P1④ 三判据都不成立 → 结算链应走后面的层
{
  const g = newGs();
  promote(g, 6, { fans: gateOf(6) + 1, rep: 88 });
  g.c6m10Played = true;
  stageSettlement.settleChapter(g, false);
  rec('P1④ 无 M05 判据（c6m10Played=true）终章结算实落', g.triggeredEnding);
}

// ───────────────────────── P2 H07 局终前评
console.log('\n【P2 H07 在任何一章体面收场时、M04/M12 之前评】');
// 走真实流程：第一次未达标 → 开加时；第二次仍未达标 → 体面收场（不手置 overtimePlayed）
const gracefulExit = (g, ch) => {
  promote(g, ch, { fans: 200, rep: 92 });
  stageSettlement.settleChapter(g, false);   // 首试未达标 → 加时
  stageSettlement.settleChapter(g, false);   // 加时后仍未达标 → 体面收场
};
for (const ch of [1, 2, 3, 5]) {
  const g = newGs();
  g.currentChapter = 1;
  play(g, 'C1-M10', 'A');                     // 真实卡写 Flag_零粉快乐 + Qualified_H07
  gracefulExit(g, ch);
  rec(`P2 第${ch}章 未达标体面收场（零粉Flag+口碑92）实落`, `${g.triggeredEnding} / isDead=${g.isDead}`);
}
for (const [tag, rep, fans] of [['口碑89 边界', 89, 200], ['粉丝10000 边界', 92, 10000], ['无零粉Flag', 92, 200]]) {
  const g = newGs();
  g.currentChapter = 1;
  if (tag !== '无零粉Flag') play(g, 'C1-M10', 'A');
  promote(g, 3, { fans, rep });
  stageSettlement.settleChapter(g, false);
  stageSettlement.settleChapter(g, false);
  rec(`P2 边界 ${tag}`, `${g.triggeredEnding}`);
}

// ───────────────────────── P3 99.4 可观测性自证
console.log('\n【P3 求值 catch 计数是否真可观测（不靠在册变异脚本）】');
{
  const g = newGs();
  const before = g.evalCatchCount ?? '（引擎无该字段）';
  const bad = ["Flag_不存在的键 >= 2", "mode == == '带货'", "C1-M01 == 'A' && 口碑 > 5", "整活流 && 失控值高"];
  for (const e of bad) { const v = g.evalCondition(e); console.log(`   evalCondition(${JSON.stringify(e)}) → ${v}  累计catch=${g.evalCatchCount}`); }
  rec('P3 坏表达式前后计数', `before=${before} after=${g.evalCatchCount}`);
  rec('P3 strict 选项是否抛', (() => { try { g.evalCondition("Flag_不存在的键 >= 2", { strict: true }); return '没抛（异常）'; } catch (e) { return `抛了 ${e.constructor.name}`; } })());
}

// ───────────────────────── P4 X-EGG-03 生路边界
console.log('\n【P4 X-EGG-03 A 项生路 / 绝路边界】');
for (const [opt, wallet] of [['A', 1], ['A', 0], ['A', -5000], ['B', 800000]]) {
  const g = newGs();
  g.currentChapter = 4;
  play(g, 'C4-M03', 'A');
  g.fiveDim.wallet = wallet;
  g.currentChapter = 5;
  const w0 = g.fiveDim.wallet;
  play(g, 'X-EGG-03', opt);
  rec(`P4 ${opt} 选时存款=${wallet}`, `实落=${g.triggeredEnding || 'null'} isDead=${g.isDead} 钱包 ${w0}→${g.fiveDim.wallet}`);
}

// ───────────────────────── P5 M05 与专精同时对撞
console.log('\n【P5 M05 判据与专精判据同时成立时谁落】');
for (const [name, setup] of [
  ['电台夜王 M06（主修电台≥3 + 嗓音≥8）', g => { g.modeChapterCounts = { 电台: 3 }; g.attributes['嗓音'] = 8; }],
  ['团播 M07（主播团播）', g => { g.selectedSchedule.mode = '团播'; g.attributes['才艺'] = 8; }],
  ['带货 M02（主修带货≥3 + 口才≥8）', g => { g.modeChapterCounts = { 带货: 3 }; g.attributes['口才'] = 8; }],
  ['大排档 M11（钱包≥100万 + 口碑≥65 + C6-M10:C）', g => { g.fiveDim.wallet = 2000000; play(g, 'C6-M10', 'C'); }],
]) {
  const g = newGs();
  g.currentChapter = 6;
  play(g, 'C6-M08', 'C');                    // 给 M05 判据
  setup(g);
  promote(g, 6, { fans: gateOf(6) + 1, rep: 88 });
  g.c6m10Played = true;
  stageSettlement.settleChapter(g, false);
  rec(`P5 C6-M08:C + ${name}`, `实落 ${g.triggeredEnding}`);
}

console.log('\n' + R.join('\n'));
console.log('\n口径提醒：本探针不判「该不该这样落」，只把「能不能落、落成谁」摆清；优先序与结局表行文的取舍归 Orange。');
