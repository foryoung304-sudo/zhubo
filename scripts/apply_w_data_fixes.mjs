import fs from 'fs';
import path from 'path';

const cardsPath = path.resolve('zhubo/data/cards.json');
const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));

let phantomFansDeleted = 0;
const deletedFansDetails = [];

// 1. W2: Delete phantom fans absolute values (count 65)
for (const card of cards) {
  for (const opt of card.options) {
    if (opt.effects && opt.effects.delta_five_dim && opt.effects.delta_five_dim.fans !== undefined) {
      deletedFansDetails.push({
        card_id: card.card_id,
        opt_key: opt.opt_key,
        fans_val: opt.effects.delta_five_dim.fans,
        fans_pct: opt.effects.delta_five_dim.fans_pct
      });
      delete opt.effects.delta_five_dim.fans;
      phantomFansDeleted++;
    }
    if (opt.check_fail && opt.check_fail.delta_five_dim && opt.check_fail.delta_five_dim.fans !== undefined) {
      delete opt.check_fail.delta_five_dim.fans;
      phantomFansDeleted++;
    }
    if (opt.effects && opt.effects.effects_conditional) {
      if (opt.effects.effects_conditional.then && opt.effects.effects_conditional.then.delta_five_dim && opt.effects.effects_conditional.then.delta_five_dim.fans !== undefined) {
        delete opt.effects.effects_conditional.then.delta_five_dim.fans;
        phantomFansDeleted++;
      }
      if (opt.effects.effects_conditional.else && opt.effects.effects_conditional.else.delta_five_dim && opt.effects.effects_conditional.else.delta_five_dim.fans !== undefined) {
        delete opt.effects.effects_conditional.else.delta_five_dim.fans;
        phantomFansDeleted++;
      }
    }
  }
}

// 2. W1: Clear branch-unique keys from base of 3 conditional cards
const c6m02 = cards.find(c => c.card_id === 'C6-M02');
const c6m02B = c6m02.options.find(o => o.opt_key === 'B');
// Base had { fans_pct: 40, fans: 4 }. Now fans deleted by W2, clear fans_pct from base so it doesn't leak to else
delete c6m02B.effects.delta_five_dim.fans_pct;

const c4m06 = cards.find(c => c.card_id === 'C4-M06');
const c4m06A = c4m06.options.find(o => o.opt_key === 'A');
// Base had { fans_pct: 20, fans: 2 }. fans deleted by W2, clear fans_pct from base so it doesn't leak
delete c4m06A.effects.delta_five_dim.fans_pct;

// 3. W3: Fix 3 hater mis-mappings
const c3m05 = cards.find(c => c.card_id === 'C3-M05');
const c3m05A = c3m05.options.find(o => o.opt_key === 'A');
delete c3m05A.effects.delta_five_dim.fans_pct;

const c4m11 = cards.find(c => c.card_id === 'C4-M11');
const c4m11A = c4m11.options.find(o => o.opt_key === 'A');
delete c4m11A.effects.delta_five_dim.fans_pct;

const c5m01 = cards.find(c => c.card_id === 'C5-M01');
const c5m01A = c5m01.options.find(o => o.opt_key === 'A');
c5m01A.effects.delta_five_dim.fans_pct = -30;

// 4. W4: Three miscellaneous items
const c4m05 = cards.find(c => c.card_id === 'C4-M05');
const c4m05B = c4m05.options.find(o => o.opt_key === 'B');
c4m05B.effects.delta_five_dim.conversion_rate_pct = 30;

const xegg09 = cards.find(c => c.card_id === 'X-EGG-09');
const xegg09B = xegg09.options.find(o => o.opt_key === 'B');
delete xegg09B.effects.delta_five_dim.rep;

fs.writeFileSync(cardsPath, JSON.stringify(cards, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  status: 'SUCCESS',
  phantomFansDeleted,
  c6m02B_base_deltas: c6m02B.effects.delta_five_dim,
  c4m06A_base_deltas: c4m06A.effects.delta_five_dim,
  c3m05A_deltas: c3m05A.effects.delta_five_dim,
  c4m11A_deltas: c4m11A.effects.delta_five_dim,
  c5m01A_deltas: c5m01A.effects.delta_five_dim,
  c4m05B_deltas: c4m05B.effects.delta_five_dim,
  xegg09B_deltas: xegg09B.effects.delta_five_dim
}, null, 2));
