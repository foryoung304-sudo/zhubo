export class DrawEngine {
  constructor(cardsData, configData) {
    this.cards = cardsData;
    this.config = configData;
    this.drawRules = configData.draw_rules;
  }

  // Draw 5 cards for the chapter
  drawChapterCards(chapter, gameState) {
    const drawnIds = new Set(gameState.cardHistory);
    const chosenMode = gameState.selectedSchedule.mode;
    const stamina = gameState.fiveDim.stamina;

    // 1. Identify guaranteed candidates
    const guaranteedPool = [];

    // 1a. Check Pity Chains
    for (const chain of this.drawRules.pity_chains) {
      if (chain.chain_id === 'pity_cat') {
        const c1Drawn = drawnIds.has('C1-S01');
        if (chapter === 2 && c1Drawn && !drawnIds.has('C2-S01')) guaranteedPool.push('C2-S01');
        if (chapter === 3 && drawnIds.has('C2-S01') && !drawnIds.has('C3-S01')) guaranteedPool.push('C3-S01');
      } else if (chain.chain_id === 'pity_exam') {
        const c1Drawn = drawnIds.has('C1-S07') && gameState.variables['Count_考编'] >= 1;
        if (chapter === 2 && c1Drawn && !drawnIds.has('C2-S17')) guaranteedPool.push('C2-S17');
        if (chapter === 4 && drawnIds.has('C2-S17') && !drawnIds.has('C4-S16')) guaranteedPool.push('C4-S16');
      } else if (chain.chain_id === 'pity_algorithm') {
        const luck10 = gameState.attributes['运气'] === 10;
        if (luck10) {
          if (chapter === 4 && !drawnIds.has('C4-S19')) guaranteedPool.push('C4-S19');
          if (chapter === 5 && !drawnIds.has('C5-S19')) guaranteedPool.push('C5-S19');
          if (chapter === 6 && !drawnIds.has('C6-S19')) guaranteedPool.push('C6-S19');
        }
      } else if (chain.chain_id === 'pity_hater') {
        if (gameState.variables['Count_黑粉不对线'] >= 3 && gameState.attributes['情商'] >= 7) {
          if (!drawnIds.has('X-EGG-04')) guaranteedPool.push('X-EGG-04');
        }
      }
    }

    // 1b. Check Trigger Upgrade cards
    for (const trig of this.drawRules.trigger_upgrade) {
      const cardId = trig.card_id;
      if (!drawnIds.has(cardId)) {
        const cardObj = this.cards.find(c => c.card_id === cardId);
        if (cardObj && cardObj.entry_chapter_min <= chapter && cardObj.entry_chapter_max >= chapter) {
          if (gameState.evalCondition(cardObj.prereq_expr)) {
            guaranteedPool.push(cardId);
          }
        }
      }
    }

    // 1c. Milestone cards of this chapter
    const chapterMilestones = this.cards.filter(c =>
      c.chapter === chapter &&
      c.pool_type === 'milestone' &&
      !drawnIds.has(c.card_id) &&
      gameState.evalCondition(c.prereq_expr)
    );

    // Pick guaranteed cards (at most 4)
    const selectedGuaranteed = [];
    for (const gId of guaranteedPool) {
      if (selectedGuaranteed.length < 4 && !selectedGuaranteed.includes(gId)) {
        const c = this.cards.find(x => x.card_id === gId);
        if (c) selectedGuaranteed.push(c);
      }
    }

    // Ensure milestone representation
    for (const m of chapterMilestones) {
      if (selectedGuaranteed.length < 2) {
        if (!selectedGuaranteed.some(c => c.card_id === m.card_id)) {
          selectedGuaranteed.push(m);
        }
      }
    }

    const guaranteedSlotsCount = Math.min(4, Math.max(2, selectedGuaranteed.length));
    const randomSlotsCount = 5 - selectedGuaranteed.length;

    // 2. Random Pool (Short cards & Cross-chapter cards)
    const eligibleRandomCards = this.cards.filter(c => {
      if (c.pool_type === 'milestone') return false;
      if (drawnIds.has(c.card_id)) return false;
      if (selectedGuaranteed.some(sc => sc.card_id === c.card_id)) return false;
      if (c.chapter && c.chapter !== chapter && !c.pool_type.startsWith('cross_')) return false;
      if (c.entry_chapter_min && c.entry_chapter_min > chapter) return false;
      if (c.entry_chapter_max && c.entry_chapter_max < chapter) return false;
      return gameState.evalCondition(c.prereq_expr);
    });

    // Calculate weights
    const weightedPool = [];
    const isAlertZone = stamina >= 1 && stamina <= 29;

    for (const c of eligibleRandomCards) {
      let weight = 1.0;

      // Mode matching (contains membership!)
      const matchesMode = c.mode_tags.some(t => {
        if (t === '全模式') return true;
        if (t === chosenMode) return true;
        if (this.config.mode_vocabulary?.tag_aliases?.[t] === chosenMode) return true;
        return false;
      });

      if (c.gate_type === 'dual_boost') {
        weight = matchesMode ? 2.0 : 0.5;
      } else if (c.gate_type === 'soft') {
        weight = matchesMode ? 3.0 : 0.5;
      } else {
        weight = matchesMode ? 1.5 : 1.0;
      }

      // X-ATTR first met weight 4.0
      if (c.pool_type === 'cross_attr') {
        weight = 4.0;
      }

      // Alert zone 40% bias to crash cards
      if (isAlertZone && (c.card_id === 'C3-S18' || c.card_id === 'X-EGG-01')) {
        weight *= 5.0;
      }

      weightedPool.push({ card: c, weight });
    }

    // Pick remaining random cards
    const selectedRandom = [];
    while (selectedRandom.length < randomSlotsCount && weightedPool.length > 0) {
      const totalWeight = weightedPool.reduce((acc, x) => acc + x.weight, 0);
      let r = Math.random() * totalWeight;
      let chosenIdx = 0;
      for (let i = 0; i < weightedPool.length; i++) {
        r -= weightedPool[i].weight;
        if (r <= 0) {
          chosenIdx = i;
          break;
        }
      }
      selectedRandom.push(weightedPool[chosenIdx].card);
      weightedPool.splice(chosenIdx, 1);
    }

    const finalQueue = [...selectedGuaranteed, ...selectedRandom];
    // Mark as drawn in history
    finalQueue.forEach(c => gameState.cardHistory.push(c.card_id));

    return finalQueue;
  }
}
