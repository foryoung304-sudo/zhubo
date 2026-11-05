import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DRAFT_PATH = path.join(REPO_ROOT, 'maker-zhubo-gemini-draft-20261104.md');

// This script strictly inspects the read-only frozen markdown draft
// It does NOT read or depend on the data/ directory.

const draftRaw = fs.readFileSync(DRAFT_PATH, 'utf8');
const lines = draftRaw.split(/\r?\n/);

const assertions = [];
function assert(condition, name, detail = '') {
  assertions.push({ pass: Boolean(condition), name, detail });
  if (!condition) {
    throw new Error(`TEST_CARDS FAILED: ${name} (${detail})`);
  }
}

// Appendix B Word Gate counters
function countModeA(str) {
  const clean = str
    .replace(/`\[操作：[^\]]+\]`/g, '')
    .replace(/`\[正经卡\]`/g, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '');
  const matches = clean.match(/[\u4e00-\u9fa50-9％.]/g);
  return matches ? matches.length : 0;
}

function countModeB(str) {
  const clean = str
    .replace(/`\[操作：[^\]]+\]`/g, '')
    .replace(/`\[正经卡\]`/g, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, '');
  return [...clean].length;
}

console.log('================================================================================');
console.log('《从小主播到顶流》冻结初稿层校验 (test_cards.mjs)');
console.log('目标: 验证只读冻结初稿 v0.2 的卡池计数、字数门、50 结局 (M/D/H) 与禁用词');
console.log('================================================================================\n');

// 1. Verify Frozen Baseline Untouched
const draftLfBytes = Buffer.byteLength(draftRaw.replace(/\r\n/g, '\n'), 'utf8');
assert(draftLfBytes === 195339, 'Frozen draft v0.2 LF byte size === 195,339', `actual=${draftLfBytes}`);

// 2. Scan Markdown Card Pool Tables
const cardMap = new Map();

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith('|')) continue;

  const cols = line.split('|').slice(1, -1).map(c => c.trim());
  if (cols.length < 5) continue;

  const id = cols[0];
  const isMilestone = /^C([1-6])-M\d{2}$/.test(id);
  const isShort = /^C([1-6])-S\d{2}$/.test(id);
  const isCrossMode = /^X-MODE-\d{2}$/.test(id);
  const isCrossAttr = /^X-ATTR-\d{2}$/.test(id);
  const isCrossEgg = /^X-EGG-\d{2}$/.test(id);

  if (!isMilestone && !isShort && !isCrossMode && !isCrossAttr && !isCrossEgg) continue;

  if (cardMap.has(id)) {
    assert(false, `Duplicate card ID in draft: ${id}`, `line ${i + 1}`);
  }

  let modeCol, contextCol, optionsCol, deltaCol, toastCol;
  if (isMilestone) {
    modeCol = cols[2];
    contextCol = cols[3];
    optionsCol = cols[4];
    deltaCol = cols[5];
    toastCol = cols[5];
  } else {
    modeCol = cols[1];
    contextCol = cols[2];
    optionsCol = cols[3];
    deltaCol = cols[4];
    toastCol = cols[4];
  }

  cardMap.set(id, {
    lineNo: i + 1,
    id,
    isMilestone,
    isShort,
    isCross: isCrossMode || isCrossAttr || isCrossEgg,
    modeCol,
    contextCol,
    optionsCol,
    deltaCol,
    toastCol
  });
}

assert(cardMap.size === 213, 'Draft card count === 213', `found=${cardMap.size}`);

// Verify breakdown
let milestoneCount = 0;
let shortCount = 0;
let crossCount = 0;

for (const [id, c] of cardMap.entries()) {
  if (c.isMilestone) milestoneCount++;
  else if (c.isShort) shortCount++;
  else if (c.isCross) crossCount++;
}

