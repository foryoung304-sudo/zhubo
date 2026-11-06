export class CardEngine {
  constructor(config, timingBar, sampleInspect) {
    this.config = config;
    this.timingBar = timingBar;
    this.sampleInspect = sampleInspect;
    this.globalRules = config.global_rules || {
      total_multiplier_clamp: [0.4, 3.0]
    };
  }

  // Check if an option is selectable (req_expr gating)
  isOptionSelectable(option, gameState) {
    if (!option.req_expr) return true;
    return gameState.evalCondition(option.req_expr);
  }

  // Execute an option selection
  selectOption(card, optionKey, gameState, timingResult = null) {
    const option = card.options.find(o => o.opt_key === optionKey);
    if (!option) throw new Error(`Option ${optionKey} not found on card ${card.card_id}`);

    // Verify selectable gate
    if (!this.isOptionSelectable(option, gameState)) {
      throw new Error(`Option ${optionKey} is locked by req_expr: ${option.req_expr}`);
    }

    // Capture snapshot for rollback right before mutating state
    gameState.takeCardSnapshot(card);

    let checkPassed = true;
    let appliedDeltas = { ...option.effects.delta_five_dim };
    let appliedAttrs = { ...option.effects.delta_attrs };
    let appliedWrites = [...(option.effects.state_writes || [])];
    let appliedEndings = [...(option.effects.ending_triggers || [])];

    // 1. Evaluate check_expr (S4: 生死/成败检定)
    if (option.check_expr) {
      checkPassed = gameState.evalCondition(option.check_expr);
      if (!checkPassed) {
        // Failed check: apply check_fail
        if (option.check_fail) {
          if (option.check_fail.delta_five_dim) {
            appliedDeltas = { ...option.check_fail.delta_five_dim };
          }
          if (option.check_fail.ending_triggers) {
            appliedEndings = [...option.check_fail.ending_triggers];
          }
          if (option.check_fail.state_writes) {
            appliedWrites = [...option.check_fail.state_writes];
          }
        }
      } else {
        // Passed check: ensure any check_fail ending triggers are excluded
        if (option.check_fail && Array.isArray(option.check_fail.ending_triggers)) {
          appliedEndings = appliedEndings.filter(e => !option.check_fail.ending_triggers.includes(e));
        }
      }
    }

    // 2. Evaluate effects_conditional (W1: 有 effects_conditional 时以分支为唯一结算源，废除 merge 写法)
    if (option.effects.effects_conditional) {
      const cond = option.effects.effects_conditional;
      const condResult = gameState.evalCondition(cond.if);
      const branch = condResult ? cond.then : cond.else;
      if (branch) {
        appliedDeltas = branch.delta_five_dim ? { ...branch.delta_five_dim } : {};
        if (branch.delta_attrs) appliedAttrs = { ...branch.delta_attrs };
        if (branch.state_writes) appliedWrites = [...branch.state_writes];
        if (branch.ending_triggers) appliedEndings = [...branch.ending_triggers];
      } else {
        appliedDeltas = {};
      }
    }

    // 3. Multiplier Handling (X2.①: 经营乘区五段 + Ops 乘区 + 整活乘区)
    // 3a. M_模式 ∈ [0.8, 1.5]
    const scheduledMode = gameState.selectedSchedule?.mode || gameState.schedule?.mode || '全模式';
    let mMode = 1.0;
    if (card.mode_tags && card.mode_tags.length > 0) {
      if (card.mode_tags.includes(scheduledMode) || card.mode_tags.includes('全模式') || card.mode_tags.some(t => t.includes(scheduledMode))) {
        mMode = 1.0;
      } else {
        mMode = 0.8;
      }
    }
    if (gameState.variables['Flag_签公会'] === 1) {
      mMode += 0.2; // §2.3: 公会推流加成 M_模式 +0.2
    }
    if (gameState.practiceBuff && gameState.practiceBuff.targetChapter === gameState.currentChapter && gameState.practiceBuff.mode === scheduledMode) {
      mMode += gameState.practiceBuff.bonus; // §2.8C & Z2: 下播行动练功加成 +0.15 (仅下一阶段对应模式生效)
    } else if (gameState.nextModeMultBonus && gameState.nextModeMultBonusMode === scheduledMode) {
      mMode += gameState.nextModeMultBonus; // §2.8C: 下播行动练功加成 +0.15
    }
    mMode = Math.max(0.8, Math.min(1.5, mMode));

    // 3b. M_时段 ∈ [0.85, 1.4]
    const slotId = gameState.selectedSchedule?.timeSlot || gameState.schedule?.timeSlot;
    const timeSlots = this.config.schedules?.time_slots || [];
    const slot = timeSlots.find(s => s.id === slotId);
    let mSlot = (slot && slot.fans_mult !== undefined) ? slot.fans_mult : 1.0;
    mSlot = Math.max(0.85, Math.min(1.4, mSlot));

    // 3c. M_时长 ∈ [0.8, 1.2]
    const durationHours = gameState.selectedSchedule?.duration || gameState.schedule?.duration;
    const durations = this.config.schedules?.durations || [];
    const durObj = durations.find(d => d.hours === durationHours);
    let mDuration = (durObj && durObj.fans_mult !== undefined) ? durObj.fans_mult : (durationHours === 2 ? 0.8 : (durationHours === 6 ? 1.2 : 1.0));
    mDuration = Math.max(0.8, Math.min(1.2, mDuration));

    // 3d. M_属性 = 1 + 0.05 * (核心属性 - 5) ∈ [0.8, 1.25]
    const coreAttrMap = { '游戏': '游戏技术', '才艺': '才艺', '电台': '嗓音', '团播': '颜值', 'PK': '口才', '带货': '口才', '户外': '体力' };
    const coreAttrName = coreAttrMap[scheduledMode] || '口才';
    const coreAttrVal = gameState.attributes?.[coreAttrName] !== undefined ? gameState.attributes[coreAttrName] : 5;
    let mAttr = 1 + 0.05 * (coreAttrVal - 5);
    mAttr = Math.max(0.8, Math.min(1.25, mAttr));

    // 3e. M_口碑 = 1 + 0.01 * (口碑 - 60) ∈ [0.5, 1.4]
    const repVal = gameState.fiveDim.rep !== undefined ? gameState.fiveDim.rep : 60;
    let mRep = 1 + 0.01 * (repVal - 60);
    mRep = Math.max(0.5, Math.min(1.4, mRep));

    // 经营乘区连乘
    const mBusiness = mMode * mSlot * mDuration * mAttr * mRep;

    // 3f. Ops 乘区
    let opsMultiplier = 1.0;
    if (timingResult && card.ops_type === 'timing_bar') {
      opsMultiplier = timingResult.multiplier || 1.0;
      if (card.card_id === 'C6-M05' && optionKey === 'A') {
        opsMultiplier = 1.0;
      }
    }

    // 3g. 整活流派特殊乘区
    let circusMultiplier = 1.0;
    let circusZeroRevenue = false;
    const isCircus = gameState.variables['Tag_流派'] === '整活' || gameState.variables['Tag_流派'] === '整活擦边';
    if (isCircus) {
      const circusCfg = this.globalRules.circus_style || { multiplier: 2.5, zero_revenue_rate: 0.35 };
      const zeroRate = circusCfg.zero_revenue_rate !== undefined ? circusCfg.zero_revenue_rate : 0.35;
      const roll = (timingResult && timingResult.circusRoll !== undefined) ? timingResult.circusRoll : Math.random();
      if (roll < zeroRate) {
        circusZeroRevenue = true;
      } else {
        circusMultiplier = circusCfg.multiplier || 2.5;
      }
    }

    // 4. 总乘区夹逼 [0.4, 3.0] 归位正本 §2.3 (Y0): 只夹经营乘区连乘，操作和整活在夹后叠加
    const clamp = this.globalRules.total_multiplier_clamp || [0.4, 3.0];
    const mBusinessClamped = Math.max(clamp[0], Math.min(clamp[1], mBusiness));
    let totalMultiplier = mBusinessClamped * opsMultiplier * circusMultiplier;

    // 5. Apply Multipliers, Base Anchors and Single-card Cap (X1, X2, X3)
    const ch = gameState.currentChapter || 1;
    const chCfg = (this.config.chapters && this.config.chapters.find(c => c.chapter === ch)) ||
                  (this.config.mainline_gates && this.config.mainline_gates.find(c => c.chapter === ch)) || {};
    const baseFans = chCfg.Base_Fans !== undefined ? chCfg.Base_Fans : 220;
    const capFans = chCfg.Cap_Fans !== undefined ? chCfg.Cap_Fans : null;
    const baseIncome = chCfg.Base_Income !== undefined ? chCfg.Base_Income : 800;
    const capWallet = chCfg.Cap_Wallet !== undefined ? chCfg.Cap_Wallet : null;
    const chapter5CardFansCap = chCfg.chapter_5card_fans_cap || (capFans ? capFans * 5 : 3000);

    if (circusZeroRevenue) {
      // 35% probability revenue/positive gain is zeroed
      if (appliedDeltas.fans_pct !== undefined && appliedDeltas.fans_pct > 0) {
        delete appliedDeltas.fans_pct;
      }
      if (appliedDeltas.fans !== undefined && appliedDeltas.fans > 0) {
        appliedDeltas.fans = 0;
      }
      if (appliedDeltas.wallet !== undefined && appliedDeltas.wallet > 0) {
        appliedDeltas.wallet = 0;
      }
      if (appliedDeltas.wallet_pct !== undefined && appliedDeltas.wallet_pct > 0) {
        delete appliedDeltas.wallet_pct;
      }
    } else {
      // 5a. Fans 结算 (X1: 锚定 Base_Fans(章) 结算公式 + X2.④: 5卡累计上限)
      if (appliedDeltas.fans_pct !== undefined && appliedDeltas.fans_pct < 0) {
        // 负向掉粉税按实数扣减 (§2.2 注 3)
        const dropFans = Math.floor(gameState.fiveDim.fans * (Math.abs(appliedDeltas.fans_pct) / 100));
        appliedDeltas.fans = -dropFans;
        delete appliedDeltas.fans_pct;
      } else if (appliedDeltas.fans_pct !== undefined || (appliedDeltas.fans !== undefined && appliedDeltas.fans > 0)) {
        // 正向涨粉: min(Cap_Fans(章), ⌊Base_Fans(章) × 总乘区 × (1 + P_卡面%)⌋)
        const cardFansPct = (appliedDeltas.fans_pct !== undefined && appliedDeltas.fans_pct > 0) ? (appliedDeltas.fans_pct / 100) : 0;
        let deltaFans = 0;
        if (appliedDeltas.fans_pct !== undefined) {
          deltaFans = Math.floor(baseFans * totalMultiplier * (1 + cardFansPct));
        } else if (appliedDeltas.fans !== undefined && appliedDeltas.fans > 0) {
          deltaFans = Math.floor(appliedDeltas.fans * totalMultiplier);
        }
        if (capFans !== null && capFans !== undefined) {
          deltaFans = Math.min(deltaFans, capFans);
        }
        // X2.④: chapter_5card_fans_cap 5卡累计上限生效
        const alreadyGained = gameState.chapterFansGained || 0;
        const remainingCap = Math.max(0, chapter5CardFansCap - alreadyGained);
        deltaFans = Math.min(deltaFans, remainingCap);
        gameState.chapterFansGained = alreadyGained + deltaFans;

        appliedDeltas.fans = deltaFans;
        delete appliedDeltas.fans_pct;
      }

      // 5b. 钱包 R 乘区结算 (X2.③ & X3)
      const convRate = (option.conversion_rate_pct !== undefined ? option.conversion_rate_pct : (appliedDeltas.conversion_rate_pct !== undefined ? appliedDeltas.conversion_rate_pct : (option.effects?.conversion_rate_pct !== undefined ? option.effects.conversion_rate_pct : 0)));
      const hasPositiveWallet = (appliedDeltas.wallet !== undefined && appliedDeltas.wallet > 0) ||
                                (appliedDeltas.wallet_pct !== undefined && appliedDeltas.wallet_pct > 0) ||
                                (convRate > 0);
      const hasNegativeWallet = (appliedDeltas.wallet !== undefined && appliedDeltas.wallet < 0);

      if (hasPositiveWallet) {
        // R_模式变现
        let rMode = 1.0;
        if (slot?.id === 'slot_afternoon' && scheduledMode === '带货') {
          rMode = slot.wallet_mult_ecommerce || 1.25;
        } else if (slot?.wallet_mult !== undefined) {
          rMode = slot.wallet_mult;
        }

        // R_粉丝构成 ∈ [0.6, 1.8] (Z1: 正本缺口裁定采用公式 R = clamp(1 + 0.02 * (S - S0), 0.6, 1.8))
        // S = 大哥% + 颜粉% - 技术粉%; S0 = 15 (新局中性基准 15 + 20 - 20)
        const comp = gameState.fanComposition || {};
        const bigSpender = comp['大哥'] !== undefined ? comp['大哥'] : 15;
        const beautyFans = comp['颜粉'] !== undefined ? comp['颜粉'] : 20;
        const techFans = comp['技术粉'] !== undefined ? comp['技术粉'] : 20;
        const S = bigSpender + beautyFans - techFans;
        const S0 = 15;
        let rFanComp = 1.0 + 0.02 * (S - S0);
        rFanComp = Math.max(0.6, Math.min(1.8, rFanComp));

        // R_分成 (野生 0.5 / 公会 0.35)
        let rShare = (gameState.variables['Flag_签公会'] === 1) ? 0.35 : 0.5;

        // R_商务 (口碑 ≥ 80 或 Tag_理性消费清流 → 1.5，两来源取最高不叠加) (Y1.③: 废除死条款 Tag_人设，只读真实键 Tag_理性消费清流)
        let rCommercial = 1.0;
        const isRational = gameState.variables['Tag_理性消费清流'] === 1;
        if (gameState.fiveDim.rep >= 80 || isRational) {
          rCommercial = 1.5;
        }

        // 基准变现收益
        const baseRevenue = baseIncome * rMode * rFanComp * rShare * rCommercial;

        // 卡面收益加成 / 分成
        let cardBonus = 0;
        if (appliedDeltas.wallet !== undefined && appliedDeltas.wallet > 0) {
          cardBonus += appliedDeltas.wallet;
        }
        if (appliedDeltas.wallet_pct !== undefined && appliedDeltas.wallet_pct > 0) {
          cardBonus += Math.floor(gameState.fiveDim.wallet * (appliedDeltas.wallet_pct / 100));
        }

        // X3: conversion_rate_pct 必须被消费 (带货结算等价钱包 +30% 修饰)
        if (convRate > 0) {
          cardBonus += Math.floor((baseRevenue + cardBonus) * (convRate / 100));
        }

        // 正向收入受 ops 乘区与 Cap_Wallet 夹逼 (Y1.②: 整活 ×2.5 退出钱包通道，钱包只吃 ops 乘区)
        let positiveWallet = Math.round((baseRevenue + cardBonus) * opsMultiplier);
        if (capWallet !== null && capWallet !== undefined) {
          positiveWallet = Math.min(positiveWallet, capWallet);
        }

        // 扣除固定/事件开支（按实数扣减）
        let finalWallet = positiveWallet;
        if (hasNegativeWallet) {
          finalWallet = positiveWallet + appliedDeltas.wallet;
        }

        appliedDeltas.wallet = finalWallet;
        delete appliedDeltas.wallet_pct;
        delete appliedDeltas.conversion_rate_pct;
      } else if (hasNegativeWallet) {
        delete appliedDeltas.wallet_pct;
        delete appliedDeltas.conversion_rate_pct;
      }
    }

    if (appliedDeltas.wallet !== undefined && appliedDeltas.wallet > 0) {
      gameState.variables['Total_Income'] = (gameState.variables['Total_Income'] || 0) + appliedDeltas.wallet;
    }

    // 5. Mutate Game State
    gameState.applyFiveDimDelta(appliedDeltas);
    for (const [attr, val] of Object.entries(appliedAttrs)) {
      gameState.attributes[attr] = (gameState.attributes[attr] || 5) + val;
    }
    for (const w of appliedWrites) {
      gameState.applyStateWrite(w);
    }

    // 6. Check Endings (落支语义按卡面顺序首个满足者落)
    if (appliedEndings.length > 0) {
      function isEndingSatisfied(eid, gs, cd, tr) {
        if (eid === 'D20') {
          return gs.variables['Flag_卖惨人设'] === 1;
        }
        if (eid === 'D21') {
          return gs.variables['Flag_造假剧本'] === 1;
        }
        if (eid === 'D15') {
          return (gs.variables['Count_复盘留档'] || 0) < 2;
        }
        if (eid === 'D16') {
          return (gs.variables['Count_偷拍素材'] || 0) >= 3;
        }
        if (eid === 'D19') {
          return gs.variables['Flag_账号协议'] === 0;
        }
        if (eid === 'D09') {
          const roll = (tr && tr.digitalCloneRoll !== undefined) ? tr.digitalCloneRoll : Math.random();
          return roll < 0.5;
        }
        if (eid === 'H03') {
          const roll = (tr && tr.digitalCloneRoll !== undefined) ? tr.digitalCloneRoll : Math.random();
          return roll >= 0.5;
        }
        if (eid === 'H04') {
          return (gs.variables['Count_猫上镜'] || 0) >= 3;
        }
        if (eid === 'H10') {
          return (gs.variables['Count_考编'] || 0) >= 3;
        }
        return true;
      }

      let chosenEnding = null;
      for (const eid of appliedEndings) {
        if (isEndingSatisfied(eid, gameState, card, timingResult)) {
          chosenEnding = eid;
          break;
        }
      }
      if (!chosenEnding) {
        chosenEnding = appliedEndings[0];
      }

      if (chosenEnding.startsWith('D')) {
        // Death endings are always immediate termination
        gameState.isDead = true;
        gameState.triggeredEnding = chosenEnding;
      } else if (card.card_id === 'X-EGG-09' && chosenEnding === 'H12') {
        // X-EGG-09 is the true immediate trigger for H12
        gameState.isCleared = true;
        gameState.triggeredEnding = chosenEnding;
        gameState.variables[`Qualified_${chosenEnding}`] = 1;
      } else if (card.card_id === 'X-EGG-04' && chosenEnding === 'H01') {
        // X-EGG-04 Option A is the direct trigger for H01
        gameState.isCleared = true;
        gameState.triggeredEnding = chosenEnding;
        gameState.variables[`Qualified_${chosenEnding}`] = 1;
      } else if (chosenEnding === 'H04' && (gameState.variables['Count_猫上镜'] || 0) >= 3) {
        gameState.isCleared = true;
        gameState.triggeredEnding = chosenEnding;
        gameState.variables[`Qualified_${chosenEnding}`] = 1;
      } else if (chosenEnding === 'H10' && (gameState.variables['Count_考编'] || 0) >= 3) {
        gameState.isCleared = true;
        gameState.triggeredEnding = chosenEnding;
        gameState.variables[`Qualified_${chosenEnding}`] = 1;
      } else if (card.card_id === 'C6-S19' && chosenEnding === 'H05' && (gameState.variables['Count_算法异常'] || 0) >= 3) {
        // H05 full trigger on C6-S19
        gameState.isCleared = true;
        gameState.triggeredEnding = chosenEnding;
        gameState.variables[`Qualified_${chosenEnding}`] = 1;
      } else if (card.card_id === 'C6-M06' && chosenEnding === 'H03') {
        gameState.isCleared = true;
        gameState.triggeredEnding = chosenEnding;
        gameState.variables[`Qualified_${chosenEnding}`] = 1;
      } else if (gameState.currentChapter === 6 && card.card_id !== 'C6-M09') {
        // In chapter 6, final cards can trigger endings (C6-M09 is pre-condition anchor)
        gameState.isCleared = true;
        gameState.triggeredEnding = chosenEnding;
        gameState.variables[`Qualified_${chosenEnding}`] = 1;
      } else {
        // In chapters 1-5 (and C6-M09), M/H references are qualification / contribution flags
        for (const eid of appliedEndings) {
          if (!eid.startsWith('D')) {
            gameState.variables[`Qualified_${eid}`] = 1;
          }
        }
      }
    }

    return {
      checkPassed,
      appliedDeltas,
      appliedWrites,
      appliedEndings,
      isDead: gameState.isDead,
      triggeredEnding: gameState.triggeredEnding
    };
  }
}

