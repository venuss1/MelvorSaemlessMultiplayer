// Action reservation / "who is training what" bookkeeping.
//
// Each player claims a skill (and optionally a specific recipe) so the two
// players don't accidentally train the same thing at the same time. The lock
// is advisory: the mod surfaces conflicts in the UI rather than hard-blocking,
// because some skills (e.g. combat) can reasonably be shared.

import { Msg } from '../net/protocol.mjs';

export class ActionLock {
  constructor(transport) {
    this.transport = transport;
    /** @type {{skillId:string, recipeId:string|null, label:string}|null} */
    this.local = null;
    /** @type {{skillId:string, recipeId:string|null, label:string}|null} */
    this.remote = null;
    this._onChange = null;
  }

  setOnChange(cb) { this._onChange = cb; }

  _notify() { if (this._onChange) this._onChange(); }

  /** Claim a skill locally and announce it to the peer. */
  claimLocal(skillId, recipeId = null, label = '') {
    this.local = { skillId, recipeId, label };
    this.transport.send({ t: Msg.ACTION_CLAIM, skillId, recipeId, label });
    this._notify();
  }

  releaseLocal() {
    if (!this.local) return;
    const skillId = this.local.skillId;
    this.local = null;
    this.transport.send({ t: Msg.ACTION_RELEASE, skillId });
    this._notify();
  }

  /** Apply a claim message received from the peer. */
  applyRemoteClaim(msg) {
    this.remote = { skillId: msg.skillId, recipeId: msg.recipeId ?? null, label: msg.label ?? '' };
    this._notify();
  }

  applyRemoteRelease(msg) {
    if (this.remote && this.remote.skillId === msg.skillId) {
      this.remote = null;
      this._notify();
    }
  }

  /** True if both players are on the same recipe (same resource). */
  isConflict() {
    if (!this.local || !this.remote) return false;
    // Same skill AND same recipe = conflict (same resource).
    if (this.local.skillId === this.remote.skillId) {
      // If both have a recipeId, conflict only if same recipe.
      if (this.local.recipeId && this.remote.recipeId) {
        return this.local.recipeId === this.remote.recipeId;
      }
      // If neither has a recipeId (e.g. combat), conflict on same skill.
      if (!this.local.recipeId && !this.remote.recipeId) return true;
      // If one has recipe and other doesn't, no conflict.
      return false;
    }
    return false;
  }

  /** True if the remote player is using the given recipe. */
  isRecipeClaimed(skillId, recipeId) {
    if (!this.remote) return false;
    if (this.remote.skillId !== skillId) return false;
    // Both must have recipe IDs for a conflict. If either is missing,
    // we can't confirm it's the same resource, so don't block.
    if (!recipeId || !this.remote.recipeId) return false;
    return this.remote.recipeId === recipeId;
  }

  reset() {
    this.local = null;
    this.remote = null;
    this._notify();
  }
}
