// State synchronisation: the core of the multiplayer experience.
//
// Model
// -----
// Both clients run independent copies of the *same save*. Each client only
// runs its own locally-chosen action. Whenever a local action changes game
// state (XP, mastery, bank, currencies) we broadcast the *absolute* new value
// to the peer. The peer writes that value straight into the relevant internal
// field, bypassing the normal modifier pipeline so progress is never counted
// twice. Both clients therefore converge on identical accumulated state.
//
// Why absolute values instead of deltas?
//   - Idempotent: a dropped/duplicated message still converges.
//   - No drift: floating point / ordering issues can't accumulate.
//
// Re-entrancy guard
// -----------------
// Applying a remote update calls into game methods (e.g. Bank.addItem) that
// we have patched to broadcast. We set `_applyingRemote` while applying so the
// patches know to stay quiet, preventing feedback loops.

import { logger } from '../util/logger.mjs';
import { Msg } from '../net/protocol.mjs';

export class Sync {
  constructor(ctx, transport, actionLock) {
    this.ctx = ctx;
    this.transport = transport;
    this.actionLock = actionLock;
    this._applyingRemote = false;
    this._patches = [];
    this._watcher = null;
    this._lastActiveSkillId = null;
  }

  /** Install all game patches and start the active-action watcher. */
  install() {
    this._patchXP();
    this._patchMastery();
    this._patchBank();
    this._patchCurrency();
    this._startWatcher();
  }

  uninstall() {
    // ctx patches are tied to the mod lifecycle; we just stop our watcher.
    if (this._watcher) { clearInterval(this._watcher); this._watcher = null; }
  }

  // ---- helpers ----------------------------------------------------------

  _guardBroadcast(fn) {
    if (this._applyingRemote) return;
    if (!this.transport.isConnected) return;
    fn();
  }

  _skillById(id) { return game.skills.getObjectByID(id); }
  _itemById(id) { return game.items.getObjectByID(id); }
  _currencyById(id) {
    return game.currencies.getObjectByID(id);
  }

  // ---- XP / Abyssal XP --------------------------------------------------