// Gender Double-Writing Rendering Rule (Ruling 6 / Stage-2 UI)
export function renderGenderText(text, playerGender = '女', isNpcDialogue = false) {
  if (!text) return '';
  if (isNpcDialogue) {
    if (playerGender === '男') {
      return text.replace(/他\/她/g, '他')
                 .replace(/她\/他/g, '他')
                 .replace(/男\/女/g, '男')
                 .replace(/女\/男/g, '男')
                 .replace(/小帅\/小美/g, '小帅')
                 .replace(/小美\/小帅/g, '小帅')
                 .replace(/小哥哥\/小姐姐/g, '小哥哥')
                 .replace(/小姐姐\/小哥哥/g, '小哥哥');
    } else {
      return text.replace(/他\/她/g, '她')
                 .replace(/她\/他/g, '她')
                 .replace(/男\/女/g, '女')
                 .replace(/女\/男/g, '女')
                 .replace(/小帅\/小美/g, '小美')
                 .replace(/小美\/小帅/g, '小美')
                 .replace(/小哥哥\/小姐姐/g, '小姐姐')
                 .replace(/小姐姐\/小哥哥/g, '小姐姐');
    }
  } else {
    // Narration / Context / Settlement: Neutralize
    return text.replace(/他\/她/g, 'TA')
               .replace(/她\/他/g, 'TA')
               .replace(/男\/女/g, '')
               .replace(/女\/男/g, '')
               .replace(/小帅\/小美/g, '主播')
               .replace(/小美\/小帅/g, '主播');
  }
}
