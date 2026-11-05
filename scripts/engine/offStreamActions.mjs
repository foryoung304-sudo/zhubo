export class OffStreamActions {
  constructor(config) {
    this.actions = config.schedules.off_stream_actions;
  }

  executeAction(actionId, gameState, extraChoice = null) {
    const act = this.actions.find(a => a.id === actionId);
    if (!act) throw new Error(`Action ${actionId} not found`);

    const result = {
      actionId,
      name: act.name,
      stat_deltas: { ...act.stat_deltas },
      state_writes: [...(act.state_writes || [])]
    };

    // Apply stat deltas
    gameState.applyFiveDimDelta(act.stat_deltas);

    // Apply state writes
    for (const w of act.state_writes) {
      gameState.applyStateWrite(w);
    }

    // Handle specific action logic
    if (actionId === 2) {
      // 专心练功: select one attribute +1
      const targetAttr = extraChoice || '才艺';
      gameState.attributes[targetAttr] = (gameState.attributes[targetAttr] || 5) + 1;
      result.attr_boosted = targetAttr;
    } else if (actionId === 6) {
      // 看回放复盘: every 2 counts +1 mindset
      const count = gameState.variables['Count_复盘留档'] || 0;
      if (count > 0 && count % 2 === 0) {
        gameState.attributes['心态'] = (gameState.attributes['心态'] || 5) + 1;
        result.mindset_boost = true;
      }
    } else if (actionId === 7) {
      // 约会: if in secret period, triggers Count_偷拍素材 += 1
      if (gameState.variables['Flag_榜一恋爱'] === 1 || extraChoice === 'secret_period') {
        gameState.applyStateWrite('Count_偷拍素材 += 1');
        result.paparazzi_triggered = true;
      }
    }

    return result;
  }
}