  _patchXP() {
    // Broadcast after addXP runs. `this` inside the hook is the skill.
    this.ctx.patch(Skill, 'addXP').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const payload = { t: Msg.XP, skillId: this.id, xp: this.xp };
      if (this.hasAbyssalLevels) payload.abyssalXp = this.abyssalXP;
      sync.transport.send(payload);
    });
    this.ctx.patch(Skill, 'addAbyssalXP').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const payload = { t: Msg.XP, skillId: this.id, xp: this.xp };
      if (this.hasAbyssalLevels) payload.abyssalXp = this.abyssalXP;
      sync.transport.send(payload);
    });
  }

  _applyXP(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill) return;
    this._applyingRemote = true;
    try {
      if (typeof msg.xp === 'number') {
        skill._xp = msg.xp;
        const cap = skill.currentLevelCap || skill.maxLevelCap || Infinity;
        skill._level = Math.min(cap, exp.xpToLevel(msg.xp));
        skill.renderQueue.xp = true;
        skill.renderQueue.level = true;
        skill.renderXP && skill.renderXP();
        skill.renderLevel && skill.renderLevel();
      }
      if (typeof msg.abyssalXp === 'number' && skill.hasAbyssalLevels) {
        skill._abyssalXP = msg.abyssalXp;
        const cap = skill.currentAbyssalLevelCap || skill.maxAbyssalLevelCap || Infinity;
        skill._abyssalLevel = Math.min(cap, abyssalExp.xpToLevel(msg.abyssalXp));
        skill.renderQueue.abyssalXP = true;
        skill.renderQueue.abyssalLevel = true;
        skill.renderAbyssalXP && skill.renderAbyssalXP();
        skill.renderAbyssalLevel && skill.renderAbyssalLevel();
      }
    } finally {
      this._applyingRemote = false;
    }
  }

  // ---- Mastery + mastery pool ------------------------------------------

  _patchMastery() {
    // SkillWithMastery.addMasteryXP(action, xp) -> broadcast action mastery xp.
    this.ctx.patch(SkillWithMastery, 'addMasteryXP').after(function (action /*, xp */) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const am = this.actionMastery.get(action);
      if (!am) return;
      sync.transport.send({
        t: Msg.MASTERY, skillId: this.id, actionId: action.id, xp: am.xp,
      });
    });
    // addMasteryForAction also credits the mastery pool; broadcast pool after.
    this.ctx.patch(SkillWithMastery, 'addMasteryForAction').after(function (/* action, interval */) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      this._masteryPoolXP.forEach((value, realm) => {
        sync.transport.send({
          t: Msg.MASTERY_POOL, skillId: this.id, realmId: realm.id, xp: value,
        });
      });
    });
  }

  _applyMastery(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill || !skill.hasMastery) return;
    const action = skill.actions && skill.actions.getObjectByID(msg.actionId);
    if (!action) return;
    const am = skill.actionMastery.get(action);
    if (!am) return;
    this._applyingRemote = true;
    try {
      am.xp = msg.xp;
      am.level = exp.xpToLevel(msg.xp);
      if (skill.renderQueue && skill.renderQueue.actionMastery) {
        skill.renderQueue.actionMastery.add(action);
      }
      skill.render && skill.render();
    } finally {
      this._applyingRemote = false;
    }
  }

  _applyMasteryPool(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill || !skill.hasMastery) return;
    const realm = game.realms.getObjectByID(msg.realmId);
    if (!realm) return;
    this._applyingRemote = true;
    try {
      skill._masteryPoolXP.set(realm, msg.xp);
      if (skill.renderQueue && skill.renderQueue.masteryPool) {
        skill.renderQueue.masteryPool.add(realm);
      }
      skill.renderMasteryPool && skill.renderMasteryPool();
    } finally {
      this._applyingRemote = false;
    }
  }

  // ---- Bank -------------------------------------------------------------

  _patchBank() {
    this.ctx.patch(Bank, 'addItem').after(function (item /*, ... */) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.BANK, itemId: item.id, qty: this.getQty(item) });
    });
    this.ctx.patch(Bank, 'removeItemQuantity').after(function (item /*, qty, ... */) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.BANK, itemId: item.id, qty: this.getQty(item) });
    });
  }

  _applyBank(msg) {
    const item = this._itemById(msg.itemId);
    if (!item) return;
    const bank = game.bank;
    const current = bank.getQty(item);
    const delta = msg.qty - current;
    if (delta === 0) return;
    this._applyingRemote = true;
    try {
      if (delta > 0) {
        // ignoreSpace=true, logLost=false, found=false, notify=false
        bank.addItem(item, delta, false, false, true, false);
      } else if (delta < 0) {
        bank.removeItemQuantity(item, -delta, false);
      }
      bank.renderQueue && (bank.renderQueue.quantity = true);
      bank.render && bank.render();
    } catch (e) {
      logger.warn('bank apply failed', msg.itemId, e);
    } finally {
      this._applyingRemote = false;
    }
  }

  // ---- Currencies -------------------------------------------------------

  _patchCurrency() {
    const sendCurrency = function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.CURRENCY, currencyId: this.id, qty: this._amount });
    };
    this.ctx.patch(Currency, 'add').after(sendCurrency);
    this.ctx.patch(Currency, 'remove').after(sendCurrency);
    this.ctx.patch(Currency, 'set').after(sendCurrency);
  }

  _applyCurrency(msg) {
    const c = this._currencyById(msg.currencyId);
    if (!c) return;
    this._applyingRemote = true;
    try {
      c._amount = msg.qty;
      c.render && c.render();
    } finally {
      this._applyingRemote = false;
    }
  }

  // ---- Active-action watcher -------------------------------------------

  _startWatcher() {
    this._watcher = setInterval(() => this._watchActiveAction(), 1000);
    this._watchActiveAction();
  }

  _watchActiveAction() {
    if (!this.transport.isConnected) return;
    const active = game.activeAction;
    const skillId = active ? active.id : null;
    if (skillId === this._lastActiveSkillId) return;
    this._lastActiveSkillId = skillId;

    if (!skillId) {
      this.actionLock.releaseLocal();
      return;
    }
    // Try to identify the specific recipe (mastery action) currently selected.
    let recipeId = null;
    try {
      const ma = active.masteryAction;
      if (ma && ma.id) recipeId = ma.id;
    } catch { /* not a mastery skill */ }
    const label = active.name || skillId;
    this.actionLock.claimLocal(skillId, recipeId, label);
  }

  // ---- Full snapshot (peer -> host request, host -> peer snapshot) -----

  requestSnapshot() {
    this.transport.send({ t: Msg.STATE_REQUEST });
  }

  _buildSnapshot() {
    const skills = [];
    for (const skill of game.skills.allObjects) {
      const entry = { id: skill.id, xp: skill.xp };
      if (skill.hasAbyssalLevels) entry.abyssalXp = skill.abyssalXP;
      skills.push(entry);
    }
    const bank = [];
    for (const [item, bi] of game.bank.items) {
      bank.push({ id: item.id, qty: bi.quantity });
    }
    const currencies = [];
    for (const c of game.currencies.allObjects) {
      currencies.push({ id: c.id, qty: c._amount });
    }
    return { t: Msg.STATE_SNAPSHOT, skills, bank, currencies };
  }

  _applySnapshot(msg) {
    this._applyingRemote = true;
    try {
      for (const s of (msg.skills || [])) {
        const skill = this._skillById(s.id);
        if (!skill) continue;
        if (typeof s.xp === 'number') {
          skill._xp = s.xp;
          const cap = skill.currentLevelCap || skill.maxLevelCap || Infinity;
          skill._level = Math.min(cap, exp.xpToLevel(s.xp));
        }
        if (typeof s.abyssalXp === 'number' && skill.hasAbyssalLevels) {
          skill._abyssalXP = s.abyssalXp;
          const cap = skill.currentAbyssalLevelCap || skill.maxAbyssalLevelCap || Infinity;
          skill._abyssalLevel = Math.min(cap, abyssalExp.xpToLevel(s.abyssalXp));
        }
      }
      for (const b of (msg.bank || [])) {
        const item = this._itemById(b.id);
        if (!item) continue;
        const cur = game.bank.getQty(item);
        const delta = b.qty - cur;
        if (delta > 0) game.bank.addItem(item, delta, false, false, true, false);
        else if (delta < 0) game.bank.removeItemQuantity(item, -delta, false);
      }
      for (const c of (msg.currencies || [])) {
        const cur = this._currencyById(c.id);
        if (!cur) continue;
        cur._amount = c.qty;
      }
      // Force a broad re-render.
      for (const skill of game.skills.allObjects) {
        skill.renderQueue && (skill.renderQueue.xp = true, skill.renderQueue.level = true);
        skill.render && skill.render();
      }
      game.bank.renderQueue && (game.bank.renderQueue.quantity = true);
      game.bank.render && game.bank.render();
    } catch (e) {
      logger.error('snapshot apply failed', e);
    } finally {
      this._applyingRemote = false;
    }
  }

  // ---- Message dispatch -------------------------------------------------

  handle(msg) {
    switch (msg.t) {
      case Msg.XP: return this._applyXP(msg);
      case Msg.MASTERY: return this._applyMastery(msg);
      case Msg.MASTERY_POOL: return this._applyMasteryPool(msg);
      case Msg.BANK: return this._applyBank(msg);
      case Msg.CURRENCY: return this._applyCurrency(msg);
      case Msg.STATE_REQUEST: return this.transport.send(this._buildSnapshot());
      case Msg.STATE_SNAPSHOT: return this._applySnapshot(msg);
      default: return;
    }
  }
}

// Singleton reference used by `after` patch hooks (their `this` is the game
// object, not the Sync instance). Set by setup.mjs after construction.
export let sync = null;
export const setSyncInstance = (s) => { sync = s; };