assert(milestoneCount === 63, 'Milestone cards === 63', `actual=${milestoneCount}`);
assert(shortCount === 120, 'Short cards === 120', `actual=${shortCount}`);
assert(crossCount === 30, 'Cross-chapter cards === 30', `actual=${crossCount}`);

// 3. Word Gate Check on Markdown Text
let bodyViolations = 0;
let optViolations = 0;
let deltaViolations = 0;

for (const [id, c] of cardMap.entries()) {
  const bodyLenA = countModeA(c.contextCol);
  const bodyLenB = countModeB(c.contextCol);
  if (bodyLenA > 140 || bodyLenB > 140) {
    bodyViolations++;
  }

  // Options check
  const optMatches = c.optionsCol.split(/<br\s*\/?>/i);
  for (const optStr of optMatches) {
    const optClean = optStr.replace(/\*\*[A-B]\.\*\*/g, '').replace(/^[AB]\./g, '').trim();
    if (optClean.length > 0) {
      const optA = countModeA(optClean);
      const optB = countModeB(optClean);
      if (optA > 22 || optB > 22) {
        optViolations++;
      }
    }
  }

  // Delta check
  const deltaA = countModeA(c.deltaCol);
  const deltaB = countModeB(c.deltaCol);
  if (deltaA > 60 || deltaB > 60) {
    deltaViolations++;
  }
}

assert(bodyViolations === 0, 'Card body word gate (<= 140 chars) 0 violations', `violations=${bodyViolations}`);
assert(optViolations === 0, 'Card option word gate (<= 22 chars) 0 violations', `violations=${optViolations}`);
assert(deltaViolations === 0, 'Card delta word gate (<= 60 chars) 0 violations', `violations=${deltaViolations}`);

// 4. Scan 50 Endings in Markdown (M01-M12, D01-D26, H01-H12)
const endingMap = new Map();

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith('|')) continue;

  const cols = line.split('|').slice(1, -1).map(c => c.trim());
  if (cols.length < 5) continue;

  const endMatch = cols[0].match(/^\*\*(M\d{2}|D\d{2}|H\d{2})\*\*$/);
  if (!endMatch) continue;

  const endId = endMatch[1];
  const prefix = endId[0];

  if (!endingMap.has(endId)) {
    endingMap.set(endId, {
      lineNo: i + 1,
      id: endId,
      tier: prefix === 'M' ? 'main' : prefix === 'D' ? 'death' : 'hidden',
      name: cols[1]
    });
  }
}

assert(endingMap.size === 50, 'Draft ending count === 50', `found=${endingMap.size}`);

const mEndings = [...endingMap.values()].filter(e => e.tier === 'main');
const dEndings = [...endingMap.values()].filter(e => e.tier === 'death');
const hEndings = [...endingMap.values()].filter(e => e.tier === 'hidden');

assert(mEndings.length === 12, 'Commercial main endings (M01-M12) === 12', `actual=${mEndings.length}`);
assert(dEndings.length === 26, 'Death / knockout endings (D01-D26) === 26', `actual=${dEndings.length}`);
assert(hEndings.length === 12, 'Hidden / easter egg endings (H01-H12) === 12', `actual=${hEndings.length}`);

// 5. Forbidden Keywords Scan (AI flavors / banned words)
const forbiddenRegex = /(作为一名AI|作为一个人工智能|请注意，本回答|根据相关法律法规无法显示)/g;
const forbiddenMatches = draftRaw.match(forbiddenRegex);
assert(!forbiddenMatches || forbiddenMatches.length === 0, 'Forbidden keyword regex 0 hits', `hits=${forbiddenMatches?.length || 0}`);

console.log('--------------------------------------------------------------------------------');
assertions.forEach((a, idx) => {
  console.log(`[PASS] ${idx + 1}. ${a.name}: ${a.detail}`);
});
console.log('--------------------------------------------------------------------------------');
console.log(`Result: All ${assertions.length} assertions PASSED in test_cards.mjs (Markdown level)\n`);
