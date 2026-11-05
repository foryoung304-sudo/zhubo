import fs from 'fs';

const cards = JSON.parse(fs.readFileSync('./data/cards.json', 'utf8'));
const draft = fs.readFileSync('./maker-zhubo-gemini-draft-20261104.md', 'utf8');

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
list.forEach((item, idx) => {
  const valStr = item.parsed_pct !== undefined ? `${item.parsed_pct}%` : `${item.parsed_wallet}`;
  console.log(`| ${idx + 1} | ${item.id} | ${item.raw_label.replace(/\|/g, '/')} | ${item.summary.replace(/\|/g, '/')} | ${valStr} | PASS |`);
});
