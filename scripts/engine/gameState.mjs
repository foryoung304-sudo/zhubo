import fs from 'fs';
import path from 'path';

export class GameState {
  constructor(config, stateDict, endingsAndTalents) {
    this.config = config;
    this.stateDict = stateDict;
    this.endingsAndTalents = endingsAndTalents;

    this.reset();
  }

  reset() {
    // 1. Initial 9 Attributes (base 45 points allocation)
    this.attributes = {
      '颜值': 5,
      '嗓音': 5,
      '才艺': 5,
      '游戏技术': 5,
      '口才': 5,
      '情商': 5,
      '体力': 5,
      '心态': 5,
      '运气': 5
    };
    this.adBonusPointsUsed = 0; // max 4 times, +3 each, max 12
    this.singleAttrAdBonus = {}; // single attr max 3 ad bonus, max 8 after ad

    // 2. Initial Five Dimensions
    const fiveCfg = this.config.five_dimensions;
    this.fiveDim = {
      fans: fiveCfg.Fans.initial || 0,
      heat: fiveCfg.Heat.initial || 100,
      wallet: fiveCfg.Wallet.initial || 2000,
      rep: fiveCfg.Rep.initial || 60,
      stamina: fiveCfg.Stamina.initial || 80
    };
    this.haterPct = 0;

    // 3. Fan Composition (6 segments §2.7)
    // Y1.①: 默认粉丝构成必须中性（大哥 15% 对应 R_粉丝构成 = 1.0，杜绝每局钱包先天 -10%）
    this.fanComposition = {
      '颜粉': 20,
      '声控粉': 15,
      '技术粉': 20,
      '乐子人': 15,
      '大哥': 15,
      '学生粉': 15
    };

    // 4. Global State Variables (37 keys from state_dictionary.json)
    this.variables = {};
    for (const v of this.stateDict.variables) {
      this.variables[v.key] = v.initial_value !== undefined ? v.initial_value : 0;
    }

    // 5. Game Progression
    this.currentChapter = 1;
    this.currentCardIndex = 0; // 0 to 4 in chapter
    this.currentCardsQueue = [];
    this.selectedSchedule = {
      mode: '电台',
      timeSlot: 'slot_prime',
      duration: 4
    };
    this.actionPoints = 1;

    // 6. Ending and Run Status
    this.isDead = false;
    this.triggeredEnding = null;
    this.isCleared = false;
    this.clearedMainEndings = [];
    this.equippedTalents = [];

    // 7. Ad placeholders usage
    this.adUsage = {
      creationPoints: 0, // max 4
      reviveOrRepick: 0, // max 1 per run
      fanAngleUnlock: 0,
      settlementDouble: 0 // max 2 per run
    };

    // 8. Snapshot for Rollback
    this.snapshotBeforeCard = null;

    // 9. Temporary buffs and multipliers
    this.playerGender = '女'; // '男' or '女'
    this.fanTilt = {}; // Ambiguity A: { segmentName: +5 }
    this.fanRetentionBuff = 0; // Ambiguity A: 10% fan loss reduction
    this.currentCardMultiplier = 1.0;
    this.nextModeMultBonus = 0; // §2.8C 下播练功增益 +0.15
    this.nextModeMultBonusMode = null;
    this.cardHistory = [];
  }

  // Allocate attribute points
  allocateAttribute(attrName, delta, isAdBonus = false) {
    if (!this.attributes[attrName]) return false;
    if (isAdBonus) {
      if (this.adBonusPointsUsed >= 4) return false;
      const curBonus = this.singleAttrAdBonus[attrName] || 0;
      if (curBonus + 3 > 3) return false;
      if (this.attributes[attrName] + 3 > 8) return false;
      this.attributes[attrName] += 3;
      this.singleAttrAdBonus[attrName] = curBonus + 3;
      this.adBonusPointsUsed++;
      return true;
    } else {
      const curVal = this.attributes[attrName];
      const newVal = curVal + delta;
      if (newVal < 1 || newVal > 10) return false;
      this.attributes[attrName] = newVal;
      return true;
    }
  }

  // Take Full Card Snapshot (Snapshot_BeforeCard)
  takeCardSnapshot(card) {
    const varsCopy = {};
    for (const k of Object.keys(this.variables)) {
      varsCopy[k] = this.variables[k];
    }
    const attrsCopy = { ...this.attributes };
    const fiveDimCopy = { ...this.fiveDim };
    const fanCompCopy = { ...this.fanComposition };

    this.snapshotBeforeCard = {
      cardId: card ? card.card_id : null,
      chapter: this.currentChapter,
      cardIndex: this.currentCardIndex,
      fiveDim: fiveDimCopy,
      haterPct: this.haterPct,
      attributes: attrsCopy,
      fanComposition: fanCompCopy,
      fanTilt: { ...this.fanTilt },
      fanRetentionBuff: this.fanRetentionBuff,
      variables: varsCopy,
      timestamp: Date.now()
    };
    return this.snapshotBeforeCard;
  }

  // Rollback to Snapshot_BeforeCard (Revive / Repick)
  rollbackCardSnapshot() {
    if (!this.snapshotBeforeCard) {
      throw new Error('No snapshot available for rollback!');
    }
    const snap = this.snapshotBeforeCard;

    // Restore five dimensions
    this.fiveDim = { ...snap.fiveDim };
    this.haterPct = snap.haterPct;

    // Restore attributes
    this.attributes = { ...snap.attributes };

    // Restore fan composition and buffs
    this.fanComposition = { ...snap.fanComposition };
    this.fanTilt = { ...(snap.fanTilt || {}) };
    this.fanRetentionBuff = snap.fanRetentionBuff || 0;

    // Restore 100% of all state variables (ZERO dirty residue!)
    this.variables = {};
    for (const k of Object.keys(snap.variables)) {
      this.variables[k] = snap.variables[k];
    }

    // Reset death state
    this.isDead = false;
    this.triggeredEnding = null;
    this.currentCardIndex = snap.cardIndex;
    this.adUsage.reviveOrRepick++;

    return true;
  }

