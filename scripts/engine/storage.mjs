import fs from 'fs';
import path from 'path';

export class GameStorage {
  constructor(saveFilePath = 'zhubo_save.json') {
    this.saveFilePath = saveFilePath;
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.saveFilePath)) {
        const raw = fs.readFileSync(this.saveFilePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {}

    return {
      unlocked_endings: [],
      unlocked_talents: [],
      runs_total: 0,
      cleared_runs: 0,
      last_updated: null
    };
  }

  save() {
    try {
      this.data.last_updated = new Date().toISOString();
      fs.writeFileSync(this.saveFilePath, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch (e) {
      return false;
    }
  }

  unlockEnding(endingId) {
    if (!endingId) return false;
    if (!this.data.unlocked_endings.includes(endingId)) {
      this.data.unlocked_endings.push(endingId);
      // Automatically unlock corresponding talent
      if (!this.data.unlocked_talents.includes(endingId)) {
        this.data.unlocked_talents.push(endingId);
      }
      this.save();
      return true;
    }
    return false;
  }

  recordRun(cleared = false) {
    this.data.runs_total = (this.data.runs_total || 0) + 1;
    if (cleared) {
      this.data.cleared_runs = (this.data.cleared_runs || 0) + 1;
    }
    this.save();
  }

  getCompletionRate() {
    const total = 50;
    const unlocked = this.data.unlocked_endings.length;
    return {
      unlocked,
      total,
      pct: Math.round((unlocked / total) * 100)
    };
  }
}
