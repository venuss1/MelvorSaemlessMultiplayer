// realMultiplayer — single-file entry point.
//
// Everything is inlined here because Melvor's mod loader does not resolve
// static `import` paths between mod resource files. The manifest loads this
// one module and the CSS; no other JS files are needed at runtime.

// ============================================================================
// LOGGER — logs to console AND an in-memory ring buffer for export.
// ============================================================================
const TAG = '%c[realMP]';
const STYLE = 'color:#34d399;font-weight:bold';
const _logBuf = [];
const _logMax = 2000;

const _safeStr = (v) => {
  try {
    if (v instanceof Error) return v.stack || String(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  } catch { return String(v); }
};

const log = (level, ...args) => {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${args.map(_safeStr).join(' ')}`;
  _logBuf.push(line);
  if (_logBuf.length > _logMax) _logBuf.shift();
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](TAG, STYLE, ...args);
};

const logger = {
  debug: (...a) => log('debug', ...a),
  info: (...a) => log('info', ...a),
  warn: (...a) => log('warn', ...a),
  error: (...a) => log('error', ...a),
};

const exportLog = () => _logBuf.join('\n');

// Auto-save log to localStorage so it persists across game crashes/reloads
const _saveLogToStorage = () => {
  try {
    const text = _logBuf.join('\n');
    localStorage.setItem('realMP_log', text);
    localStorage.setItem('realMP_log_ts', new Date().toISOString());
  } catch { /* storage full or unavailable */ }
};
// Save every 5 seconds and on page unload
setInterval(_saveLogToStorage, 5000);
window.addEventListener('beforeunload', _saveLogToStorage);

// ============================================================================
// PROTOCOL
// ============================================================================
const Msg = Object.freeze({
  HELLO: 'hello', WELCOME: 'welcome', PING: 'ping', PONG: 'pong',
  ACTION_CLAIM: 'claim', ACTION_RELEASE: 'release',
  ACTION_START: 'action_start', ACTION_STOP: 'action_stop',
  XP: 'xp', MASTERY: 'mastery', MASTERY_POOL: 'pool',
  BANK: 'bank', CURRENCY: 'currency',
  EQUIPMENT: 'equip', PET: 'pet', ITEM_CHARGE: 'charge', POTION: 'potion',
  SHOP: 'shop',
  TUTORIAL: 'tutorial',
  ROCK_HP: 'rock_hp',
  FARMING: 'farming',
  AGILITY: 'agility',
  ASTROLOGY: 'astrology',
  SUMMONING: 'summoning',
  SLAYER: 'slayer',
  SKILL_SELECT: 'skill_select',
  PLAYER_STATE: 'player_state',
  COMBAT_AREA: 'combat_area',
  ANCIENT_RELIC: 'ancient_relic',
  SKILL_TREE: 'skill_tree',
  TOWNSHIP: 'township',
  CLUE_HUNT: 'clue_hunt',
  CORRUPTION: 'corruption',
  RAID: 'raid',
  FISHING_CONTEST: 'fish_contest',
  TOWNSHIP_TASKS: 'township_tasks',
  CARTOGRAPHY: 'cartography',
  STATS: 'stats',
  COMBAT_EVENT: 'combat_event',
  COMBAT_CLAIM: 'combat_claim',     // { monsterId, areaId } — I'm fighting this
  COMBAT_RELEASE: 'combat_release', // {} — I stopped fighting
  STATE_REQUEST: 'state_req', STATE_SNAPSHOT: 'state_snap',
  SAVE_SYNC: 'save_sync',
  UNLOCK_ALL: 'unlock_all',
});
const encode = (msg) => JSON.stringify(msg);
const decode = (data) => {
  try {
    const msg = typeof data === 'string' ? JSON.parse(data) : data;
    if (!msg || typeof msg.t !== 'string') return null;
    return msg;
  } catch { return null; }
};

// ============================================================================
// TRANSPORT (WebSocket relay — no WebRTC, no NAT issues)
// ============================================================================
// Both players connect to the same WebSocket relay server. The server pairs
// them and relays messages. This works through any firewall that allows
// HTTPS (which is essentially all of them).

const DEFAULT_SERVER = 'wss://northwest-remarks-dial-univ.trycloudflare.com';

class Transport {
  constructor() {
    this.ws = null;
    this._listeners = new Map();
    this._myRole = null;
    this._myName = '';
    this._peerName = '';
    this._pingTimer = null;
    this._lastPong = 0;
    this._connected = false;
    this._paired = false;
  }
  on(evt, cb) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(cb);
  }
  _emit(evt, ...args) {
    const cbs = this._listeners.get(evt);
    if (cbs) for (const cb of cbs) {
      try { cb(...args); } catch (e) { logger.error('listener error', evt, e); }
    }
  }
  get isConnected() { return this._paired; }
  get myId() { return this._myRole || ''; }
  get role() { return this._myRole; }
  get myName() { return this._myName; }
  get peerName() { return this._peerName; }
  get isWaiting() { return this._connected && !this._paired; }

  /** Connect to the relay server. Both host and peer use this. */
  async connect(serverUrl, name = 'Player') {
    logger.info('connect() called, server =', serverUrl, 'name =', name);
    this._myName = name;
    this._serverUrl = serverUrl;
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(serverUrl);
      } catch (e) {
        logger.error('WebSocket constructor failed:', e);
        reject(e);
        return;
      }
      this.ws = ws;

      // Connection timeout
      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          logger.error('WebSocket connection timeout (10s). Server may be down or URL wrong.');
          reject(new Error('Connection timeout — check the server URL.'));
          try { ws.close(); } catch { /* noop */ }
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(timeout);
        logger.info('WebSocket connected to relay server');
        this._connected = true;
        // Send our name so the server/peer knows who we are.
        this._rawSend({ t: Msg.HELLO, name: this._myName });
        resolve();
      };

      ws.onmessage = (event) => {
        logger.debug('recv data:', event.data);
        const msg = decode(event.data);
        if (!msg) { logger.warn('recv: failed to decode message'); return; }
        logger.debug('recv msg:', msg.t, msg);

        // Server control messages
        if (msg.t === 'waiting') {
          logger.info('Server says: waiting for the other player...');
          this._myRole = 'host';
          this._emit('waiting');
          return;
        }
        if (msg.t === 'paired') {
          this._myRole = msg.role || this._myRole || 'peer';
          this._paired = true;
          logger.info('Paired! Role =', this._myRole);
          this._startPing();
          this._emit('open');
          // Host automatically sends its save to the peer.
          if (this._myRole === 'host') {
            this._emit('send_save');
          }
          return;
        }
        if (msg.t === 'peer_left') {
          logger.info('Other player disconnected');
          this._paired = false;
          this._peerName = '';
          this._stopPing();
          this._emit('close');
          return;
        }
        if (msg.t === 'error' && msg.msg) {
          logger.error('Server error:', msg.msg);
          this._emit('error', new Error(msg.msg));
          return;
        }

        // Peer messages (relayed by server)
        if (msg.t === Msg.SAVE_SYNC) {
          logger.info('Received save sync from host (' + (msg.save?.length || 0) + ' chars)');
          this._emit('save_sync', msg.save);
          return;
        }
        if (msg.t === Msg.HELLO) {
          this._peerName = msg.name || 'Player';
          logger.info('Got HELLO from', this._peerName, '— sending WELCOME');
          this._rawSend({ t: Msg.WELCOME, name: this._myName, role: this._myRole });
          return;
        }
        if (msg.t === Msg.WELCOME) {
          this._peerName = msg.name || 'Player';
          logger.info('Got WELCOME from', this._peerName);
          return;
        }
        if (msg.t === Msg.PING) { this._rawSend({ t: Msg.PONG, ts: msg.ts }); return; }
        if (msg.t === Msg.PONG) { this._lastPong = Date.now(); return; }

        // Game state messages
        this._emit('message', msg);
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        logger.error('WebSocket error:', err);
        this._emit('error', new Error('WebSocket error — check server URL and network.'));
        if (!this._connected) reject(new Error('WebSocket connection failed'));
      };

      ws.onclose = (event) => {
        clearTimeout(timeout);
        logger.info('WebSocket closed, code =', event.code, 'reason =', event.reason);
        const wasPaired = this._paired;
        this._connected = false;
        this._paired = false;
        this._stopPing();
        if (wasPaired) this._emit('close');
      };
    });
  }

  _rawSend(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('_rawSend: WebSocket not open');
      return false;
    }
    try {
      const encoded = encode(msg);
      this.ws.send(encoded);
      logger.debug('sent msg:', msg.t, '(' + encoded.length + ' bytes)');
      return true;
    } catch (e) { logger.error('send failed:', e); return false; }
  }

  send(msg) {
    if (!this._paired) {
      logger.warn('send() called but not paired, msg.t =', msg.t);
      return false;
    }
    return this._rawSend(msg);
  }

  _startPing() {
    this._stopPing();
    this._lastPong = Date.now();
    this._pingTimer = setInterval(() => {
      if (!this._paired) return;
      this._rawSend({ t: Msg.PING, ts: Date.now() });
      if (Date.now() - this._lastPong > 30000) {
        logger.warn('Ping timeout, connection may be dead');
      }
    }, 10000);
  }
  _stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }
  get latencyMs() { return this._lastPong ? Date.now() - this._lastPong : -1; }
  close() {
    this._stopPing();
    try { this.ws && this.ws.close(); } catch { /* noop */ }
    this.ws = null;
    this._connected = false;
    this._paired = false;
    this._emit('close');
  }
}

// ============================================================================
// ACTION LOCK
// ============================================================================
class ActionLock {
  constructor(transport) {
    this.transport = transport;
    this.local = null;
    this.remote = null;
    this._onChange = null;
  }
  setOnChange(cb) { this._onChange = cb; }
  _notify() { if (this._onChange) this._onChange(); }
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
  isConflict() {
    if (!this.local || !this.remote) return false;
    if (this.local.skillId === this.remote.skillId) {
      if (this.local.recipeId && this.remote.recipeId) {
        return this.local.recipeId === this.remote.recipeId;
      }
      if (!this.local.recipeId && !this.remote.recipeId) return true;
      return false;
    }
    return false;
  }
  isRecipeClaimed(skillId, recipeId) {
    if (!this.remote) return false;
    if (this.remote.skillId !== skillId) return false;
    if (!recipeId || !this.remote.recipeId) return false;
    return this.remote.recipeId === recipeId;
  }
  reset() { this.local = null; this.remote = null; this._notify(); }
}

// ============================================================================
// SYNC — real-time state synchronisation for all game systems
// ============================================================================
let sync = null;

class Sync {
  constructor(ctx, transport, actionLock) {
    this.ctx = ctx;
    this.transport = transport;
    this.actionLock = actionLock;
    this._applyingRemote = false;
    this._combatOwner = null;  // 'me' = I'm attacking, 'peer' = peer is attacking, null = no one
    this._combatWasPaused = false;  // remember pause state before we forced pause
    this._watcher = null;
    this._lastActiveSkillId = null;
    this._saveTimer = null;
    this._progressTimer = null;
    this._installed = false;
    this._remoteAction = null; // { skillId, progress, actionLabel }
    this._onRemoteActionCb = null;
    this._onLocalActionCb = null;
    this._coopBoost = false;
    this._coopBoostRecipeId = null;
  }

  onRemoteAction(cb) { this._onRemoteActionCb = cb; }
  onLocalAction(cb) { this._onLocalActionCb = cb; }

  install() {
    if (this._installed) { logger.info('Sync already installed, skipping'); return; }
    this._installed = true;
    logger.info('========== [MP] INSTALLING SYNC PATCHES ==========');
    const patches = [
      ['XP', () => this._patchXP()],
      ['Mastery', () => this._patchMastery()],
      ['Bank', () => this._patchBank()],
      ['Currency', () => this._patchCurrency()],
      ['Equipment+PlayerState', () => this._patchEquipment()],
      ['Pets', () => this._patchPets()],
      ['ItemCharges', () => this._patchItemCharges()],
      ['Potions', () => this._patchPotions()],
      ['Shop', () => this._patchShop()],
      ['ActionStartStop', () => this._patchActionStartStop()],
      ['MiningRockHP', () => this._patchMiningRockHP()],
      ['Farming', () => this._patchFarming()],
      ['Agility', () => this._patchAgility()],
      ['Astrology', () => this._patchAstrology()],
      ['Summoning', () => this._patchSummoning()],
      ['Slayer', () => this._patchSlayer()],
      ['SkillSelections', () => this._patchSkillSelections()],
      ['PlayerState', () => this._patchPlayerState()],
      ['CombatAreas', () => this._patchCombatAreas()],
      ['CombatEvents', () => this._patchCombatEvents()],
      ['AncientRelics', () => this._patchAncientRelics()],
      ['SkillTree', () => this._patchSkillTree()],
      ['Township', () => this._patchTownship()],
      ['ClueHunt', () => this._patchClueHunt()],
      ['Corruption', () => this._patchCorruption()],
      ['Raids', () => this._patchRaids()],
      ['FishingContest', () => this._patchFishingContest()],
      ['TownshipTasks', () => this._patchTownshipTasks()],
      ['Cartography', () => this._patchCartography()],
      ['Stats', () => this._patchStats()],
      ['Tutorial', () => this._patchTutorial()],
    ];
    let ok = 0, fail = 0, skip = 0;
    for (const [name, fn] of patches) {
      try {
        fn();
        // Check if the patch actually did something (some return early if skill missing)
        logger.info(`  [PATCH] ${name}: OK`);
        ok++;
      } catch (e) {
        logger.error(`  [PATCH] ${name}: FAILED —`, e.message);
        fail++;
      }
    }
    this._startWatcher();
    this._startProgressBroadcaster();
    logger.info(`========== [MP] PATCHES DONE: ${ok} ok, ${fail} failed, ${patches.length - ok - fail} skipped ==========`);

    // Log what game systems are actually available
    logger.info('========== [MP] GAME SYSTEM AVAILABILITY ==========');
    const systems = [
      ['game.bank', !!game.bank],
      ['game.combat', !!game.combat],
      ['game.combat.player', !!(game.combat && game.combat.player)],
      ['game.combat.player.food', !!(game.combat && game.combat.player && game.combat.player.food)],
      ['game.combat.player.equipmentSets', !!(game.combat && game.combat.player && game.combat.player.equipmentSets)],
      ['game.combat.player.activePrayers', !!(game.combat && game.combat.player && game.combat.player.activePrayers)],
      ['game.combat.slayerTask', !!(game.combat && game.combat.slayerTask)],
      ['game.currencies', !!game.currencies],
      ['game.petManager', !!game.petManager],
      ['game.itemCharges', !!game.itemCharges],
      ['game.potions', !!game.potions],
      ['game.shop', !!game.shop],
      ['game.mining', !!game.mining],
      ['game.farming', !!game.farming],
      ['game.agility', !!game.agility],
      ['game.astrology', !!game.astrology],
      ['game.summoning', !!game.summoning],
      ['game.slayer', !!game.slayer],
      ['game.cooking', !!game.cooking],
      ['game.woodcutting', !!game.woodcutting],
      ['game.firemaking', !!game.firemaking],
      ['game.fishing', !!game.fishing],
      ['game.fishing.contest', !!(game.fishing && game.fishing.contest)],
      ['game.thieving', !!game.thieving],
      ['game.altMagic', !!game.altMagic],
      ['game.fletching', !!game.fletching],
      ['game.harvesting', !!game.harvesting],
      ['game.archaeology', !!game.archaeology],
      ['game.archaeology.museum', !!(game.archaeology && game.archaeology.museum)],
      ['game.cartography', !!game.cartography],
      ['game.dungeons', !!game.dungeons],
      ['game.ancientRelics', !!game.ancientRelics],
      ['game.township', !!game.township],
      ['game.township.tasks', !!(game.township && game.township.tasks)],
      ['game.township.casualTasks', !!(game.township && game.township.casualTasks)],
      ['game.clueHunt', !!game.clueHunt],
      ['game.corruption', !!game.corruption],
      ['game.corruption.corruptionEffects', !!(game.corruption && game.corruption.corruptionEffects)],
      ['game.golbinRaid', !!game.golbinRaid],
      ['game.stats', !!game.stats],
      ['game.tutorial', !!game.tutorial],
      ['game.realms', !!game.realms],
      ['game.equipmentSlots', !!game.equipmentSlots],
      ['game.prayers', !!game.prayers],
      ['game.attackSpells', !!game.attackSpells],
    ];
    for (const [name, available] of systems) {
      logger.info(`  [SYS] ${name}: ${available ? 'AVAILABLE' : 'MISSING'}`);
    }
    logger.info('========== [MP] SYSTEM CHECK DONE ==========');
  }

  uninstall() {
    if (this._watcher) { clearInterval(this._watcher); this._watcher = null; }
    if (this._saveTimer) { clearInterval(this._saveTimer); this._saveTimer = null; }
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
    if (this._combatStateInterval) { clearInterval(this._combatStateInterval); this._combatStateInterval = null; }
  }

  // Debounced render — batches multiple updates into a single render frame.
  // Instead of re-rendering everything on every message, we queue what needs
  // updating and process it once per animation frame (or after a short delay).
  _renderQueue = null;
  _renderScheduled = false;

  _queueRender(type) {
    if (!this._renderQueue) this._renderQueue = new Set();
    this._renderQueue.add(type);
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      // Use requestAnimationFrame for smooth rendering, fall back to setTimeout.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this._flushRender());
      } else {
        setTimeout(() => this._flushRender(), 16);
      }
    }
  }

  _flushRender() {
    this._renderScheduled = false;
    const q = this._renderQueue;
    this._renderQueue = null;
    if (!q) return;
    try {
      if (q.has('xp') || q.has('mastery')) {
        // Only render the specific skills that changed — not all skills.
        // The game's own render loop will pick up renderQueue flags.
        if (game.renderQueue) game.renderQueue.activeSkills = true;
        if (game.renderActiveSkills) game.renderActiveSkills();
      }
      if (q.has('bank')) {
        if (game.bank) {
          if (game.bank.renderQueue) {
            game.bank.renderQueue.quantity = true;
            game.bank.renderQueue.bankSearch = true;
            game.bank.renderQueue.bankValue = true;
            game.bank.renderQueue.space = true;
          }
          // Call bank.render() to actually update the UI — the game's render
          // loop may not pick up the flag quickly enough for remote updates.
          if (game.bank.render) game.bank.render();
        }
      }
      if (q.has('currency')) {
        if (game.currencies) {
          for (const c of game.currencies.allObjects) {
            if (c.renderAmount) c.renderAmount();
          }
        }
      }
      if (q.has('shop')) {
        if (game.shop && game.shop.renderQueue) {
          game.shop.renderQueue.requirements = true;
          game.shop.renderQueue.upgrades = true;
        }
      }
      // Don't call game.render() — it's very expensive and the game's
      // own tick loop handles rendering. We just set renderQueue flags.
    } catch (e) { logger.warn('flushRender failed', e); }
  }

  // Legacy _forceRender — now just queues everything. Kept for compatibility
  // but should be replaced with targeted _queueRender() calls.
  _forceRender() {
    this._queueRender('xp');
    this._queueRender('bank');
    this._queueRender('currency');
    this._queueRender('shop');
  }

  _scheduleSave() {
    // Debounce saves — don't save on every single message, just every 5 seconds.
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try { if (game && game.scheduleSave) game.scheduleSave(); }
      catch (e) { logger.warn('scheduleSave failed', e); }
    }, 5000);
  }

  _skillById(id) { return game.skills.getObjectByID(id); }
  _itemById(id) { return game.items.getObjectByID(id); }
  _currencyById(id) { return game.currencies.getObjectByID(id); }

  // ---- XP / Abyssal XP --------------------------------------------------

  _patchXP() {
    this.ctx.patch(Skill, 'addXP').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const p = { t: Msg.XP, skillId: this.id, xp: this.xp };
      if (this.hasAbyssalLevels) p.abyssalXp = this.abyssalXP;
      sync.transport.send(p);
    });
    this.ctx.patch(Skill, 'addAbyssalXP').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const p = { t: Msg.XP, skillId: this.id, xp: this.xp };
      if (this.hasAbyssalLevels) p.abyssalXp = this.abyssalXP;
      sync.transport.send(p);
    });
  }

  _applyXP(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill) return;
    this._applyingRemote = true;
    try {
      if (typeof msg.xp === 'number') {
        const deltaXp = msg.xp - skill.xp;
        if (deltaXp > 0) {
          skill.addXP(deltaXp);
        } else if (deltaXp < 0) {
          skill._xp = msg.xp;
          const cap = skill.currentLevelCap || skill.maxLevelCap || Infinity;
          skill._level = Math.min(cap, exp.xpToLevel(msg.xp));
          if (skill.renderQueue) { skill.renderQueue.xp = true; skill.renderQueue.level = true; }
        }
      }
      if (typeof msg.abyssalXp === 'number' && skill.hasAbyssalLevels) {
        const deltaAxp = msg.abyssalXp - skill.abyssalXP;
        if (deltaAxp > 0) {
          skill.addAbyssalXP(deltaAxp);
        } else if (deltaAxp < 0) {
          skill._abyssalXP = msg.abyssalXp;
          const cap = skill.currentAbyssalLevelCap || skill.maxAbyssalLevelCap || Infinity;
          skill._abyssalLevel = Math.min(cap, abyssalExp.xpToLevel(msg.abyssalXp));
          if (skill.renderQueue) { skill.renderQueue.abyssalXP = true; skill.renderQueue.abyssalLevel = true; }
        }
      }
      // Targeted render — only queue XP/mastery, not everything.
      this._queueRender('xp');
    } catch (e) { logger.error('applyXP failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Mastery + mastery pool ------------------------------------------

  _patchMastery() {
    this.ctx.patch(SkillWithMastery, 'addMasteryXP').after(function (_ret, action) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const am = this.actionMastery.get(action);
      if (!am) return;
      sync.transport.send({ t: Msg.MASTERY, skillId: this.id, actionId: action.id, xp: am.xp });
    });
    this.ctx.patch(SkillWithMastery, 'addMasteryForAction').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      this._masteryPoolXP.forEach((value, realm) => {
        sync.transport.send({ t: Msg.MASTERY_POOL, skillId: this.id, realmId: realm.id, xp: value });
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
      // Calculate the delta between current and remote mastery XP.
      const currentXp = am.xp;
      const deltaXp = msg.xp - currentXp;
      if (deltaXp > 0) {
        // Use the game's own addMasteryXP method — it handles level-ups,
        // mastery unlocks, mastery bonuses, and rendering properly.
        skill.addMasteryXP(action, deltaXp);
      } else if (deltaXp < 0) {
        // If remote has less XP (e.g. after save sync), set directly.
        am.xp = msg.xp;
        am.level = exp.xpToLevel(msg.xp);
      }
      // Queue render for the action's mastery display.
      if (skill.renderQueue && skill.renderQueue.actionMastery) skill.renderQueue.actionMastery.add(action);
      this._queueRender('mastery');
    } catch (e) { logger.error('applyMastery failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  _applyMasteryPool(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill || !skill.hasMastery) return;
    const realm = game.realms.getObjectByID(msg.realmId);
    if (!realm) return;
    this._applyingRemote = true;
    try {
      skill._masteryPoolXP.set(realm, msg.xp);
      if (skill.renderQueue && skill.renderQueue.masteryPool) skill.renderQueue.masteryPool.add(realm);
      if (skill.renderMasteryPool) skill.renderMasteryPool();
    } catch (e) { logger.error('applyMasteryPool failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Bank -------------------------------------------------------------

  _patchBank() {
    // Patch all methods that can add or remove items from the bank.
    // Melvor uses several different methods depending on context.
    const sendBankUpdate = function (item) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      if (!item || !item.id) return;
      const qty = this.getQty(item);
      logger.info('Bank sync send:', item.id, 'qty:', qty);
      sync.transport.send({ t: Msg.BANK, itemId: item.id, qty });
    };

    // Adding items
    this.ctx.patch(Bank, 'addItem').after(function (_ret, item) {
      sendBankUpdate.call(this, item);
    });
    this.ctx.patch(Bank, 'addItemByID').after(function (_ret, itemID) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const item = game.items.getObjectByID(itemID);
      sendBankUpdate.call(this, item);
    });

    // Removing items
    this.ctx.patch(Bank, 'removeItemQuantity').after(function (_ret, item) {
      sendBankUpdate.call(this, item);
    });
    this.ctx.patch(Bank, 'removeItemQuantityByID').after(function (_ret, itemID) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const item = game.items.getObjectByID(itemID);
      sendBankUpdate.call(this, item);
    });

    // Selling items
    this.ctx.patch(Bank, 'processItemSale').after(function (_ret, item) {
      sendBankUpdate.call(this, item);
    });

    // Also patch addItemOnLoad for items loaded from save
    logger.info('Bank patches installed: addItem, addItemByID, removeItemQuantity, removeItemQuantityByID, processItemSale');
  }

  _applyBank(msg) {
    const item = this._itemById(msg.itemId);
    if (!item) { logger.warn('bank apply: item not found', msg.itemId); return; }
    const bank = game.bank;
    const current = bank.getQty(item);
    const delta = msg.qty - current;
    if (delta === 0) return;
    logger.info('Bank sync apply:', msg.itemId, 'current:', current, 'target:', msg.qty, 'delta:', delta);
    this._applyingRemote = true;
    try {
      if (delta > 0) bank.addItem(item, delta, false, false, true, false);
      else bank.removeItemQuantity(item, -delta, false);
      this._queueRender('bank');
    } catch (e) { logger.warn('bank apply failed', msg.itemId, e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
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
      // Use set() which fires the amountChanged event and queues renders.
      c.set(msg.qty);
      // Just queue a currency render — set() already handles the event.
      this._queueRender('currency');
    } catch (e) { logger.error('applyCurrency failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Equipment --------------------------------------------------------

  _patchEquipment() {
    // --- Gear / equipment sets ---
    const sendEquip = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const sets = [];
      for (let i = 0; i < game.combat.player.equipmentSets.length; i++) {
        const eq = game.combat.player.equipmentSets[i].equipment;
        const slots = {};
        for (const [slotId, eqItem] of Object.entries(eq.equippedItems)) {
          slots[slotId] = { itemId: eqItem.item.id, qty: eqItem.quantity };
        }
        sets.push(slots);
      }
      sync.transport.send({
        t: Msg.EQUIPMENT, sets,
        selectedSet: game.combat.player.selectedEquipmentSet,
      });
    };
    this.ctx.patch(Player, 'equipItem').after(function () { sendEquip(); });
    this.ctx.patch(Player, 'unequipItem').after(function () { sendEquip(); });
    this.ctx.patch(Player, 'changeEquipmentSet').after(function () { sendEquip(); });

    // --- Food ---
    const sendFood = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const food = [];
      if (game.combat.player.food && game.combat.player.food.slots) {
        for (let i = 0; i < game.combat.player.food.slots.length; i++) {
          const s = game.combat.player.food.slots[i];
          food.push({ slot: i, itemId: s.item ? s.item.id : null, qty: s.quantity });
        }
      }
      sync.transport.send({ t: Msg.PLAYER_STATE, food, selectedFoodSlot: game.combat.player.food.selectedSlot });
    };
    this.ctx.patch(Player, 'equipFood').after(function () { sendFood(); });
    this.ctx.patch(Player, 'unequipFood').after(function () { sendFood(); });
    // Patch EquippedFood class methods (prototype-level, works even if player not ready)
    this.ctx.patch(EquippedFood, 'setSlot').after(function () { sendFood(); });
    this.ctx.patch(EquippedFood, 'unequipSelected').after(function () { sendFood(); });

    // --- Prayers / Curses / Auroras ---
    const sendPrayers = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const prayers = [];
      if (game.combat.player.activePrayers) for (const ap of game.combat.player.activePrayers) prayers.push(ap.prayer.id);
      sync.transport.send({
        t: Msg.PLAYER_STATE, prayers,
        prayerPoints: game.combat.player.prayerPoints,
        soulPoints: game.combat.player.soulPoints,
      });
    };
    this.ctx.patch(Player, 'togglePrayer').after(function () { sendPrayers(); });
    this.ctx.patch(Player, 'toggleCurse').after(function () { sendPrayers(); });
    this.ctx.patch(Player, 'toggleAurora').after(function () { sendPrayers(); });

    // --- Attack spell selection ---
    const sendAttackSpell = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({
        t: Msg.PLAYER_STATE,
        attackSpellId: game.combat.player.selectedAttackSpell ? game.combat.player.selectedAttackSpell.id : null,
      });
    };
    this.ctx.patch(Player, 'selectAttackSpell').after(function () { sendAttackSpell(); });

    // --- Attack styles ---
    const sendAttackStyles = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const styles = [];
      if (game.combat.player && game.combat.player.attackStyles) for (let i = 0; i < game.combat.player.attackStyles.length; i++) {
        styles.push({ set: i, style: game.combat.player.attackStyles[i] });
      }
      sync.transport.send({ t: Msg.PLAYER_STATE, attackStyles });
    };
    // Patch Player class prototype (works even if player instance not ready yet)
    for (const m of ['setAttackStyle', 'changeAttackStyle']) {
      if (Player.prototype && typeof Player.prototype[m] === 'function') {
        this.ctx.patch(Player, m).after(function () { sendAttackStyles(); });
      }
    }

    // --- Prayer/soul points changes (combat) ---
    for (const m of ['spendPrayerPoints', 'addPrayerPoints', 'spendSoulPoints', 'addSoulPoints']) {
      if (Player.prototype && typeof Player.prototype[m] === 'function') {
        this.ctx.patch(Player, m).after(function () { sendPrayers(); });
      }
    }
  }

  _applyEquipment(msg) {
    if (!msg.sets || !game.combat.player) return;
    this._applyingRemote = true;
    try {
      for (let i = 0; i < msg.sets.length; i++) {
        const remoteSlots = msg.sets[i];
        const eqSet = game.combat.player.equipmentSets[i];
        if (!eqSet) continue;
        const eq = eqSet.equipment;
        // Unequip slots that are no longer equipped remotely.
        // unequipItem already returns the item to bank internally
        for (const [slotId, eqItem] of Object.entries(eq.equippedItems)) {
          if (!remoteSlots[slotId]) {
            const slot = game.equipmentSlots.getObjectByID(slotId);
            if (slot) {
              try { eq.unequipItem(slot); } catch (e) { logger.warn(`unequip ${slotId} failed: ${e.message}`); }
            }
          }
        }
        // Equip / update slots to match remote.
        // equipItem already removes the item from bank internally
        for (const [slotId, remote] of Object.entries(remoteSlots)) {
          const local = eq.equippedItems[slotId];
          const item = this._itemById(remote.itemId);
          if (!item) { logger.warn(`equip: item not found: ${remote.itemId}`); continue; }
          const slot = game.equipmentSlots.getObjectByID(slotId);
          if (!slot) { logger.warn(`equip: slot not found: ${slotId}`); continue; }
          if (local && local.item.id === remote.itemId && local.quantity === remote.qty) continue;
          // Unequip current item if any (returns to bank)
          if (local) {
            try { eq.unequipItem(slot); } catch (e) { logger.warn(`unequip before equip ${slotId} failed: ${e.message}`); }
          }
          // Ensure item is in bank (add if missing, since UNLOCK_ALL may have equipped it already)
          if (!game.bank.hasItem(item)) {
            try { game.bank.addItem(item, remote.qty, false, false, true, false); } catch (e) { /* skip */ }
          }
          // Equip — equipItem removes from bank internally
          try {
            eq.equipItem(item, slot, remote.qty);
          } catch (e) {
            logger.warn(`equip ${slotId} with ${remote.itemId} failed: ${e.message}`);
          }
        }
      }
      // Switch to the remote's selected equipment set.
      if (typeof msg.selectedSet === 'number' && msg.selectedSet !== game.combat.player.selectedEquipmentSet) {
        try { game.combat.player.changeEquipmentSet(msg.selectedSet); } catch (e) { /* skip */ }
      }
      // Properly update stats and UI — updateForEquipmentChange does stat recalc + UI update
      try { game.combat.player.updateForEquipmentChange(); } catch (e) { /* skip */ }
      // Render equipment sets menu
      try { game.combat.player.updateForEquipSetChange(); } catch (e) { /* skip */ }
      // Set render queue flags for equipment and bank
      if (game.combat.player.renderQueue) {
        game.combat.player.renderQueue.equipment = true;
        game.combat.player.renderQueue.equipmentSets = true;
      }
      // Force bank to re-render (items moved in/out of bank)
      this._queueRender('bank');
      // Update active skills/minibar
      this._queueRender('xp');
    } catch (e) { logger.error('applyEquipment failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Pets -------------------------------------------------------------

  _patchPets() {
    this.ctx.patch(PetManager, 'unlockPet').after(function (_ret, pet) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.PET, petId: pet.id });
    });
  }

  _applyPet(msg) {
    const pet = game.pets.getObjectByID(msg.petId);
    if (!pet) return;
    this._applyingRemote = true;
    try {
      if (!game.petManager.unlocked.has(pet)) {
        game.petManager.unlocked.add(pet);
        if (game.petManager.computeProvidedStats) game.petManager.computeProvidedStats();
      }
    } catch (e) { logger.error('applyPet failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Item Charges -----------------------------------------------------

  _patchItemCharges() {
    this.ctx.patch(ItemCharges, 'addCharges').after(function (_ret, item) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.ITEM_CHARGE, itemId: item.id, charges: this.getCharges(item) });
    });
    this.ctx.patch(ItemCharges, 'removeCharges').after(function (_ret, item) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.ITEM_CHARGE, itemId: item.id, charges: this.getCharges(item) });
    });
  }

  _applyItemCharge(msg) {
    const item = this._itemById(msg.itemId);
    if (!item) return;
    this._applyingRemote = true;
    try {
      const current = game.itemCharges.getCharges(item);
      const delta = msg.charges - current;
      if (delta > 0) game.itemCharges.addCharges(item, delta);
      else if (delta < 0) game.itemCharges.removeCharges(item, -delta);
      if (game.itemCharges.render) game.itemCharges.render();
    } catch (e) { logger.error('applyItemCharge failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Potions ----------------------------------------------------------

  _patchPotions() {
    this.ctx.patch(PotionManager, 'usePotion').after(function (_ret, item) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const potions = [];
      this.activePotions.forEach((active, action) => {
        potions.push({ actionId: action.id, itemId: active.item.id, charges: active.charges });
      });
      sync.transport.send({ t: Msg.POTION, potions });
    });
    this.ctx.patch(PotionManager, 'removePotion').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const potions = [];
      this.activePotions.forEach((active, action) => {
        potions.push({ actionId: action.id, itemId: active.item.id, charges: active.charges });
      });
      sync.transport.send({ t: Msg.POTION, potions });
    });
  }

  _applyPotion(msg) {
    if (!msg.potions || !game.potions) return;
    this._applyingRemote = true;
    try {
      game.potions.activePotions.forEach((ap, action) => {
        game.potions.removePotion(action, true);
      });
      for (const p of msg.potions) {
        const item = this._itemById(p.itemId);
        const action = game.actions.getObjectByID(p.actionId);
        if (!item || !action) continue;
        game.potions.usePotion(item, true);
      }
      if (game.potions.computeProvidedStats) game.potions.computeProvidedStats();
      if (game.potions.render) game.potions.render();
    } catch (e) { logger.error('applyPotion failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Shop / Upgrades --------------------------------------------------

  _patchShop() {
    // Sync when a shop purchase is made.
    this.ctx.patch(Shop, 'buyItemOnClick').after(function (_ret, purchase) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const upgrades = {};
      for (const [p, count] of this.upgradesPurchased) {
        upgrades[p.id] = count;
      }
      sync.transport.send({ t: Msg.SHOP, upgrades });
    });
  }

  _applyShop(msg) {
    if (!msg.upgrades || !game.shop) return;
    this._applyingRemote = true;
    try {
      for (const [purchaseId, count] of Object.entries(msg.upgrades)) {
        const purchase = game.shop.purchases.getObjectByID(purchaseId);
        if (!purchase) continue;
        const current = game.shop.upgradesPurchased.get(purchase) || 0;
        const delta = count - current;
        if (delta > 0) {
          // Apply the purchase delta without charging currency again.
          game.shop.upgradesPurchased.set(purchase, count);
        }
      }
      if (game.shop.computeProvidedStats) game.shop.computeProvidedStats();
      if (game.shop.renderQueue) {
        game.shop.renderQueue.requirements = true;
        game.shop.renderQueue.costs = true;
        game.shop.renderQueue.upgrades = true;
      }
      if (game.shop.render) game.shop.render();
      this._forceRender();
    } catch (e) { logger.error('applyShop failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Tutorial ---------------------------------------------------------
  // The tutorial has stages with tasks. We sync task progress, stage claims,
  // and stage transitions. We call actual game methods for stage transitions
  // to avoid crashing the render system.

  _patchTutorial() {
    // Broadcast after any task progress update.
    this.ctx.patch(Tutorial, 'updateTaskProgress').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.TUTORIAL, tutorial: sync._buildTutorialState() });
    });
    // Broadcast after stage transitions.
    this.ctx.patch(Tutorial, 'startNextStage').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.TUTORIAL, tutorial: sync._buildTutorialState() });
    });
    this.ctx.patch(Tutorial, 'completeTutorial').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.TUTORIAL, tutorial: sync._buildTutorialState() });
    });
    this.ctx.patch(TutorialStage, 'setClaimed').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.TUTORIAL, tutorial: sync._buildTutorialState() });
    });
    this.ctx.patch(Tutorial, 'skipTutorial').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.TUTORIAL, tutorial: sync._buildTutorialState() });
    });
  }

  _buildTutorialState() {
    const t = game.tutorial;
    if (!t) return null;
    const stages = [];
    for (const stage of t.stages.allObjects) {
      const tasks = [];
      for (const task of stage.tasks) {
        tasks.push({ id: task.id, progress: task.progress });
      }
      stages.push({ id: stage.id, claimed: stage.claimed, tasks });
    }
    return {
      complete: t.complete,
      stagesCompleted: t._stagesCompleted,
      stages,
    };
  }

  _applyTutorial(msg) {
    if (!msg.tutorial || !game.tutorial) return;
    const data = msg.tutorial;
    const t = game.tutorial;
    this._applyingRemote = true;
    try {
      // Handle tutorial completion.
      if (data.complete && !t.complete) {
        try { t.completeTutorial(); } catch (e) { logger.warn('tutorial completeTutorial failed', e); }
        this._applyingRemote = false;
        return;
      }

      // Handle stage transitions: if remote has completed more stages than us,
      // advance through them using the actual game method.
      const remoteStagesCompleted = data.stagesCompleted || 0;
      let safety = 0;
      while (t._stagesCompleted < remoteStagesCompleted && !t.complete && safety < 20) {
        safety++;
        try {
          // Claim the current stage if it's complete but not claimed.
          const current = t.currentStage;
          if (current && current.complete && !current.claimed) {
            current.setClaimed();
          }
          t.startNextStage();
        } catch (e) {
          logger.warn('tutorial startNextStage failed', e);
          break;
        }
      }

      // Sync task progress for all stages (safe — just setting numbers).
      for (const stageData of (data.stages || [])) {
        const stage = t.stages.getObjectByID(stageData.id);
        if (!stage) continue;
        // Sync claimed status.
        if (stageData.claimed && !stage.claimed) {
          stage.claimed = true;
        }
        // Sync task progress.
        for (const taskData of (stageData.tasks || [])) {
          const task = stage.tasks.find(tt => tt.id === taskData.id);
          if (task && typeof taskData.progress === 'number') {
            task.progress = taskData.progress;
          }
        }
      }

      // Queue renders — don't call render() directly to avoid crashes
      // when currentStage is in an intermediate state.
      if (t.renderQueue) {
        t.renderQueue.currentStageTasks = true;
        t.renderQueue.currentStageStatus = true;
      }
      // renderProgress is safe — it just updates the progress counter.
      if (t.renderProgress) {
        try { t.renderProgress(); } catch { /* noop */ }
      }
    } catch (e) { logger.error('applyTutorial failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Action start/stop + progress bar sync ---------------------------
  // When one player starts an action, the other player sees the progress
  // bar moving too. We sync the skill ID and the timer progress.

  // ---- Mining rock HP sync ---------------------------------------------
  // Mining rocks have HP (available ore count) that depletes as you mine.
  // We sync rock HP between players so both see the same available ore count.

  _patchMiningRockHP() {
    // Patch Mining.renderRockHP to broadcast rock HP changes.
    const mining = game.mining;
    if (!mining) return;
    this.ctx.patch(Mining, 'renderRockHP').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendRockHP();
    });
    // Don't patch passiveTick — it fires every game tick (20x/sec) and
    // would flood the network. renderRockHP already fires when rock HP
    // actually changes, which is all we need.
  }

  _sendRockHP() {
    const mining = game.mining;
    if (!mining) return;
    const rocks = [];
    for (const rock of mining.actions.allObjects) {
      if (rock && typeof rock.currentHP === 'number') {
        // Only send if HP changed since last send.
        const key = rock.id;
        const last = this._lastRockHP ? this._lastRockHP[key] : undefined;
        if (last !== undefined && last === rock.currentHP) continue;
        if (!this._lastRockHP) this._lastRockHP = {};
        this._lastRockHP[key] = rock.currentHP;
        rocks.push({ id: rock.id, hp: rock.currentHP, maxHp: rock.maxHP });
      }
    }
    if (rocks.length === 0) return; // Nothing changed — don't send.
    this.transport.send({ t: Msg.ROCK_HP, rocks });
  }

  _applyRockHP(msg) {
    const mining = game.mining;
    if (!mining || !msg.rocks) return;
    // Determine which rock the local player is currently mining so we
    // don't overwrite its HP — the local game manages depletion for the
    // rock being mined. Syncing HP=0 from the remote would stop our action.
    let localRockId = null;
    try {
      if (mining.selectedRock && mining.selectedRock.id) localRockId = mining.selectedRock.id;
      else if (mining.activeProgressRock && mining.activeProgressRock.id) localRockId = mining.activeProgressRock.id;
    } catch { /* noop */ }

    this._applyingRemote = true;
    try {
      let changed = false;
      for (const r of msg.rocks) {
        // Skip the rock the local player is actively mining.
        if (localRockId && r.id === localRockId) continue;
        const rock = mining.actions.getObjectByID(r.id);
        if (!rock) continue;
        if (typeof r.hp === 'number') { rock.currentHP = r.hp; changed = true; }
        if (typeof r.maxHp === 'number') { rock.maxHP = r.maxHp; changed = true; }
      }
      // Only re-render if we actually changed something.
      if (changed) {
        if (mining.renderRockHP) mining.renderRockHP();
        if (mining.renderRockStatus) mining.renderRockStatus();
      }
    } catch (e) { logger.error('applyRockHP failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Farming sync -----------------------------------------------------
  // Syncs plot unlocks, planted seeds, compost, and growth state.

  _patchFarming() {
    const farming = game.farming;
    if (!farming) return;

    // Patch all methods that change plot state.
    const sendPlot = function (plot) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      if (!plot || !plot.id) return;
      sync._sendFarmingPlot(plot);
    };

    // Plot unlock
    this.ctx.patch(Farming, 'unlockPlotOnClick').after(function (_ret, plot) {
      sendPlot(plot);
    });

    // Planting seeds
    this.ctx.patch(Farming, 'plantPlot').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'plantPlotOnClick').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'plantAllPlots').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });
    this.ctx.patch(Farming, 'plantAllOnClick').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });
    this.ctx.patch(Farming, 'plantRecipe').after(function (_ret, recipe, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'plantAllRecipe').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });
    this.ctx.patch(Farming, 'plantAllSelectedOnClick').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });

    // Harvesting
    this.ctx.patch(Farming, 'harvestPlot').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'harvestPlotOnClick').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'harvestAllOnClick').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });

    // Compost
    this.ctx.patch(Farming, 'compostPlot').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'compostAllOnClick').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });

    // Destroy / clear / reset
    this.ctx.patch(Farming, 'destroyPlot').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'destroyPlotOnClick').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'clearDeadPlot').after(function (_ret, plot) {
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'resetPlot').after(function (_ret, plot) {
      sendPlot(plot);
    });

    // Growth tick — send updates when plots grow
    this.ctx.patch(Farming, 'growPlots').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });

    // Selected recipe changes
    this.ctx.patch(Farming, 'setPlantAllSelected').after(function (_ret, plot) {
      sendPlot(plot);
    });
  }

  _sendFarmingPlot(plot) {
    const data = this._serializePlot(plot);
    if (!data) return;
    this.transport.send({ t: Msg.FARMING, plots: [data] });
  }

  _sendAllFarmingPlots() {
    const farming = game.farming;
    if (!farming) return;
    const plots = [];
    for (const plot of farming.plots.allObjects) {
      const data = this._serializePlot(plot);
      if (data) plots.push(data);
    }
    if (plots.length === 0) return;
    this.transport.send({ t: Msg.FARMING, plots });
  }

  _serializePlot(plot) {
    if (!plot || !plot.id) return null;
    return {
      id: plot.id,
      state: plot.state,
      plantedRecipeId: plot.plantedRecipe ? plot.plantedRecipe.id : null,
      compostItemId: plot.compostItem ? plot.compostItem.id : null,
      compostLevel: plot.compostLevel,
      growthTime: plot.growthTime,
      selectedRecipeId: plot.selectedRecipe ? plot.selectedRecipe.id : null,
    };
  }

  _applyFarming(msg) {
    const farming = game.farming;
    if (!farming || !msg.plots) return;
    this._applyingRemote = true;
    try {
      for (const p of msg.plots) {
        const plot = farming.plots.getObjectByID(p.id);
        if (!plot) continue;
        if (typeof p.state === 'number') plot.state = p.state;
        if (p.plantedRecipeId !== undefined) {
          plot.plantedRecipe = p.plantedRecipeId ? game.items.getObjectByID(p.plantedRecipeId) : undefined;
        }
        if (p.compostItemId !== undefined) {
          plot.compostItem = p.compostItemId ? game.items.getObjectByID(p.compostItemId) : undefined;
        }
        if (typeof p.compostLevel === 'number') plot.compostLevel = p.compostLevel;
        if (typeof p.growthTime === 'number') plot.growthTime = p.growthTime;
        if (p.selectedRecipeId !== undefined) {
          plot.selectedRecipe = p.selectedRecipeId ? game.items.getObjectByID(p.selectedRecipeId) : undefined;
        }
      }
      // Re-render farming UI
      if (farming.render) farming.render();
      if (farming.renderGrowthState) farming.renderGrowthState();
      if (farming.renderGrowthStatus) farming.renderGrowthStatus();
      if (farming.renderCompost) farming.renderCompost();
      if (farming.renderSelectedSeed) farming.renderSelectedSeed();
      if (farming.renderPlotVisibility) farming.renderPlotVisibility();
      if (farming.renderPlotUnlockQuantities) farming.renderPlotUnlockQuantities();
    } catch (e) { logger.error('applyFarming failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Agility sync (obstacles, pillars, blueprints) -------------------
  _patchAgility() {
    const ag = game.agility;
    if (!ag) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendAgility();
    };
    // Patch build/destroy methods
    for (const m of ['buildObstacle', 'destroyObstacle', 'buildPillar', 'destroyPillar']) {
      if (typeof ag[m] === 'function') {
        this.ctx.patch(Agility, m).after(() => send());
      }
    }
    // Patch blueprint save/load
    for (const m of ['saveBlueprint', 'loadBlueprint', 'replaceCourseWithBlueprint']) {
      if (typeof ag[m] === 'function') {
        this.ctx.patch(Agility, m).after(() => send());
      }
    }
  }

  _sendAgility() {
    const ag = game.agility;
    if (!ag) return;
    const courses = [];
    for (const [realm, course] of ag.courses) {
      const obstacles = {};
      for (const [tier, ob] of course.builtObstacles) obstacles[tier] = ob ? ob.id : null;
      const pillars = {};
      for (const [tier, pi] of course.builtPillars) pillars[tier] = pi ? pi.id : null;
      courses.push({ realmId: realm.id, obstacles, pillars });
    }
    this.transport.send({ t: Msg.AGILITY, courses, activeObstacle: ag.currentlyActiveObstacle });
  }

  _applyAgility(msg) {
    const ag = game.agility;
    if (!ag || !msg.courses) return;
    this._applyingRemote = true;
    try {
      for (const c of msg.courses) {
        const realm = game.realms.getObjectByID(c.realmId);
        if (!realm) continue;
        const course = ag.courses.get(realm);
        if (!course) continue;
        for (const [tier, obId] of Object.entries(c.obstacles)) {
          const ob = obId ? game.items.getObjectByID(obId) : null;
          if (ob) course.builtObstacles.set(Number(tier), ob);
          else course.builtObstacles.delete(Number(tier));
        }
        for (const [tier, piId] of Object.entries(c.pillars)) {
          const pi = piId ? game.items.getObjectByID(piId) : null;
          if (pi) course.builtPillars.set(Number(tier), pi);
          else course.builtPillars.delete(Number(tier));
        }
      }
      if (typeof msg.activeObstacle === 'number') ag.currentlyActiveObstacle = msg.activeObstacle;
      if (ag.render) ag.render();
      if (ag.renderBuiltObstacles) ag.renderBuiltObstacles();
      if (ag.renderCourseModifiers) ag.renderCourseModifiers();
    } catch (e) { logger.error('applyAgility failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Astrology sync (modifier upgrades) -------------------------------
  _patchAstrology() {
    const as = game.astrology;
    if (!as) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendAstrology();
    };
    for (const m of ['upgradeStandardModifier', 'upgradeUniqueModifier', 'upgradeAbyssalModifier']) {
      if (typeof as[m] === 'function') {
        this.ctx.patch(Astrology, m).after(() => send());
      }
    }
  }

  _sendAstrology() {
    const as = game.astrology;
    if (!as) return;
    const upgrades = [];
    // AstrologyModifier instances have timesBought
    try {
      if (as.standardModifierUpgrades) {
        for (const mod of as.standardModifierUpgrades) {
          if (mod && mod.recipe && mod.recipe.id) upgrades.push({ recipeId: mod.recipe.id, tier: mod.tier, timesBought: mod.timesBought });
        }
      }
    } catch { /* noop */ }
    this.transport.send({ t: Msg.ASTROLOGY, upgrades });
  }

  _applyAstrology(msg) {
    const as = game.astrology;
    if (!as || !msg.upgrades) return;
    this._applyingRemote = true;
    try {
      for (const u of msg.upgrades) {
        const recipe = as.actions.getObjectByID(u.recipeId);
        if (!recipe) continue;
        // Find the modifier upgrade and set timesBought
        try {
          const mod = as.standardModifierUpgrades?.find(m => m.recipe === recipe && m.tier === u.tier);
          if (mod) mod.timesBought = u.timesBought;
        } catch { /* noop */ }
      }
      if (as.render) as.render();
    } catch (e) { logger.error('applyAstrology failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Summoning sync (marks unlocked, selected costs) -----------------
  _patchSummoning() {
    const su = game.summoning;
    if (!su) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendSummoning();
    };
    if (typeof su.discoverMark === 'function') {
      this.ctx.patch(Summoning, 'discoverMark').after(() => send());
    }
    if (typeof su.rollForMark === 'function') {
      this.ctx.patch(Summoning, 'rollForMark').after(() => send());
    }
    if (typeof su.selectNonShardCostOnClick === 'function') {
      this.ctx.patch(Summoning, 'selectNonShardCostOnClick').after(() => send());
    }
  }

  _sendSummoning() {
    const su = game.summoning;
    if (!su) return;
    const marks = [];
    if (su.marksUnlocked) {
      for (const [recipe, count] of su.marksUnlocked) {
        if (recipe && recipe.id) marks.push({ recipeId: recipe.id, count });
      }
    }
    const costs = [];
    if (su.selectedNonShardCosts) {
      for (const [recipe, item] of su.selectedNonShardCosts) {
        if (recipe && recipe.id) costs.push({ recipeId: recipe.id, itemId: item ? item.id : null });
      }
    }
    this.transport.send({ t: Msg.SUMMONING, marks, costs });
  }

  _applySummoning(msg) {
    const su = game.summoning;
    if (!su) return;
    this._applyingRemote = true;
    try {
      if (msg.marks && su.marksUnlocked) {
        for (const m of msg.marks) {
          const recipe = su.actions.getObjectByID(m.recipeId);
          if (!recipe) continue;
          su.marksUnlocked.set(recipe, m.count);
        }
      }
      if (msg.costs && su.selectedNonShardCosts) {
        for (const c of msg.costs) {
          const recipe = su.actions.getObjectByID(c.recipeId);
          if (!recipe) continue;
          const item = c.itemId ? game.items.getObjectByID(c.itemId) : null;
          if (item) su.selectedNonShardCosts.set(recipe, item);
        }
      }
      if (su.render) su.render();
    } catch (e) { logger.error('applySummoning failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Slayer sync (task state) -----------------------------------------
  _patchSlayer() {
    const sl = game.slayer;
    if (!sl || !game.combat.slayerTask) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendSlayer();
    };
    for (const m of ['selectTask', 'extendTask', 'clickNewTask', 'addKill']) {
      if (typeof game.combat.slayerTask[m] === 'function') {
        this.ctx.patch(SlayerTask, m).after(() => send());
      }
    }
  }

  _sendSlayer() {
    const sl = game.slayer;
    if (!sl || !game.combat.slayerTask) return;
    const t = game.combat.slayerTask;
    this.transport.send({
      t: Msg.SLAYER,
      active: t.active,
      monsterId: t.monster ? t.monster.id : null,
      killsLeft: t.killsLeft,
      extended: t.extended,
      realmId: t.realm ? t.realm.id : null,
      categoryId: t.category ? t.category.id : null,
    });
  }

  _applySlayer(msg) {
    const sl = game.slayer;
    if (!sl || !game.combat.slayerTask) return;
    this._applyingRemote = true;
    try {
      const t = game.combat.slayerTask;
      t.active = !!msg.active;
      t.monster = msg.monsterId ? game.monsters.getObjectByID(msg.monsterId) : undefined;
      t.killsLeft = msg.killsLeft || 0;
      t.extended = !!msg.extended;
      if (msg.realmId) t.realm = game.realms.getObjectByID(msg.realmId);
      if (msg.categoryId) t.category = game.combat.slayerTask.categories.getObjectByID(msg.categoryId);
      if (t.render) t.render();
      if (t.renderTask) t.renderTask();
    } catch (e) { logger.error('applySlayer failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Skill selections sync (cooking, woodcutting, firemaking, etc.) ---
  _patchSkillSelections() {
    // Cooking: selected recipes per category
    const cook = game.cooking;
    if (cook) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        const recipes = [];
        if (cook.selectedRecipes) {
          for (const [cat, r] of cook.selectedRecipes) {
            recipes.push({ catId: cat.id, recipeId: r ? r.id : null });
          }
        }
        this.transport.send({ t: Msg.SKILL_SELECT, skillId: 'melvorD:Cooking', recipes });
      };
      for (const m of ['onRecipeSelectionClick', 'onActiveCookButtonClick', 'onPassiveCookButtonClick']) {
        if (typeof Cooking.prototype[m] === 'function') this.ctx.patch(Cooking, m).after(() => send());
      }
    }

    // Woodcutting: active trees
    const wc = game.woodcutting;
    if (wc) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        const trees = [];
        if (wc.activeTrees) for (const t of wc.activeTrees) trees.push(t.id);
        this.transport.send({ t: Msg.SKILL_SELECT, skillId: 'melvorD:Woodcutting', trees });
      };
      if (typeof Woodcutting.prototype.selectTree === 'function') this.ctx.patch(Woodcutting, 'selectTree').after(() => send());
    }

    // Firemaking: selected log, oil, bonfire
    const fm = game.firemaking;
    if (fm) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        this.transport.send({
          t: Msg.SKILL_SELECT, skillId: 'melvorD:Firemaking',
          recipeId: fm.selectedRecipe ? fm.selectedRecipe.id : null,
          oilId: fm.selectedOil ? fm.selectedOil.id : null,
          bonfireId: fm.litBonfireRecipe ? fm.litBonfireRecipe.id : null,
        });
      };
      for (const m of ['selectLog', 'selectOil', 'lightBonfire', 'oilMyLog']) {
        if (typeof Firemaking.prototype[m] === 'function') this.ctx.patch(Firemaking, m).after(() => send());
      }
    }

    // Fishing: selected area fish
    const fish = game.fishing;
    if (fish) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        const sel = [];
        if (fish.selectedAreaFish) {
          for (const [area, f] of fish.selectedAreaFish) {
            sel.push({ areaId: area.id, fishId: f ? f.id : null });
          }
        }
        this.transport.send({ t: Msg.SKILL_SELECT, skillId: 'melvorD:Fishing', areaFish: sel });
      };
      for (const m of ['onAreaStartButtonClick', 'onAreaFishSelection']) {
        if (typeof Fishing.prototype[m] === 'function') this.ctx.patch(Fishing, m).after(() => send());
      }
    }

    // Thieving: selected area/NPC
    const th = game.thieving;
    if (th) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        this.transport.send({
          t: Msg.SKILL_SELECT, skillId: 'melvorD:Thieving',
          areaId: th.currentArea ? th.currentArea.id : null,
          npcId: th.currentNPC ? th.currentNPC.id : null,
        });
      };
      for (const m of ['onAreaHeaderClick', 'onNPCPanelSelection', 'startThieving']) {
        if (typeof Thieving.prototype[m] === 'function') this.ctx.patch(Thieving, m).after(() => send());
      }
    }

    // Alt Magic: selected spell, recipe, item
    const am = game.altMagic;
    if (am) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        this.transport.send({
          t: Msg.SKILL_SELECT, skillId: 'melvorD:AltMagic',
          spellId: am.selectedSpell ? am.selectedSpell.id : null,
          smithingRecipeId: am.selectedSmithingRecipe ? am.selectedSmithingRecipe.id : null,
          conversionItemId: am.selectedConversionItem ? am.selectedConversionItem.id : null,
        });
      };
      for (const m of ['selectSpellOnClick', 'selectItemOnClick', 'selectBarOnClick']) {
        if (typeof AltMagic.prototype[m] === 'function') this.ctx.patch(AltMagic, m).after(() => send());
      }
    }

    // Fletching: alt recipe selection
    const fl = game.fletching;
    if (fl) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        const alts = [];
        if (fl.setAltRecipes) {
          for (const [recipe, idx] of fl.setAltRecipes) {
            alts.push({ recipeId: recipe.id, altIndex: idx });
          }
        }
        this.transport.send({ t: Msg.SKILL_SELECT, skillId: 'melvorD:Fletching', altRecipes: alts });
      };
      if (typeof Fletching.prototype.selectAltRecipeOnClick === 'function') this.ctx.patch(Fletching, 'selectAltRecipeOnClick').after(() => send());
    }

    // Harvesting: selected vein
    const hv = game.harvesting;
    if (hv) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        const veins = [];
        if (hv.actions) for (const v of hv.actions.allObjects) {
          if (typeof v.currentIntensity === 'number') veins.push({ id: v.id, intensity: v.currentIntensity, max: v.maxIntensity });
        }
        this.transport.send({
          t: Msg.SKILL_SELECT, skillId: 'melvorD:Harvesting',
          veinId: hv.selectedVein ? hv.selectedVein.id : null,
          veins,
        });
      };
      if (typeof Harvesting.prototype.onVeinClick === 'function') this.ctx.patch(Harvesting, 'onVeinClick').after(() => send());
    }

    // Archaeology: dig site selection, tools, museum
    const ar = game.archaeology;
    if (ar) {
      const send = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        const digSites = [];
        if (ar.actions) for (const ds of ar.actions.allObjects) {
          digSites.push({
            id: ds.id,
            mapIndex: ds.selectedMapIndex,
            tools: (ds.selectedTools || []).map(t => t ? t.id : null),
          });
        }
        const donated = [];
        if (ar.museum && ar.museum.donatedItems) for (const item of ar.museum.donatedItems) donated.push(item.id);
        this.transport.send({ t: Msg.SKILL_SELECT, skillId: 'melvorD:Archaeology', digSites, donatedItems: donated });
      };
      for (const m of ['setMapAsActive', 'toggleTool', 'setToolAsActive', 'startDigging']) {
        if (typeof Archaeology.prototype[m] === 'function') this.ctx.patch(Archaeology, m).after(() => send());
      }
      if (ar.museum) {
        for (const m of ['donateItem', 'donateAllGenericArtefacts', 'giveReward']) {
          if (typeof ArchaeologyMuseum.prototype[m] === 'function') this.ctx.patch(ArchaeologyMuseum, m).after(() => send());
        }
      }
    }
  }

  _applySkillSelect(msg) {
    this._applyingRemote = true;
    try {
      switch (msg.skillId) {
        case 'melvorD:Cooking': {
          const s = game.cooking;
          if (!s || !msg.recipes) break;
          for (const r of msg.recipes) {
            const cat = s.categories.getObjectByID(r.catId);
            if (!cat) continue;
            const recipe = r.recipeId ? s.actions.getObjectByID(r.recipeId) : null;
            if (recipe) s.selectedRecipes.set(cat, recipe);
          }
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Woodcutting': {
          const s = game.woodcutting;
          if (!s || !msg.trees) break;
          s.activeTrees.clear();
          for (const tid of msg.trees) {
            const tree = s.actions.getObjectByID(tid);
            if (tree) s.activeTrees.add(tree);
          }
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Firemaking': {
          const s = game.firemaking;
          if (!s) break;
          if (msg.recipeId) s.selectedRecipe = s.actions.getObjectByID(msg.recipeId);
          if (msg.oilId) s.selectedOil = game.items.getObjectByID(msg.oilId);
          if (msg.bonfireId) s.litBonfireRecipe = s.actions.getObjectByID(msg.bonfireId);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Fishing': {
          const s = game.fishing;
          if (!s || !msg.areaFish) break;
          for (const af of msg.areaFish) {
            const area = s.actions.getObjectByID(af.areaId) || s.fishingAreas?.getObjectByID(af.areaId);
            if (!area) continue;
            const f = af.fishId ? s.actions.getObjectByID(af.fishId) : null;
            if (f) s.selectedAreaFish.set(area, f);
          }
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Thieving': {
          const s = game.thieving;
          if (!s) break;
          if (msg.areaId) s.currentArea = s.actions.getObjectByID(msg.areaId) || s.areas?.getObjectByID(msg.areaId);
          if (msg.npcId) s.currentNPC = s.actions.getObjectByID(msg.npcId);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:AltMagic': {
          const s = game.altMagic;
          if (!s) break;
          if (msg.spellId) s.selectedSpell = s.actions.getObjectByID(msg.spellId);
          if (msg.smithingRecipeId) s.selectedSmithingRecipe = game.smithing.actions.getObjectByID(msg.smithingRecipeId);
          if (msg.conversionItemId) s.selectedConversionItem = game.items.getObjectByID(msg.conversionItemId);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Fletching': {
          const s = game.fletching;
          if (!s || !msg.altRecipes) break;
          for (const a of msg.altRecipes) {
            const recipe = s.actions.getObjectByID(a.recipeId);
            if (recipe) s.setAltRecipes.set(recipe, a.altIndex);
          }
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Harvesting': {
          const s = game.harvesting;
          if (!s) break;
          if (msg.veinId) s.selectedVein = s.actions.getObjectByID(msg.veinId);
          if (msg.veins) for (const v of msg.veins) {
            const vein = s.actions.getObjectByID(v.id);
            if (vein) { vein.currentIntensity = v.intensity; vein.maxIntensity = v.max; }
          }
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Archaeology': {
          const s = game.archaeology;
          if (!s) break;
          if (msg.digSites) for (const ds of msg.digSites) {
            const digSite = s.actions.getObjectByID(ds.id);
            if (!digSite) continue;
            digSite.selectedMapIndex = ds.mapIndex;
            if (ds.tools) digSite.selectedTools = ds.tools.map(tid => tid ? game.items.getObjectByID(tid) : null).filter(Boolean);
          }
          if (msg.donatedItems && s.museum && s.museum.donatedItems) {
            for (const itemId of msg.donatedItems) {
              const item = game.items.getObjectByID(itemId);
              if (item) s.museum.donatedItems.add(item);
            }
          }
          if (s.render) s.render();
          break;
        }
      }
    } catch (e) { logger.error('applySkillSelect failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Player state sync (prayers, food, attack styles) -----------------
  // Player state patches are now all in _patchEquipment to avoid double-patching.
  _patchPlayerState() { /* no-op — handled by _patchEquipment */ }

  _applyPlayerState(msg) {
    const p = game.combat.player;
    if (!p) return;
    this._applyingRemote = true;
    try {
      // Prayer / soul points
      if (typeof msg.prayerPoints === 'number') p.prayerPoints = msg.prayerPoints;
      if (typeof msg.soulPoints === 'number') p.soulPoints = msg.soulPoints;

      // Active prayers
      if (msg.prayers && p.activePrayers) {
        p.activePrayers.clear();
        for (const pid of msg.prayers) {
          const prayer = game.prayers.getObjectByID(pid);
          if (prayer) {
            try {
              const ap = new ActivePrayer(prayer);
              p.activePrayers.add(ap);
            } catch { /* noop */ }
          }
        }
        if (p.render) p.render();
      }

      // Food slots
      if (msg.food && p.food && p.food.slots) {
        for (const f of msg.food) {
          if (f.slot >= p.food.slots.length) continue;
          if (!f.itemId) {
            // Clear this food slot
            p.food.slots[f.slot] = { item: null, quantity: 0 };
          } else {
            const item = game.items.getObjectByID(f.itemId);
            if (item) p.food.slots[f.slot] = { item, quantity: f.qty };
          }
        }
        if (typeof msg.selectedFoodSlot === 'number') p.food.selectedSlot = msg.selectedFoodSlot;
        if (p.food.render) p.food.render();
      }

      // Attack styles
      if (msg.attackStyles && p.attackStyles) {
        for (const a of msg.attackStyles) {
          if (a.set < p.attackStyles.length) p.attackStyles[a.set] = a.style;
        }
        if (p.render) p.render();
      }

      // Attack spell
      if (msg.attackSpellId !== undefined) {
        if (msg.attackSpellId) {
          const spell = game.attackSpells.getObjectByID(msg.attackSpellId);
          if (spell && p.selectAttackSpell) p.selectAttackSpell(spell, false);
        }
      }

      // Equipment set selection
      if (typeof msg.selectedEquipmentSet === 'number' && msg.selectedEquipmentSet !== p.selectedEquipmentSet) {
        try { p.changeEquipmentSet(msg.selectedEquipmentSet); } catch { /* noop */ }
      }

      // Trigger render queue updates
      if (p.renderQueue) {
        p.renderQueue.prayerPoints = true;
        p.renderQueue.soulPoints = true;
        p.renderQueue.food = true;
        p.renderQueue.equipmentSets = true;
        p.renderQueue.attackSpellSelection = true;
        p.renderQueue.curseSelection = true;
        p.renderQueue.auroraSelection = true;
      }
      if (p.render) p.render();
    } catch (e) { logger.error('applyPlayerState failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Combat area completion sync --------------------------------------
  _patchCombatAreas() {
    const cm = game.combat;
    if (!cm) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendCombatAreas();
    };
    // Patch dungeon/stronghold/abyss completion
    for (const m of ['selectDungeon', 'selectAbyssDepth', 'selectStronghold', 'selectMonster', 'startEvent']) {
      if (typeof CombatManager.prototype[m] === 'function') this.ctx.patch(CombatManager, m).after(() => send());
    }
    // Patch dungeon progress increase (class-level, covers all dungeons)
    if (typeof Dungeon.prototype.increaseDungeonProgress === 'function') {
      this.ctx.patch(Dungeon, 'increaseDungeonProgress').after(() => send());
    }
  }

  _sendCombatAreas() {
    const cm = game.combat;
    if (!cm) return;
    const completions = [];
    if (cm.dungeonCompletion) {
      for (const [d, count] of cm.dungeonCompletion) completions.push({ id: d.id, count });
    }
    this.transport.send({ t: Msg.COMBAT_AREA, completions });
  }

  _applyCombatArea(msg) {
    const cm = game.combat;
    if (!cm || !msg.completions) return;
    this._applyingRemote = true;
    try {
      for (const c of msg.completions) {
        const d = game.dungeons.getObjectByID(c.id);
        if (d && cm.dungeonCompletion) cm.dungeonCompletion.set(d, c.count);
      }
    } catch (e) { logger.error('applyCombatArea failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Combat event sync (damage, healing, monster selection) ------------
  _patchCombatEvents() {
    const cm = game.combat;
    if (!cm) return;
    const sync = this;

    // Throttle: send at most every 100ms to avoid flooding
    let lastSend = 0;
    const sendCombatEvent = (data) => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const now = Date.now();
      if (now - lastSend < 80) return; // throttle ~12 updates/sec
      lastSend = now;
      sync.transport.send({ t: Msg.COMBAT_EVENT, ...data });
    };

    // Send full combat state (monster, HP, paused, player stats) — used for periodic sync
    const sendCombatState = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const cm = game.combat;
      const enemy = cm.enemy;
      const player = cm.player;
      // Gather player combat stats for realistic damage calculation
      let playerStats = null;
      try {
        playerStats = {
          maxHit: player.maxHit || 0,
          minHit: player.minHit || 0,
          attackSpeed: player.attackSpeed || 3000, // ms per attack
          accuracyRating: player.accuracyRating || 0,
          attackType: player.attackType || 'melee',
          selectedAttackStyle: player.attackStyle ? player.attackStyle.id : null,
        };
      } catch (e) { /* skip */ }
      sync.transport.send({
        t: Msg.COMBAT_EVENT,
        kind: 'state',
        paused: cm.paused,
        monsterId: enemy.monster ? enemy.monster.id : null,
        areaId: cm.selectedMonster ? (cm.selectedMonster._area ? cm.selectedMonster._area.id : null) : null,
        enemyHp: enemy.hitpoints,
        enemyMaxHp: enemy.stats ? enemy.stats.maxHitpoints : 0,
        playerHp: player.hitpoints,
        playerMaxHp: player.stats ? player.stats.maxHitpoints : 0,
        playerStats,
      });
    };

    // Patch Enemy.damage — fires after enemy takes damage
    if (typeof Enemy !== 'undefined' && Enemy.prototype && typeof Enemy.prototype.damage === 'function') {
      this.ctx.patch(Enemy, 'damage').after(function (amount, source) {
        if (amount <= 0) return;
        // Only send if we're the attacker (not spectating)
        if (sync._combatOwner === 'peer') return;
        sendCombatEvent({
          kind: 'damage',
          target: 'enemy',
          amount,
          source: typeof source === 'string' ? source : 'Attack',
          monsterId: this.monster ? this.monster.id : null,
          hp: this.hitpoints,
          maxHp: this.stats ? this.stats.maxHitpoints : 0,
        });
      });
    }

    // Patch Player.damage — fires after player takes damage
    if (typeof Player !== 'undefined' && Player.prototype && typeof Player.prototype.damage === 'function') {
      this.ctx.patch(Player, 'damage').after(function (amount, source) {
        if (amount <= 0) return;
        // Only send if we're the attacker (not spectating)
        if (sync._combatOwner === 'peer') return;
        sendCombatEvent({
          kind: 'damage',
          target: 'player',
          amount,
          source: typeof source === 'string' ? source : 'Attack',
          hp: this.hitpoints,
          maxHp: this.stats ? this.stats.maxHitpoints : 0,
        });
      });
    }

    // Patch Character.heal — fires after healing (both player and enemy)
    if (typeof Character !== 'undefined' && Character.prototype && typeof Character.prototype.heal === 'function') {
      this.ctx.patch(Character, 'heal').after(function (amount) {
        if (amount <= 0) return;
        // Only send if we're the attacker (not spectating)
        if (sync._combatOwner === 'peer') return;
        const isEnemy = this === game.combat.enemy;
        sendCombatEvent({
          kind: 'heal',
          target: isEnemy ? 'enemy' : 'player',
          amount,
          hp: this.hitpoints,
          maxHp: this.stats ? this.stats.maxHitpoints : 0,
        });
      });
    }

    // Patch spawnEnemy — sync when a new monster spawns
    if (typeof CombatManager.prototype.spawnEnemy === 'function') {
      this.ctx.patch(CombatManager, 'spawnEnemy').after(() => {
        sendCombatState();
      });
    }

    // Note: When spectating (_combatOwner === 'peer'), the local game still
    // runs combat ticks and attacks. This is fine because:
    // 1. Our damage/heal patches skip sending events (guarded by _combatOwner)
    // 2. The attacker's damage events override our local HP (they send absolute hp)
    // 3. Our local damage doesn't affect the attacker's game
    // The spectator sees both their local damage and the attacker's damage,
    // but the HP bar is always corrected by the attacker's state messages.

    // Patch selectMonster — sync monster selection AND claim combat
    if (typeof CombatManager.prototype.selectMonster === 'function') {
      this.ctx.patch(CombatManager, 'selectMonster').after(function () {
        // Local player selected a monster — claim combat ownership
        if (!sync._applyingRemote) {
          sync._combatOwner = 'me';
          const cm = game.combat;
          const monsterId = cm.enemy.monster ? cm.enemy.monster.id : null;
          const areaId = cm.selectedArea ? cm.selectedArea.id : null;
          sync.transport.send({ t: Msg.COMBAT_CLAIM, monsterId, areaId });
          logger.info(`[COMBAT] Claimed combat: ${monsterId}`);
        }
        sendCombatState();
      });
    }

    // Patch rewardSlayerTaskCurrency — prevent crash when slayer task category
    // is undefined (happens when monster was selected remotely)
    if (typeof CombatManager.prototype.rewardSlayerTaskCurrency === 'function') {
      const orig = CombatManager.prototype.rewardSlayerTaskCurrency;
      CombatManager.prototype.rewardSlayerTaskCurrency = function (category) {
        if (!category || !category.currencyRewards) return; // skip if invalid
        try { return orig.call(this, category); }
        catch (e) { logger.warn(`rewardSlayerTaskCurrency caught: ${e.message}`); }
      };
    }

    // Also patch rewardForEnemyDeath to catch any other death reward crashes
    if (typeof CombatManager.prototype.rewardForEnemyDeath === 'function') {
      const orig2 = CombatManager.prototype.rewardForEnemyDeath;
      CombatManager.prototype.rewardForEnemyDeath = function (monster, area) {
        try { return orig2.call(this, monster, area); }
        catch (e) { logger.warn(`rewardForEnemyDeath caught: ${e.message}`); }
      };
    }

    // Patch loadNextEnemy — prevent crash when area/monster not selected
    if (typeof CombatManager.prototype.loadNextEnemy === 'function') {
      const orig3 = CombatManager.prototype.loadNextEnemy;
      CombatManager.prototype.loadNextEnemy = function () {
        try { return orig3.call(this); }
        catch (e) { logger.warn(`loadNextEnemy caught: ${e.message}`); }
      };
    }

    // Patch CombatManager.tick — skip combat ticks when spectating (peer is attacking)
    // This prevents double-hitting: only the attacker's game runs combat
    if (typeof CombatManager.prototype.tick === 'function') {
      this.ctx.patch(CombatManager, 'tick').before(function () {
        if (sync._combatOwner === 'peer') {
          // Skip this tick entirely — return false to cancel? No, before can't cancel.
          // Instead, we'll set paused=true temporarily so the tick does nothing.
          this._rmpWasPaused = this.paused;
          if (!this.paused) this.paused = true;
        }
      });
      this.ctx.patch(CombatManager, 'tick').after(function () {
        if (sync._combatOwner === 'peer' && this._rmpWasPaused === false) {
          this.paused = false;
          this._rmpWasPaused = undefined;
        }
      });
    }

    // Patch pause/unpause — sync combat pause state and release claim on stop
    for (const m of ['pause', 'stop', 'start']) {
      if (typeof CombatManager.prototype[m] === 'function') {
        try {
          this.ctx.patch(CombatManager, m).after(function () {
            // If local player stops combat, release our claim
            if (m === 'stop' && sync._combatOwner === 'me' && !sync._applyingRemote) {
              sync._combatOwner = null;
              sync.transport.send({ t: Msg.COMBAT_RELEASE });
              logger.info(`[COMBAT] Released combat (stopped)`);
            }
            sendCombatState();
          });
        } catch (e) { /* skip if already patched */ }
      }
    }

    // Periodic state sync every 2 seconds (catches up any missed events)
    this._combatStateInterval = setInterval(() => {
      if (sync.transport.isConnected && !sync._applyingRemote) {
        sendCombatState();
      }
    }, 2000);
  }

  _applyCombatEvent(msg) {
    const cm = game.combat;
    if (!cm) return;
    this._applyingRemote = true;
    try {
      if (msg.kind === 'state') {
        // Full state sync — monster selection, HP, paused
        if (msg.monsterId) {
          const monster = game.monsters.getObjectByID(msg.monsterId);
          const currentMonsterId = cm.enemy.monster ? cm.enemy.monster.id : null;
          const enemyIsDead = cm.enemy.hitpoints <= 0;
          logger.info(`[COMBAT] State sync: monster=${msg.monsterId}, found=${!!monster}, current=${currentMonsterId}, enemyDead=${enemyIsDead}, hp=${cm.enemy.hitpoints}, areaId=${msg.areaId}`);
          // Re-select if monster is different OR enemy is dead (needs respawn)
          if (monster && cm.enemy && (currentMonsterId !== msg.monsterId || enemyIsDead)) {
            try {
              // Find the area this monster belongs to
              let area = null;
              if (msg.areaId) {
                area = game.combatAreas.getObjectByID(msg.areaId)
                    || game.slayerAreas.getObjectByID(msg.areaId)
                    || (game.dungeons && game.dungeons.getObjectByID(msg.areaId))
                    || (game.strongholds && game.strongholds.getObjectByID(msg.areaId))
                    || (game.abyssDepths && game.abyssDepths.getObjectByID(msg.areaId));
              }
              logger.info(`[COMBAT] Area from areaId: ${area ? area.id : 'not found'}`);
              if (!area && monster._area) { area = monster._area; logger.info(`[COMBAT] Area from monster._area: ${area.id}`); }
              if (!area) {
                if (game.combatAreas && game.combatAreas.allObjects) {
                  for (const a of game.combatAreas.allObjects) {
                    if (a.monsters && a.monsters.includes(monster)) { area = a; break; }
                  }
                }
                if (!area && game.slayerAreas && game.slayerAreas.allObjects) {
                  for (const a of game.slayerAreas.allObjects) {
                    if (a.monsters && a.monsters.includes(monster)) { area = a; break; }
                  }
                }
                if (area) logger.info(`[COMBAT] Area from search: ${area.id}`);
              }
              if (area && cm.selectMonster) {
                logger.info(`[COMBAT] Calling selectMonster(${monster.id}, ${area.id})`);
                try {
                  cm.selectMonster(monster, area);
                } catch (e) { logger.warn(`[COMBAT] selectMonster threw: ${e.message}`); }
                cm.selectedMonster = monster;
                if (cm.selectedArea !== undefined) cm.selectedArea = area;
                // selectMonster sets up the monster but may leave HP at 0.
                // Call spawnEnemy to properly spawn with full HP and image.
                if (cm.enemy.hitpoints <= 0 && cm.spawnEnemy) {
                  try { cm.spawnEnemy(); } catch (e) { logger.warn(`[COMBAT] spawnEnemy threw: ${e.message}`); }
                }
                logger.info(`[COMBAT] selectMonster done, enemy.monster=${cm.enemy.monster ? cm.enemy.monster.id : 'none'}, hp=${cm.enemy.hitpoints}`);
              } else {
                logger.info(`[COMBAT] Fallback: setNewMonster + initializeForCombat`);
                cm.enemy.setNewMonster(monster);
                cm.enemy.initializeForCombat();
                cm.selectedMonster = monster;
                if (cm.selectedArea !== undefined && area) cm.selectedArea = area;
                if (cm.enemy.hitpoints <= 0 && cm.spawnEnemy) {
                  try { cm.spawnEnemy(); } catch (e) { logger.warn(`[COMBAT] spawnEnemy threw: ${e.message}`); }
                }
                logger.info(`[COMBAT] Fallback done, enemy.monster=${cm.enemy.monster ? cm.enemy.monster.id : 'none'}, hp=${cm.enemy.hitpoints}`);
              }
            } catch (e) { logger.warn(`[COMBAT] selectMonster failed: ${e.message}`); }
          } else {
            logger.info(`[COMBAT] Monster already selected and alive — skipping selectMonster`);
          }
        }
        // Sync HP values (only if provided and enemy is alive)
        if (msg.enemyHp !== undefined && msg.enemyHp > 0 && cm.enemy) {
          cm.enemy.hitpoints = msg.enemyHp;
        }
        if (msg.playerHp !== undefined && cm.player) {
          cm.player.hitpoints = msg.playerHp;
        }
        // Full combat render
        this._renderCombat();
      } else if (msg.kind === 'damage') {
        const target = msg.target === 'enemy' ? cm.enemy : cm.player;
        if (!target) return;
        // Apply damage directly to hitpoints
        if (msg.hp !== undefined) {
          target.hitpoints = msg.hp;
        } else {
          target.hitpoints = Math.max(0, target.hitpoints - msg.amount);
        }
        // Show damage splash for visual feedback
        if (target.splashManager && target.splashManager.add) {
          try {
            target.splashManager.add({
              source: msg.source || 'Attack',
              amount: msg.amount,
              xOffset: 0,
            });
          } catch (e) { /* skip splash */ }
        }
        // Set render queue flags so the game's render loop picks it up
        if (target.renderQueue) {
          target.renderQueue.hitpoints = true;
          target.renderQueue.damageSplash = true;
        }
        // Note: Don't reset HP on death — let the game's tick loop process
        // death normally (onEnemyDeath) so monster drops work. The crash in
        // rewardSlayerTaskCurrency is handled by patching that method.
        this._renderCombat();
      } else if (msg.kind === 'heal') {
        const target = msg.target === 'enemy' ? cm.enemy : cm.player;
        if (!target) return;
        if (msg.hp !== undefined) {
          target.hitpoints = msg.hp;
        } else {
          target.hitpoints = Math.min(target.stats ? target.stats.maxHitpoints : target.hitpoints, target.hitpoints + msg.amount);
        }
        // Show heal splash
        if (target.splashManager && target.splashManager.add) {
          try {
            target.splashManager.add({
              source: 'Heal',
              amount: msg.amount,
              xOffset: 0,
            });
          } catch (e) { /* skip splash */ }
        }
        if (target.renderQueue) {
          target.renderQueue.hitpoints = true;
          target.renderQueue.damageSplash = true;
        }
        this._renderCombat();
      }
    } catch (e) { logger.error('applyCombatEvent failed', e); }
    finally { this._applyingRemote = false; }
  }

  _renderCombat() {
    const cm = game.combat;
    if (!cm) return;
    try {
      // Set all relevant render queue flags
      if (cm.enemy) {
        if (cm.enemy.renderQueue) {
          cm.enemy.renderQueue.hitpoints = true;
          cm.enemy.renderQueue.damageSplash = true;
          cm.enemy.renderQueue.image = true;
          cm.enemy.renderQueue.levels = true;
          cm.enemy.renderQueue.stats = true;
          cm.enemy.renderQueue.attacks = true;
        }
        // setRenderAll sets ALL render queue flags at once
        if (cm.enemy.setRenderAll) cm.enemy.setRenderAll();
        if (cm.enemy.renderHitpoints) cm.enemy.renderHitpoints();
        if (cm.enemy.renderImageAndName) cm.enemy.renderImageAndName();
        if (cm.enemy.render) cm.enemy.render();
      }
      if (cm.player) {
        if (cm.player.renderQueue) {
          cm.player.renderQueue.hitpoints = true;
          cm.player.renderQueue.damageSplash = true;
        }
        if (cm.player.renderHitpoints) cm.player.renderHitpoints();
      }
      // Full combat manager render — updates the entire combat tab
      if (cm.render) cm.render();
      // onPageChange forces a full re-render of the combat page
      if (cm.onPageChange) cm.onPageChange();
      if (cm.renderLocation) cm.renderLocation();
    } catch (e) { /* skip render errors */ }
  }

  // ---- Combat claim/release (only one player attacks at a time) ----------
  _applyCombatClaim(msg) {
    const cm = game.combat;
    if (!cm) return;
    logger.info(`[COMBAT] Peer claimed combat: ${msg.monsterId}`);
    this._combatOwner = 'peer';
    // Don't pause combat — that hides the enemy visual.
    // Instead, we just set _combatOwner='peer' which prevents our local
    // damage patches from sending (the peer is the attacker, not us).
    // The enemy stays visible, we just don't attack.
    // Sync the monster selection so we see the same enemy
    if (msg.monsterId) {
      this._applyingRemote = true;
      try {
        const monster = game.monsters.getObjectByID(msg.monsterId);
        if (monster && cm.enemy && (!cm.enemy.monster || cm.enemy.monster.id !== msg.monsterId || cm.enemy.hitpoints <= 0)) {
          let area = null;
          if (msg.areaId) {
            area = game.combatAreas.getObjectByID(msg.areaId)
                || game.slayerAreas.getObjectByID(msg.areaId)
                || (game.dungeons && game.dungeons.getObjectByID(msg.areaId))
                || (game.strongholds && game.strongholds.getObjectByID(msg.areaId))
                || (game.abyssDepths && game.abyssDepths.getObjectByID(msg.areaId));
          }
          if (!area && monster._area) area = monster._area;
          if (!area) {
            if (game.combatAreas && game.combatAreas.allObjects) {
              for (const a of game.combatAreas.allObjects) {
                if (a.monsters && a.monsters.includes(monster)) { area = a; break; }
              }
            }
            if (!area && game.slayerAreas && game.slayerAreas.allObjects) {
              for (const a of game.slayerAreas.allObjects) {
                if (a.monsters && a.monsters.includes(monster)) { area = a; break; }
              }
            }
          }
          if (area && cm.selectMonster) {
            cm.selectMonster(monster, area);
            if (cm.enemy.hitpoints <= 0 && cm.spawnEnemy) cm.spawnEnemy();
          }
        }
      } catch (e) { logger.warn(`[COMBAT] claim selectMonster failed: ${e.message}`); }
      finally { this._applyingRemote = false; }
    }
    this._renderCombat();
  }

  _applyCombatRelease() {
    const cm = game.combat;
    if (!cm) return;
    logger.info(`[COMBAT] Peer released combat`);
    this._combatOwner = null;
    // Restore our pause state — we can attack again if we want
    // Don't auto-unpause; let the player decide
  }

  // ---- Ancient relics sync ----------------------------------------------
  _patchAncientRelics() {
    if (!game.ancientRelics) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const relics = [];
      for (const set of game.ancientRelics.allObjects) {
        if (set.foundRelics) {
          for (const [relic, count] of set.foundRelics) {
            relics.push({ setId: set.id, relicId: relic.id, count });
          }
        }
      }
      this.transport.send({ t: Msg.ANCIENT_RELIC, relics });
    };
    for (const set of game.ancientRelics.allObjects) {
      if (typeof set.addRelic === 'function') {
        this.ctx.patch(AncientRelicSet, 'addRelic').after(() => send());
      }
    }
  }

  _applyAncientRelic(msg) {
    if (!game.ancientRelics || !msg.relics) return;
    this._applyingRemote = true;
    try {
      for (const r of msg.relics) {
        const set = game.ancientRelics.getObjectByID(r.setId);
        if (!set || !set.foundRelics) continue;
        // Find the relic by ID in the set's registry
        const relic = set.relics?.getObjectByID(r.relicId);
        if (relic) set.foundRelics.set(relic, r.count);
      }
    } catch (e) { logger.error('applyAncientRelic failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Skill tree sync --------------------------------------------------
  _patchSkillTree() {
    // Skill trees are per-skill, not global. Iterate all skills.
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const trees = [];
      for (const skill of game.skills.allObjects) {
        if (skill.skillTrees) {
          for (const tree of skill.skillTrees.allObjects) {
            const nodes = [];
            if (tree.unlockedNodes) for (const n of tree.unlockedNodes) nodes.push(n.id);
            trees.push({ skillId: skill.id, treeId: tree.id, points: tree._points, nodes });
          }
        }
      }
      this.transport.send({ t: Msg.SKILL_TREE, trees });
    };
    for (const skill of game.skills.allObjects) {
      if (skill.skillTrees) {
        for (const tree of skill.skillTrees.allObjects) {
          for (const m of ['unlockNode', 'addPoints']) {
            if (typeof tree[m] === 'function') {
              this.ctx.patch(SkillTree, m).after(() => send());
            }
          }
        }
      }
    }
  }

  _applySkillTree(msg) {
    if (!msg.trees) return;
    this._applyingRemote = true;
    try {
      for (const t of msg.trees) {
        const skill = game.skills.getObjectByID(t.skillId);
        if (!skill || !skill.skillTrees) continue;
        const tree = skill.skillTrees.getObjectByID(t.treeId);
        if (!tree) continue;
        if (typeof t.points === 'number') tree._points = t.points;
        if (t.nodes && tree.unlockedNodes) {
          tree.unlockedNodes.clear();
          for (const nid of t.nodes) {
            const node = tree.nodes?.getObjectByID(nid);
            if (node) { node.isUnlocked = true; tree.unlockedNodes.add(node); }
          }
        }
      }
    } catch (e) { logger.error('applySkillTree failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Township sync ----------------------------------------------------
  _patchTownship() {
    const tw = game.township;
    if (!tw) return;
    // Throttle township sends — passiveTick fires ~10x/sec, we only need updates every 5s
    let lastSend = 0;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const now = Date.now();
      if (now - lastSend < 5000) return; // throttle to once per 5 seconds
      lastSend = now;
      this._sendTownship();
    };
    // Immediate send for user-initiated actions
    const sendImmediate = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      lastSend = Date.now();
      this._sendTownship();
    };
    for (const m of ['addBuildings', 'reduceBuildingEfficiency', 'changeDifficulty', 'repairAllBuildings']) {
      if (typeof Township.prototype[m] === 'function') this.ctx.patch(Township, m).after(() => sendImmediate());
    }
    if (tw.tasks && typeof tw.tasks.completeTask === 'function') {
      this.ctx.patch(TownshipTasks, 'completeTask').after(() => sendImmediate());
    }
    // passiveTick fires every game tick — throttle to 5s intervals
    if (tw.passiveTick) {
      this.ctx.patch(Township, 'passiveTick').after(() => send());
    }
  }

  _sendTownship() {
    const tw = game.township;
    if (!tw) return;
    const biomes = [];
    if (tw.biomes) for (const biome of tw.biomes.allObjects) {
      const buildings = {};
      if (biome.buildingsBuilt) for (const [b, count] of biome.buildingsBuilt) buildings[b.id] = count;
      biomes.push({ id: biome.id, buildings });
    }
    const resources = {};
    if (tw.resources) for (const r of tw.resources.allObjects) {
      resources[r.id] = { amount: r._amount, cap: r._cap };
    }
    this.transport.send({
      t: Msg.TOWNSHIP,
      biomes,
      resources,
      totalTicks: tw.totalTicks,
      legacyTicks: tw.legacyTicks,
    });
  }

  _applyTownship(msg) {
    const tw = game.township;
    if (!tw) return;
    this._applyingRemote = true;
    try {
      if (msg.biomes) for (const b of msg.biomes) {
        const biome = tw.biomes.getObjectByID(b.id);
        if (!biome || !biome.buildingsBuilt) continue;
        for (const [bid, count] of Object.entries(b.buildings)) {
          const building = tw.buildings.getObjectByID(bid);
          if (building) biome.buildingsBuilt.set(building, count);
        }
      }
      if (msg.resources) for (const [rid, data] of Object.entries(msg.resources)) {
        const r = tw.resources.getObjectByID(rid);
        if (r) { r._amount = data.amount; r._cap = data.cap; }
      }
      if (typeof msg.totalTicks === 'number') tw.totalTicks = msg.totalTicks;
      if (typeof msg.legacyTicks === 'number') tw.legacyTicks = msg.legacyTicks;
      if (tw.render) tw.render();
    } catch (e) { logger.error('applyTownship failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Clue Hunt sync ---------------------------------------------------
  _patchClueHunt() {
    if (!game.clueHunt) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const ch = game.clueHunt;
      const steps = (ch.clueProgress || []).map(s => ({
        id: s.id, progress: s.progress, required: s.required, complete: s.complete,
      }));
      this.transport.send({ t: Msg.CLUE_HUNT, steps, currentStep: ch.currentStep });
    };
    // Patch any method that advances clue progress
    for (const m of ['checkClueProgress', 'advanceStep', 'startClueHunt', 'giveReward']) {
      if (typeof ClueHunt.prototype[m] === 'function') {
        this.ctx.patch(ClueHunt, m).after(() => send());
      }
    }
  }

  _applyClueHunt(msg) {
    if (!game.clueHunt || !msg.steps) return;
    this._applyingRemote = true;
    try {
      const ch = game.clueHunt;
      if (ch.clueProgress) {
        for (let i = 0; i < msg.steps.length && i < ch.clueProgress.length; i++) {
          const remote = msg.steps[i];
          const local = ch.clueProgress[i];
          if (remote.id && local.id === remote.id) {
            local.progress = remote.progress;
            local.complete = remote.complete;
          }
        }
      }
      if (typeof msg.currentStep === 'number') ch.currentStep = msg.currentStep;
    } catch (e) { logger.error('applyClueHunt failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Corruption sync --------------------------------------------------
  _patchCorruption() {
    const co = game.corruption;
    if (!co) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const rows = [];
      if (co.corruptionEffects && co.corruptionEffects.unlockedRows) {
        for (const row of co.corruptionEffects.unlockedRows) {
          rows.push({ id: row.id, effectId: row.effect ? row.effect.id : null });
        }
      }
      this.transport.send({ t: Msg.CORRUPTION, rows });
    };
    if (co.corruptionEffects && typeof co.corruptionEffects.unlockRow === 'function') {
      this.ctx.patch(CorruptionEffectTable, 'unlockRow').after(() => send());
    }
  }

  _applyCorruption(msg) {
    const co = game.corruption;
    if (!co || !co.corruptionEffects || !msg.rows) return;
    this._applyingRemote = true;
    try {
      // Don't replace the array — just update unlocked state
      for (const r of msg.rows) {
        // Find matching row in local effectTable
        if (co.corruptionEffects.unlockedRows) {
          const existing = co.corruptionEffects.unlockedRows.find(row => row.id === r.id);
          if (existing && r.effectId) {
            const effect = game.combatEffects?.getObjectByID(r.effectId);
            if (effect) existing.effect = effect;
          }
        }
      }
    } catch (e) { logger.error('applyCorruption failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Raid sync (Golbin raids) -----------------------------------------
  _patchRaids() {
    if (!game.golbinRaid) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const r = game.golbinRaid;
      const history = (r.history || []).map(h => ({
        wave: h.wave, coins: h.coins, timestamp: h.timestamp,
      }));
      this.transport.send({
        t: Msg.RAID,
        wave: r.wave,
        waveProgress: r.waveProgress,
        selectedDifficulty: r.selectedDifficulty ? r.selectedDifficulty.id : null,
        history,
      });
    };
    for (const m of ['startRaid', 'skipWave', 'changeDifficulty', 'endRaid', 'nextWave']) {
      if (typeof RaidManager.prototype[m] === 'function') {
        this.ctx.patch(RaidManager, m).after(() => send());
      }
    }
  }

  _applyRaid(msg) {
    if (!game.golbinRaid) return;
    this._applyingRemote = true;
    try {
      const r = game.golbinRaid;
      if (typeof msg.wave === 'number') r.wave = msg.wave;
      if (typeof msg.waveProgress === 'number') r.waveProgress = msg.waveProgress;
      if (msg.selectedDifficulty) {
        const diff = game.raidDifficulties?.getObjectByID(msg.selectedDifficulty);
        if (diff) r.selectedDifficulty = diff;
      }
      // History is append-only — just add new entries
      if (msg.history && r.history) {
        for (const h of msg.history) {
          const exists = r.history.find(local => local.wave === h.wave && local.timestamp === h.timestamp);
          if (!exists) {
            r.history.push(h);
          }
        }
      }
    } catch (e) { logger.error('applyRaid failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Fishing Contest sync ---------------------------------------------
  _patchFishingContest() {
    const fc = game.fishing?.contest;
    if (!fc) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const results = (fc.playerResults || []).map(r => ({
        fishId: r.fish ? r.fish.id : null, score: r.score, timestamp: r.timestamp,
      }));
      this.transport.send({
        t: Msg.FISHING_CONTEST,
        isActive: fc.isActive,
        activeFishId: fc.activeFish ? fc.activeFish.id : null,
        actionsRemaining: fc.actionsRemaining,
        results,
      });
    };
    for (const m of ['startFishingContest', 'stopFishingContest', 'setFishingContestDifficulty', 'addResult']) {
      if (typeof FishingContest.prototype[m] === 'function') {
        this.ctx.patch(FishingContest, m).after(() => send());
      }
    }
  }

  _applyFishingContest(msg) {
    const fc = game.fishing?.contest;
    if (!fc) return;
    this._applyingRemote = true;
    try {
      fc.isActive = !!msg.isActive;
      if (msg.activeFishId) fc.activeFish = game.items.getObjectByID(msg.activeFishId);
      if (typeof msg.actionsRemaining === 'number') fc.actionsRemaining = msg.actionsRemaining;
      if (msg.results) {
        fc.playerResults = msg.results.map(r => ({
          fish: r.fishId ? game.items.getObjectByID(r.fishId) : null,
          score: r.score, timestamp: r.timestamp,
        }));
      }
    } catch (e) { logger.error('applyFishingContest failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Township Tasks sync ----------------------------------------------
  _patchTownshipTasks() {
    const tw = game.township;
    if (!tw) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const completed = [];
      if (tw.tasks && tw.tasks.completedTasks) {
        for (const t of tw.tasks.completedTasks) completed.push(t.id);
      }
      const casual = [];
      if (tw.casualTasks && tw.casualTasks.currentCasualTasks) {
        for (const t of tw.casualTasks.currentCasualTasks) {
          casual.push({ id: t.id, progress: t.progress, completed: t.completed });
        }
      }
      this.transport.send({
        t: Msg.TOWNSHIP_TASKS, completed,
        casualTasksCompleted: tw.casualTasks ? tw.casualTasks.casualTasksCompleted : 0,
        casual,
      });
    };
    if (tw.tasks && typeof tw.tasks.completeTask === 'function') {
      this.ctx.patch(TownshipTasks, 'completeTask').after(() => send());
    }
    if (tw.casualTasks) {
      for (const m of ['completeTask', 'skipTask', 'addNewDailyTask']) {
        if (typeof tw.casualTasks[m] === 'function') {
          this.ctx.patch(TownshipCasualTasks, m).after(() => send());
        }
      }
    }
  }

  _applyTownshipTasks(msg) {
    const tw = game.township;
    if (!tw) return;
    this._applyingRemote = true;
    try {
      if (msg.completed && tw.tasks && tw.tasks.completedTasks) {
        for (const tid of msg.completed) {
          const task = tw.tasks.allObjects?.getObjectByID(tid);
          if (task && !tw.tasks.completedTasks.has(task)) tw.tasks.completedTasks.add(task);
        }
      }
      if (typeof msg.casualTasksCompleted === 'number' && tw.casualTasks) {
        tw.casualTasks.casualTasksCompleted = msg.casualTasksCompleted;
      }
      if (msg.casual && tw.casualTasks && tw.casualTasks.currentCasualTasks) {
        for (const c of msg.casual) {
          const task = tw.casualTasks.currentCasualTasks.find(t => t.id === c.id);
          if (task) { task.progress = c.progress; task.completed = c.completed; }
        }
      }
    } catch (e) { logger.error('applyTownshipTasks failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Cartography sync -------------------------------------------------
  _patchCartography() {
    const ca = game.cartography;
    if (!ca) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      // Send POI discoveries and paper recipe selection
      const pois = [];
      if (ca.worldMaps) {
        for (const wm of ca.worldMaps.allObjects) {
          if (wm.pointsOfInterest) {
            for (const poi of wm.pointsOfInterest) {
              if (poi.isDiscovered) pois.push({ mapId: wm.id, poiId: poi.id });
            }
          }
        }
      }
      this.transport.send({
        t: Msg.CARTOGRAPHY,
        pois,
        paperRecipeId: ca.selectedPaperRecipe ? ca.selectedPaperRecipe.id : null,
      });
    };
    for (const m of ['discoverPOI', 'selectPaperRecipeOnClick', 'autoSurveyOnClick', 'travelOnClick']) {
      if (typeof Cartography.prototype[m] === 'function') {
        this.ctx.patch(Cartography, m).after(() => send());
      }
    }
  }

  _applyCartography(msg) {
    const ca = game.cartography;
    if (!ca) return;
    this._applyingRemote = true;
    try {
      if (msg.pois && ca.worldMaps) {
        for (const p of msg.pois) {
          const wm = ca.worldMaps.getObjectByID(p.mapId);
          if (!wm || !wm.pointsOfInterest) continue;
          const poi = wm.pointsOfInterest.find(poi => poi.id === p.poiId);
          if (poi) poi.isDiscovered = true;
        }
      }
      if (msg.paperRecipeId) {
        ca.selectedPaperRecipe = game.items.getObjectByID(msg.paperRecipeId);
      }
      if (ca.render) ca.render();
    } catch (e) { logger.error('applyCartography failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Stats sync -------------------------------------------------------
  _patchStats() {
    if (!game.stats) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      // Send all stat values — stats are a Map<number, number>
      const stats = {};
      if (game.stats.stats) {
        for (const [key, val] of game.stats.stats) stats[key] = val;
      }
      this.transport.send({ t: Msg.STATS, stats });
    };
    // Patch add/set/inc on the stat tracker
    for (const m of ['add', 'set', 'inc']) {
      if (typeof Statistics.prototype[m] === 'function') {
        this.ctx.patch(Statistics, m).after(() => send());
      }
    }
  }

  _applyStats(msg) {
    if (!game.stats || !msg.stats) return;
    this._applyingRemote = true;
    try {
      for (const [key, val] of Object.entries(msg.stats)) {
        const numKey = Number(key);
        if (!isNaN(numKey)) game.stats.stats.set(numKey, val);
      }
    } catch (e) { logger.error('applyStats failed', e); }
    finally { this._applyingRemote = false; }
  }

  _patchActionStartStop() {
    // Patch game.stopActiveAction and game.clearActiveAction to broadcast stops.
    this.ctx.patch(Game, 'stopActiveAction').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.ACTION_STOP });
    });
    this.ctx.patch(Game, 'clearActiveAction').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.ACTION_STOP });
    });

    // When both players are gathering the same resource, speed up 2x.
    // We patch GatheringSkill.startActionTimer() — if both players are on
    // the same recipe, we start the timer with half the interval.
    // This works for ALL skills since they all inherit from GatheringSkill.
    this.ctx.patch(GatheringSkill, 'startActionTimer').before(function () {
      if (!sync.transport.isConnected || sync._applyingRemote) return;
      // Get the recipe ID for the current action.
      let recipeId = null;
      try {
        const ma = this.masteryAction;
        if (ma && ma.id) recipeId = ma.id;
      } catch { /* noop */ }
      if (!recipeId) {
        try {
          if (this.activeRecipe && this.activeRecipe.id) recipeId = this.activeRecipe.id;
        } catch { /* noop */ }
      }
      if (!recipeId) return;
      // Check if the remote player is on the same recipe.
      if (sync.actionLock.isRecipeClaimed(this.id, recipeId)) {
        // Both players on same resource — mark for 2x speed.
        sync._coopBoost = true;
        sync._coopBoostRecipeId = recipeId;
      } else {
        sync._coopBoost = false;
        sync._coopBoostRecipeId = null;
      }
    });

    // Patch Timer.start to halve the time when coop boost is active.
    // The action timer calls start(interval) — we intercept and halve it.
    this.ctx.patch(Timer, 'start').before(function (time, offsetByTick) {
      if (sync._coopBoost && this === game.activeAction?.actionTimer) {
        return [time / 2, offsetByTick];
      }
    });
  }

  _startProgressBroadcaster() {
    // Every 500ms, if we have an active action, broadcast the timer progress
    // so the other player's progress bar moves in sync.
    this._progressTimer = setInterval(() => {
      if (!this.transport.isConnected || this._applyingRemote) return;
      const active = game.activeAction;
      if (!active) return;
      try {
        // The active action IS the skill for gathering/artisan/crafting skills.
        // It has an actionTimer property. For combat, it's the combat manager.
        let timer = null;
        let skillId = null;

        if (active.actionTimer) {
          timer = active.actionTimer;
          skillId = active.id;
        } else if (active.skill && active.skill.actionTimer) {
          timer = active.skill.actionTimer;
          skillId = active.skill.id;
        }

        // Also check if the active action is a skill in game.skills
        if (!timer) {
          const skill = game.skills.getObjectByID(active.id);
          if (skill && skill.actionTimer) {
            timer = skill.actionTimer;
            skillId = skill.id;
          }
        }

        if (!timer || !skillId) return;

        this.transport.send({
          t: Msg.ACTION_START,
          skillId,
          actionId: active.id,
          recipeId: this._currentRecipeId || skillId,
          progress: timer.progress,
          ticksLeft: timer._ticksLeft,
          maxTicks: timer._maxTicks,
        });

        // Also update the panel's local progress bar.
        if (this._onLocalActionCb) {
          this._onLocalActionCb({
            skillId,
            recipeId: this._currentRecipeId || skillId,
            progress: timer.progress,
            label: active.name || skillId,
          });
        }
      } catch { /* noop */ }
    }, 500);
  }

  _applyActionStart(msg) {
    // When the remote player has an active action, animate the progress bar
    // on the skill page — but ONLY if the user is already viewing that skill,
    // and ONLY the specific progress bar for the resource being gathered.
    // We do NOT auto-navigate, so the user can freely switch tabs.
    try {
      const skill = game.skills.getObjectByID(msg.skillId || msg.actionId);
      if (!skill || !skill.actionTimer) return;
      const timer = skill.actionTimer;

      this._applyingRemote = true;
      try {
        // Set up the timer to match the remote action.
        timer._ticksLeft = msg.ticksLeft || 0;
        timer._maxTicks = msg.maxTicks || 1;
        timer.active = true;

        // Calculate elapsed and total time for animateProgress.
        const maxTicks = msg.maxTicks || 1;
        const ticksLeft = msg.ticksLeft || 0;
        const elapsed = maxTicks - ticksLeft;
        const total = maxTicks;
        const elapsedMs = elapsed * 50;
        const totalMs = total * 50;

        // Only animate if the user is currently viewing this skill's page.
        try {
          const pages = game.getPagesForSkill(skill);
          if (pages && pages.length > 0) {
            const page = pages[0];
            const container = document.getElementById(page.containerID);
            if (container && !container.hidden) {
              // Find the SPECIFIC progress bar for this action.
              const bar = this._findActionProgressBar(skill, container, msg.recipeId);
              if (bar) {
                // Use animateProgressFromTimer first (most reliable),
                // then fall back to animateProgress.
                if (bar.animateProgressFromTimer) {
                  try { bar.animateProgressFromTimer(timer); } catch { /* noop */ }
                } else if (bar.animateProgress) {
                  try { bar.animateProgress(elapsedMs, totalMs); } catch { /* noop */ }
                }
              }
              // Also call the skill's own renderProgressBar method if it has one.
              // This ensures the game's internal state matches the bar.
              if (skill.renderProgressBar) {
                try { skill.renderProgressBar(); } catch { /* noop */ }
              } else if (skill.renderProgressBars) {
                try { skill.renderProgressBars(); } catch { /* noop */ }
              }
            }
          }
        } catch (e) { /* page lookup may fail, that's ok */ }

        // Update the panel's mini progress bar (always, regardless of page).
        const progress = msg.progress || 0;
        this._remoteAction = {
          skillId: skill.id,
          recipeId: msg.recipeId,
          progress,
          label: skill.name || skill.id,
        };
        if (this._onRemoteActionCb) this._onRemoteActionCb(this._remoteAction);
      } finally { this._applyingRemote = false; }
    } catch (e) { logger.warn('applyActionStart failed', e); }
  }

  // Find the specific progress bar for the action being performed.
  _findActionProgressBar(skill, container, recipeId) {
    try {
      // Mining: use the global rockMenus map to find the specific rock's
      // miningProgress bar (NOT hpProgress).
      if (skill.id === 'melvorD:Mining' && typeof rockMenus !== 'undefined') {
        for (const [rock, el] of rockMenus) {
          if (recipeId && rock.id === recipeId) {
            if (el && el.miningProgress) return el.miningProgress;
          }
        }
        if (skill.activeProgressRock) {
          const el = rockMenus.get(skill.activeProgressRock);
          if (el && el.miningProgress) return el.miningProgress;
        }
      }

      // Most skills have a menu object with a progressBar property.
      const menuProps = ['menu', '_menu', 'actionMenu'];
      for (const prop of menuProps) {
        if (skill[prop] && skill[prop].progressBar) return skill[prop].progressBar;
      }

      // Fallback: find the first progress-bar in the container that is NOT
      // an HP bar or inside a rock element.
      const bars = container.querySelectorAll('progress-bar');
      for (const bar of bars) {
        if (bar.currentStyle === 'bg-danger') continue;
        if (bar.closest('mining-rock-element')) continue;
        if (bar.animateProgress || bar.animateProgressFromTimer) return bar;
      }
    } catch (e) { /* noop */ }
    return null;
  }

  _applyActionStop(msg) {
    try {
      if (this._remoteAction && this._remoteAction.skillId) {
        const skill = game.skills.getObjectByID(this._remoteAction.skillId);
        if (skill) {
          // Only stop the in-game progress bar if the LOCAL player is NOT
          // actively mining the same resource. If the local player is still
          // mining (e.g. their rock still has HP), we should NOT stop their
          // timer or progress bar — the remote player's rock depleting
          // shouldn't affect the local player's action.
          const localActive = game.activeAction;
          const localIsSameAction = localActive && localActive.id === skill.id;

          if (!localIsSameAction) {
            // Local player is not doing this skill — safe to stop the bar.
            if (skill.actionTimer) {
              try { skill.actionTimer.stop(); } catch { /* noop */ }
              try { skill.actionTimer.active = false; } catch { /* noop */ }
            }
            if (skill.stopActiveProgressBar) {
              try { skill.stopActiveProgressBar(); } catch { /* noop */ }
            }
            if (skill.renderProgressBar) {
              try { skill.renderProgressBar(); } catch { /* noop */ }
            } else if (skill.renderProgressBars) {
              try { skill.renderProgressBars(); } catch { /* noop */ }
            }
            // Stop the specific progress bar element.
            try {
              const pages = game.getPagesForSkill(skill);
              if (pages && pages.length > 0) {
                const container = document.getElementById(pages[0].containerID);
                if (container) {
                  const bar = this._findActionProgressBar(skill, container, this._remoteAction.recipeId);
                  if (bar) {
                    if (bar.stopAnimation) bar.stopAnimation();
                    if (bar.setFixedPosition) {
                      try { bar.setFixedPosition(0); } catch { /* noop */ }
                    }
                  }
                }
              }
            } catch { /* noop */ }
          }
        }
      }
      // Always clear the panel's mini progress bar for the remote player.
      this._remoteAction = null;
      if (this._onRemoteActionCb) this._onRemoteActionCb(null);
    } catch (e) { logger.warn('applyActionStop failed', e); }
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
      this._currentRecipeId = null;
      this.actionLock.releaseLocal();
      // Clear local progress bar.
      if (this._onLocalActionCb) this._onLocalActionCb(null);
      return;
    }
    let recipeId = null;
    try { const ma = active.masteryAction; if (ma && ma.id) recipeId = ma.id; } catch { /* noop */ }
    this._currentRecipeId = recipeId;
    const label = active.name || skillId;
    this.actionLock.claimLocal(skillId, recipeId, label);
  }

  // ---- Full snapshot ----------------------------------------------------

  requestSnapshot() { this.transport.send({ t: Msg.STATE_REQUEST }); }

  _buildSnapshot() {
    logger.info('========== [MP] BUILDING SNAPSHOT ==========');
    const skills = [];
    for (const skill of game.skills.allObjects) {
      const e = { id: skill.id, xp: skill.xp };
      if (skill.hasAbyssalLevels) e.abyssalXp = skill.abyssalXP;
      skills.push(e);
    }
    const bank = [];
    for (const [item, bi] of game.bank.items) bank.push({ id: item.id, qty: bi.quantity });
    const currencies = [];
    for (const c of game.currencies.allObjects) currencies.push({ id: c.id, qty: c._amount });
    const equipSets = [];
    const playerState = {};
    if (game.combat.player) {
      for (let i = 0; i < game.combat.player.equipmentSets.length; i++) {
        const slots = {};
        for (const [slotId, eqItem] of Object.entries(game.combat.player.equipmentSets[i].equipment.equippedItems)) {
          slots[slotId] = { itemId: eqItem.item.id, qty: eqItem.quantity };
        }
        equipSets.push(slots);
      }
      // Player combat state
      playerState.selectedSet = game.combat.player.selectedEquipmentSet;
      playerState.prayerPoints = game.combat.player.prayerPoints;
      playerState.soulPoints = game.combat.player.soulPoints;
      playerState.prayers = [];
      if (game.combat.player.activePrayers) for (const ap of game.combat.player.activePrayers) playerState.prayers.push(ap.prayer.id);
      playerState.food = [];
      if (game.combat.player.food && game.combat.player.food.slots) {
        for (let i = 0; i < game.combat.player.food.slots.length; i++) {
          const s = game.combat.player.food.slots[i];
          playerState.food.push({ slot: i, itemId: s.item ? s.item.id : null, qty: s.quantity });
        }
        playerState.selectedFoodSlot = game.combat.player.food.selectedSlot;
      }
      playerState.attackStyles = [];
      if (game.combat.player.attackStyles) for (let i = 0; i < game.combat.player.attackStyles.length; i++) {
        playerState.attackStyles.push({ set: i, style: game.combat.player.attackStyles[i] });
      }
      playerState.attackSpellId = game.combat.player.selectedAttackSpell ? game.combat.player.selectedAttackSpell.id : null;
    }
    const pets = [];
    if (game.petManager) for (const pet of game.petManager.unlocked) pets.push(pet.id);
    const charges = [];
    if (game.itemCharges) for (const [item, ch] of game.itemCharges.charges) {
      if (ch > 0) charges.push({ itemId: item.id, charges: ch });
    }
    // Shop upgrades
    const shopUpgrades = {};
    if (game.shop) for (const [p, count] of game.shop.upgradesPurchased) shopUpgrades[p.id] = count;
    // Tutorial
    const tutorial = this._buildTutorialState();
    // Mining rock HP
    let rockHP = null;
    if (game.mining) {
      rockHP = [];
      for (const rock of game.mining.actions.allObjects) {
        if (rock && typeof rock.currentHP === 'number') {
          rockHP.push({ id: rock.id, hp: rock.currentHP, maxHp: rock.maxHP });
        }
      }
    }
    // Farming plots
    let farmingPlots = null;
    if (game.farming) {
      farmingPlots = [];
      for (const plot of game.farming.plots.allObjects) {
        const data = this._serializePlot(plot);
        if (data) farmingPlots.push(data);
      }
    }
    // Combat state
    let combatState = null;
    if (game.combat && game.combat.enemy) {
      combatState = {
        monsterId: game.combat.enemy.monster ? game.combat.enemy.monster.id : null,
        enemyHp: game.combat.enemy.hitpoints,
        enemyMaxHp: game.combat.enemy.stats ? game.combat.enemy.stats.maxHitpoints : 0,
        playerHp: game.combat.player ? game.combat.player.hitpoints : 0,
        playerMaxHp: game.combat.player && game.combat.player.stats ? game.combat.player.stats.maxHitpoints : 0,
        paused: game.combat.paused,
      };
    }
    const snapshot = { t: Msg.STATE_SNAPSHOT, skills, bank, currencies, equipSets, playerState, pets, charges, shopUpgrades, tutorial, rockHP, farming: farmingPlots, combat: combatState };
    logger.info(`[SNAPSHOT] Built: ${skills.length} skills, ${bank.length} bank items, ${currencies.length} currencies, ${equipSets.length} equip sets, ${pets.length} pets, ${charges.length} charges, ${rockHP?.length || 0} rocks, ${farmingPlots?.length || 0} farming plots, combat: ${combatState ? 'yes' : 'no'}`);
    logger.info('========== [MP] SNAPSHOT BUILT ==========');
    return snapshot;
  }

  _applySnapshot(msg) {
    logger.info('========== [MP] APPLYING SNAPSHOT ==========');
    logger.info(`[SNAPSHOT] Received: ${msg.skills?.length || 0} skills, ${msg.bank?.length || 0} bank items, ${msg.currencies?.length || 0} currencies, ${msg.equipSets?.length || 0} equip sets, ${msg.pets?.length || 0} pets, ${msg.charges?.length || 0} charges, ${msg.rockHP?.length || 0} rocks, ${msg.farming?.length || 0} farming plots`);
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
        if (cur.renderAmount) cur.renderAmount();
        if (cur.onAmountChange) cur.onAmountChange();
      }
      // Equipment sets — unequipItem/equipItem handle bank internally
      if (msg.equipSets && game.combat.player) {
        for (let i = 0; i < msg.equipSets.length; i++) {
          const remoteSlots = msg.equipSets[i];
          const eqSet = game.combat.player.equipmentSets[i];
          if (!eqSet) continue;
          const eq = eqSet.equipment;
          for (const [slotId, eqItem] of Object.entries(eq.equippedItems)) {
            if (!remoteSlots[slotId]) {
              const slot = game.equipmentSlots.getObjectByID(slotId);
              if (slot) {
                try { eq.unequipItem(slot); } catch (e) { /* skip */ }
              }
            }
          }
          for (const [slotId, remote] of Object.entries(remoteSlots)) {
            const local = eq.equippedItems[slotId];
            const item = this._itemById(remote.itemId);
            if (!item) continue;
            const slot = game.equipmentSlots.getObjectByID(slotId);
            if (!slot) continue;
            if (local && local.item.id === remote.itemId && local.quantity === remote.qty) continue;
            if (local) {
              try { eq.unequipItem(slot); } catch (e) { /* skip */ }
            }
            if (!game.bank.hasItem(item)) {
              try { game.bank.addItem(item, remote.qty, false, false, true, false); } catch (e) { /* skip */ }
            }
            try { eq.equipItem(item, slot, remote.qty); } catch (e) { /* skip */ }
          }
        }
        // Properly update stats and UI for equipment changes
        try { game.combat.player.updateForEquipmentChange(); } catch (e) { /* skip */ }
        try { game.combat.player.updateForEquipSetChange(); } catch (e) { /* skip */ }
        if (game.combat.player.renderQueue) {
          game.combat.player.renderQueue.equipment = true;
          game.combat.player.renderQueue.equipmentSets = true;
        }
        this._queueRender('bank');
      }
      if (msg.playerState && game.combat.player) {
        const ps = msg.playerState;
        const p = game.combat.player;
        if (typeof ps.prayerPoints === 'number') p.prayerPoints = ps.prayerPoints;
        if (typeof ps.soulPoints === 'number') p.soulPoints = ps.soulPoints;
        if (ps.prayers && p.activePrayers) {
          p.activePrayers.clear();
          for (const pid of ps.prayers) {
            const prayer = game.prayers.getObjectByID(pid);
            if (prayer) { try { p.activePrayers.add(new ActivePrayer(prayer)); } catch { /* noop */ } }
          }
        }
        if (ps.food && p.food && p.food.slots) {
          for (const f of ps.food) {
            if (f.slot >= p.food.slots.length) continue;
            if (!f.itemId) p.food.slots[f.slot] = { item: null, quantity: 0 };
            else {
              const item = game.items.getObjectByID(f.itemId);
              if (item) p.food.slots[f.slot] = { item, quantity: f.qty };
            }
          }
          if (typeof ps.selectedFoodSlot === 'number') p.food.selectedSlot = ps.selectedFoodSlot;
        }
        if (ps.attackStyles && p.attackStyles) {
          for (const a of ps.attackStyles) {
            if (a.set < p.attackStyles.length) p.attackStyles[a.set] = a.style;
          }
        }
        if (typeof ps.selectedSet === 'number') p.selectedEquipmentSet = ps.selectedSet;
        if (ps.attackSpellId) {
          const spell = game.attackSpells.getObjectByID(ps.attackSpellId);
          if (spell && p.selectAttackSpell) p.selectAttackSpell(spell, false);
        }
        if (p.render) p.render();
      }
      if (msg.pets && game.petManager) {
        for (const petId of msg.pets) {
          const pet = game.pets.getObjectByID(petId);
          if (pet && !game.petManager.unlocked.has(pet)) game.petManager.unlocked.add(pet);
        }
      }
      if (msg.charges && game.itemCharges) {
        for (const ch of msg.charges) {
          const item = this._itemById(ch.itemId);
          if (!item) continue;
          const cur = game.itemCharges.getCharges(item);
          const delta = ch.charges - cur;
          if (delta > 0) game.itemCharges.addCharges(item, delta);
          else if (delta < 0) game.itemCharges.removeCharges(item, -delta);
        }
      }
      if (msg.shopUpgrades && game.shop) {
        for (const [purchaseId, count] of Object.entries(msg.shopUpgrades)) {
          const purchase = game.shop.purchases.getObjectByID(purchaseId);
          if (purchase) game.shop.upgradesPurchased.set(purchase, count);
        }
        if (game.shop.computeProvidedStats) game.shop.computeProvidedStats();
      }
      if (msg.tutorial && game.tutorial) {
        const data = msg.tutorial;
        const t = game.tutorial;
        // Handle tutorial completion.
        if (data.complete && !t.complete) {
          try { t.completeTutorial(); } catch (e) { logger.warn('snapshot tutorial complete failed', e); }
        } else {
          // Advance stages to match.
          const remoteStagesCompleted = data.stagesCompleted || 0;
          while (t._stagesCompleted < remoteStagesCompleted && !t.complete) {
            try {
              const current = t.currentStage;
              if (current && current.complete && !current.claimed) current.setClaimed();
              t.startNextStage();
            } catch (e) { logger.warn('snapshot tutorial stage advance failed', e); break; }
          }
        }
        // Sync task progress (safe — just setting numbers).
        for (const stageData of (data.stages || [])) {
          const stage = t.stages.getObjectByID(stageData.id);
          if (!stage) continue;
          if (stageData.claimed && !stage.claimed) stage.claimed = true;
          for (const taskData of (stageData.tasks || [])) {
            const task = stage.tasks.find(tt => tt.id === taskData.id);
            if (task && typeof taskData.progress === 'number') task.progress = taskData.progress;
          }
        }
        if (t.renderQueue) {
          t.renderQueue.currentStageTasks = true;
          t.renderQueue.currentStageStatus = true;
        }
        if (t.renderProgress) { try { t.renderProgress(); } catch { /* noop */ } }
      }
      // Mining rock HP — skip the rock the local player is mining.
      if (msg.rockHP && game.mining) {
        let localRockId = null;
        try {
          if (game.mining.selectedRock && game.mining.selectedRock.id) localRockId = game.mining.selectedRock.id;
          else if (game.mining.activeProgressRock && game.mining.activeProgressRock.id) localRockId = game.mining.activeProgressRock.id;
        } catch { /* noop */ }
        for (const r of msg.rockHP) {
          if (localRockId && r.id === localRockId) continue;
          const rock = game.mining.actions.getObjectByID(r.id);
          if (!rock) continue;
          if (typeof r.hp === 'number') rock.currentHP = r.hp;
          if (typeof r.maxHp === 'number') rock.maxHP = r.maxHp;
        }
        if (game.mining.renderRockHP) game.mining.renderRockHP();
        if (game.mining.renderRockStatus) game.mining.renderRockStatus();
      }
      // Farming plots
      if (msg.farming && game.farming) {
        for (const p of msg.farming) {
          const plot = game.farming.plots.getObjectByID(p.id);
          if (!plot) continue;
          if (typeof p.state === 'number') plot.state = p.state;
          if (p.plantedRecipeId !== undefined) {
            plot.plantedRecipe = p.plantedRecipeId ? game.items.getObjectByID(p.plantedRecipeId) : undefined;
          }
          if (p.compostItemId !== undefined) {
            plot.compostItem = p.compostItemId ? game.items.getObjectByID(p.compostItemId) : undefined;
          }
          if (typeof p.compostLevel === 'number') plot.compostLevel = p.compostLevel;
          if (typeof p.growthTime === 'number') plot.growthTime = p.growthTime;
          if (p.selectedRecipeId !== undefined) {
            plot.selectedRecipe = p.selectedRecipeId ? game.items.getObjectByID(p.selectedRecipeId) : undefined;
          }
        }
        if (game.farming.render) game.farming.render();
        if (game.farming.renderGrowthState) game.farming.renderGrowthState();
        if (game.farming.renderPlotVisibility) game.farming.renderPlotVisibility();
        if (game.farming.renderPlotUnlockQuantities) game.farming.renderPlotUnlockQuantities();
      }
      // Combat state from snapshot
      if (msg.combat && game.combat) {
        const cs = msg.combat;
        if (cs.monsterId && game.combat.enemy) {
          const monster = game.monsters.getObjectByID(cs.monsterId);
          if (monster && (!game.combat.enemy.monster || game.combat.enemy.monster.id !== cs.monsterId)) {
            try { game.combat.enemy.setNewMonster(monster); } catch (e) { /* skip */ }
          }
        }
        if (typeof cs.enemyHp === 'number' && game.combat.enemy) {
          game.combat.enemy.hitpoints = cs.enemyHp;
          if (game.combat.enemy.renderHitpoints) game.combat.enemy.renderHitpoints();
        }
        if (typeof cs.playerHp === 'number' && game.combat.player) {
          game.combat.player.hitpoints = cs.playerHp;
          if (game.combat.player.renderHitpoints) game.combat.player.renderHitpoints();
        }
      }
      this._forceRender();
    } catch (e) { logger.error('snapshot apply failed', e); }
    finally {
      this._applyingRemote = false;
      this._scheduleSave();
      logger.info('========== [MP] SNAPSHOT APPLIED ==========');
    }
  }

  // ---- Unlock everything (debug/test command) ---------------------------
  _unlockAll() {
    logger.info('========== [MP] UNLOCKING EVERYTHING ==========');
    this._applyingRemote = true;
    let count = 0;
    try {
      // 1. All skills to level 120 + abyssal level 120
      for (const skill of game.skills.allObjects) {
        try {
          // Normal XP — level 120 = 200M XP
          if (skill._xp !== undefined) {
            const targetXp = 200000000;
            if (skill.xp < targetXp) {
              const delta = targetXp - skill.xp;
              skill.addXP(delta);
            }
          }
          // Abyssal XP — force set even if hasAbyssalLevels is false
          // (some skills like Corruption/Harvesting may not report it correctly)
          if (skill._abyssalXP !== undefined) {
            const targetAxp = 200000000;
            if (skill.abyssalXP < targetAxp) {
              try {
                skill.addAbyssalXP(targetAxp - skill.abyssalXP);
              } catch (e) {
                // Force-set directly if addAbyssalXP fails
                skill._abyssalXP = targetAxp;
                if (skill._abyssalLevel !== undefined) skill._abyssalLevel = 120;
              }
            }
          }
          // Also try to enable hasAbyssalLevels if the skill supports it
          if (skill._hasAbyssalLevels === false && skill._abyssalXP !== undefined) {
            skill._hasAbyssalLevels = true;
          }
          count++;
        } catch (e) { logger.warn(`[UNLOCK] Skill ${skill.id} failed: ${e.message}`); }
      }
      logger.info(`[UNLOCK] Skills: ${count} processed`);

      // 1b. Unlock all skills (some like Corruption/Harvesting need setUnlock(true))
      let unlockCount = 0;
      for (const skill of game.skills.allObjects) {
        try {
          if (!skill.isUnlocked && skill.setUnlock) {
            skill.setUnlock(true);
            unlockCount++;
          }
        } catch (e) { /* skip */ }
      }
      logger.info(`[UNLOCK] Skills unlocked: ${unlockCount}`);

      // 1c. Complete all dungeons using the proper API — addDungeonCompletion
      // This fires the correct events and triggers skill/realm unlocks
      let dunCount = 0;
      const cm = game.combat;
      if (cm && cm.addDungeonCompletion) {
        // Regular dungeons
        if (game.dungeons && game.dungeons.allObjects) {
          for (const dungeon of game.dungeons.allObjects) {
            try {
              // Complete each dungeon enough times to trigger skill unlocks
              const required = dungeon.skillUnlockCompletions || [1];
              const maxRequired = Math.max(...required, 1);
              const current = cm.getDungeonCompleteCount(dungeon);
              const needed = Math.max(maxRequired - current, 1);
              for (let i = 0; i < needed; i++) {
                cm.addDungeonCompletion(dungeon);
              }
              dunCount++;
            } catch (e) { logger.warn(`[UNLOCK] Dungeon ${dungeon.id} failed: ${e.message}`); }
          }
        }
        // Abyss depths (Into the Abyss) — AbyssDepth extends Dungeon, so same API
        if (game.abyssDepths && game.abyssDepths.allObjects) {
          for (const depth of game.abyssDepths.allObjects) {
            try {
              const required = depth.skillUnlockCompletions || [1];
              const maxRequired = Math.max(...required, 1);
              // addDungeonCompletion should work since AbyssDepth extends Dungeon
              for (let i = 0; i < maxRequired; i++) {
                cm.addDungeonCompletion(depth);
              }
              dunCount++;
            } catch (e) {
              // Fallback: set completion count directly + fire event
              try {
                if (game.abyssDepthCompletion) {
                  game.abyssDepthCompletion.set(depth, Math.max(game.abyssDepthCompletion.get(depth) || 0, maxRequired));
                }
                if (cm.emit) cm.emit('abyssDepthCompleted', { depth });
                dunCount++;
              } catch (e2) { logger.warn(`[UNLOCK] Abyss depth ${depth.id} failed: ${e2.message}`); }
            }
          }
        }
        // Strongholds
        if (game.strongholds && game.strongholds.allObjects) {
          for (const sh of game.strongholds.allObjects) {
            try {
              const required = sh.skillUnlockCompletions || [1];
              const maxRequired = Math.max(...required, 1);
              // Strongholds may not work with addDungeonCompletion, try anyway
              for (let i = 0; i < maxRequired; i++) {
                try { cm.addDungeonCompletion(sh); } catch (e) { break; }
              }
              // Also set timesCompleted directly
              if (sh.timesCompleted !== undefined) {
                sh.timesCompleted = Math.max(sh.timesCompleted || 0, maxRequired);
              }
              if (cm.emit) cm.emit('strongholdCompleted', { stronghold: sh });
              dunCount++;
            } catch (e) { logger.warn(`[UNLOCK] Stronghold ${sh.id} failed: ${e.message}`); }
          }
        }
      }
      logger.info(`[UNLOCK] Dungeons/Depths/Strongholds completed: ${dunCount}`);

      // 1d. Unlock all realms — trigger realm manager for each locked realm
      let realmCount = 0;
      if (game.realms && game.realms.allObjects) {
        for (const realm of game.realms.allObjects) {
          try {
            if (!realm.isUnlocked && game.realmManager && game.realmManager.onRealmRequirementMet) {
              game.realmManager.onRealmRequirementMet(realm);
            }
            realmCount++;
          } catch (e) { /* skip */ }
        }
      }
      // Try toggling abyssal realm to make it available
      try {
        if (game.toggleAbyssalRealm) game.toggleAbyssalRealm();
        logger.info('[UNLOCK] Abyssal realm toggled');
      } catch (e) { /* skip */ }
      logger.info(`[UNLOCK] Realms processed: ${realmCount}`);

      // 2. All items to bank (1000 each) — try all items, skip ones that fail
      let itemCount = 0;
      if (game.items && game.items.allObjects) {
        for (const item of game.items.allObjects) {
          try {
            if (!item || !item.id) continue;
            // Skip dummy items
            if (item.id.startsWith('melvorD:Dummy')) continue;
            game.bank.addItemOnLoad(item, 1000);
            itemCount++;
          } catch (e) { /* skip items that can't be added */ }
        }
      }
      logger.info(`[UNLOCK] Bank items: ${itemCount} added`);

      // 3. All currencies
      let curCount = 0;
      if (game.currencies && game.currencies.allObjects) {
        for (const cur of game.currencies.allObjects) {
          try {
            cur.add(1000000000);
            curCount++;
          } catch (e) { /* skip */ }
        }
      }
      logger.info(`[UNLOCK] Currencies: ${curCount} maxed`);

      // 4. All pets — use isPetUnlocked + unlockPet, with fallback to unlockPetByID and direct set add
      let petCount = 0;
      if (game.petManager) {
        const petReg = game.pets;
        if (petReg && petReg.allObjects) {
          for (const pet of petReg.allObjects) {
            try {
              if (pet && pet.id && !game.petManager.isPetUnlocked(pet)) {
                try {
                  game.petManager.unlockPet(pet);
                } catch (e) {
                  try { game.petManager.unlockPetByID(pet.id); }
                  catch (e2) {
                    // Last resort: add directly to the unlocked set
                    if (game.petManager.unlocked) game.petManager.unlocked.add(pet);
                  }
                }
                petCount++;
              }
            } catch (e) { /* skip */ }
          }
        }
      }
      logger.info(`[UNLOCK] Pets: ${petCount} unlocked`);

      // 5. All item charges — use addCharges for equipment items that support charges
      let chargeCount = 0;
      if (game.itemCharges && game.itemCharges.addCharges) {
        for (const item of game.items.allObjects) {
          try {
            if (!item || !item.id) continue;
            // EquipmentItem subclasses can have charges
            if (item.equipSlot !== undefined || item.charges !== undefined) {
              game.itemCharges.addCharges(item, 10000);
              chargeCount++;
            }
          } catch (e) { /* skip */ }
        }
      }
      logger.info(`[UNLOCK] Item charges: ${chargeCount} set`);

      // 6. All mastery to level 99 (500K XP) — use skill.actions and addMasteryXP
      let masteryCount = 0;
      for (const skill of game.skills.allObjects) {
        try {
          // SkillWithMastery has .actions (NamespaceRegistry) and .addMasteryXP
          if (skill.actions && skill.actions.allObjects && skill.addMasteryXP) {
            for (const action of skill.actions.allObjects) {
              try {
                skill.addMasteryXP(action, 500000);
                masteryCount++;
              } catch (e) { /* skip individual action */ }
            }
          }
        } catch (e) { /* skip */ }
      }
      logger.info(`[UNLOCK] Mastery: ${masteryCount} actions set to 99`);

      // 7. All mastery pools to max — use addMasteryPoolXP(realm, xp)
      let poolCount = 0;
      for (const skill of game.skills.allObjects) {
        try {
          if (skill.addMasteryPoolXP && skill._masteryPoolXP !== undefined) {
            // Add pool XP for each realm
            if (game.realms && game.realms.allObjects) {
              for (const realm of game.realms.allObjects) {
                try { skill.addMasteryPoolXP(realm, 5000000); } catch (e) { /* skip */ }
              }
            }
            poolCount++;
          }
        } catch (e) { /* skip */ }
      }
      logger.info(`[UNLOCK] Mastery pools: ${poolCount} maxed`);

      // 8. All shop upgrades — use purchases registry and upgradesPurchased map
      let shopCount = 0;
      if (game.shop && game.shop.purchases && game.shop.purchases.allObjects) {
        for (const purchase of game.shop.purchases.allObjects) {
          try {
            if (!game.shop.isUpgradePurchased(purchase)) {
              // Directly set the purchase count in the map
              game.shop.upgradesPurchased.set(purchase, 1);
              shopCount++;
            }
          } catch (e) { /* skip */ }
        }
      }
      logger.info(`[UNLOCK] Shop upgrades: ${shopCount} purchased`);

      // 9. All farming plots — plots are unlocked based on level, which we already set to 120
      // Just count them for logging
      let farmCount = 0;
      if (game.farming && game.farming.plots && game.farming.plots.allObjects) {
        farmCount = game.farming.plots.allObjects.length;
      }
      logger.info(`[UNLOCK] Farming plots: ${farmCount} available (unlocked via level 120)`);

      // 10. All agility obstacles & pillars built — use buildObstacle/buildPillar
      let agCount = 0;
      if (game.agility) {
        // Build all obstacles
        if (game.agility.actions && game.agility.actions.allObjects) {
          for (const obstacle of game.agility.actions.allObjects) {
            try {
              if (obstacle && obstacle.isBuilt === false && game.agility.buildObstacle) {
                game.agility.buildObstacle(obstacle);
                agCount++;
              }
            } catch (e) { /* skip */ }
          }
        }
        // Build all pillars
        if (game.agility.pillars && game.agility.pillars.allObjects) {
          for (const pillar of game.agility.pillars.allObjects) {
            try {
              if (pillar && pillar.isBuilt === false && game.agility.buildPillar) {
                game.agility.buildPillar(pillar);
                agCount++;
              }
            } catch (e) { /* skip */ }
          }
        }
      }
      logger.info(`[UNLOCK] Agility obstacles/pillars: ${agCount} built`);

      // 11. All summoning marks discovered — use marksUnlocked map, not isMarkDiscovered
      let summonCount = 0;
      if (game.summoning && game.summoning.actions && game.summoning.actions.allObjects) {
        for (const recipe of game.summoning.actions.allObjects) {
          try {
            // Check if mark is already in marksUnlocked map
            if (!game.summoning.marksUnlocked || !game.summoning.marksUnlocked.has(recipe)) {
              game.summoning.discoverMark(recipe);
              summonCount++;
            }
          } catch (e) { /* skip */ }
        }
      }
      logger.info(`[UNLOCK] Summoning marks: ${summonCount} discovered`);

      // 12. All ancient relics found — relic sets are per-skill: skill.ancientRelicSets (Map<Realm, AncientRelicSet>)
      let relicCount = 0;
      for (const skill of game.skills.allObjects) {
        try {
          if (skill.ancientRelicSets && skill.ancientRelicSets.size > 0) {
            for (const [realm, relicSet] of skill.ancientRelicSets) {
              try {
                // relicDrops contains the actual relics that can be found
                if (relicSet.relicDrops) {
                  for (const drop of relicSet.relicDrops) {
                    try {
                      const relic = drop.relic;
                      if (relic && relicSet.addRelic) {
                        if (!relicSet.isRelicFound || !relicSet.isRelicFound(relic)) {
                          relicSet.addRelic(relic);
                          relicCount++;
                        }
                      }
                    } catch (e) { /* skip */ }
                  }
                }
                // Also try the completed relic
                if (relicSet.completedRelic && relicSet.addRelic) {
                  try {
                    if (!relicSet.isRelicFound || !relicSet.isRelicFound(relicSet.completedRelic)) {
                      relicSet.addRelic(relicSet.completedRelic);
                      relicCount++;
                    }
                  } catch (e) { /* skip */ }
                }
              } catch (e) { /* skip */ }
            }
          }
        } catch (e) { /* skip */ }
      }
      logger.info(`[UNLOCK] Ancient relics: ${relicCount} found`);

      // 13. All combat areas/dungeons/strongholds completed (set timesCompleted to 100)
      let dungeonCount = 0;
      // Dungeons
      if (game.dungeons && game.dungeons.allObjects) {
        for (const dungeon of game.dungeons.allObjects) {
          try {
            if (dungeon.timesCompleted !== undefined) {
              dungeon.timesCompleted = Math.max(dungeon.timesCompleted || 0, 100);
              dungeonCount++;
            }
          } catch (e) { /* skip */ }
        }
      }
      // Strongholds
      if (game.strongholds && game.strongholds.allObjects) {
        for (const sh of game.strongholds.allObjects) {
          try {
            if (sh.timesCompleted !== undefined) {
              sh.timesCompleted = Math.max(sh.timesCompleted || 0, 100);
              dungeonCount++;
            }
          } catch (e) { /* skip */ }
        }
      }
      // Abyss depths
      if (game.abyssDepths && game.abyssDepths.allObjects) {
        for (const depth of game.abyssDepths.allObjects) {
          try {
            if (depth.timesCompleted !== undefined) {
              depth.timesCompleted = Math.max(depth.timesCompleted || 0, 100);
              dungeonCount++;
            }
          } catch (e) { /* skip */ }
        }
      }
      logger.info(`[UNLOCK] Combat areas: ${dungeonCount} completed 100x`);

      // 14. All skill tree nodes unlocked — use tree.unlockNode() and addPoints()
      let treeNodeCount = 0;
      for (const skill of game.skills.allObjects) {
        try {
          if (skill.skillTrees && skill.skillTrees.allObjects) {
            for (const tree of skill.skillTrees.allObjects) {
              try {
                // Give plenty of skill points
                if (tree.addPoints) tree.addPoints(1000);
                // Unlock all nodes
                if (tree.nodes && tree.nodes.allObjects) {
                  for (const node of tree.nodes.allObjects) {
                    try {
                      if (!node.isUnlocked && tree.unlockNode) {
                        tree.unlockNode(node);
                        treeNodeCount++;
                      }
                    } catch (e) { /* skip individual node */ }
                  }
                }
              } catch (e) { /* skip individual tree */ }
            }
          }
        } catch (e) { /* skip */ }
      }
      logger.info(`[UNLOCK] Skill tree nodes: ${treeNodeCount} unlocked`);

      // 15. All clue hunt steps completed
      if (game.clueHunt) {
        try {
          if (game.clueHunt.steps) {
            for (const step of game.clueHunt.steps) {
              if (step && step.complete !== undefined) step.complete = true;
            }
          }
          logger.info('[UNLOCK] Clue hunt: all steps completed');
        } catch (e) { /* skip */ }
      }

      // 16. All corruption effect rows unlocked
      if (game.corruption && game.corruption.corruptionEffects) {
        try {
          for (const row of game.corruption.corruptionEffects.rows) {
            if (row && row.isUnlocked !== undefined) row.isUnlocked = true;
          }
          logger.info('[UNLOCK] Corruption: all rows unlocked');
        } catch (e) { /* skip */ }
      }

      // 17. All astrology modifiers upgraded
      if (game.astrology) {
        try {
          for (const recipe of game.astrology.actions.allObjects) {
            for (let tier = 0; tier < 2; tier++) {
              try {
                if (recipe.modifiers && recipe.modifiers[tier]) {
                  recipe.modifiers[tier].timesBought = 10;
                }
              } catch (e) { /* skip */ }
            }
          }
          logger.info('[UNLOCK] Astrology: all modifiers upgraded');
        } catch (e) { /* skip */ }
      }

      // 18. All archaeology dig sites unlocked + museum donations
      if (game.archaeology) {
        try {
          for (const site of game.archaeology.actions.allObjects) {
            if (site.isUnlocked !== undefined) site.isUnlocked = true;
          }
          logger.info('[UNLOCK] Archaeology: all dig sites unlocked');
        } catch (e) { /* skip */ }
      }

      // 19. All cartography POIs discovered
      if (game.cartography) {
        try {
          for (const map of game.cartography.maps.allObjects) {
            if (map.pois) {
              for (const poi of map.pois.allObjects) {
                if (poi.isDiscovered !== undefined) poi.isDiscovered = true;
              }
            }
          }
          logger.info('[UNLOCK] Cartography: all POIs discovered');
        } catch (e) { /* skip */ }
      }

      // 20. All harvesting veins unlocked
      if (game.harvesting) {
        try {
          for (const vein of game.harvesting.actions.allObjects) {
            if (vein.isUnlocked !== undefined) vein.isUnlocked = true;
          }
          logger.info('[UNLOCK] Harvesting: all veins unlocked');
        } catch (e) { /* skip */ }
      }

      // 21. Complete tutorial
      if (game.tutorial) {
        try {
          if (game.tutorial.stages) {
            for (const stage of game.tutorial.stages) {
              if (stage && stage.setClaimed) stage.setClaimed();
            }
          }
          if (game.tutorial.completeTutorial) game.tutorial.completeTutorial();
          logger.info('[UNLOCK] Tutorial: completed');
        } catch (e) { /* skip */ }
      }

      // 22. Set prayer points and soul points to max
      if (game.combat && game.combat.player) {
        try {
          const p = game.combat.player;
          if (p.prayerPoints !== undefined) p.prayerPoints = 9999;
          if (p.soulPoints !== undefined) p.soulPoints = 9999;
          logger.info('[UNLOCK] Prayer/soul points: maxed');
        } catch (e) { /* skip */ }
      }

      // 23. All level cap increases purchased
      try {
        if (game._levelCapIncreasesBought !== undefined) game._levelCapIncreasesBought = 50;
        if (game._abyssalLevelCapIncreasesBought !== undefined) game._abyssalLevelCapIncreasesBought = 50;
        logger.info('[UNLOCK] Level cap increases: 50 purchased');
      } catch (e) { /* skip */ }

      logger.info('========== [MP] UNLOCK COMPLETE — forcing render & save ==========');
      this._forceRender();
      this._scheduleSave();
    } catch (e) {
      logger.error('[UNLOCK] Failed:', e.message, e.stack);
    } finally {
      this._applyingRemote = false;
    }
  }

  // ---- Message dispatch -------------------------------------------------

  handle(msg) {
    // Log every incoming message with a readable name
    const msgName = Object.keys(Msg).find(k => Msg[k] === msg.t) || msg.t;
    logger.info(`[RECV] ${msgName}`, JSON.stringify(msg).slice(0, 200));
    const handlers = {
      [Msg.XP]: (m) => this._applyXP(m),
      [Msg.MASTERY]: (m) => this._applyMastery(m),
      [Msg.MASTERY_POOL]: (m) => this._applyMasteryPool(m),
      [Msg.BANK]: (m) => this._applyBank(m),
      [Msg.CURRENCY]: (m) => this._applyCurrency(m),
      [Msg.EQUIPMENT]: (m) => this._applyEquipment(m),
      [Msg.PET]: (m) => this._applyPet(m),
      [Msg.ITEM_CHARGE]: (m) => this._applyItemCharge(m),
      [Msg.POTION]: (m) => this._applyPotion(m),
      [Msg.SHOP]: (m) => this._applyShop(m),
      [Msg.TUTORIAL]: (m) => this._applyTutorial(m),
      [Msg.ACTION_START]: (m) => this._applyActionStart(m),
      [Msg.ACTION_STOP]: (m) => this._applyActionStop(m),
      [Msg.ROCK_HP]: (m) => this._applyRockHP(m),
      [Msg.FARMING]: (m) => this._applyFarming(m),
      [Msg.AGILITY]: (m) => this._applyAgility(m),
      [Msg.ASTROLOGY]: (m) => this._applyAstrology(m),
      [Msg.SUMMONING]: (m) => this._applySummoning(m),
      [Msg.SLAYER]: (m) => this._applySlayer(m),
      [Msg.SKILL_SELECT]: (m) => this._applySkillSelect(m),
      [Msg.PLAYER_STATE]: (m) => this._applyPlayerState(m),
      [Msg.COMBAT_AREA]: (m) => this._applyCombatArea(m),
      [Msg.COMBAT_EVENT]: (m) => this._applyCombatEvent(m),
      [Msg.COMBAT_CLAIM]: (m) => this._applyCombatClaim(m),
      [Msg.COMBAT_RELEASE]: () => this._applyCombatRelease(),
      [Msg.ANCIENT_RELIC]: (m) => this._applyAncientRelic(m),
      [Msg.SKILL_TREE]: (m) => this._applySkillTree(m),
      [Msg.TOWNSHIP]: (m) => this._applyTownship(m),
      [Msg.CLUE_HUNT]: (m) => this._applyClueHunt(m),
      [Msg.CORRUPTION]: (m) => this._applyCorruption(m),
      [Msg.RAID]: (m) => this._applyRaid(m),
      [Msg.FISHING_CONTEST]: (m) => this._applyFishingContest(m),
      [Msg.TOWNSHIP_TASKS]: (m) => this._applyTownshipTasks(m),
      [Msg.CARTOGRAPHY]: (m) => this._applyCartography(m),
      [Msg.STATS]: (m) => this._applyStats(m),
      [Msg.STATE_REQUEST]: () => this.transport.send(this._buildSnapshot()),
      [Msg.STATE_SNAPSHOT]: (m) => this._applySnapshot(m),
      [Msg.UNLOCK_ALL]: () => this._unlockAll(),
    };
    const handler = handlers[msg.t];
    if (!handler) {
      logger.warn(`[RECV] No handler for message type: ${msgName}`);
      return;
    }
    try {
      handler(msg);
      logger.info(`[APPLY OK] ${msgName}`);
    } catch (e) {
      logger.error(`[APPLY FAIL] ${msgName}:`, e.message, e.stack);
    }
  }
}

// ============================================================================
// PANEL (with inline styles so it works even if CSS fails to load)
// ============================================================================
function formatAction(claim) {
  if (!claim) return 'Idle';
  const skill = game.skills.getObjectByID(claim.skillId);
  const skillName = skill ? skill.name : claim.skillId;
  if (claim.recipeId) return `${skillName} (${claim.recipeId.split(':').pop()})`;
  return skillName;
}

// Show text in a modal overlay so the user can manually select+copy it.
// This works even in cross-origin iframes where the Clipboard API is blocked.
function showTextModal(title, text, opts = {}) {
  // Remove any existing modal.
  const existing = document.querySelector('.rmp-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.6)', zIndex: '100000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  overlay.className = 'rmp-modal-overlay';

  const box = document.createElement('div');
  Object.assign(box.style, {
    background: '#1f2937', border: '1px solid #4b5563', borderRadius: '10px',
    padding: '16px', maxWidth: '90vw', maxHeight: '80vh',
    display: 'flex', flexDirection: 'column', gap: '10px',
    fontFamily: 'Roboto, system-ui, sans-serif', color: '#e5e7eb',
  });

  const label = document.createElement('div');
  label.textContent = title;
  Object.assign(label.style, { fontWeight: '700', fontSize: '14px' });

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  Object.assign(ta.style, {
    width: opts.wide ? '600px' : '400px', height: opts.wide ? '300px' : '80px',
    background: '#111827', border: '1px solid #4b5563', color: '#34d399',
    borderRadius: '6px', padding: '8px', fontFamily: 'ui-monospace, monospace',
    fontSize: '11px', resize: 'vertical', outline: 'none',
  });

  const hint = document.createElement('div');
  hint.textContent = 'Click the text above, press Ctrl+A then Ctrl+C to copy.';
  Object.assign(hint.style, { fontSize: '11px', color: '#9ca3af' });

  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

  const makeBtn = (text, bg, border) => {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      background: bg, border: `1px solid ${border}`, color: '#e5e7eb',
      borderRadius: '6px', padding: '6px 14px', fontSize: '12px', cursor: 'pointer',
    });
    return b;
  };

  const closeBtn = makeBtn('Close', '#1f2937', '#4b5563');
  closeBtn.addEventListener('click', () => overlay.remove());

  btnRow.appendChild(closeBtn);

  // Add a download button for save strings (which can be very long).
  if (opts.download) {
    const dlBtn = makeBtn('Download file', '#1f2937', '#34d399');
    dlBtn.addEventListener('click', () => {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.download;
      a.click();
      URL.revokeObjectURL(url);
    });
    btnRow.insertBefore(dlBtn, closeBtn);
  }

  box.appendChild(label);
  box.appendChild(ta);
  box.appendChild(hint);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Click outside the box to close.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Auto-select the text for easy copying.
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
}

class Panel {
  constructor({ transport, actionLock, sync }) {
    this.transport = transport;
    this.actionLock = actionLock;
    this.sync = sync;
    this.root = null;
    this._statusTimer = null;
  }

  mount() {
    if (this.root) return;
    this.root = document.createElement('div');
    // Critical inline styles so the panel is always visible.
    Object.assign(this.root.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '99999',
      width: '280px', fontFamily: 'Roboto, system-ui, sans-serif',
      fontSize: '13px', color: '#e5e7eb',
      background: 'rgba(17,24,39,0.96)', border: '1px solid #374151',
      borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      userSelect: 'none',
    });
    this.root.className = 'rmp-panel';
    this.root.innerHTML = `
      <div data-rmp="header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #374151;cursor:grab;">
        <span style="font-weight:700;letter-spacing:.3px;cursor:pointer;user-select:none;" data-rmp="toggleBtn">Multiplayer</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="rmp-status" data-rmp="status" style="font-size:11px;padding:2px 8px;border-radius:999px;background:#374151;color:#cbd5e1;">Offline</span>
          <button data-rmp="hideBtn" title="Hide panel"
            style="background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:16px;line-height:1;padding:0 2px;">–</button>
        </div>
      </div>
      <div data-rmp="body" style="padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="rmp-input" data-rmp="nameInput" placeholder="Your name" maxlength="16"
            style="flex:1;background:#111827;border:1px solid #4b5563;color:#f3f4f6;border-radius:6px;padding:5px 8px;font-size:12px;outline:none;" />
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="rmp-input" data-rmp="serverInput" value="${DEFAULT_SERVER}" title="WebSocket relay server URL"
            style="flex:1;background:#111827;border:1px solid #4b5563;color:#f3f4f6;border-radius:6px;padding:5px 8px;font-size:11px;outline:none;font-family:ui-monospace,monospace;" />
        </div>
        <button class="rmp-btn" data-rmp="connectBtn"
          style="background:#1f2937;border:1px solid #34d399;color:#6ee7b7;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600;">Connect</button>
        <div data-rmp="waitingRow" hidden style="font-size:11px;color:#fbbf24;text-align:center;padding:4px;">
          Connected to server. Waiting for the other player...
        </div>
        <div data-rmp="saveSyncRow" hidden style="font-size:11px;color:#60a5fa;text-align:center;padding:4px;">
          Syncing host save...
        </div>
        <div data-rmp="connectedRow" hidden style="display:flex;gap:6px;align-items:center;justify-content:space-between;">
          <div style="display:flex;gap:8px;align-items:center;">
            <span data-rmp="peerName">—</span>
            <span class="rmp-ping" data-rmp="ping" style="font-size:11px;color:#9ca3af;">—</span>
          </div>
          <button class="rmp-btn" data-rmp="disconnectBtn"
            style="background:#1f2937;border:1px solid #7f1d1d;color:#fca5a5;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;">Disconnect</button>
        </div>
        <hr style="border:none;border-top:1px solid #374151;margin:4px 0;" />
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#34d399;flex:0 0 auto;"></span>
            <span style="font-weight:600;min-width:48px;" data-rmp="localName">You</span>
            <span style="color:#9ca3af;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-rmp="localAction">Idle</span>
          </div>
          <div data-rmp="localProgressBar" hidden style="margin-left:14px;width:calc(100% - 14px);height:6px;background:#1f2937;border-radius:3px;overflow:hidden;">
            <div data-rmp="localProgressFill" style="width:0%;height:100%;background:#34d399;border-radius:3px;transition:width 0.5s linear;"></div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#60a5fa;flex:0 0 auto;"></span>
            <span style="font-weight:600;min-width:48px;" data-rmp="remoteName">Peer</span>
            <span style="color:#9ca3af;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-rmp="remoteAction">Idle</span>
          </div>
          <div data-rmp="remoteProgressBar" hidden style="margin-left:14px;width:calc(100% - 14px);height:6px;background:#1f2937;border-radius:3px;overflow:hidden;">
            <div data-rmp="remoteProgressFill" style="width:0%;height:100%;background:#60a5fa;border-radius:3px;transition:width 0.5s linear;"></div>
          </div>
        </div>
        <div data-rmp="conflict" hidden
          style="font-size:11px;color:#6ee7b7;background:rgba(6,78,59,0.4);border:1px solid #065f46;border-radius:6px;padding:6px 8px;">
          Co-op boost active! Both players gathering the same resource — 2x speed.
        </div>
        <hr style="border:none;border-top:1px solid #374151;margin:4px 0;" />
        <div style="display:flex;gap:6px;">
          <button class="rmp-btn" data-rmp="copySaveBtn"
            style="flex:1;background:#1f2937;border:1px solid #4b5563;color:#e5e7eb;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;">Export save</button>
          <button class="rmp-btn" data-rmp="logBtn"
            style="flex:1;background:#1f2937;border:1px solid #4b5563;color:#e5e7eb;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;">Download log</button>
        </div>
        <div style="font-size:10px;color:#6b7280;margin:2px 0 0;">Tip: both players must load the same save before connecting.</div>
      </div>
    `;
    document.body.appendChild(this.root);
    this._wire();
    this._statusTimer = setInterval(() => this._refreshStatus(), 1000);
    this._refresh();
    logger.info('Panel mounted');
  }

  unmount() {
    if (this._statusTimer) { clearInterval(this._statusTimer); this._statusTimer = null; }
    if (this.root) { this.root.remove(); this.root = null; }
  }

  $(sel) { return this.root.querySelector(`[data-rmp="${sel}"]`); }

  // Make the panel draggable by a handle element (the header bar).
  // Uses pointer events so it works with mouse and touch alike. A short
  // movement threshold distinguishes a drag from a click so the toggle and
  // hide buttons still work normally.
  _wireDrag(handle) {
    let dragging = false;
    let startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;
    let moved = false;

    handle.addEventListener('pointerdown', (e) => {
      // Ignore drags that start on an interactive control inside the header.
      if (e.target.closest('button, input, [data-rmp="toggleBtn"]')) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.root.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      handle.style.cursor = 'grabbing';
      try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return; // click threshold
      moved = true;
      // Switch from right-anchored to left/top positioning on first move.
      let left = origLeft + dx;
      let top = origTop + dy;
      // Keep the panel on-screen.
      const maxLeft = window.innerWidth - this.root.offsetWidth;
      const maxTop = window.innerHeight - 40; // keep header visible
      left = Math.max(0, Math.min(left, maxLeft));
      top = Math.max(0, Math.min(top, maxTop));
      this.root.style.left = left + 'px';
      this.root.style.top = top + 'px';
      this.root.style.right = 'auto';
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      try { handle.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  _wire() {
    const $ = (s) => this.$(s);

    // Hide / show the panel body. When hidden, the panel collapses to just
    // the header bar; a small floating tab re-opens it.
    const hide = () => {
      $('body').style.display = 'none';
      $('hideBtn').textContent = '+';
      $('hideBtn').title = 'Show panel';
      this._hidden = true;
    };
    const show = () => {
      $('body').style.display = 'flex';
      $('hideBtn').textContent = '–';
      $('hideBtn').title = 'Hide panel';
      this._hidden = false;
    };
    $('hideBtn').addEventListener('click', (e) => { e.stopPropagation(); this._hidden ? show() : hide(); });
    // Clicking the "Multiplayer" title also toggles, for convenience.
    $('toggleBtn').addEventListener('click', (e) => { e.stopPropagation(); this._hidden ? show() : hide(); });

    // Drag the panel by its header bar.
    this._wireDrag($('header'));

    $('connectBtn').addEventListener('click', async () => {
      const name = $('nameInput').value.trim() || 'Player';
      const serverUrl = $('serverInput').value.trim();
      if (!serverUrl) { alert('Enter the server URL.'); return; }
      $('connectBtn').disabled = true;
      $('connectBtn').textContent = 'Connecting...';
      try {
        await this.transport.connect(serverUrl, name);
        // If we connected but aren't paired yet, show waiting message.
        if (this.transport.isWaiting) {
          this._showRow('waitingRow');
        }
      } catch (e) {
        logger.error('connect failed', e);
        alert(`Failed to connect: ${e.message || e}`);
      } finally {
        $('connectBtn').disabled = false;
        $('connectBtn').textContent = 'Connect';
      }
    });

    $('disconnectBtn').addEventListener('click', () => this.transport.close());

    $('copySaveBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const save = game.generateSaveString();
        showTextModal('Your save string — share this with the other player:', save, { wide: true, download: 'melvor-save.txt' });
      } catch (err) {
        logger.error('save copy failed', err);
        alert(`Could not generate save: ${err.message || err}`);
      }
    });

    $('logBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const text = exportLog();
      // Try downloading directly; if that fails (iframe), show in modal.
      try {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'realMP-log.txt';
        a.click();
        URL.revokeObjectURL(url);
        logger.info('Log file downloaded (' + text.length + ' bytes)');
      } catch (err) {
        logger.warn('Log download failed, showing in modal:', err);
        showTextModal('Mod log (' + _logBuf.length + ' lines):', text, { wide: true, download: 'realMP-log.txt' });
      }
    });

    this.transport.on('waiting', () => {
      this._showRow('waitingRow');
      this._refresh();
    });
    this.transport.on('open', () => {
      logger.info('========== [MP] CONNECTION OPENED ==========');
      logger.info(`[MP] Role: ${this.transport.role}, Peer: ${this.transport.peerName || 'unknown'}`);
      this._showRow('connectedRow');
      this._hideRow('waitingRow');
      this._hideRow('saveSyncRow');
      if (this.transport.role === 'peer') {
        logger.info('[MP] We are peer — requesting state snapshot from host');
        this.sync.requestSnapshot();
      } else {
        logger.info('[MP] We are host — waiting for peer to connect, will send save');
      }
      this._refresh();
    });
    this.transport.on('close', () => {
      logger.info('========== [MP] CONNECTION CLOSED ==========');
      this._hideRow('connectedRow');
      this._hideRow('waitingRow');
      this._hideRow('saveSyncRow');
      this.actionLock.reset();
      this._refresh();
    });
    this.transport.on('send_save', () => {
      this._showRow('saveSyncRow');
      const $ = (s) => this.$(s);
      $('saveSyncRow').textContent = 'Sending save to peer...';
    });
    this.transport.on('save_sync', () => {
      this._showRow('saveSyncRow');
      const $ = (s) => this.$(s);
      $('saveSyncRow').textContent = 'Loading host save...';
    });
    this.transport.on('error', (e) => {
      $('status').textContent = 'Error';
      logger.error('transport error', e);
    });
    this.actionLock.setOnChange(() => this._refreshActions());

    // Listen for remote action progress updates.
    if (this.sync && this.sync.onRemoteAction) {
      this.sync.onRemoteAction((remote) => {
        const $ = (s) => this.$(s);
        const bar = $('remoteProgressBar');
        const fill = $('remoteProgressFill');
        if (!bar || !fill) return;
        if (remote) {
          bar.hidden = false;
          fill.style.width = (remote.progress * 100).toFixed(1) + '%';
        } else {
          bar.hidden = true;
          fill.style.width = '0%';
        }
      });
    }

    // Listen for local action progress updates.
    if (this.sync && this.sync.onLocalAction) {
      this.sync.onLocalAction((local) => {
        const $ = (s) => this.$(s);
        const bar = $('localProgressBar');
        const fill = $('localProgressFill');
        if (!bar || !fill) return;
        if (local) {
          bar.hidden = false;
          fill.style.width = (local.progress * 100).toFixed(1) + '%';
        } else {
          bar.hidden = true;
          fill.style.width = '0%';
        }
      });
    }
  }

  _showRow(name) { const el = this.$(name); if (el) el.hidden = false; }
  _hideRow(name) { const el = this.$(name); if (el) el.hidden = true; }

  _refreshStatus() {
    if (!this.root) return;
    const $ = (s) => this.$(s);
    const status = $('status');
    if (this.transport.isConnected) {
      status.textContent = 'Connected';
      status.style.background = '#065f46';
      status.style.color = '#6ee7b7';
      $('ping').textContent = `${this.transport.latencyMs}ms`;
    } else if (this.transport.isWaiting) {
      status.textContent = 'Waiting';
      status.style.background = '#78350f';
      status.style.color = '#fbbf24';
      $('ping').textContent = '—';
    } else {
      status.textContent = 'Offline';
      status.style.background = '#374151';
      status.style.color = '#cbd5e1';
      $('ping').textContent = '—';
    }
  }

  _refresh() { this._refreshStatus(); this._refreshActions(); }

  _refreshActions() {
    if (!this.root) return;
    const $ = (s) => this.$(s);
    const lock = this.actionLock;
    $('localName').textContent = this.transport.myName || 'You';
    $('remoteName').textContent = this.transport.peerName || 'Peer';
    $('localAction').textContent = lock.local ? formatAction(lock.local) : 'Idle';
    $('remoteAction').textContent = lock.remote ? formatAction(lock.remote) : 'Idle';
    $('conflict').hidden = !lock.isConflict();
  }
}

// ============================================================================
// SETUP — entry point
// ============================================================================
export function setup(ctx) {
  logger.info('realMultiplayer mod loading…');

  let transport, actionLock, syncInstance, panel;

  try {
    transport = new Transport();
    actionLock = new ActionLock(transport);
    syncInstance = new Sync(ctx, transport, actionLock);
    sync = syncInstance;
  } catch (e) {
    logger.error('Failed to initialise mod components', e);
    return;
  }

  // Route incoming messages.
  transport.on('message', (msg) => {
    const msgName = Object.keys(Msg).find(k => Msg[k] === msg.t) || msg.t;
    switch (msg.t) {
      case Msg.ACTION_CLAIM:
        logger.info(`[RECV] ${msgName}`, JSON.stringify(msg).slice(0, 200));
        try { actionLock.applyRemoteClaim(msg); logger.info(`[APPLY OK] ${msgName}`); }
        catch (e) { logger.error(`[APPLY FAIL] ${msgName}:`, e.message); }
        break;
      case Msg.ACTION_RELEASE:
        logger.info(`[RECV] ${msgName}`, JSON.stringify(msg).slice(0, 200));
        try { actionLock.applyRemoteRelease(msg); logger.info(`[APPLY OK] ${msgName}`); }
        catch (e) { logger.error(`[APPLY FAIL] ${msgName}:`, e.message); }
        break;
      default: syncInstance.handle(msg);
    }
  });

  // Host: automatically send save to peer when they connect.
  transport.on('send_save', () => {
    logger.info('Peer connected — auto-sending host save...');
    try {
      const saveString = game.generateSaveString();
      logger.info('Save string generated (' + saveString.length + ' chars), sending to peer');
      transport._rawSend({ t: Msg.SAVE_SYNC, save: saveString });
    } catch (e) {
      logger.error('Failed to generate/send save for peer', e);
    }
  });

  // Peer: automatically load the host's save when received.
  // We can't use loadSaveFromString() because it re-registers custom HTML
  // elements that are already registered, causing a crash. Instead we write
  // the save to slot 0 in local storage and reload the page — the game loads
  // the save cleanly on startup.
  transport.on('save_sync', (saveString) => {
    if (!saveString) { logger.warn('save_sync event but no save string'); return; }
    logger.info('Received host save (' + saveString.length + ' chars)');
    try {
      const ok = confirm(
        'Multiplayer: The host has sent you their save file.\n\n' +
        'Your game will reload with the host\'s character.\n\n' +
        'Click OK to continue.'
      );
      if (!ok) { logger.info('User declined save sync'); return; }

      // Write the save to slot 0 in local storage, then reload the page.
      // The game will load this save on startup, avoiding the custom element
      // registration conflict.
      logger.info('Writing host save to slot 0...');
      // Remember the server URL and name so we can auto-reconnect after reload.
      try {
        sessionStorage.setItem('rmp_autoconnect', JSON.stringify({
          server: transport._serverUrl || '',
          name: transport.myName || 'Player',
        }));
      } catch { /* noop */ }
      setSlotToSaveString(0, saveString).then(() => {
        logger.info('Save written to slot 0, reloading page...');
        setTimeout(() => { window.location.reload(); }, 500);
      }).catch((e) => {
        logger.error('Failed to write save to slot', e);
        // Fallback: use the state snapshot instead.
        logger.info('Falling back to state snapshot sync');
        syncInstance.requestSnapshot();
      });
    } catch (e) {
      logger.error('save_sync handling failed', e);
      // Fallback: use the state snapshot instead.
      logger.info('Falling back to state snapshot sync');
      syncInstance.requestSnapshot();
    }
  });

  // Install patches after character loads.
  ctx.onCharacterLoaded(() => {
    logger.info('Character loaded, installing sync patches');
    try { syncInstance.install(); }
    catch (e) { logger.error('sync.install() failed', e); }
  });

  // Fallback: if character is already loaded (onCharacterLoaded may have
  // fired before the mod loaded), try installing patches immediately.
  try {
    if (game && game.character && game.character.loaded) {
      logger.info('Character already loaded, installing sync patches immediately');
      syncInstance.install();
    }
  } catch { /* noop */ }

  // Mount the UI panel.
  ctx.onInterfaceReady(() => {
    logger.info('Interface ready, mounting panel');
    try {
      if (panel) { try { panel.unmount(); } catch { /* noop */ } }
      panel = new Panel({ transport, actionLock, sync: syncInstance });
      panel.mount();
    } catch (e) { logger.error('panel mount failed', e); }

    // Auto-reconnect after a save sync reload.
    try {
      const auto = sessionStorage.getItem('rmp_autoconnect');
      if (auto) {
        sessionStorage.removeItem('rmp_autoconnect');
        const { server, name } = JSON.parse(auto);
        if (server) {
          logger.info('Auto-reconnecting after save sync...', server, name);
          setTimeout(() => {
            transport.connect(server, name).then(() => {
              logger.info('Auto-reconnect successful');
            }).catch((e) => {
              logger.error('Auto-reconnect failed', e);
            });
          }, 2000); // Give the game time to fully load.
        }
      }
    } catch { /* noop */ }
  });

  // Fallback: if onInterfaceReady already fired or doesn't fire, try mounting
  // 3 seconds after character load.
  ctx.onCharacterLoaded(() => {
    setTimeout(() => {
      if (!panel && document.querySelector('.rmp-panel') === null) {
        logger.info('Fallback panel mount (onInterfaceReady may not have fired)');
        try {
          panel = new Panel({ transport, actionLock, sync: syncInstance });
          panel.mount();
        } catch (e) { logger.error('fallback panel mount failed', e); }
      }
    }, 3000);
  });

  // Teardown.
  const teardown = () => {
    try { syncInstance.uninstall(); } catch (e) { logger.warn('sync uninstall', e); }
    try { panel && panel.unmount(); } catch (e) { logger.warn('panel unmount', e); }
    try { transport.close(); } catch (e) { logger.warn('transport close', e); }
    panel = null;
  };

  ctx.api({ transport, actionLock, sync: syncInstance, teardown, exportLog });
  window.realMP = { transport, actionLock, sync: syncInstance, teardown, exportLog };

  logger.info('realMultiplayer mod loaded successfully');
}
