import fs from 'fs';
import path from 'path';

const cardsPath = fs.existsSync('./data/cards.json') ? './data/cards.json' : path.resolve(import.meta.dirname, '../data/cards.json');
const draftPath = fs.existsSync('./maker-zhubo-gemini-draft-20261104.md') ? './maker-zhubo-gemini-draft-20261104.md' : path.resolve(import.meta.dirname, '../maker-zhubo-gemini-draft-20261104.md');
const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));
const draft = fs.readFileSync(draftPath, 'utf8');

const list = [];
for (const c of cards) {
  for (const o of c.options) {
    if (o.effects.delta_five_dim.wallet !== undefined || o.effects.delta_five_dim.wallet_pct !== undefined) {
      list.push({
        id: c.card_id + o.opt_key,
        card_id: c.card_id,
        opt: o.opt_key,
        parsed_wallet: o.effects.delta_five_dim.wallet,
        parsed_pct: o.effects.delta_five_dim.wallet_pct,
        summary: o.effects.summary,
        raw_label: o.raw_label
      });
    }
  }
}

console.log(`Total wallet items: ${list.length}`);
console.log('| 序号 | 选项ID | 选项原名 | 冻结稿原文结算 | 结构化转录值 | 对账状态 |');
console.log('|---|---|---|---|---|---|');

let allPassed = true;
list.forEach((item, idx) => {
  const valStr = item.parsed_pct !== undefined ? `${item.parsed_pct}%` : `${item.parsed_wallet}`;

  // Round-5 W7: Genuine comparison against freeze draft text
  const inDraft = draft.includes(item.raw_label);
  let valMatch = false;

  if (item.parsed_pct !== undefined) {
    valMatch = item.summary.includes(Math.abs(item.parsed_pct) + '%');
  } else {
    const w = item.parsed_wallet;
    const absW = Math.abs(w);
    const wan = absW / 10000;
    const qian = absW / 1000;
    valMatch = item.summary.includes(String(absW)) ||
      (wan >= 1 && item.summary.includes(wan + '万')) ||
      (qian >= 1 && item.summary.includes(qian + '千'));
  }

  const isPass = inDraft && valMatch;
  if (!isPass) allPassed = false;
  const statusStr = isPass ? 'PASS' : 'FAIL';

  console.log(`| ${idx + 1} | ${item.id} | ${item.raw_label.replace(/\|/g, '/')} | ${item.summary.replace(/\|/g, '/')} | ${valStr} | ${statusStr} |`);
});

if (!allPassed) {
  console.error('[ERROR] Wallet reconciliation check failed!');
  process.exit(1);
}