  // Apply state write expression e.g. "Flag_安保习惯 = 1", "Count_复盘留档 += 1", "Tag_人设 = 真实"
  applyStateWrite(writeExpr) {
    if (!writeExpr) return;
    const m = writeExpr.match(/`?((?:Flag_|Count_|Tag_|Param_|Total_)[A-Za-z0-9_\u4e00-\u9fa5]+)`?\s*([=+=]+)\s*(.*)/);
    if (!m) return;
    const key = m[1];
    const op = m[2];
    const rawVal = m[3].trim().replace(/^['"]|['"]$/g, '');

    if (op === '+=') {
      const num = Number(rawVal) || 1;
      this.variables[key] = (this.variables[key] || 0) + num;
    } else if (op === '=') {
      if (rawVal === '0' || rawVal === '1') {
        this.variables[key] = Number(rawVal);
      } else {
        this.variables[key] = isNaN(Number(rawVal)) ? rawVal : Number(rawVal);
      }
    }
  }

  // Evaluate simple expression e.g. "Count_复盘留档 >= 2", "Flag_审过合同 == 1", "嗓音 >= 7"
  evalCondition(expr) {
    if (!expr || expr === 'null') return true;

    // Check variables first
    for (const [k, v] of Object.entries(this.variables)) {
      if (expr.includes(k)) {
        if (typeof v === 'string') {
          expr = expr.replaceAll(k, `'${v}'`);
        } else {
          expr = expr.replaceAll(k, String(v));
        }
      }
    }

    // Check attributes
    for (const [k, v] of Object.entries(this.attributes)) {
      if (expr.includes(k)) {
        expr = expr.replaceAll(k, String(v));
      }
    }

    // Check five dimensions
    expr = expr.replaceAll('口碑', String(this.fiveDim.rep));
    expr = expr.replaceAll('状态', String(this.fiveDim.stamina));
    expr = expr.replaceAll('热度', String(this.fiveDim.heat));
    expr = expr.replaceAll('钱包', String(this.fiveDim.wallet));
    expr = expr.replaceAll('粉丝', String(this.fiveDim.fans));
    expr = expr.replaceAll('chapter', String(this.currentChapter));

    // Support has_encountered helper
    expr = expr.replace(/has_encountered\('([^']+)'\)/g, (_, cid) => {
      return String(this.cardHistory.includes(cid));
    });

    try {
      // Safe boolean eval for simple comparisons
      return Boolean(Function(`"use strict"; return (${expr});`)());
    } catch (e) {
      return false;
    }
  }

  // Apply Five Dim delta
  applyFiveDimDelta(delta) {
    if (!delta) return;

    if (delta.fans !== undefined) this.fiveDim.fans += delta.fans;
    if (delta.fans_pct !== undefined) {
      const pctDelta = Math.round(this.fiveDim.fans * (delta.fans_pct / 100));
      this.fiveDim.fans += pctDelta;
    }
    if (this.fiveDim.fans < 0) this.fiveDim.fans = 0;

    if (delta.heat !== undefined) this.fiveDim.heat += delta.heat;
    if (delta.heat_pct !== undefined) {
      const pctDelta = Math.round(this.fiveDim.heat * (delta.heat_pct / 100));
      this.fiveDim.heat += pctDelta;
    }
    if (delta.heat_target !== undefined) this.fiveDim.heat = delta.heat_target;
    if (this.fiveDim.heat < 0) this.fiveDim.heat = 0;
    if (this.fiveDim.heat > 10000) this.fiveDim.heat = 10000;

    if (delta.wallet !== undefined) this.fiveDim.wallet += delta.wallet;
    if (delta.wallet_pct !== undefined) {
      const pctDelta = Math.round(this.fiveDim.wallet * (delta.wallet_pct / 100));
      this.fiveDim.wallet += pctDelta;
    }
    if (this.fiveDim.wallet < 0) this.fiveDim.wallet = 0;

    if (delta.rep !== undefined) this.fiveDim.rep += delta.rep;
    if (delta.rep_target !== undefined) this.fiveDim.rep = delta.rep_target;
    if (this.fiveDim.rep < -100) this.fiveDim.rep = -100;
    if (this.fiveDim.rep > 100) this.fiveDim.rep = 100;

    if (delta.stamina !== undefined) this.fiveDim.stamina += delta.stamina;
    if (this.fiveDim.stamina < 0) this.fiveDim.stamina = 0;
    if (this.fiveDim.stamina > 100) this.fiveDim.stamina = 100;

    if (delta.hater_pct !== undefined) this.haterPct += delta.hater_pct;

    // Check death conditions
    this.checkFiveDimDeath();
  }

  checkFiveDimDeath() {
    if (this.fiveDim.stamina <= 0 && !this.isDead) {
      this.isDead = true;
      this.triggeredEnding = 'D01'; // 状态归零猝死
    } else if (this.fiveDim.wallet <= 0 && this.currentChapter >= 2 && !this.isDead) {
      this.isDead = true;
      this.triggeredEnding = 'D02'; // 现金流断裂破产
    } else if (this.fiveDim.rep <= -20 && !this.isDead) {
      this.isDead = true;
      this.triggeredEnding = 'D03'; // 口碑崩盘万人声讨
    } else if (this.fiveDim.heat <= 0 && this.currentChapter >= 2 && !this.isDead) {
      this.isDead = true;
      this.triggeredEnding = 'D04'; // 热度归零查无此人
    }
  }
}
