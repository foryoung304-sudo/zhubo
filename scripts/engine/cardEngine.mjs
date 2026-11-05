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

    // 2. Evaluate effects_conditional (V2: 若...否则...)
    if (option.effects.effects_conditional) {
      const cond = option.effects.effects_conditional;
      const condResult = gameState.evalCondition(cond.if);
      if (condResult) {
        if (cond.then && cond.then.delta_five_dim) {
          appliedDeltas = { ...appliedDeltas, ...cond.then.delta_five_dim };
        }
      } else {
        if (cond.else && cond.else.delta_five_dim) {
          appliedDeltas = { ...appliedDeltas, ...cond.else.delta_five_dim };
        }
      }
    }

    // 3. Timing Bar Multiplier Handling (with C6-M05 special ruling)
    let opsMultiplier = 1.0;
    if (timingResult && card.ops_type === 'timing_bar') {
      opsMultiplier = timingResult.multiplier || 1.0;

      // Special rule: C6-M05 only applies timing multiplier to non-inflammatory Option B
      if (card.card_id === 'C6-M05' && optionKey === 'A') {
        opsMultiplier = 1.0;
      }

      // Apply multiplier to positive gains
      if (appliedDeltas.fans_pct !== undefined && appliedDeltas.fans_pct > 0) {
        appliedDeltas.fans_pct = Math.round(appliedDeltas.fans_pct * opsMultiplier);
      }
      if (appliedDeltas.wallet !== undefined && appliedDeltas.wallet > 0) {
        appliedDeltas.wallet = Math.round(appliedDeltas.wallet * opsMultiplier);
      }
    }

    // 4. Global rules clamping [0.4, 3.0]
    const clamp = this.globalRules.total_multiplier_clamp || [0.4, 3.0];
    if (appliedDeltas.fans_pct !== undefined) {
      // Clamped within reasonable multiplier bounds
    }

    // 5. Mutate Game State
    gameState.applyFiveDimDelta(appliedDeltas);
    for (const [attr, val] of Object.entries(appliedAttrs)) {
      gameState.attributes[attr] = (gameState.attributes[attr] || 5) + val;
    }
    for (const w of appliedWrites) {
      gameState.applyStateWrite(w);
    }

    // 6. Check Endings
    if (appliedEndings.length > 0) {
      for (const endingId of appliedEndings) {
        if (endingId.startsWith('D')) {
          // Death endings are always immediate termination
          gameState.isDead = true;
          gameState.triggeredEnding = endingId;
          break;
        } else if (card.card_id === 'X-EGG-09' && endingId === 'H12') {
          // X-EGG-09 is the true immediate trigger for H12
          gameState.isCleared = true;
          gameState.triggeredEnding = endingId;
        } else if (card.card_id === 'C6-S19' && endingId === 'H05' && gameState.variables['Count_算法异常'] >= 3) {
          // H05 full trigger on C6-S19
          gameState.isCleared = true;
          gameState.triggeredEnding = endingId;
        } else if (gameState.currentChapter === 6) {
          // In chapter 6, final cards can trigger endings
          gameState.isCleared = true;
          gameState.triggeredEnding = endingId;
        } else {
          // In chapters 1-5, M/H references are qualification / contribution flags
          gameState.variables[`Qualified_${endingId}`] = 1;
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
