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
    const text = exportLog();
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
  COMBAT_EVENT_STATE: 'combat_event_state', // CombatEvent system (Into the Mist, etc.)
  COMBAT_CLAIM: 'combat_claim',     // { monsterId, areaId } — I'm fighting this
  COMBAT_RELEASE: 'combat_release', // {} — I stopped fighting
  COMBAT_LOOT: 'combat_loot',       // { drops: [{itemId, qty}], currency: {gp, sc, ...} }
  STATE_REQUEST: 'state_req', STATE_SNAPSHOT: 'state_snap',
  SAVE_SYNC: 'save_sync',
  UNLOCK_ALL: 'unlock_all',
  LEVEL_CAP: 'level_cap',           // skill level cap increases purchased
  GAME_STATE: 'game_state',         // tickTimestamp, merchantsPermitRead, pause, etc.
  LORE: 'lore',                     // lore books read
  SECRET_AREA: 'secret_area',       // message in a bottle read (fishing)
  SKILL_UNLOCK: 'skill_unlock',     // skill unlocked mid-game via lock icon
  ASTROLOGY_SELECT: 'astro_select', // studied/explored constellation
  REALM: 'realm',                   // current realm selection
  SLAYER_CAT: 'slayer_cat',         // slayer task category completions
  COOKING_STOCKPILE: 'cook_stock',  // cooking stockpile items
  EQUIP_SET_COUNT: 'equip_set_count', // number of equipment set slots
  SETTINGS: 'settings',             // gameplay-affecting game settings
  MUSEUM_DONATE: 'museum_donate',   // { itemId } — 1 player donated, auto-donate for peer
  BANK_TAB_COUNT: 'bank_tab_count', // number of bank tabs purchased
});

// Named StatTracker keys on game.stats — shared by the stats sync and the
// snapshot builder.
const STATS_TRACKER_KEYS = [
  'Woodcutting', 'Fishing', 'Firemaking', 'Cooking', 'Mining', 'Smithing',
  'Attack', 'Strength', 'Defence', 'Hitpoints', 'Thieving', 'Farming',
  'Ranged', 'Fletching', 'Crafting', 'Runecrafting', 'Magic', 'Prayer',
  'Slayer', 'Herblore', 'Agility', 'Summoning', 'Astrology', 'Township',
  'Archaeology', 'Cartography', 'Corruption', 'Harvesting',
  'General', 'Combat', 'GolbinRaid', 'Shop',
];
// MappedStatTracker keys on game.stats (keyed by game object).
const STATS_MAPPED_TRACKER_KEYS = ['Items', 'Monsters'];
// Gameplay-affecting boolean game settings synced between peers.
const SETTINGS_BOOL_KEYS = [
  'continueIfBankFull', 'continueThievingOnStun', 'autoRestartDungeon',
  'enableAutoSlayer', 'enableAutoEquipFood', 'enableAutoSwapFood',
  'enablePerfectCooking', 'enablePermaCorruption', 'enableOfflineCombat',
];

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

const DEFAULT_SERVER = 'wss://vaccine-knowledgestorm-fundamentals-trends.trycloudflare.com';

// localStorage helpers — values are trimmed on read only; writes store raw.
const getSaved = (key, fallback) => {
  try {
    const s = localStorage.getItem(key);
    if (s && s.trim()) return s.trim();
  } catch { /* noop */ }
  return fallback;
};
const saveVal = (key, v) => { try { localStorage.setItem(key, v); } catch { /* noop */ } };

/** Get the saved server URL from localStorage, or fall back to DEFAULT_SERVER. */
const getSavedServerUrl = () => getSaved('rmp_server_url', DEFAULT_SERVER);
/** Save the server URL to localStorage so it persists across reloads. */
const saveServerUrl = (url) => saveVal('rmp_server_url', url);
/** Get the saved player name from localStorage. */
const getSavedName = () => getSaved('rmp_player_name', '');
/** Save the player name to localStorage. */
const saveName = (name) => saveVal('rmp_player_name', name);

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
  // "connected" means "paired with a peer" (relay handshake complete).
  get isConnected() { return this._paired; }
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
        this._resetConnection();
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
  _resetConnection() {
    this._connected = false;
    this._paired = false;
    this._stopPing();
  }
  close() {
    this._resetConnection();
    try { this.ws && this.ws.close(); } catch { /* noop */ }
    this.ws = null;
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
    this._watcher = null;
    this._lastActiveSkillId = null;
    this._saveTimer = null;
    this._progressTimer = null;
    this._installed = false;
    this._remoteAction = null; // { skillId, progress, actionLabel }
    this._onRemoteActionCb = null;
    this._onLocalActionCb = null;
    this._renderQueue = null;      // Set of render types, flushed once per frame
    this._renderScheduled = false;
    this._lastRockHP = null;       // delta cache for rock-HP broadcasts
    this._handlers = this._buildHandlers();
  }

  onRemoteAction(cb) { this._onRemoteActionCb = cb; }
  onLocalAction(cb) { this._onLocalActionCb = cb; }

  // ---- Shared helpers ------------------------------------------------------
  // Patch-callback convention: callbacks registered with `function` run with
  // `this` bound to the patched GAME object and reach the Sync instance via
  // the module-global `sync`; arrow callbacks use lexical `this` (the Sync
  // instance). Never convert one form into the other.

  /** True when a local change should be broadcast (not echoing a remote apply). */
  _canSend() { return !this._applyingRemote && this.transport.isConnected; }

  /** Guard + send in one call. Returns true if the message went out. */
  _send(payload) {
    if (!this._canSend()) return false;
    this.transport.send(payload);
    return true;
  }

  /**
   * Apply a remote state change: hold the re-entrancy guard, log failures,
   * and (unless save:false) schedule a save afterwards. The finally block runs
   * even when `fn` returns early — call sites rely on that.
   */
  _applyRemote(label, fn, { save = true, level = 'error' } = {}) {
    this._applyingRemote = true;
    try { fn(); }
    catch (e) { logger[level](`${label} failed`, e); }
    finally { this._applyingRemote = false; if (save) this._scheduleSave(); }
  }

  /** Patch several methods of one class to run `cb` afterwards (skips missing). */
  _afterEach(Cls, methods, cb) {
    for (const m of methods) {
      if (typeof Cls.prototype[m] === 'function') this.ctx.patch(Cls, m).after(cb);
    }
  }

  /**
   * try/catch-noop attach: `obj[key] = fn()` on success; leave `obj`
   * untouched on throw (fn may also return undefined to skip the key).
   * Callers needing a default attached even on throw pre-assign it first.
   */
  _tryAssign(obj, key, fn) {
    try {
      const v = fn();
      if (v !== undefined) obj[key] = v;
    } catch { /* noop */ }
  }

  install() {
    if (this._installed) { logger.info('Sync already installed, skipping'); return; }
    this._installed = true;
    logger.info('========== [MP] INSTALLING SYNC PATCHES ==========');
    const patches = [
      ['XP', '_patchXP'],
      ['Mastery', '_patchMastery'],
      ['Bank', '_patchBank'],
      ['Currency', '_patchCurrency'],
      ['Equipment+PlayerState', '_patchEquipment'],
      ['Pets', '_patchPets'],
      ['ItemCharges', '_patchItemCharges'],
      ['Potions', '_patchPotions'],
      ['Shop', '_patchShop'],
      ['ActionStartStop', '_patchActionStartStop'],
      ['MiningRockHP', '_patchMiningRockHP'],
      ['Farming', '_patchFarming'],
      ['Agility', '_patchAgility'],
      ['Astrology', '_patchAstrology'],
      ['Summoning', '_patchSummoning'],
      ['Slayer', '_patchSlayer'],
      ['SkillSelections', '_patchSkillSelections'],
      ['CombatAreas', '_patchCombatAreas'],
      ['CombatEvents', '_patchCombatEvents'],
      ['CombatEventSystem', '_patchCombatEventSystem'],
      ['AncientRelics', '_patchAncientRelics'],
      ['SkillTree', '_patchSkillTree'],
      ['Township', '_patchTownship'],
      ['ClueHunt', '_patchClueHunt'],
      ['Corruption', '_patchCorruption'],
      ['Raids', '_patchRaids'],
      ['FishingContest', '_patchFishingContest'],
      ['TownshipTasks', '_patchTownshipTasks'],
      ['Cartography', '_patchCartography'],
      ['Stats', '_patchStats'],
      ['LevelCaps', '_patchLevelCaps'],
      ['GameState', '_patchGameState'],
      ['Lore', '_patchLore'],
      ['Unlocks', '_patchUnlocks'],
      ['Tutorial', '_patchTutorial'],
      ['RealmSelection', '_patchRealmSelection'],
      ['SlayerCategories', '_patchSlayerCategories'],
      ['CookingStockpile', '_patchCookingStockpile'],
      ['EquipSetCount', '_patchEquipSetCount'],
      ['GameSettings', '_patchGameSettings'],
    ];
    let ok = 0, fail = 0;
    for (const [name, method] of patches) {
      try {
        this[method]();
        logger.info(`  [PATCH] ${name}: OK`);
        ok++;
      } catch (e) {
        logger.error(`  [PATCH] ${name}: FAILED —`, e.message);
        fail++;
      }
    }
    this._startWatcher();
    this._startProgressBroadcaster();
    this._startPeriodicStateSync();
    logger.info(`========== [MP] PATCHES DONE: ${ok} ok, ${fail} failed ==========`);

    this._logSystemAvailability();
  }

  /** Log which game systems the current game/version actually provides. */
  _logSystemAvailability() {
    logger.info('========== [MP] GAME SYSTEM AVAILABILITY ==========');
    const paths = [
      'bank', 'combat', 'combat.player', 'combat.player.food',
      'combat.player.equipmentSets', 'combat.player.activePrayers', 'combat.slayerTask',
      'currencies', 'petManager', 'itemCharges', 'potions', 'shop', 'mining', 'farming',
      'agility', 'astrology', 'summoning', 'slayer', 'cooking', 'woodcutting',
      'firemaking', 'fishing', 'fishing.contest', 'thieving', 'altMagic', 'fletching',
      'harvesting', 'archaeology', 'archaeology.museum', 'cartography', 'dungeons',
      'ancientRelics', 'township', 'township.tasks', 'township.casualTasks',
      'clueHunt', 'corruption', 'corruption.corruptionEffects', 'golbinRaid',
      'stats', 'tutorial', 'realms', 'equipmentSlots', 'prayers', 'attackSpells',
    ];
    for (const path of paths) {
      const available = path.split('.').reduce((o, k) => o && o[k], game);
      logger.info(`  [SYS] game.${path}: ${available ? 'AVAILABLE' : 'MISSING'}`);
    }
    logger.info('========== [MP] SYSTEM CHECK DONE ==========');
  }

  uninstall() {
    if (this._watcher) { clearInterval(this._watcher); this._watcher = null; }
    if (this._saveTimer) { clearInterval(this._saveTimer); this._saveTimer = null; }
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
    if (this._combatStateInterval) { clearInterval(this._combatStateInterval); this._combatStateInterval = null; }
    if (this._stateSyncTimer) { clearInterval(this._stateSyncTimer); this._stateSyncTimer = null; }
  }

  // Debounced render — batches multiple updates into a single render frame.
  // Instead of re-rendering everything on every message, we queue what needs
  // updating and process it once per animation frame (or after a short delay).
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

  // Check if an item is currently equipped in any equipment set.
  // Used to prevent bank dupe when stale bank syncs arrive after equipment syncs.
  _isItemEquipped(item) {
    if (!game.combat || !game.combat.player || !game.combat.player.equipmentSets) return false;
    for (const eqSet of game.combat.player.equipmentSets) {
      if (!eqSet || !eqSet.equipment || !eqSet.equipment.equippedItems) continue;
      for (const eqItem of Object.values(eqSet.equipment.equippedItems)) {
        if (eqItem && eqItem.item && eqItem.item.id === item.id) return true;
      }
    }
    return false;
  }

  // ---- XP / Abyssal XP --------------------------------------------------

  _patchXP() {
    const sendXP = function () {
      const p = { t: Msg.XP, skillId: this.id, xp: this.xp };
      if (this.hasAbyssalLevels) p.abyssalXp = this.abyssalXP;
      sync._send(p);
    };
    this.ctx.patch(Skill, 'addXP').after(sendXP);
    this.ctx.patch(Skill, 'addAbyssalXP').after(sendXP);
  }

  _applyXP(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill) return;
    this._applyRemote('applyXP', () => {
      if (typeof msg.xp === 'number') {
        // XP should only ever go UP — both players share the same character.
        // Never decrease XP via sync (would undo the other player's progress).
        const deltaXp = msg.xp - skill.xp;
        if (deltaXp > 0) {
          skill.addXP(deltaXp);
        }
      }
      if (typeof msg.abyssalXp === 'number' && skill.hasAbyssalLevels) {
        const deltaAxp = msg.abyssalXp - skill.abyssalXP;
        if (deltaAxp > 0) {
          skill.addAbyssalXP(deltaAxp);
        }
      }
      // Targeted render — only queue XP/mastery, not everything.
      this._queueRender('xp');
    });
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
    // Don't return early if am is undefined — the actionMastery entry may not
    // exist yet if the player has never trained this action. addMasteryXP
    // creates it automatically. Use 0 as current XP in that case.
    const am = skill.actionMastery.get(action);
    this._applyRemote('applyMastery', () => {
      // Mastery should only ever go UP, never down. Both players share the
      // same character, so we take the max of local and remote XP. This
      // prevents a player with lower mastery from resetting the other
      // player's mastery down.
      const currentXp = am ? am.xp : 0;
      if (msg.xp > currentXp) {
        // Use the game's own addMasteryXP method — it handles level-ups,
        // mastery unlocks, mastery bonuses, and rendering properly.
        skill.addMasteryXP(action, msg.xp - currentXp);
      }
      // If msg.xp <= currentXp, do nothing — don't decrease mastery.
      // Queue render for the action's mastery display.
      if (skill.renderQueue && skill.renderQueue.actionMastery) skill.renderQueue.actionMastery.add(action);
      this._queueRender('mastery');
    });
  }

  _applyMasteryPool(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill || !skill.hasMastery) return;
    const realm = game.realms.getObjectByID(msg.realmId);
    if (!realm) return;
    this._applyRemote('applyMasteryPool', () => {
      // Mastery pool should only ever go UP, never down — same as mastery XP.
      const current = skill._masteryPoolXP.get(realm) || 0;
      if (msg.xp > current) {
        skill._masteryPoolXP.set(realm, msg.xp);
        if (skill.renderQueue && skill.renderQueue.masteryPool) skill.renderQueue.masteryPool.add(realm);
        if (skill.renderMasteryPool) skill.renderMasteryPool();
      }
    });
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

    // Make Bank.render crash-proof — if updateSearchArray encounters an
    // undefined/corrupted item, skip it instead of crashing the whole game.
    if (typeof Bank.prototype.updateSearchArray === 'function') {
      const origUpdateSearch = Bank.prototype.updateSearchArray;
      Bank.prototype.updateSearchArray = function () {
        try {
          // Clean up any corrupted entries (undefined keys) before rendering
          if (this.items && this.items.forEach) {
            const toDelete = [];
            this.items.forEach((bi, key) => {
              if (!key || !key.name) toDelete.push(key);
            });
            for (const k of toDelete) {
              try { this.items.delete(k); } catch { /* noop */ }
            }
            if (toDelete.length > 0) {
              logger.warn(`[BANK] Cleaned up ${toDelete.length} corrupted bank entries`);
            }
          }
          return origUpdateSearch.call(this);
        } catch (e) {
          logger.warn(`[BANK] updateSearchArray threw: ${e.message}`);
        }
      };
    }

    // Adding / removing / selling items — same handler for all three
    const onBankItem = function (_ret, item) {
      sendBankUpdate.call(this, item);
    };
    for (const m of ['addItem', 'removeItemQuantity', 'processItemSale']) {
      this.ctx.patch(Bank, m).after(onBankItem);
    }

    // By-ID variants look the item up first, then share the same handler
    const onBankItemByID = function (_ret, itemID) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      const item = game.items.getObjectByID(itemID);
      sendBankUpdate.call(this, item);
    };
    for (const m of ['addItemByID', 'removeItemQuantityByID']) {
      this.ctx.patch(Bank, m).after(onBankItemByID);
    }

    // Bank tab purchases (from the shop) — sync tab count so the peer's
    // bank has the same number of tabs available.
    if (typeof Bank.prototype.addTabs === 'function') {
      this.ctx.patch(Bank, 'addTabs').after(function () {
        if (sync._applyingRemote || !sync.transport.isConnected) return;
        sync.transport.send({ t: Msg.BANK_TAB_COUNT, count: this.tabCount });
      });
    }

    logger.info('Bank patches installed: addItem, addItemByID, removeItemQuantity, removeItemQuantityByID, processItemSale, addTabs');
  }

  _applyBankTabCount(msg) {
    if (typeof msg.count !== 'number' || !game.bank) return;
    this._applyRemote('applyBankTabCount', () => {
      const current = game.bank.tabCount || 0;
      // Tab count only ever increases (purchased permanently) — apply the
      // delta via addTabs() so the game's own logic sets up the new tab.
      if (msg.count > current && typeof game.bank.addTabs === 'function') {
        try { game.bank.addTabs(msg.count - current); } catch (e) { logger.warn('addTabs failed', e); }
      }
    });
  }

  _applyBank(msg) {
    const item = this._itemById(msg.itemId);
    if (!item || !item.name) { logger.warn('bank apply: item not found or invalid', msg.itemId); return; }
    const bank = game.bank;
    const current = bank.getQty(item);
    const delta = msg.qty - current;
    if (delta === 0) return;
    // Prevent dupe: if the bank sync says to ADD an item (delta > 0) but the
    // item is currently equipped by the local player, skip the add. This
    // happens when a stale bank sync from an unequip arrives after the
    // equipment sync from a re-equip. The item is already equipped, so adding
    // it back to the bank would create a duplicate.
    if (delta > 0 && this._isItemEquipped(item)) {
      logger.info('Bank sync skip (item equipped):', msg.itemId, 'current:', current, 'target:', msg.qty);
      return;
    }
    logger.info('Bank sync apply:', msg.itemId, 'current:', current, 'target:', msg.qty, 'delta:', delta);
    this._applyRemote('bank apply', () => {
      if (delta > 0) {
        // found=true marks the item as discovered in the completion log,
        // which reveals its picture in the museum and item log. notify=false
        // suppresses the "new item" popup so syncs are silent.
        try { bank.addItem(item, delta, false, true, true, false); } catch (e) { logger.warn('bank addItem failed', msg.itemId, e); }
      } else {
        try { bank.removeItemQuantity(item, -delta, false); } catch (e) { logger.warn('bank removeItem failed', msg.itemId, e); }
      }
      this._queueRender('bank');
    }, { level: 'warn' });
  }

  // ---- Currencies -------------------------------------------------------

  _patchCurrency() {
    // Currency is synced by DELTA, not absolute value. Currency legitimately
    // goes both up (earning) AND down (spending), unlike XP/mastery/completion
    // counts which only ever increase. An earlier version sent the absolute
    // new value and the receiver applied Math.max(local, remote) to avoid
    // regressing progress — but that meant any decrease (buying a shop
    // upgrade, paying a township repair, a raid entry fee, etc.) could never
    // reach the peer, since Math.max always keeps the larger of the two
    // values. The peer's currency would silently stop decreasing while the
    // spending player's own copy went down — "gold not taken" from the
    // peer's perspective. Sending the exact delta and applying it with
    // `current + delta` fixes this and also commutes correctly if two
    // deltas from both players arrive out of order.
    const sendCurrencyDelta = function (amount) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      if (!amount) return;
      sync.transport.send({ t: Msg.CURRENCY, currencyId: this.id, delta: amount });
    };
    const sendCurrencySet = function () {
      sync._send({ t: Msg.CURRENCY, currencyId: this.id, qty: this._amount });
    };
    this.ctx.patch(Currency, 'add').after(function (_ret, amount) { sendCurrencyDelta.call(this, amount); });
    this.ctx.patch(Currency, 'remove').after(function (_ret, amount) { sendCurrencyDelta.call(this, -amount); });
    // set() is rare (used by our own snapshot/apply code, and possibly
    // cheats/debug tools) — it means "this IS the definitive value", so it's
    // still sent as an absolute qty rather than a delta.
    this.ctx.patch(Currency, 'set').after(sendCurrencySet);
  }

  _applyCurrency(msg) {
    const c = this._currencyById(msg.currencyId);
    if (!c) return;
    this._applyRemote('applyCurrency', () => {
      if (typeof msg.delta === 'number') {
        // Apply the exact delta the sender applied on their end. This is
        // commutative regardless of message arrival order and correctly
        // propagates both gains AND spends.
        const newAmt = Math.max(0, (c._amount || 0) + msg.delta);
        c.set(newAmt);
      } else if (typeof msg.qty === 'number') {
        // Absolute set (from Currency.set(), e.g. our own periodic
        // safety-net sync) — trust it directly. No Math.max: currency can
        // legitimately decrease, so clamping to "never go down" would
        // reintroduce the same bug delta-sync fixes.
        c.set(Math.max(0, msg.qty));
      }
      this._queueRender('currency');
    });
  }

  // ---- Equipment --------------------------------------------------------

  _patchEquipment() {
    // --- Gear / equipment sets ---
    const sendEquip = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({
        t: Msg.EQUIPMENT, sets: sync._serializeEquipSets(),
        selectedSet: game.combat.player.selectedEquipmentSet,
      });
    };
    const afterEquip = function () { sendEquip(); };
    for (const m of ['equipItem', 'unequipItem', 'changeEquipmentSet']) {
      this.ctx.patch(Player, m).after(afterEquip);
    }

    // --- Food ---
    const sendFood = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.PLAYER_STATE, ...sync._serializeFood() });
    };
    const afterFood = function () { sendFood(); };
    for (const m of ['equipFood', 'unequipFood']) {
      this.ctx.patch(Player, m).after(afterFood);
    }
    // Patch EquippedFood class methods (prototype-level, works even if player not ready)
    for (const m of ['setSlot', 'unequipSelected']) {
      this.ctx.patch(EquippedFood, m).after(afterFood);
    }
    // Patch food consumption during combat
    this._afterEach(Player, ['eatFood'], afterFood);
    this._afterEach(EquippedFood, ['consume'], afterFood);

    // --- Prayers / Curses / Auroras ---
    const sendPrayers = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.PLAYER_STATE, ...sync._serializePrayers() });
    };
    const afterPrayers = function () { sendPrayers(); };
    for (const m of ['togglePrayer', 'toggleCurse', 'toggleAurora']) {
      this.ctx.patch(Player, m).after(afterPrayers);
    }
    // --- Prayer/soul points changes (combat) ---
    this._afterEach(Player, ['consumePrayerPoints', 'addPrayerPoints', 'consumeSoulPoints', 'addSoulPoints'], afterPrayers);

    // --- Attack spell selection ---
    const sendAttackSpell = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync.transport.send({ t: Msg.PLAYER_STATE, ...sync._serializeAttackSpell() });
    };
    this.ctx.patch(Player, 'selectAttackSpell').after(function () { sendAttackSpell(); });

    // --- Attack styles ---
    const sendAttackStyles = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      // attackStyles is { melee?: AttackStyle, ranged?: AttackStyle, magic?: AttackStyle }
      const styles = sync._serializeAttackStyles();
      sync.transport.send({ t: Msg.PLAYER_STATE, attackStyles: styles });
    };
    // Patch Player class prototype (works even if player instance not ready yet)
    this._afterEach(Player, ['setAttackStyle'], function () { sendAttackStyles(); });
  }

  // Wave-2 serializers: each returns the exact wire fragment its sender
  // emits today, reading state via game.combat.player (never callback this).

  _serializeEquipSets() {
    const sets = [];
    for (let i = 0; i < game.combat.player.equipmentSets.length; i++) {
      const eqSet = game.combat.player.equipmentSets[i];
      const eq = eqSet.equipment;
      const slots = {};
      for (const [slotId, eqItem] of Object.entries(eq.equippedItems)) {
        slots[slotId] = { itemId: eqItem.item.id, qty: eqItem.quantity };
      }
      // Per-set spell/prayer selection
      const spellSel = eqSet.spellSelection || {};
      const prayerSel = eqSet.prayerSelection;
      slots.__spellSelection = {
        attackId: spellSel.attack ? spellSel.attack.id : null,
        curseId: spellSel.curse ? spellSel.curse.id : null,
        auroraId: spellSel.aurora ? spellSel.aurora.id : null,
      };
      slots.__prayerSelection = prayerSel ? [...prayerSel].map(ap => ap.id) : [];
      sets.push(slots);
    }
    return sets;
  }

  _serializeFood() {
    const food = [];
    if (game.combat.player.food && game.combat.player.food.slots) {
      for (let i = 0; i < game.combat.player.food.slots.length; i++) {
        const s = game.combat.player.food.slots[i];
        food.push({ slot: i, itemId: s.item ? s.item.id : null, qty: s.quantity });
      }
    }
    return { food, selectedFoodSlot: game.combat.player.food.selectedSlot };
  }

  _serializePrayers() {
    const prayers = [];
    if (game.combat.player.activePrayers) for (const ap of game.combat.player.activePrayers) prayers.push(ap.id);
    return {
      prayers,
      prayerPoints: game.combat.player.prayerPoints,
      soulPoints: game.combat.player.soulPoints,
    };
  }

  _serializeAttackSpell() {
    return {
      attackSpellId: (game.combat.player.spellSelection && game.combat.player.spellSelection.attack) ? game.combat.player.spellSelection.attack.id : null,
      curseSpellId: (game.combat.player.spellSelection && game.combat.player.spellSelection.curse) ? game.combat.player.spellSelection.curse.id : null,
      auroraSpellId: (game.combat.player.spellSelection && game.combat.player.spellSelection.aurora) ? game.combat.player.spellSelection.aurora.id : null,
    };
  }

  _serializeAttackStyles() {
    // attackStyles is { melee?: AttackStyle, ranged?: AttackStyle, magic?: AttackStyle }
    const styles = [];
    const as = game.combat.player.attackStyles;
    if (as) {
      for (const at of ['melee', 'ranged', 'magic']) {
        const style = as[at];
        styles.push({ attackType: at, styleId: style ? style.id : null });
      }
    }
    return styles;
  }

  _applyEquipment(msg) {
    if (!msg.sets || !game.combat.player) return;
    this._applyRemote('applyEquipment', () => {
      this._applyEquipmentSets(msg.sets, { warn: true });
      // Switch to the remote's selected equipment set.
      if (typeof msg.selectedSet === 'number' && msg.selectedSet !== game.combat.player.selectedEquipmentSet) {
        try { game.combat.player.changeEquipmentSet(msg.selectedSet); } catch (e) { /* skip */ }
      }
      this._updateEquipmentAfterSync();
      // Update active skills/minibar
      this._queueRender('xp');
    });
  }

  // Shared equipment-sets apply core (live EQUIPMENT message + snapshot
  // equipSets block). Guard-neutral: never touches _applyingRemote or
  // _scheduleSave — callers keep their wrappers. `warn` enables the live
  // handler's per-slot warning logs; the snapshot applies silently.
  // Callers must guard game.combat.player before calling.
  _applyEquipmentSets(sets, { warn = false } = {}) {
    const player = game.combat.player;
    for (let i = 0; i < sets.length; i++) {
      const remoteSlots = sets[i];
      const eqSet = player.equipmentSets[i];
      if (!eqSet) continue;
      const eq = eqSet.equipment;
      // Unequip slots that are no longer equipped remotely.
      // unequipItem already returns the item to bank internally
      for (const [slotId, eqItem] of Object.entries(eq.equippedItems)) {
        if (remoteSlots[slotId] === undefined) {
          const slot = game.equipmentSlots.getObjectByID(slotId);
          if (slot) {
            try { eq.unequipItem(slot); } catch (e) { if (warn) logger.warn(`unequip ${slotId} failed: ${e.message}`); }
          }
        }
      }
      // Equip / update slots to match remote.
      // equipItem already removes the item from bank internally
      for (const [slotId, remote] of Object.entries(remoteSlots)) {
        if (slotId === '__spellSelection' || slotId === '__prayerSelection') continue;
        const local = eq.equippedItems[slotId];
        const item = this._itemById(remote.itemId);
        if (!item) { if (warn) logger.warn(`equip: item not found: ${remote.itemId}`); continue; }
        const slot = game.equipmentSlots.getObjectByID(slotId);
        if (!slot) { if (warn) logger.warn(`equip: slot not found: ${slotId}`); continue; }
        if (local && local.item.id === remote.itemId && local.quantity === remote.qty) continue;
        // Unequip current item if any (returns to bank)
        if (local) {
          try { eq.unequipItem(slot); } catch (e) { if (warn) logger.warn(`unequip before equip ${slotId} failed: ${e.message}`); }
        }
        // Ensure item is in bank (add if missing, since UNLOCK_ALL may have equipped it already)
        if (!game.bank.hasItem(item)) {
          try { game.bank.addItem(item, remote.qty, false, true, true, false); } catch (e) { /* skip */ }
        }
        // Equip — equipItem removes from bank internally
        try {
          eq.equipItem(item, slot, remote.qty);
        } catch (e) {
          if (warn) logger.warn(`equip ${slotId} with ${remote.itemId} failed: ${e.message}`);
        }
      }
      // Per-set spell selection
      if (remoteSlots.__spellSelection && eqSet.spellSelection) {
        const ss = remoteSlots.__spellSelection;
        try {
          if (ss.attackId) {
            const sp = game.attackSpells.getObjectByID(ss.attackId);
            if (sp && player.selectAttackSpell) player.selectAttackSpell(sp, false);
          }
          if (ss.curseId) {
            const sp = game.curseSpells && game.curseSpells.getObjectByID(ss.curseId);
            if (sp && player.toggleCurse) player.toggleCurse(sp, false);
          }
          if (ss.auroraId) {
            const sp = game.auroraSpells && game.auroraSpells.getObjectByID(ss.auroraId);
            if (sp && player.toggleAurora) player.toggleAurora(sp, false);
          }
        } catch { /* skip */ }
      }
      // Per-set prayer selection
      if (remoteSlots.__prayerSelection && eqSet.prayerSelection) {
        try {
          eqSet.prayerSelection.clear();
          for (const pid of remoteSlots.__prayerSelection) {
            // game.prayers is NamespaceRegistry<ActivePrayer>, so
            // getObjectByID already returns an ActivePrayer instance.
            const ap = game.prayers && game.prayers.getObjectByID(pid);
            if (ap) eqSet.prayerSelection.add(ap);
          }
        } catch { /* skip */ }
      }
    }
  }

  // Post-equipment-sync refresh: stat recalc, equip-set UI update, render
  // flags, bank re-render. Guard-neutral. Shared by the live EQUIPMENT
  // handler and the snapshot equipSets block (the live handler's selectedSet
  // switch and extra xp render stay at its call site, between the two calls).
  _updateEquipmentAfterSync() {
    const player = game.combat.player;
    // Properly update stats and UI — updateForEquipmentChange does stat recalc + UI update
    try { player.updateForEquipmentChange(); } catch (e) { /* skip */ }
    // Render equipment sets menu
    try { player.updateForEquipSetChange(); } catch (e) { /* skip */ }
    // Set render queue flags for equipment and bank
    if (player.renderQueue) {
      player.renderQueue.equipment = true;
      player.renderQueue.equipmentSets = true;
    }
    // Force bank to re-render (items moved in/out of bank)
    this._queueRender('bank');
  }

  // ---- Pets -------------------------------------------------------------

  _patchPets() {
    this.ctx.patch(PetManager, 'unlockPet').after(function (_ret, pet) {
      sync._send({ t: Msg.PET, petId: pet.id });
    });
  }

  _applyPet(msg) {
    const pet = game.pets.getObjectByID(msg.petId);
    if (!pet) return;
    this._applyRemote('applyPet', () => {
      if (!game.petManager.unlocked.has(pet)) {
        game.petManager.unlocked.add(pet);
        if (game.petManager.computeProvidedStats) game.petManager.computeProvidedStats();
      }
    });
  }

  // ---- Item Charges -----------------------------------------------------

  _patchItemCharges() {
    const sendCharges = function (_ret, item) {
      sync._send({ t: Msg.ITEM_CHARGE, itemId: item.id, charges: this.getCharges(item) });
    };
    for (const m of ['addCharges', 'removeCharges']) this.ctx.patch(ItemCharges, m).after(sendCharges);
  }

  _applyItemCharge(msg) {
    const item = this._itemById(msg.itemId);
    if (!item) return;
    this._applyRemote('applyItemCharge', () => {
      const current = game.itemCharges.getCharges(item);
      // Only increase charges — never decrease via sync. Charges decrease
      // through actual item usage, not through remote sync.
      if (msg.charges > current) game.itemCharges.addCharges(item, msg.charges - current);
      if (game.itemCharges.render) game.itemCharges.render();
    });
  }

  // ---- Potions ----------------------------------------------------------

  _patchPotions() {
    const sendPotions = function () {
      sync._send({ t: Msg.POTION, potions: sync._serializePotions() });
    };
    for (const m of ['usePotion', 'removePotion']) this.ctx.patch(PotionManager, m).after(sendPotions);
  }

  _serializePotions() {
    const potions = [];
    game.potions.activePotions.forEach((active, action) => {
      potions.push({ actionId: action.id, itemId: active.item.id, charges: active.charges });
    });
    return potions;
  }

  _applyPotion(msg) {
    if (!msg.potions || !game.potions) return;
    this._applyRemote('applyPotion', () => {
      game.potions.activePotions.forEach((ap, action) => {
        game.potions.removePotion(action, true);
      });
      // usePotion(item, loadPotions?) takes only the item — no action needed.
      // The actionId in the message is informational (which action the potion
      // was used for) but usePotion assigns the potion to the currently
      // selected action internally.
      for (const p of msg.potions) {
        const item = this._itemById(p.itemId);
        if (!item) continue;
        try { game.potions.usePotion(item, true); } catch { /* skip */ }
      }
      if (game.potions.computeProvidedStats) game.potions.computeProvidedStats();
      if (game.potions.render) game.potions.render();
    }, { save: false });
  }

  // ---- Shop / Upgrades --------------------------------------------------

  _patchShop() {
    // Sync when a shop purchase is made. Both buyItemOnClick and
    // quickBuyItemOnClick are separate code paths that need patching.
    const sendShopState = function () {
      sync._send({ t: Msg.SHOP, upgrades: sync._serializeShopUpgrades() });
    };
    for (const m of ['buyItemOnClick', 'quickBuyItemOnClick']) {
      this.ctx.patch(Shop, m).after(sendShopState);
    }
  }

  _serializeShopUpgrades() {
    const upgrades = {};
    for (const [p, count] of game.shop.upgradesPurchased) {
      upgrades[p.id] = count;
    }
    return upgrades;
  }

  _applyShop(msg) {
    if (!msg.upgrades || !game.shop) return;
    this._applyRemote('applyShop', () => {
      const changedPurchases = [];
      for (const [purchaseId, count] of Object.entries(msg.upgrades)) {
        const purchase = game.shop.purchases.getObjectByID(purchaseId);
        if (!purchase) continue;
        const current = game.shop.upgradesPurchased.get(purchase) || 0;
        const delta = count - current;
        if (delta > 0) {
          // Apply the purchase delta without charging currency again.
          game.shop.upgradesPurchased.set(purchase, count);
          changedPurchases.push(purchase);
        }
      }
      if (changedPurchases.length === 0) return;
      if (game.shop.computeProvidedStats) game.shop.computeProvidedStats();
      // Mirror the render queue flags set by the real buyItemOnClick so
      // unlock displays in other skills update on the peer.
      if (game.shop.renderQueue) {
        game.shop.renderQueue.upgrades = true;
        game.shop.renderQueue.requirements = true;
        game.shop.renderQueue.costs = true;
      }
      if (game.queueRequirementRenders) game.queueRequirementRenders();
      if (game.woodcutting?.renderQueue) game.woodcutting.renderQueue.treeUnlocks = true;
      if (game.mining?.renderQueue) game.mining.renderQueue.rockUnlock = true;
      if (game.harvesting?.renderQueue) game.harvesting.renderQueue.veinUnlock = true;
      if (game.archaeology?.actions) {
        game.archaeology.actions.forEach((action) => {
          if (game.archaeology.renderQueue?.digSites) game.archaeology.renderQueue.digSites.add(action);
        });
      }
      if (game.firemaking?.renderQueue) game.firemaking.renderQueue.oilQty = true;
      // Emit the purchaseMade event — other systems (requirements, mod
      // listeners) depend on it.
      for (const purchase of changedPurchases) {
        try {
          const event = new ShopPurchaseMadeEvent(purchase, 1);
          game.shop._events.emit('purchaseMade', event);
        } catch (e) { /* event emission is best-effort */ }
      }
      // The critical call: updateItemSelection() on the relevant tab is what
      // actually makes the shop "advance" — it removes the purchased item
      // from the list (shouldShowItem returns DontShow/ShowAtBuyLimit) and
      // creates new ShopItem DOM elements for the next upgrade in the chain
      // that just became available. Without this the peer's shop still shows
      // the old upgrade as buyable. updateItemPostPurchase only updates the
      // description of an existing item — it does NOT remove it or create
      // new ones.
      if (typeof shopMenu !== 'undefined' && shopMenu) {
        for (const purchase of changedPurchases) {
          try {
            const tab = shopMenu.tabs.get(purchase.category);
            if (tab) tab.menu.updateItemSelection();
          } catch (e) { /* shop may not be open yet */ }
          try { shopMenu.updateItemPostPurchase(purchase); } catch (e) { /* ignore */ }
        }
        try { shopMenu.updateForCostChange(); } catch (e) { /* ignore */ }
        try { shopMenu.updateForRequirementChange(); } catch (e) { /* ignore */ }
      }
      // Process the shop's internal render queue (renderUpgrades updates
      // upgrade-chain-display elements in the sidebar/etc.).
      if (game.shop.render) game.shop.render();
      this._forceRender();
    });
  }

  // ---- Tutorial ---------------------------------------------------------
  // The tutorial has stages with tasks. We sync task progress, stage claims,
  // and stage transitions. We call actual game methods for stage transitions
  // to avoid crashing the render system.

  _patchTutorial() {
    // Broadcast after any task progress update or stage transition.
    const sendTutorial = () => {
      sync._send({ t: Msg.TUTORIAL, tutorial: sync._buildTutorialState() });
    };
    /** @type {Array<[any, string]>} */
    const tutorialPatches = [
      [Tutorial, 'updateTaskProgress'],
      [Tutorial, 'startNextStage'],
      [Tutorial, 'completeTutorial'],
      [TutorialStage, 'setClaimed'],
      [Tutorial, 'skipTutorial'],
    ];
    for (const [C, m] of tutorialPatches) {
      if (typeof C !== 'undefined' && typeof C.prototype[m] === 'function') this.ctx.patch(C, m).after(sendTutorial);
    }
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
    this._applyRemote('applyTutorial', () => {
      // Handle tutorial completion.
      if (data.complete && !t.complete) {
        try { t.completeTutorial(); } catch (e) { logger.warn('tutorial completeTutorial failed', e); }
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
            task.progress = Math.max(task.progress || 0, taskData.progress);
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
    });
  }

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
    // Patch respawnRock so rock respawns sync to the peer.
    if (typeof Mining.prototype.respawnRock === 'function') {
      this.ctx.patch(Mining, 'respawnRock').after(function () {
        if (sync._applyingRemote || !sync.transport.isConnected) return;
        sync._sendRockHP();
      });
    }
    // Don't patch passiveTick — it fires every game tick (20x/sec) and
    // would flood the network. renderRockHP already fires when rock HP
    // actually changes, which is all we need.
  }

  _serializeRockHP() {
    const rocks = [];
    for (const rock of game.mining.actions.allObjects) {
      if (rock && typeof rock.currentHP === 'number') {
        rocks.push({ id: rock.id, hp: rock.currentHP, maxHp: rock.maxHP });
      }
    }
    return rocks;
  }

  _sendRockHP() {
    const mining = game.mining;
    if (!mining) return;
    const rocks = [];
    for (const r of this._serializeRockHP()) {
      // Only send if HP changed since last send.
      const key = r.id;
      const last = this._lastRockHP ? this._lastRockHP[key] : undefined;
      if (last !== undefined && last === r.hp) continue;
      if (!this._lastRockHP) this._lastRockHP = {};
      this._lastRockHP[key] = r.hp;
      rocks.push(r);
    }
    if (rocks.length === 0) return; // Nothing changed — don't send.
    this.transport.send({ t: Msg.ROCK_HP, rocks });
  }

  _applyRockHP(msg) {
    const mining = game.mining;
    if (!mining || !msg.rocks) return;
    this._applyRemote('applyRockHP', () => {
      const changed = this._applyRockHPList(msg.rocks);
      // Only re-render if we actually changed something.
      if (changed) {
        if (mining.renderRockHP) mining.renderRockHP();
        if (mining.renderRockStatus) mining.renderRockStatus();
      }
    }, { save: false });
  }

  // Apply a rock-HP list, skipping the rock the local player is currently
  // mining — the local game manages depletion for the rock being mined, and
  // syncing HP=0 from the remote would stop our action. Guard-neutral.
  // Returns true if any rock changed; rendering stays at the call sites
  // (the live handler renders only on change, the snapshot unconditionally).
  _applyRockHPList(rocks) {
    const mining = game.mining;
    // Determine which rock the local player is currently mining so we
    // don't overwrite its HP.
    let localRockId = null;
    try {
      if (mining.selectedRock && mining.selectedRock.id) localRockId = mining.selectedRock.id;
      else if (mining.activeProgressRock && mining.activeProgressRock.id) localRockId = mining.activeProgressRock.id;
    } catch { /* noop */ }
    let changed = false;
    for (const r of rocks) {
      // Skip the rock the local player is actively mining.
      if (localRockId && r.id === localRockId) continue;
      const rock = mining.actions.getObjectByID(r.id);
      if (!rock) continue;
      if (typeof r.hp === 'number') { rock.currentHP = r.hp; changed = true; }
      if (typeof r.maxHp === 'number') { rock.maxHP = r.maxHp; changed = true; }
    }
    return changed;
  }

  // ---- Farming sync -----------------------------------------------------
  // Syncs plot unlocks, planted seeds, compost, and growth state.
  // Uses action-based sync: each action (unlock, plant, compost, harvest)
  // is sent as a discrete event and replayed on the receiver.

  _patchFarming() {
    const farming = game.farming;
    if (!farming) return;
    logger.info('[FARM] _patchFarming: starting, farming plots count:', farming.plots ? farming.plots.size : 'unknown');
    logger.info('[FARM] unlockPlotOnClick type:', typeof farming.unlockPlotOnClick);
    logger.info('[FARM] plantPlot type:', typeof farming.plantPlot);
    logger.info('[FARM] compostPlot type:', typeof farming.compostPlot);

    // Patch the farming custom elements to be error-resilient.
    // The game's rendering code throws "Cannot read properties of undefined
    // (reading 'item')" when rendering some plots (e.g. recipe.seedCost.item
    // is undefined for some recipes). This crashes the entire category view
    // AND the game's main render loop. We wrap ALL update methods in
    // try/catch so one broken plot doesn't break the rest. `label` overrides
    // the log tag (defaults to ConstructorName.methodName).
    const wrapMethod = (proto, name, label) => {
      if (!proto || !proto[name]) return false;
      const orig = proto[name];
      const tag = label || `${proto.constructor.name}.${name}`;
      proto[name] = function (...args) {
        try { return orig.apply(this, args); }
        catch (e) { logger.warn(`[FARM] ${tag} threw: ${e.message}`); }
      };
      return true;
    };

    try {
      // Patch LockedFarmingPlotElement — used for locked plots
      const LockedPlotEl = customElements.get('locked-farming-plot');
      if (LockedPlotEl) {
        wrapMethod(LockedPlotEl.prototype, 'setPlot');
        logger.info('[FARM] Patched LockedFarmingPlotElement');
      }

      // Patch FarmingPlotElement — used for unlocked plots.
      // updateGrowthTime is called during renderGrowthStatus which is
      // called from Farming.render() in the main render loop. If it
      // throws, the entire game render crashes.
      const PlotEl = customElements.get('farming-plot');
      if (PlotEl) {
        for (const m of ['setPlot', 'updateCompost', 'updatePlotState',
                         'updateGrowthTime', 'updateSelectedSeed',
                         'updateSeedQuantities', 'destroyTooltips']) {
          if (wrapMethod(PlotEl.prototype, m)) {
            logger.info(`[FARM] Patched FarmingPlotElement.${m}`);
          }
        }
      }

      // Also patch the category options element
      const CatOptsEl = customElements.get('farming-category-options');
      if (CatOptsEl) {
        wrapMethod(CatOptsEl.prototype, 'setCategory');
        logger.info('[FARM] Patched FarmingCategoryOptionsElement.setCategory');
      }
    } catch (e) { logger.warn('[FARM] Could not patch custom elements:', e.message); }

    // Patch Farming.renderGrowthStatus — iterates over plot elements and
    // calls updateGrowthTime. If one throws, the rest don't get rendered.
    if (typeof Farming.prototype.renderGrowthStatus === 'function') {
      wrapMethod(Farming.prototype, 'renderGrowthStatus', 'renderGrowthStatus');
      logger.info('[FARM] Patched Farming.renderGrowthStatus');
    }

    // Patch Farming.render — the main render method called from the game
    // render loop. If it throws, the entire game UI breaks.
    if (typeof Farming.prototype.render === 'function') {
      wrapMethod(Farming.prototype, 'render', 'Farming.render');
      logger.info('[FARM] Patched Farming.render');
    }

    // Patch showPlotsInCategory to be error-resilient. The original can
    // throw mid-render, leaving the category view half-rendered.
    if (typeof Farming.prototype.showPlotsInCategory === 'function') {
      const origShowPlots = Farming.prototype.showPlotsInCategory;
      Farming.prototype.showPlotsInCategory = function (category) {
        try {
          return origShowPlots.call(this, category);
        } catch (e) {
          logger.warn(`[FARM] showPlotsInCategory threw for ${category?.id}: ${e.message}`);
          // Try a second time — sometimes the first call partially succeeds
          // and the second call can complete the render.
          try { return origShowPlots.call(this, category); }
          catch (e2) { logger.warn(`[FARM] showPlotsInCategory second try also threw: ${e2.message}`); }
        }
      };
      logger.info('[FARM] Patched showPlotsInCategory');
    }

    const sendPlot = function (plot) {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      if (!plot || !plot.id) return;
      sync._sendFarmingPlot(plot);
    };

    // Replace unlockPlotOnClick entirely — the newer Melvor version uses
    // currencyCosts/itemCosts instead of gpCost (which is @deprecated).
    // The original function throws "Cannot read properties of undefined
    // (reading 'item')" because it tries to access itemCosts items that
    // don't exist. It eats gold before throwing and leaves the DOM broken.
    // So we replace it completely and do everything ourselves.
    Farming.prototype.unlockPlotOnClick = function (plot) {
      if (!plot) {
        logger.warn('[FARM] unlockPlotOnClick called with no plot');
        return;
      }
      // Already unlocked — do nothing
      if (plot.state !== 0) {
        logger.info(`[FARM] unlockPlotOnClick: plot ${plot.id} already unlocked (state=${plot.state})`);
        return;
      }
      const gpBefore = game.gp ? game.gp.amount : 0;
      logger.info(`[FARM] unlockPlotOnClick: plot=${plot.id}, state=${plot.state}, level=${plot.level}, myLevel=${this._level}, myGP=${gpBefore}`);

      // Pay costs using the Costs system (handles currencyCosts + itemCosts)
      let paid = false;
      try {
        if (this.getPlotUnlockCosts) {
          const costs = this.getPlotUnlockCosts(plot);
          logger.info(`[FARM] getPlotUnlockCosts returned: ${costs ? typeof costs : 'null'}`);
          if (costs) {
            // Check if we can afford it
            if (costs.checkIfOwned && costs.checkIfOwned()) {
              costs.consumeCosts();
              paid = true;
              logger.info(`[FARM] Paid costs via Costs API for ${plot.id}, gp now=${game.gp ? game.gp.amount : 'no-gp'}`);
            } else {
              logger.warn(`[FARM] Cannot afford costs for ${plot.id}`);
              // Can't afford — don't unlock
              return;
            }
          }
        }
      } catch (e) {
        logger.warn(`[FARM] Cost payment threw: ${e.message}`);
        // Restore any GP that was eaten
        if (game.gp && game.gp.amount < gpBefore) {
          const eaten = gpBefore - game.gp.amount;
          try { game.gp.add(eaten); logger.info(`[FARM] Restored ${eaten} GP after cost error`); }
          catch (e2) { /* skip */ }
        }
      }

      // Force the unlock — set state to Empty
      plot.state = 1;
      logger.info(`[FARM] Unlocked plot ${plot.id}, state=${plot.state}, paid=${paid}`);

      // Re-render the UI completely
      try {
        if (this.showPlotsInCategory && plot.category) {
          this.showPlotsInCategory(plot.category);
        }
      } catch (e) { logger.warn(`[FARM] showPlotsInCategory threw: ${e.message}`); }
      try { if (this.render) this.render(); } catch (e) { /* skip */ }
      try { if (this.renderPlotVisibility) this.renderPlotVisibility(); } catch (e) { /* skip */ }

      // Sync to peer
      sendPlot(plot);
    };

    // Single-plot plant/harvest methods share one log format; the bulk
    // ("...All...") methods share one send-everything callback.
    const logSendPlot = (name) => function (_ret, plot) {
      logger.info(`[FARM] ${name} called: plot=${plot ? plot.id : 'null'}, state=${plot ? plot.state : 'null'}`);
      sendPlot(plot);
    };
    // Planting — sync so both players plant the same seeds.
    // Harvesting — sync so both players harvest.
    for (const m of ['plantPlot', 'plantPlotOnClick', 'harvestPlot', 'harvestPlotOnClick']) {
      this.ctx.patch(Farming, m).after(logSendPlot(m));
    }
    this.ctx.patch(Farming, 'plantRecipe').after(function (_ret, recipe, plot) {
      sendPlot(plot);
    });
    // Compost — sync so both players compost (weird gloop, abyssal compost, etc.)
    this.ctx.patch(Farming, 'compostPlot').after(function (_ret, plot) {
      logger.info(`[FARM] compostPlot called: plot=${plot ? plot.id : 'null'}, compostLevel=${plot ? plot.compostLevel : 'null'}, compostItem=${plot && plot.compostItem ? plot.compostItem.id : 'null'}`);
      sendPlot(plot);
    });

    // Destroy / clear / reset / selected recipe changes — same body, no logging
    const onPlot = function (_ret, plot) { sendPlot(plot); };
    for (const m of ['destroyPlot', 'destroyPlotOnClick', 'clearDeadPlot', 'resetPlot', 'setPlantAllSelected']) {
      this.ctx.patch(Farming, m).after(onPlot);
    }
    // Compost removal
    this._afterEach(Farming, ['removeCompostFromPlot'], onPlot);

    // Bulk operations — send every plot
    const sendAllPlots = function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    };
    for (const m of ['plantAllPlots', 'plantAllOnClick', 'plantAllRecipe',
                     'plantAllSelectedOnClick', 'harvestAllOnClick', 'compostAllOnClick']) {
      this.ctx.patch(Farming, m).after(sendAllPlots);
    }
    // Growth tick — send updates when plots grow
    this.ctx.patch(Farming, 'growPlots').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      logger.info('[FARM] growPlots tick — sending all plots');
      sync._sendAllFarmingPlots();
    });
  }

  _sendFarmingPlot(plot) {
    const data = this._serializePlot(plot);
    if (!data) return;
    logger.info(`[FARM] Sending plot: ${JSON.stringify(data)}`);
    this.transport.send({ t: Msg.FARMING, plots: [data] });
  }

  _sendAllFarmingPlots() {
    if (!game.farming) return;
    const plots = this._serializeAllPlots();
    if (plots.length === 0) return;
    this.transport.send({ t: Msg.FARMING, plots });
  }

  _serializeAllPlots() {
    const plots = [];
    for (const plot of game.farming.plots.allObjects) {
      const data = this._serializePlot(plot);
      if (data) plots.push(data);
    }
    return plots;
  }

  _serializePlot(plot) {
    if (!plot || !plot.id) return null;
    const farming = game.farming;
    // Get remaining growth time from the timer (what the UI displays)
    let remainingTimeMs = 0;
    if (farming && farming.getPlotGrowthTime && plot.state === 2) {
      try { remainingTimeMs = farming.getPlotGrowthTime(plot); } catch { /* noop */ }
    }
    return {
      id: plot.id,
      state: plot.state,
      plantedRecipeId: plot.plantedRecipe ? plot.plantedRecipe.id : null,
      compostItemId: plot.compostItem ? plot.compostItem.id : null,
      compostLevel: plot.compostLevel,
      growthTime: plot.growthTime,
      remainingTimeMs,
      selectedRecipeId: plot.selectedRecipe ? plot.selectedRecipe.id : null,
      abyssalLevel: typeof plot.abyssalLevel === 'number' ? plot.abyssalLevel : 0,
    };
  }

  // FarmingRecipe lookup — recipes live in farming.actions (a NamespaceRegistry),
  // so getObjectByID covers every registered recipe.
  _farmRecipe(id) {
    if (!id || !game.farming.actions) return null;
    return game.farming.actions.getObjectByID(id);
  }

  _stopGrowthTimer(farming, plot) {
    const timer = farming.growthTimerMap.get(plot);
    if (timer) {
      try { timer.stop(); } catch { /* noop */ }
      if (farming.growthTimers && farming.growthTimers.delete) {
        try { farming.growthTimers.delete(timer); } catch { /* noop */ }
      }
      farming.growthTimerMap.delete(plot);
    }
  }

  _ensureGrowthTimer(farming, plot, recipe, remainingMs, logTag) {
    // Use the remaining time from the sender if available,
    // otherwise compute the full interval.
    let intervalMs = remainingMs || 0;
    if (intervalMs <= 0 && farming.modifyInterval && recipe && recipe.baseInterval) {
      try { intervalMs = farming.modifyInterval(recipe.baseInterval, recipe); }
      catch { intervalMs = recipe.baseInterval; }
    }
    if (intervalMs > 0) {
      // Remove any existing timer for this plot first
      this._stopGrowthTimer(farming, plot);
      // Create a new growth timer with the remaining time
      try {
        farming.createGrowthTimer([plot], intervalMs);
        logger.info(`[FARM] Created ${logTag} for ${plot.id}, interval=${intervalMs}ms`);
      } catch (e) {
        logger.warn(`[FARM] Failed to create ${logTag}: ${e.message}`);
      }
    }
  }

  _queueFarmRender(farming, plot) {
    if (farming.renderQueue) {
      if (farming.renderQueue.growthState) farming.renderQueue.growthState.add(plot);
      if (farming.renderQueue.growthTime) {
        const timer = farming.growthTimerMap.get(plot);
        if (timer) farming.renderQueue.growthTime.add(timer);
      }
    }
  }

  _applyFarming(msg) {
    const farming = game.farming;
    if (!farming || !msg.plots) return;
    logger.info(`[FARM] _applyFarming: received ${msg.plots.length} plots`);
    this._applyRemote('applyFarming', () => {
      for (const p of msg.plots) {
        const plot = farming.plots.getObjectByID(p.id);
        if (!plot) {
          logger.warn(`[FARM] Plot not found: ${p.id}`);
          continue;
        }
        logger.info(`[FARM] Applying: plot=${p.id}, remoteState=${p.state}, localState=${plot.state}, plantedRecipeId=${p.plantedRecipeId}, compostItemId=${p.compostItemId}, compostLevel=${p.compostLevel}`);

        // Handle plot unlock: if the plot was unlocked by the other player,
        // unlock it here too (without charging)
        if (typeof p.state === 'number' && p.state > 0 && plot.state === 0) {
          // Plot is unlocked on the other side but locked here — unlock it
          plot.state = 1; // Empty
          logger.info(`[FARM] Synced plot unlock: ${p.id}`);
          // Force show plots in category to update UI
          if (farming.showPlotsInCategory && plot.category) {
            try { farming.showPlotsInCategory(plot.category); } catch (e) { /* skip */ }
          }
        }

        // Handle planting: if the other player planted, plant here too
        if (p.plantedRecipeId && p.state >= 2 && plot.state === 1) {
          // Other player has a crop growing, we're empty — plant it
          // FarmingRecipe is stored in farming.actions, not game.items
          const recipe = this._farmRecipe(p.plantedRecipeId);
          if (recipe) {
            // Set plot state directly (don't consume seeds on the receiver)
            plot.state = p.state;
            plot.plantedRecipe = recipe;
            plot.growthTime = p.growthTime || 0;
            logger.info(`[FARM] Synced plant: ${p.id} → ${p.plantedRecipeId}, state=${p.state}`);

            // Create a growth timer so the UI shows the remaining time
            // and the crop eventually grows/hrows on the receiver too.
            if (p.state === 2 && farming.createGrowthTimer) {
              this._ensureGrowthTimer(farming, plot, recipe, p.remainingTimeMs, 'growth timer');
            }
            // Queue render updates
            this._queueFarmRender(farming, plot);
          } else {
            logger.warn(`[FARM] Recipe not found: ${p.plantedRecipeId}`);
            // Fallback: set state directly
            plot.state = p.state;
            plot.plantedRecipe = undefined;
            plot.growthTime = p.growthTime || 0;
          }
        } else if (p.plantedRecipeId && p.state >= 2 && plot.state >= 2) {
          // Both have a crop growing — just update the remaining time
          // if the sender has a different recipe or the plot was reset
          const recipe = this._farmRecipe(p.plantedRecipeId);
          if (recipe && plot.plantedRecipe !== recipe) {
            // Different recipe — update it
            plot.plantedRecipe = recipe;
            plot.growthTime = p.growthTime || 0;
            logger.info(`[FARM] Updated planted recipe: ${p.id} → ${p.plantedRecipeId}`);
          }
          // If the receiver has no timer but the sender does, create one
          if (p.state === 2 && farming.growthTimerMap && !farming.growthTimerMap.get(plot) && farming.createGrowthTimer) {
            this._ensureGrowthTimer(farming, plot, recipe, p.remainingTimeMs, 'missing growth timer');
          }
        } else {
          // Handle harvest, destroy, clear dead, etc.
          const oldState = plot.state;

          // If the plot was Grown (3) and the remote says it's now Empty (1),
          // the other player harvested it. Try to harvest locally too so
          // we get the products in our bank.
          if (oldState === 3 && p.state === 1 && plot.plantedRecipe && farming.harvestPlot) {
            try {
              farming.harvestPlot(plot);
              logger.info(`[FARM] Synced harvest: ${p.id}`);
            } catch (e) {
              logger.warn(`[FARM] Synced harvest failed, setting state directly: ${e.message}`);
              plot.state = 1;
              plot.plantedRecipe = undefined;
              plot.growthTime = 0;
            }
          }
          // If the plot was Dead (4) and the remote says it's now Empty (1),
          // the other player cleared the dead plot.
          else if (oldState === 4 && p.state === 1) {
            plot.state = 1;
            plot.plantedRecipe = undefined;
            plot.growthTime = 0;
            logger.info(`[FARM] Synced clear dead: ${p.id}`);
          }
          // If the plot was Growing (2) or Grown (3) and the remote says
          // it's now Empty (1), the other player destroyed/cleared it.
          else if ((oldState === 2 || oldState === 3) && p.state === 1) {
            plot.state = 1;
            plot.plantedRecipe = undefined;
            plot.growthTime = 0;
            logger.info(`[FARM] Synced destroy/clear: ${p.id}`);
          }
          // Otherwise just update the state directly
          else {
            if (typeof p.state === 'number') plot.state = p.state;
            if (p.plantedRecipeId !== undefined) {
              // FarmingRecipe is a MasteryAction in game.farming.actions,
              // not an Item — don't fall back to game.items.
              const plantedRecipe = this._farmRecipe(p.plantedRecipeId);
              plot.plantedRecipe = plantedRecipe || undefined;
            }
            if (typeof p.growthTime === 'number') plot.growthTime = p.growthTime;
          }

          // Remove growth timer if the plot is no longer growing
          if (p.state !== 2 && farming.growthTimerMap) {
            this._stopGrowthTimer(farming, plot);
          }
          // Queue render updates
          this._queueFarmRender(farming, plot);
          logger.info(`[FARM] State update: ${p.id} ${oldState}→${p.state}`);
        }

        // Handle compost: sync compost item and level
        if (p.compostItemId !== undefined) {
          // CompostItem is in game.items but also accessible via farming.composts
          let compostItem = p.compostItemId ? game.items.getObjectByID(p.compostItemId) : undefined;
          if (!compostItem && farming.composts) {
            compostItem = farming.composts.getObjectByID(p.compostItemId);
          }
          if (compostItem) {
            // Try to apply compost via the game method (only works on empty plots)
            if (farming.compostPlot && plot.compostLevel < p.compostLevel && plot.state === 1) {
              try {
                const amount = p.compostLevel - plot.compostLevel;
                farming.compostPlot(plot, compostItem, amount);
                logger.info(`[FARM] Synced compost: ${p.id} → ${p.compostItemId}, level ${p.compostLevel}`);
              } catch (e) {
                // Fallback: set directly
                plot.compostItem = compostItem;
                plot.compostLevel = p.compostLevel;
                logger.warn(`[FARM] Compost failed, set directly: ${p.id}`);
              }
            } else {
              // Direct set — works for any plot state
              plot.compostItem = compostItem;
              plot.compostLevel = p.compostLevel;
              if (farming.renderQueue && farming.renderQueue.compost) {
                farming.renderQueue.compost.add(plot);
              }
            }
          } else {
            plot.compostItem = undefined;
            plot.compostLevel = p.compostLevel || 0;
          }
        }

        // Sync selected recipe
        if (p.selectedRecipeId !== undefined) {
          // FarmingRecipe is a MasteryAction in farming.actions, not an Item.
          const selectedRecipe = this._farmRecipe(p.selectedRecipeId);
          plot.selectedRecipe = p.selectedRecipeId ? selectedRecipe : undefined;
        }

        // Sync abyssal level (required for abyssal farming plots)
        if (typeof p.abyssalLevel === 'number' && 'abyssalLevel' in plot) {
          plot.abyssalLevel = p.abyssalLevel;
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
    });
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

    // Patch the activeObstacle getter to not throw when no obstacle is built.
    // The game throws "Tried to get active obstacle, but none is built" which
    // crashes the entire tick loop. We make it return undefined instead.
    try {
      const desc = Object.getOwnPropertyDescriptor(Agility.prototype, 'activeObstacle');
      if (desc && desc.get) {
        const origGet = desc.get;
        Object.defineProperty(Agility.prototype, 'activeObstacle', {
          get() {
            try { return origGet.call(this); }
            catch (e) { return undefined; }
          },
          configurable: true,
        });
        logger.info('[AGILITY] Patched activeObstacle getter to not throw');
      }
    } catch (e) { logger.warn('[AGILITY] Could not patch activeObstacle getter:', e.message); }
  }

  _sendAgility() {
    const ag = game.agility;
    if (!ag) return;
    // obstacleBuildCount: how many times each obstacle has been built
    const buildCounts = [];
    if (ag.obstacleBuildCount) for (const [ob, count] of ag.obstacleBuildCount) {
      buildCounts.push({ id: ob.id, count });
    }
    this.transport.send({ t: Msg.AGILITY, courses: this._serializeAgilityCourses(), activeObstacle: ag.currentlyActiveObstacle, buildCounts });
  }

  _serializeAgilityCourses() {
    const ag = game.agility;
    const courses = [];
    for (const [realm, course] of ag.courses) {
      const obstacles = this._mapIdsToObj(course.builtObstacles);
      const pillars = this._mapIdsToObj(course.builtPillars);
      // Blueprints: { name, obstacles: {tier: id}, pillars: {tier: id} }
      const blueprints = [];
      if (course.blueprints) for (const [slot, bp] of course.blueprints) {
        const bpObstacles = bp.obstacles ? this._mapIdsToObj(bp.obstacles) : {};
        const bpPillars = bp.pillars ? this._mapIdsToObj(bp.pillars) : {};
        blueprints.push({ slot, name: bp.name || '', obstacles: bpObstacles, pillars: bpPillars });
      }
      courses.push({ realmId: realm.id, obstacles, pillars, blueprints });
    }
    return courses;
  }

  _mapIdsToObj(map) {
    const obj = {};
    for (const [tier, o] of map) obj[tier] = o ? o.id : null;
    return obj;
  }

  _idsToMap(entries, registry) {
    const map = new Map();
    for (const [tier, id] of Object.entries(entries || {})) {
      if (id) {
        const obj = registry && registry.getObjectByID(id);
        if (obj) map.set(Number(tier), obj);
      }
    }
    return map;
  }

  // Mirror a wire {tier: id} map into a built-obstacle/pillar Map. `label`
  // is { name } for the not-found warning; `label.setLog` (obstacles only)
  // enables the per-tier info log.
  _syncBuiltMap(wireMap, registry, builtMap, label) {
    for (const [tier, id] of Object.entries(wireMap)) {
      const tierNum = Number(tier);
      const current = builtMap.get(tierNum);
      const currentId = current ? current.id : null;
      if (id === currentId) continue; // already in sync
      if (id) {
        // AgilityObstacle/AgilityPillar are MasteryActions in ag.actions/ag.pillars, not Items.
        const obj = registry && registry.getObjectByID(id);
        if (!obj) { logger.warn(`[AGILITY] ${label.name} not found: ${id}`); continue; }
        // Direct set — don't call buildObstacle()/buildPillar() because:
        // 1. buildObstacle(obstacle) takes only 1 param (not course+tier)
        // 2. It would consume resources (spectator shouldn't pay again)
        // 3. We want to replicate exact state, not trigger build side-effects
        builtMap.set(tierNum, obj);
        if (label.setLog) logger.info(`[AGILITY] Set ${label.setLog} ${id} at tier ${tierNum}`);
      } else {
        // Remove obstacle/pillar at this tier
        builtMap.delete(tierNum);
      }
    }
  }

  _applyAgility(msg) {
    const ag = game.agility;
    if (!ag || !msg.courses) return;
    this._applyRemote('applyAgility', () => {
      for (const c of msg.courses) {
        const realm = game.realms.getObjectByID(c.realmId);
        if (!realm) continue;
        const course = ag.courses.get(realm);
        if (!course) continue;

        // Sync obstacles/pillars — direct set (see _syncBuiltMap)
        this._syncBuiltMap(c.obstacles, ag.actions, course.builtObstacles, { name: 'Obstacle', setLog: 'obstacle' });
        this._syncBuiltMap(c.pillars, ag.pillars, course.builtPillars, { name: 'Pillar' });
      }

      // Only set active obstacle if there's actually an obstacle built at that tier
      if (typeof msg.activeObstacle === 'number') {
        const realm = game.realms.getObjectByID(game.currentRealm?.id || 'melvorD:Melvor');
        const course = realm ? ag.courses.get(realm) : null;
        if (course && course.builtObstacles.has(msg.activeObstacle)) {
          ag.currentlyActiveObstacle = msg.activeObstacle;
        } else {
          // Find any built obstacle to set as active, or -1 if none
          let anyTier = -1;
          for (const [tier, ob] of course?.builtObstacles || []) {
            if (ob) { anyTier = tier; break; }
          }
          ag.currentlyActiveObstacle = anyTier;
          logger.info(`[AGILITY] Active obstacle adjusted to ${anyTier} (requested ${msg.activeObstacle})`);
        }
      }

      // Sync blueprints per course
      for (const c of msg.courses) {
        if (!c.blueprints) continue;
        const realm = game.realms.getObjectByID(c.realmId);
        if (!realm) continue;
        const course = ag.courses.get(realm);
        if (!course || !course.blueprints) continue;
        for (const bp of c.blueprints) {
          const bpObstacles = this._idsToMap(bp.obstacles, ag.actions);
          const bpPillars = this._idsToMap(bp.pillars, ag.pillars);
          course.blueprints.set(bp.slot, { name: bp.name, obstacles: bpObstacles, pillars: bpPillars });
        }
      }

      // Sync obstacle build counts (take max to avoid losing progress)
      if (msg.buildCounts && ag.obstacleBuildCount) {
        for (const bc of msg.buildCounts) {
          const ob = ag.actions && ag.actions.getObjectByID(bc.id);
          if (!ob) continue;
          const cur = ag.obstacleBuildCount.get(ob) || 0;
          if (bc.count > cur) ag.obstacleBuildCount.set(ob, bc.count);
        }
      }

      if (ag.render) ag.render();
      if (ag.renderBuiltObstacles) ag.renderBuiltObstacles();
      if (ag.renderCourseModifiers) ag.renderCourseModifiers();
    });
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
    // Sync constellation selection (study/explore)
    const sendSelect = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this.transport.send({
        t: Msg.ASTROLOGY_SELECT,
        studiedId: as.studiedConstellation ? as.studiedConstellation.id : null,
        exploredId: as.exploredConstellation ? as.exploredConstellation.id : null,
      });
    };
    for (const m of ['studyConstellationOnClick', 'exploreConstellationOnClick', 'resetActionState']) {
      if (typeof Astrology.prototype[m] === 'function') {
        this.ctx.patch(Astrology, m).after(() => sendSelect());
      }
    }
  }

  _sendAstrology() {
    const as = game.astrology;
    if (!as) return;
    let upgrades = [];
    try { upgrades = this._serializeAstrologyUpgrades(); } catch { /* noop */ }
    this.transport.send({ t: Msg.ASTROLOGY, upgrades });
  }

  _serializeAstrologyUpgrades() {
    const as = game.astrology;
    const upgrades = [];
    // Astrology has no aggregated *ModifierUpgrades arrays — the upgrade
    // state (timesBought) is stored directly on the AstrologyModifier
    // objects in each recipe's standardModifiers/uniqueModifiers/
    // abyssalModifiers arrays.
    if (as.actions) {
      for (const recipe of as.actions.allObjects) {
        for (const type of ['standardModifiers', 'uniqueModifiers', 'abyssalModifiers']) {
          const mods = recipe[type];
          if (!mods) continue;
          const tName = type === 'standardModifiers' ? 'standard' : (type === 'uniqueModifiers' ? 'unique' : 'abyssal');
          for (let i = 0; i < mods.length; i++) {
            const m = mods[i];
            if (m && typeof m.timesBought === 'number' && m.timesBought > 0) {
              upgrades.push({ recipeId: recipe.id, tier: i, timesBought: m.timesBought, type: tName });
            }
          }
        }
      }
    }
    return upgrades;
  }

  _applyAstrology(msg) {
    const as = game.astrology;
    if (!as || !msg.upgrades) return;
    this._applyRemote('applyAstrology', () => {
      for (const u of msg.upgrades) {
        const recipe = as.actions.getObjectByID(u.recipeId);
        if (!recipe) continue;
        const type = u.type || 'standard';
        const arr = type === 'standard' ? recipe.standardModifiers
          : (type === 'unique' ? recipe.uniqueModifiers : recipe.abyssalModifiers);
        if (arr && arr[u.tier]) arr[u.tier].timesBought = Math.max(arr[u.tier].timesBought || 0, u.timesBought);
      }
      // Recompute provided stats so modifier effects take effect.
      if (as.computeProvidedStats) try { as.computeProvidedStats(); } catch { /* noop */ }
      if (as.addProvidedStats) try { as.addProvidedStats(); } catch { /* noop */ }
      if (as.render) as.render();
    });
  }

  _applyAstrologySelect(msg) {
    const as = game.astrology;
    if (!as) return;
    this._applyRemote('applyAstrologySelect', () => {
      if (msg.studiedId !== undefined) {
        as.studiedConstellation = msg.studiedId ? as.actions.getObjectByID(msg.studiedId) : undefined;
      }
      if (msg.exploredId !== undefined) {
        as.exploredConstellation = msg.exploredId ? as.actions.getObjectByID(msg.exploredId) : undefined;
      }
      if (as.render) try { as.render(); } catch { /* noop */ }
      if (as.renderVisibleConstellations) try { as.renderVisibleConstellations(); } catch { /* noop */ }
    }, { save: false });
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
    this.transport.send({ t: Msg.SUMMONING, ...this._serializeSummoning() });
  }

  _serializeSummoning() {
    const su = game.summoning;
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
    return { marks, costs };
  }

  _applySummoning(msg) {
    const su = game.summoning;
    if (!su) return;
    this._applyRemote('applySummoning', () => {
      if (msg.marks && su.marksUnlocked) {
        for (const m of msg.marks) {
          const recipe = su.actions.getObjectByID(m.recipeId);
          if (!recipe) continue;
          const current = su.marksUnlocked.get(recipe) || 0;
          // Only credit new mark discoveries via the game method so that
          // discovery side-effects (XP/rewards) fire. discoverMark takes
          // only the recipe (not a count) — call it once per new discovery.
          if (m.count > current) {
            if (typeof su.discoverMark === 'function') {
              try { su.discoverMark(recipe); su.marksUnlocked.set(recipe, m.count); }
              catch (e) { su.marksUnlocked.set(recipe, m.count); }
            } else {
              su.marksUnlocked.set(recipe, m.count);
            }
          }
          // If m.count <= current, do nothing — don't decrease marks.
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
    });
  }

  // ---- Slayer sync (task state) -----------------------------------------
  _patchSlayer() {
    if (!game.slayer || !game.combat.slayerTask) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendSlayer();
    };
    for (const m of ['selectTask', 'extendTask', 'clickNewTask', 'addKill', 'setTask', 'changeSelectedRealm', 'resetTaskState']) {
      if (typeof game.combat.slayerTask[m] === 'function') {
        this.ctx.patch(SlayerTask, m).after(() => send());
      }
    }
  }

  _sendSlayer() {
    if (!game.slayer || !game.combat.slayerTask) return;
    this.transport.send({ t: Msg.SLAYER, ...this._serializeSlayerTask() });
  }

  _serializeSlayerTask() {
    const t = game.combat.slayerTask;
    return {
      active: t.active,
      monsterId: t.monster ? t.monster.id : null,
      killsLeft: t.killsLeft,
      extended: t.extended,
      realmId: t.realm ? t.realm.id : null,
      categoryId: t.category ? t.category.id : null,
    };
  }

  _applySlayer(msg) {
    if (!game.slayer || !game.combat.slayerTask) return;
    this._applyRemote('applySlayer', () => {
      const t = game.combat.slayerTask;
      const remoteMonster = msg.monsterId ? game.monsters.getObjectByID(msg.monsterId) : undefined;
      const isNewTask = !t.monster || !remoteMonster || t.monster.id !== remoteMonster.id;
      t.active = !!msg.active;
      t.monster = remoteMonster;
      // If the monster changed, this is a new task — set killsLeft directly.
      // Otherwise use Math.max so stale messages can't regress the counter
      // (killsLeft only decreases via addKill during active play).
      if (isNewTask) {
        t.killsLeft = msg.killsLeft || 0;
      } else {
        t.killsLeft = Math.max(t.killsLeft || 0, msg.killsLeft || 0);
      }
      t.extended = !!msg.extended;
      // Handle realmId null explicitly so deselection syncs correctly.
      if (msg.realmId !== undefined && msg.realmId !== null) {
        t.realm = game.realms.getObjectByID(msg.realmId);
      } else if (msg.realmId === null) {
        t.realm = undefined;
      }
      if (msg.categoryId) {
        // Slayer task categories live on SlayerTask (game.combat.slayerTask.categories),
        // not on the Slayer skill class.
        const cats = game.combat.slayerTask.categories;
        if (cats) {
          const cat = cats.getObjectByID(msg.categoryId);
          if (cat) t.category = cat;
        }
      }
      if (t.render) t.render();
      if (t.renderTask) t.renderTask();
    });
  }

  // ---- Skill selections sync (cooking, woodcutting, firemaking, etc.) ---
  _serializeCookingSelection() {
    const cook = game.cooking;
    const recipes = [];
    if (cook.selectedRecipes) {
      for (const [cat, r] of cook.selectedRecipes) {
        recipes.push({ catId: cat.id, recipeId: r ? r.id : null });
      }
    }
    return { recipes };
  }

  _serializeFiremakingSelection() {
    const fm = game.firemaking;
    return {
      recipeId: fm.selectedRecipe ? fm.selectedRecipe.id : null,
      oilId: fm.selectedOil ? fm.selectedOil.id : null,
      bonfireId: fm.litBonfireRecipe ? fm.litBonfireRecipe.id : null,
    };
  }

  _serializeFishingSelection() {
    const fish = game.fishing;
    const areaFish = [];
    if (fish.selectedAreaFish) {
      for (const [area, f] of fish.selectedAreaFish) {
        areaFish.push({ areaId: area.id, fishId: f ? f.id : null });
      }
    }
    return { areaFish };
  }

  _serializeThievingSelection() {
    const th = game.thieving;
    return {
      areaId: th.currentArea ? th.currentArea.id : null,
      npcId: th.currentNPC ? th.currentNPC.id : null,
    };
  }

  _serializeAltMagicSelection() {
    const am = game.altMagic;
    return {
      spellId: am.selectedSpell ? am.selectedSpell.id : null,
      smithingRecipeId: am.selectedSmithingRecipe ? am.selectedSmithingRecipe.id : null,
      conversionItemId: am.selectedConversionItem ? am.selectedConversionItem.id : null,
    };
  }

  _serializeFletchingSelection() {
    const fl = game.fletching;
    const altRecipes = [];
    if (fl.setAltRecipes) {
      for (const [recipe, idx] of fl.setAltRecipes) {
        altRecipes.push({ recipeId: recipe.id, altIndex: idx });
      }
    }
    return { altRecipes };
  }

  // Generic artisan skill (Herblore, Smithing, Crafting, Runecrafting, Fletching)
  _serializeArtisanSelection(sk) {
    // selectedRecipeInRealm: Map<Realm, Recipe>
    const artisanRecipes = [];
    for (const [realm, recipe] of sk.selectedRecipeInRealm) {
      artisanRecipes.push({ realmId: realm.id, recipeId: recipe ? recipe.id : null });
    }
    return {
      artisanRecipes,
      selectedRecipeId: sk.selectedRecipe ? sk.selectedRecipe.id : null,
    };
  }

  _serializeVeins() {
    const hv = game.harvesting;
    const veins = [];
    if (hv.actions) for (const v of hv.actions.allObjects) {
      if (typeof v.currentIntensity === 'number') veins.push({ id: v.id, intensity: v.currentIntensity, max: v.maxIntensity });
    }
    return veins;
  }

  _serializeHarvestingSelection() {
    const hv = game.harvesting;
    return {
      veinId: hv.selectedVein ? hv.selectedVein.id : null,
      veins: this._serializeVeins(),
    };
  }

  _serializeArchaeology() {
    const ar = game.archaeology;
    const digSites = [];
    if (ar.actions) for (const ds of ar.actions.allObjects) {
      digSites.push({
        id: ds.id,
        mapIndex: ds.selectedMapIndex,
        tools: (ds.selectedTools || []).map(t => t ? t.id : null),
      });
    }
    const donatedItems = [];
    if (ar.museum && ar.museum.donatedItems) for (const item of ar.museum.donatedItems) donatedItems.push(item.id);
    const museumRewards = [];
    if (ar.museum && ar.museum.rewards) for (const rw of ar.museum.rewards.allObjects) {
      if (rw.awarded) museumRewards.push(rw.id);
    }
    return { digSites, donatedItems, museumRewards };
  }

  _patchSkillSelections() {
    // Woodcutting: active trees are NOT synced — tree selection is a
    // per-player UI choice. Syncing activeTrees corrupts the receiver's
    // woodcutting state (trees set without the action being started,
    // causing -Infinity tick crashes when trees are deselected).
    const simpleSkills = [
      // Cooking: selected recipes per category
      { sk: game.cooking, Cls: Cooking, skillId: 'melvorD:Cooking', ser: () => this._serializeCookingSelection(),
        methods: ['onRecipeSelectionClick', 'onActiveCookButtonClick', 'onPassiveCookButtonClick'] },
      // Firemaking: selected log, oil, bonfire
      { sk: game.firemaking, Cls: Firemaking, skillId: 'melvorD:Firemaking', ser: () => this._serializeFiremakingSelection(),
        methods: ['selectLog', 'selectOil', 'lightBonfire', 'oilMyLog'] },
      // Fishing: selected area fish
      { sk: game.fishing, Cls: Fishing, skillId: 'melvorD:Fishing', ser: () => this._serializeFishingSelection(),
        methods: ['onAreaStartButtonClick', 'onAreaFishSelection'] },
      // Thieving: selected area/NPC
      { sk: game.thieving, Cls: Thieving, skillId: 'melvorD:Thieving', ser: () => this._serializeThievingSelection(),
        methods: ['onAreaHeaderClick', 'onNPCPanelSelection', 'startThieving'] },
      // Alt Magic: selected spell, recipe, item
      { sk: game.altMagic, Cls: AltMagic, skillId: 'melvorD:AltMagic', ser: () => this._serializeAltMagicSelection(),
        methods: ['selectSpellOnClick', 'selectItemOnClick', 'selectBarOnClick'] },
      // Fletching: alt recipe selection
      { sk: game.fletching, Cls: Fletching, skillId: 'melvorD:Fletching', ser: () => this._serializeFletchingSelection(),
        methods: ['selectAltRecipeOnClick'] },
    ];
    for (const { sk, Cls, skillId, ser, methods } of simpleSkills) {
      if (!sk) continue;
      const send = () => {
        this._send({ t: Msg.SKILL_SELECT, skillId, ...ser() });
      };
      for (const m of methods) {
        if (typeof Cls.prototype[m] === 'function') this.ctx.patch(Cls, m).after(() => send());
      }
    }

    // Generic artisan skill recipe selection sync (Herblore, Smithing, Crafting, Runecrafting, Fletching)
    // These all extend ArtisanSkill which has selectedRecipe and selectedRecipeInRealm.
    for (const skillName of ['herblore', 'smithing', 'crafting', 'runecrafting', 'fletching']) {
      const sk = game[skillName];
      if (!sk || !sk.selectedRecipeInRealm) continue;
      const sendArtisan = () => {
        this._send({
          t: Msg.SKILL_SELECT, skillId: `melvorD:${skillName.charAt(0).toUpperCase() + skillName.slice(1)}`,
          ...this._serializeArtisanSelection(sk),
        });
      };
      const proto = sk.constructor.prototype;
      for (const m of ['selectRecipeOnClick', 'createButtonOnClick', 'resetToDefaultSelectedRecipeBasedOnRealm', 'updateRealmSelection']) {
        if (typeof proto[m] === 'function') {
          try { this.ctx.patch(sk.constructor, m).after(() => sendArtisan()); } catch { /* skip */ }
        }
      }
    }

    // Harvesting: selected vein + vein intensity
    const hv = game.harvesting;
    if (hv) {
      const send = () => {
        this._send({
          t: Msg.SKILL_SELECT, skillId: 'melvorD:Harvesting',
          ...this._serializeHarvestingSelection(),
        });
      };
      // Throttle intensity updates — reduceVeinIntensity fires every action tick
      let lastHarvestSend = 0;
      const throttledSend = () => {
        const now = Date.now();
        if (now - lastHarvestSend < 2000) return;
        lastHarvestSend = now;
        send();
      };
      if (typeof Harvesting.prototype.onVeinClick === 'function') this.ctx.patch(Harvesting, 'onVeinClick').after(() => send());
      // Sync vein intensity changes during active harvesting
      if (typeof Harvesting.prototype.reduceVeinIntensity === 'function') this.ctx.patch(Harvesting, 'reduceVeinIntensity').after(() => throttledSend());
      if (typeof Harvesting.prototype.postAction === 'function') this.ctx.patch(Harvesting, 'postAction').after(() => throttledSend());
      // Sync passive vein regen
      if (typeof Harvesting.prototype.passiveTick === 'function') this.ctx.patch(Harvesting, 'passiveTick').after(() => throttledSend());
    }

    // Archaeology: dig site selection, tools, museum
    const ar = game.archaeology;
    if (ar) {
      const send = () => {
        this._send({ t: Msg.SKILL_SELECT, skillId: 'melvorD:Archaeology', ...this._serializeArchaeology() });
      };
      for (const m of ['setMapAsActive', 'toggleTool', 'setToolAsActive', 'startDigging']) {
        if (typeof Archaeology.prototype[m] === 'function') this.ctx.patch(Archaeology, m).after(() => send());
      }
      if (ar.museum) {
        // Direct instance method override for donateItem — more reliable than
        // ctx.patch which may fail silently if the class reference doesn't
        // work correctly. This ensures the MUSEUM_DONATE message is sent
        // immediately when a player donates an artifact.
        const museum = ar.museum;
        if (typeof museum.donateItem === 'function') {
          const origDonateItem = museum.donateItem.bind(museum);
          museum.donateItem = function (item) {
            const result = origDonateItem(item);
            try {
              if (!sync._applyingRemote && sync.transport.isConnected && item && item.id) {
                logger.info('[MUSEUM] donateItem patched, sending MUSEUM_DONATE for', item.id);
                sync.transport.send({ t: Msg.MUSEUM_DONATE, itemId: item.id });
                send(); // also send bulk sync for rewards/etc
              }
            } catch (e) { logger.error('[MUSEUM] donateItem patch error', e); }
            return result;
          };
          logger.info('[MUSEUM] donateItem patch installed on museum instance');
        }
        // Patch donateAllGenericArtefacts via ctx.patch (less critical)
        const MuseumClass = (typeof ArchaeologyMuseum !== 'undefined') ? ArchaeologyMuseum : museum.constructor;
        for (const m of ['donateAllGenericArtefacts', 'giveReward', 'giveUnawardedRewards']) {
          if (typeof MuseumClass.prototype[m] === 'function') {
            try { this.ctx.patch(MuseumClass, m).after(() => send()); } catch (e) { logger.warn('[MUSEUM] patch failed for', m, e); }
          }
        }
      }
    }
  }

  _applySkillSelect(msg) {
    this._applyingRemote = true;
    try {
      // Guard: don't modify any skill's selection while it's actively
      // running. Changing selectedRecipe/selectedAreaFish/etc. while the
      // action is active can cause actionInterval to compute to -Infinity
      // and crash the game. This mirrors the woodcutting fix.
      const skillKey = msg.skillId ? msg.skillId.slice('melvorD:'.length).toLowerCase() : '';
      const skillObj = game[skillKey];
      if (skillObj && skillObj.isActive) {
        // Skill is active — skip selection sync to avoid crash.
        return;
      }
      switch (msg.skillId) {
        case 'melvorD:Cooking': {
          const s = game.cooking;
          if (!s || !msg.recipes) break;
          this._applyCookingSelection(msg);
          if (s.render) s.render();
          break;
        }
        // Woodcutting: active trees are NOT synced (per-player UI choice).
        case 'melvorD:Firemaking': {
          const s = game.firemaking;
          if (!s) break;
          this._applyFiremakingSelection(msg);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Fishing': {
          const s = game.fishing;
          if (!s || !msg.areaFish) break;
          this._applyFishingSelection(msg);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Thieving': {
          const s = game.thieving;
          if (!s) break;
          this._applyThievingSelection(msg);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:AltMagic': {
          const s = game.altMagic;
          if (!s) break;
          this._applyAltMagicSelection(msg);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Fletching': {
          const s = game.fletching;
          if (!s) break;
          this._applyFletchingSelection(msg);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Herblore':
        case 'melvorD:Smithing':
        case 'melvorD:Crafting':
        case 'melvorD:Runecrafting': {
          // slice('melvorD:'.length) gives 'Herblore' etc., then lowercased
          // to match the game property name (game.herblore, game.smithing, ...).
          const s = game[msg.skillId.slice('melvorD:'.length).toLowerCase()];
          if (!s) break;
          this._applyArtisanSelection(s, msg);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Harvesting': {
          const s = game.harvesting;
          if (!s) break;
          this._applyHarvestingSelection(msg);
          if (s.render) s.render();
          break;
        }
        case 'melvorD:Archaeology': {
          const s = game.archaeology;
          if (!s) break;
          // NOTE: the live case historically lacks the typeof mapIndex guard
          // (writes ds.mapIndex raw) — guardMapIndex: false preserves that.
          this._applyArchaeologyBulk(msg, { guardMapIndex: false });
          break;
        }
      }
    } catch (e) { logger.error('applySkillSelect failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Museum donation sync ---------------------------------------------
  // When one player donates an artifact, the other player's game auto-donates
  // it too — removes from bank, adds to donatedItems, gives rewards, updates
  // museum UI. This way only 1 person needs to donate.
  _applyMuseumDonate(msg) {
    logger.info('[MUSEUM] _applyMuseumDonate received for', msg.itemId);
    const ar = game.archaeology;
    if (!ar || !ar.museum) { logger.warn('[MUSEUM] no archaeology/museum'); return; }
    const item = this._itemById(msg.itemId);
    if (!item) { logger.warn('[MUSEUM] item not found:', msg.itemId); return; }
    // Already donated — skip (prevents double-donating)
    if (ar.museum.isItemDonated(item)) { logger.info('[MUSEUM] already donated, skipping'); return; }
    this._applyingRemote = true;
    try {
      // If the peer has the item in their bank, use the game's donateItem
      // method which handles everything: removes from bank, adds to
      // donatedItems, gives rewards, fires events, queues renders.
      const bankQty = game.bank.getQty(item);
      logger.info('[MUSEUM] bank qty for', item.id, '=', bankQty);
      if (bankQty > 0) {
        try { ar.museum.donateItem(item); logger.info('[MUSEUM] donateItem called successfully'); } catch (e) { logger.warn('[MUSEUM] donateItem failed', e); }
      } else {
        // Peer doesn't have the item in bank — just mark as donated + found
        ar.museum.donatedItems.add(item);
        this._museumMarkAsFound(item);
        // Give any unawarded rewards
        try { ar.museum.giveUnawardedRewards(); } catch { /* noop */ }
        // Queue renders
        if (ar.museum.renderQueue) {
          ar.museum.renderQueue.donationProgress = true;
          ar.museum.renderQueue.allArtefacts = true;
        }
      }
    } catch (e) { logger.error('applyMuseumDonate failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Skill-selection apply helpers -------------------------------------
  // All helpers in this block are GUARD-NEUTRAL: they never touch
  // _applyingRemote or _scheduleSave. They perform field writes only —
  // rendering stays at the call sites (the live SKILL_SELECT handler renders
  // per skill; the snapshot skillSelects block renders nothing).

  _applyCookingSelection(data) {
    const s = game.cooking;
    if (!s || !data.recipes) return;
    for (const r of data.recipes) {
      const cat = s.categories.getObjectByID(r.catId);
      if (!cat) continue;
      const recipe = r.recipeId ? s.actions.getObjectByID(r.recipeId) : null;
      if (recipe) s.selectedRecipes.set(cat, recipe);
    }
  }

  _applyFiremakingSelection(data) {
    const s = game.firemaking;
    if (!s) return;
    if (data.recipeId) s.selectedRecipe = s.actions.getObjectByID(data.recipeId);
    if (data.oilId) s.selectedOil = game.items.getObjectByID(data.oilId);
    if (data.bonfireId) s.litBonfireRecipe = s.actions.getObjectByID(data.bonfireId);
  }

  _applyFishingSelection(data) {
    const s = game.fishing;
    if (!s || !data.areaFish) return;
    for (const af of data.areaFish) {
      // Fishing areas are in s.areas (NamespaceRegistry<FishingArea>),
      // not s.actions (which contains Fish objects).
      const area = s.areas && s.areas.getObjectByID(af.areaId);
      if (!area) continue;
      const f = af.fishId ? s.actions.getObjectByID(af.fishId) : null;
      if (f) s.selectedAreaFish.set(area, f);
    }
  }

  _applyThievingSelection(data) {
    const s = game.thieving;
    if (!s) return;
    // Thieving areas are in s.areas (NamespaceRegistry<ThievingArea>),
    // not s.actions (which contains ThievingNPC objects).
    if (data.areaId) s.currentArea = s.areas && s.areas.getObjectByID(data.areaId);
    if (data.npcId) s.currentNPC = s.actions.getObjectByID(data.npcId);
  }

  _applyAltMagicSelection(data) {
    const s = game.altMagic;
    if (!s) return;
    if (data.spellId) s.selectedSpell = s.actions.getObjectByID(data.spellId);
    if (data.smithingRecipeId) s.selectedSmithingRecipe = game.smithing.actions.getObjectByID(data.smithingRecipeId);
    if (data.conversionItemId) s.selectedConversionItem = game.items.getObjectByID(data.conversionItemId);
  }

  _applyFletchingSelection(data) {
    const s = game.fletching;
    if (!s) return;
    if (data.altRecipes) for (const a of data.altRecipes) {
      const recipe = s.actions.getObjectByID(a.recipeId);
      if (recipe) s.setAltRecipes.set(recipe, a.altIndex);
    }
    // Artisan recipe selection (from generic artisan sync)
    this._applyArtisanSelection(s, data);
  }

  // Shared artisan-skill apply (Herblore/Smithing/Crafting/Runecrafting, and
  // Fletching after its altRecipes pre-step): per-realm recipe selection plus
  // the plain selectedRecipe.
  _applyArtisanSelection(s, data) {
    if (!s) return;
    if (data.artisanRecipes && s.selectedRecipeInRealm) {
      for (const ar of data.artisanRecipes) {
        const realm = game.realms.getObjectByID(ar.realmId);
        if (!realm) continue;
        const recipe = ar.recipeId ? s.actions.getObjectByID(ar.recipeId) : null;
        if (recipe) s.selectedRecipeInRealm.set(realm, recipe);
      }
    }
    if (data.selectedRecipeId) s.selectedRecipe = s.actions.getObjectByID(data.selectedRecipeId);
  }

  // Harvesting selection + vein intensities. NOTE: OVERWRITE semantics shared
  // by the live SKILL_SELECT handler and the snapshot skillSelects block —
  // deliberately different from the snapshot's separate harvestingVeins block
  // (which skips the locally-harvested vein and max-merges maxIntensity).
  // Do not unify the two; see _applySnapshot.
  _applyHarvestingSelection(data) {
    const s = game.harvesting;
    if (!s) return;
    if (data.veinId) s.selectedVein = s.actions.getObjectByID(data.veinId);
    if (data.veins) for (const v of data.veins) {
      const vein = s.actions.getObjectByID(v.id);
      if (vein) { vein.currentIntensity = v.intensity; vein.maxIntensity = v.max; }
    }
  }

  // Shared archaeology bulk apply (dig sites, museum donations, museum
  // rewards) used by the live SKILL_SELECT handler, the snapshot archaeology
  // block, and the snapshot skillSelects.archaeology block. Guard-neutral.
  // Callers must guard game.archaeology before calling.
  // Options (preserve per-site divergences — do NOT unify):
  // - guardMapIndex (default true): only write selectedMapIndex when it's a
  //   number. The live SKILL_SELECT case historically lacks this guard and
  //   writes ds.mapIndex raw — kept lacking via guardMapIndex: false.
  // - requireDonatedItems (default true): when false, the museum donatedItems
  //   block (and its renderQueue flags) runs even if ad.donatedItems is
  //   absent — the snapshot skillSelects.archaeology block's behavior.
  _applyArchaeologyBulk(ad, { guardMapIndex = true, requireDonatedItems = true } = {}) {
    const ar = game.archaeology;
    if (ad.digSites && ar.actions) for (const ds of ad.digSites) {
      const digSite = ar.actions.getObjectByID(ds.id);
      if (!digSite) continue;
      if (!guardMapIndex || typeof ds.mapIndex === 'number') digSite.selectedMapIndex = ds.mapIndex;
      // ArchaeologyTool extends NamespacedObject, not Item — use ar.tools
      if (ds.tools) digSite.selectedTools = ds.tools.map(tid => tid ? ar.tools.getObjectByID(tid) : null).filter(Boolean);
    }
    if ((requireDonatedItems ? ad.donatedItems : true) && ar.museum && ar.museum.donatedItems) {
      for (const itemId of ad.donatedItems || []) {
        const item = game.items.getObjectByID(itemId);
        if (!item) continue;
        // Skip if already donated — the dedicated MUSEUM_DONATE message
        // handles the actual donation (bank removal, rewards, etc).
        // This bulk sync just ensures donatedItems stays in sync.
        if (ar.museum.donatedItems.has(item)) continue;
        ar.museum.donatedItems.add(item);
        // Mark as found so museum shows picture
        this._museumMarkAsFound(item);
      }
      if (ar.museum.renderQueue) {
        ar.museum.renderQueue.donationProgress = true;
        ar.museum.renderQueue.allArtefacts = true;
      }
    }
    if (ad.museumRewards && ar.museum && ar.museum.rewards) {
      for (const rwId of ad.museumRewards) {
        const rw = ar.museum.rewards.getObjectByID(rwId);
        if (rw) rw.awarded = true;
      }
    }
    // NOTE: Do NOT call museum.render() — it freezes the game from
    // sync handlers. The donatedItems set is updated; the game will
    // render the museum naturally when the tab is opened.
  }

  // Hack: force an item's "found" stat so the museum shows its picture —
  // briefly add then remove it from the bank (itemFindCount is bank-driven).
  // Guard-neutral; swallows all errors by design.
  _museumMarkAsFound(item) {
    try {
      if (game.stats && game.stats.itemFindCount(item) === 0) {
        game.bank.addItem(item, 1, false, true, true, false);
        game.bank.removeItemQuantity(item, 1, false);
      }
    } catch { /* noop */ }
  }

  // ---- Player state sync (prayers, food, attack styles) -----------------
  _applyPlayerState(msg) {
    const p = game.combat.player;
    if (!p) return;
    this._applyRemote('applyPlayerState', () => {
      // Prayer / soul points
      if (typeof msg.prayerPoints === 'number') p.prayerPoints = msg.prayerPoints;
      if (typeof msg.soulPoints === 'number') p.soulPoints = msg.soulPoints;

      // Active prayers
      if (msg.prayers && p.activePrayers) {
        p.activePrayers.clear();
        for (const pid of msg.prayers) {
          // game.prayers is NamespaceRegistry<ActivePrayer>, so
          // getObjectByID already returns an ActivePrayer instance.
          const ap = game.prayers.getObjectByID(pid);
          if (ap) {
            try { p.activePrayers.add(ap); } catch { /* noop */ }
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

      // Attack styles — attackStyles is { melee?, ranged?, magic? } of AttackStyle
      if (msg.attackStyles && p.attackStyles) {
        for (const a of msg.attackStyles) {
          if (!a.attackType) continue;
          if (a.styleId) {
            const style = game.attackStyles.getObjectByID(a.styleId);
            if (style) p.attackStyles[a.attackType] = style;
          } else {
            delete p.attackStyles[a.attackType];
          }
        }
        if (p.render) p.render();
      }

      // Attack / curse / aurora spells
      /** @type {Array<[string, any, string]>} */
      const spellPatches = [
        ['attackSpellId', game.attackSpells, 'selectAttackSpell'],
        ['curseSpellId', game.curseSpells, 'toggleCurse'],
        ['auroraSpellId', game.auroraSpells, 'toggleAurora'],
      ];
      for (const [field, registry, method] of spellPatches) {
        if (msg[field] !== undefined && msg[field]) {
          const spell = registry.getObjectByID(msg[field]);
          if (spell && p[method]) p[method](spell, false);
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
    });
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
    // Patch progress/completion increases (all on CombatManager per DTS)
    for (const m of ['increaseDungeonProgress', 'increaseAbyssProgress', 'increaseStrongholdProgress', 'addDungeonCompletion']) {
      if (typeof CombatManager.prototype[m] === 'function') this.ctx.patch(CombatManager, m).after(() => send());
    }
  }

  _sendCombatAreas() {
    const cm = game.combat;
    if (!cm) return;
    const completions = this._serializeCombatAreas();
    // Also sync the current stronghold tier and area progress so the peer
    // sees the same combat location state.
    const extra = {};
    if (typeof cm.strongholdTier !== 'undefined') extra.strongholdTier = cm.strongholdTier;
    if (typeof cm.areaProgress === 'number') extra.areaProgress = cm.areaProgress;
    this.transport.send({ t: Msg.COMBAT_AREA, completions, ...extra });
  }

  _serializeCombatAreas() {
    const cm = game.combat;
    const completions = [];
    // Dungeons — stored in cm.dungeonCompletion (Map<Dungeon, number>)
    if (cm.dungeonCompletion) {
      for (const [d, count] of cm.dungeonCompletion) completions.push({ id: d.id, count, kind: 'dungeon' });
    }
    // Abyss depths / Strongholds — timesCompleted is a save-state field on each object
    /** @type {Array<[any, string]>} */
    const completionRegistries = [[game.abyssDepths, 'abyssDepth'], [game.strongholds, 'stronghold']];
    for (const [registry, kind] of completionRegistries) {
      if (registry) {
        for (const obj of registry.allObjects) {
          if (obj && typeof obj.timesCompleted === 'number') {
            completions.push({ id: obj.id, count: obj.timesCompleted, kind });
          }
        }
      }
    }
    return completions;
  }

  _applyCombatArea(msg) {
    const cm = game.combat;
    if (!cm || !msg.completions) return;
    this._applyRemote('applyCombatArea', () => {
      for (const c of msg.completions) {
        const kind = c.kind || 'dungeon';
        if (kind === 'dungeon') {
          const d = game.dungeons.getObjectByID(c.id);
          if (d && cm.dungeonCompletion) cm.dungeonCompletion.set(d, Math.max(cm.dungeonCompletion.get(d) || 0, c.count));
        } else if (kind === 'abyssDepth' || kind === 'stronghold') {
          const registry = kind === 'abyssDepth' ? game.abyssDepths : game.strongholds;
          const obj = registry && registry.getObjectByID(c.id);
          if (obj) obj.timesCompleted = Math.max(obj.timesCompleted || 0, c.count);
        }
      }
      // Sync stronghold tier + area progress.
      if (typeof msg.strongholdTier !== 'undefined') {
        try { cm.strongholdTier = msg.strongholdTier; } catch { /* noop */ }
      }
      if (typeof msg.areaProgress === 'number') {
        try { cm.areaProgress = msg.areaProgress; } catch { /* noop */ }
      }
      if (cm.render) try { cm.render(); } catch { /* noop */ }
      if (cm.renderCompletionCount) try { cm.renderCompletionCount(); } catch { /* noop */ }
    });
  }

  // ---- Combat Event system sync (Into the Mist, Spider Lair, etc.) ------
  // These are special timed events with stages, passives, and slayer areas.
  // The CombatManager tracks activeEvent, eventProgress, eventPassives, etc.
  _patchCombatEventSystem() {
    const cm = game.combat;
    if (!cm) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendCombatEventState();
    };
    for (const m of ['startEvent', 'stopEvent', 'increaseEventProgress', 'onPassiveSelection', 'computeAvailableEventPassives']) {
      if (typeof CombatManager.prototype[m] === 'function') {
        this.ctx.patch(CombatManager, m).after(() => send());
      }
    }
  }

  _sendCombatEventState() {
    const cm = game.combat;
    if (!cm) return;
    this.transport.send({ t: Msg.COMBAT_EVENT_STATE, ...this._serializeCombatEventState() });
  }

  _serializeCombatEventState() {
    const cm = game.combat;
    const data = {
      activeEventId: cm.activeEvent ? cm.activeEvent.id : null,
      eventProgress: cm.eventProgress,
      eventDungeonLength: cm.eventDungeonLength,
      eventPassives: (cm.eventPassives || []).map(p => p.id),
      availableEventPassives: (cm.availableEventPassives || []).map(p => p.id),
      eventPassivesBeingSelected: (cm.eventPassivesBeingSelected ? [...cm.eventPassivesBeingSelected] : []).map(p => p.id),
      shouldResetEvent: cm.shouldResetEvent,
      activeEventAreas: [],
    };
    if (cm.activeEventAreas) {
      for (const [area, count] of cm.activeEventAreas) {
        if (area && area.id) data.activeEventAreas.push({ areaId: area.id, count });
      }
    }
    return data;
  }

  _applyCombatEventState(msg) {
    const cm = game.combat;
    if (!cm) return;
    this._applyRemote('applyCombatEventState', () => {
      if (msg.activeEventId !== undefined) {
        if (msg.activeEventId === null) {
          cm.activeEvent = undefined;
        } else {
          const evt = game.combatEvents && game.combatEvents.getObjectByID(msg.activeEventId);
          if (evt) cm.activeEvent = evt;
        }
      }
      if (typeof msg.eventProgress === 'number') cm.eventProgress = msg.eventProgress;
      if (typeof msg.eventDungeonLength === 'number') cm.eventDungeonLength = msg.eventDungeonLength;
      if (typeof msg.shouldResetEvent === 'boolean') cm.shouldResetEvent = msg.shouldResetEvent;
      // Passives — resolve from the combat passives registry.
      const resolvePassives = (ids) => (ids || []).map(id => {
        const p = game.combatPassives && game.combatPassives.getObjectByID(id);
        return p;
      }).filter(Boolean);
      if (msg.eventPassives) cm.eventPassives = resolvePassives(msg.eventPassives);
      if (msg.availableEventPassives) cm.availableEventPassives = resolvePassives(msg.availableEventPassives);
      if (msg.eventPassivesBeingSelected) {
        if (!cm.eventPassivesBeingSelected) cm.eventPassivesBeingSelected = new Set();
        cm.eventPassivesBeingSelected.clear();
        for (const p of resolvePassives(msg.eventPassivesBeingSelected)) {
          cm.eventPassivesBeingSelected.add(p);
        }
      }
      if (msg.activeEventAreas) {
        if (!cm.activeEventAreas) cm.activeEventAreas = new Map();
        // Merge: set the count for each area; don't blindly clear in case
        // local has progress the remote doesn't (take max).
        for (const a of msg.activeEventAreas) {
          const area = game.slayerAreas && game.slayerAreas.getObjectByID(a.areaId);
          if (area) {
            const cur = cm.activeEventAreas.get(area) || 0;
            cm.activeEventAreas.set(area, Math.max(cur, a.count));
          }
        }
      }
      if (cm.renderEventMenu) try { cm.renderEventMenu(); } catch { /* noop */ }
      if (cm.renderEventAreas) try { cm.renderEventAreas(); } catch { /* noop */ }
    });
  }

  // ---- Combat event sync (damage, healing, monster selection) ------------
  // Wrap proto methods that add loot/currency: snapshot `diffFn.before()`,
  // run the original, then `diffFn.after(before)` broadcasts the delta.
  // `skipWhenPeer: true` mirrors the "skip when spectating" early return.
  _wrapLootDiff(proto, methods, diffFn) {
    const sync = this;
    for (const m of methods) {
      if (typeof proto[m] !== 'function') continue;
      const orig = proto[m];
      proto[m] = function (...args) {
        if (diffFn.skipWhenPeer && sync._combatOwner === 'peer') return; // skip when spectating
        const before = diffFn.before();
        try { orig.apply(this, args); } catch (e) { /* skip */ }
        diffFn.after(before);
      };
    }
  }

  // Replace a CombatManager method with a guarded version that never throws:
  // optional spectating/invalid-arg skip, then try/catch around the original.
  /**
   * @param {any} Proto class whose prototype method gets replaced
   * @param {string} m method name
   * @param {{ skipWhenPeer?: boolean, skipLog?: string | null, skipIf?: null | ((...args: any[]) => boolean), label?: string }} [opts]
   */
  _safeOverride(Proto, m, { skipWhenPeer = false, skipLog = null, skipIf = null, label = m } = {}) {
    if (typeof Proto.prototype[m] !== 'function') return;
    const orig = Proto.prototype[m];
    const sync = this;
    Proto.prototype[m] = function (...args) {
      if (skipWhenPeer && sync._combatOwner === 'peer') {
        if (skipLog) logger.info(skipLog);
        return;
      }
      if (skipIf && skipIf(...args)) return;
      try { return orig.apply(this, args); }
      catch (e) { logger.warn(`${label} caught: ${e.message}`); }
    };
  }

  /**
   * Core combat state (monster, HP, barrier, paused). The live sender spreads
   * this and adds kind/areaId/playerStats; the snapshot sends the core only.
   */
  _serializeCombatState() {
    const cm = game.combat;
    const enemy = cm.enemy;
    const player = cm.player;
    return {
      paused: cm.paused,
      monsterId: enemy.monster ? enemy.monster.id : null,
      enemyHp: enemy.hitpoints,
      enemyMaxHp: enemy.stats ? enemy.stats.maxHitpoints : 0,
      enemyBarrier: typeof enemy.barrier === 'number' ? enemy.barrier : 0,
      playerHp: player.hitpoints,
      playerMaxHp: player.stats ? player.stats.maxHitpoints : 0,
    };
  }

  _patchCombatEvents() {
    if (!game.combat) return;
    const sync = this;

    // Throttle: send at most every 80ms to avoid flooding
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
      // Don't send state if we're spectating — the attacker sends state
      if (sync._combatOwner === 'peer') return;
      const cm = game.combat;
      const player = cm.player;
      // Gather player combat stats for realistic damage calculation
      let playerStats = null;
      try {
        playerStats = {
          maxHit: (player.stats && player.stats.maxHit) || 0,
          minHit: (player.stats && player.stats.minHit) || 0,
          attackSpeed: (player.equipmentStats && player.equipmentStats.attackSpeed) || (player.stats && player.stats.attackInterval) || 3000,
          accuracyRating: (player.stats && player.stats.accuracy) || 0,
          attackType: player.attackType || 'melee',
          selectedAttackStyle: player.attackStyle ? player.attackStyle.id : null,
        };
      } catch (e) { /* skip */ }
      sync.transport.send({
        t: Msg.COMBAT_EVENT,
        kind: 'state',
        ...sync._serializeCombatState(),
        areaId: cm._rmpSelectedArea ? cm._rmpSelectedArea.id : null,
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

    // Patch Character.attack — when spectating, the spectator's player
    // attacks deal 0 damage to the enemy. This prevents double-damage
    // while keeping the attack bar animation and enemy visible.
    if (typeof Character !== 'undefined' && Character.prototype && typeof Character.prototype.attack === 'function') {
      const origAttack = Character.prototype.attack;
      Character.prototype.attack = function (target, attack) {
        // If we're spectating and this is the player attacking the enemy
        if (sync._combatOwner === 'peer' && this === game.combat.player && target === game.combat.enemy) {
          // Call the original but then heal the damage back (net 0)
          const hpBefore = target.hitpoints;
          const result = origAttack.call(this, target, attack);
          // Restore HP — neutralize our attack
          target.hitpoints = hpBefore;
          return result;
        }
        return origAttack.call(this, target, attack);
      };
    }

    // Patch CombatLoot.add — when attacker gets loot, sync to spectator
    if (typeof CombatLoot !== 'undefined' && CombatLoot.prototype && typeof CombatLoot.prototype.add === 'function') {
      this.ctx.patch(CombatLoot, 'add').after(function (item, quantity) {
        // Only sync if we're the attacker
        if (sync._combatOwner === 'me' && !sync._applyingRemote && sync.transport.isConnected) {
          const itemId = item && item.id ? item.id : null;
          if (itemId) {
            logger.info(`[COMBAT] Loot drop: ${itemId} x${quantity}`);
            sync.transport.send({ t: Msg.COMBAT_LOOT, itemId, quantity });
          }
        }
      });
    }

    // Patch dropEnemyCurrency — sync currency drops to spectator
    this._wrapLootDiff(CombatManager.prototype, ['dropEnemyCurrency'], {
      before: () => (game.gp ? game.gp.amount : 0),
      after: (gpBefore) => {
        // If we're the attacker, sync currency gained
        if (sync._combatOwner === 'me' && !sync._applyingRemote && sync.transport.isConnected) {
          const gpAfter = game.gp ? game.gp.amount : 0;
          const gpGained = gpAfter - gpBefore;
          if (gpGained > 0) {
            sync.transport.send({ t: Msg.COMBAT_LOOT, itemId: 'melvorD:GP', quantity: gpGained });
          }
        }
      },
    });

    // Patch dropEnemyBones, dropBarrierDust, dropSignetHalfB, dropBirthdayPresent
    // These add items directly to bank (not via CombatLoot), so sync them.
    this._wrapLootDiff(CombatManager.prototype, ['dropEnemyBones', 'dropBarrierDust', 'dropSignetHalfB', 'dropBirthdayPresent'], {
      skipWhenPeer: true,
      before: () => {
        const bankBefore = new Map();
        try { for (const [item, bi] of game.bank.items) bankBefore.set(item.id, bi.quantity); } catch { /* skip */ }
        return bankBefore;
      },
      after: (bankBefore) => {
        // Sync any items that were added
        if (sync._combatOwner === 'me' && !sync._applyingRemote && sync.transport.isConnected) {
          try {
            for (const [item, bi] of game.bank.items) {
              const before = bankBefore.get(item.id) || 0;
              if (bi.quantity > before) {
                sync.transport.send({ t: Msg.COMBAT_LOOT, itemId: item.id, quantity: bi.quantity - before });
              }
            }
          } catch { /* skip */ }
        }
      },
    });

    // Note: When spectating (_combatOwner === 'peer'), the local game still
    // runs combat ticks. The spectator's player attacks are neutralized
    // (damage healed back) by the Character.attack patch above.
    // The attacker's damage events override the enemy HP with absolute values.

    // Patch selectMonster — sync monster selection AND claim combat
    if (typeof CombatManager.prototype.selectMonster === 'function') {
      // Capture the area from selectMonster's arguments (before patch)
      this.ctx.patch(CombatManager, 'selectMonster').before(function (monster, area) {
        // Store the area on the combat manager for later use
        this._rmpSelectedArea = area || null;
      });
      this.ctx.patch(CombatManager, 'selectMonster').after(function () {
        // Local player selected a monster — claim combat ownership
        if (!sync._applyingRemote) {
          sync._combatOwner = 'me';
          const cm = game.combat;
          const monsterId = cm.enemy.monster ? cm.enemy.monster.id : null;
          const areaId = cm._rmpSelectedArea ? cm._rmpSelectedArea.id : null;
          sync.transport.send({ t: Msg.COMBAT_CLAIM, monsterId, areaId });
          logger.info(`[COMBAT] Claimed combat: ${monsterId}, area: ${areaId}`);
        }
        sendCombatState();
      });
    }

    // Patch rewardSlayerTaskCurrency — prevent crash when slayer task category
    // is undefined (happens when monster was selected remotely)
    this._safeOverride(CombatManager, 'rewardSlayerTaskCurrency', {
      skipIf: (category) => !category || !category.currencyRewards, // skip if invalid
      label: 'rewardSlayerTaskCurrency',
    });

    // Also patch rewardForEnemyDeath — when spectating, skip local loot
    // generation entirely. The spectator only gets loot via COMBAT_LOOT
    // sync messages from the attacker. This prevents double items.
    this._safeOverride(CombatManager, 'rewardForEnemyDeath', {
      skipWhenPeer: true,
      skipLog: '[COMBAT] Spectator: skipping local rewardForEnemyDeath',
      label: 'rewardForEnemyDeath',
    });

    // Patch loadNextEnemy — prevent crash when area/monster not selected
    // AND skip when spectating (attacker handles enemy spawning)
    this._safeOverride(CombatManager, 'loadNextEnemy', {
      skipWhenPeer: true,
      skipLog: '[COMBAT] Spectator: skipping loadNextEnemy',
      label: 'loadNextEnemy',
    });

    // Note: When spectating (_combatOwner === 'peer'), the spectator's combat
    // is NOT started (we don't call selectMonster). The spectator can do other
    // tasks (mining, fishing, etc.) while watching the attacker's combat.
    // The attacker's damage events update the spectator's enemy HP visually.
    // The spectator gets loot via COMBAT_LOOT sync messages, not local drops.

    // Patch pause/unpause — sync combat pause state and release claim on stop
    for (const m of ['pause', 'stop', 'start', 'pauseDungeon', 'resumeDungeon']) {
      if (typeof CombatManager.prototype[m] === 'function') {
        try {
          this.ctx.patch(CombatManager, m).after(function () {
            // Skip sending events if we're applying remote
            if (sync._applyingRemote) return;
            // If attacker stops combat, release claim and send stop to spectator
            if (m === 'stop' && sync._combatOwner === 'me') {
              sync._combatOwner = null;
              sync.transport.send({ t: Msg.COMBAT_RELEASE });
              sync.transport.send({ t: Msg.COMBAT_EVENT, kind: 'stop' });
              logger.info(`[COMBAT] Released combat (stopped)`);
            }
            // If spectator stops, notify attacker so they stop too
            if (m === 'stop' && sync._combatOwner === 'peer') {
              sync.transport.send({ t: Msg.COMBAT_EVENT, kind: 'stop' });
              sync._combatOwner = null;
              logger.info(`[COMBAT] Spectator stopped combat, notifying attacker`);
            }
            sendCombatState();
          });
        } catch (e) { /* skip if already patched */ }
      }
    }

    // Periodic state sync every 2 seconds (catches up any missed events)
    this._combatStateInterval = setInterval(() => {
      if (sync.transport.isConnected && !sync._applyingRemote && sync._combatOwner !== 'peer') {
        sendCombatState();
      }
    }, 2000);
  }

  _applyCombatEvent(msg) {
    const cm = game.combat;
    if (!cm) return;
    this._applyRemote('applyCombatEvent', () => {
      if (msg.kind === 'state') {
        // State sync — just update HP, don't re-select monster
        // Monster selection is handled by COMBAT_CLAIM, not state sync
        if (msg.enemyHp !== undefined && cm.enemy) {
          cm.enemy.hitpoints = msg.enemyHp;
        }
        if (msg.enemyBarrier !== undefined && cm.enemy && 'barrier' in cm.enemy) {
          cm.enemy.barrier = msg.enemyBarrier;
        }
        if (msg.playerHp !== undefined && cm.player) {
          cm.player.hitpoints = msg.playerHp;
        }
        this._renderCombat();
      } else if (msg.kind === 'damage' || msg.kind === 'heal') {
        const target = msg.target === 'enemy' ? cm.enemy : cm.player;
        if (!target) return;
        // Damage clamps at 0; healing clamps at max hitpoints.
        const isHeal = msg.kind === 'heal';
        const clamp = isHeal
          ? (hp) => Math.min(target.stats ? target.stats.maxHitpoints : hp, hp + msg.amount)
          : (hp) => Math.max(0, hp - msg.amount);
        // Apply damage directly to hitpoints
        if (msg.hp !== undefined) {
          target.hitpoints = msg.hp;
        } else {
          target.hitpoints = clamp(target.hitpoints);
        }
        // Show damage splash for visual feedback
        if (msg.amount > 0 && target.splashManager && target.splashManager.add) {
          try {
            target.splashManager.add({
              source: isHeal ? 'Heal' : (msg.source || 'Attack'),
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
      } else if (msg.kind === 'stop') {
        // Attacker stopped combat — stop our combat too
        // But preserve loot! Save loot before stop, restore after
        logger.info(`[COMBAT] Peer stopped combat`);
        let savedLoot = null;
        if (cm.loot && cm.loot.drops) {
          savedLoot = cm.loot.drops.slice(); // copy loot array
        }
        if (cm.stop) {
          try { cm.stop(); } catch (e) { /* skip */ }
        }
        // Restore loot if it was destroyed
        if (savedLoot && cm.loot) {
          if (!cm.loot.drops || cm.loot.drops.length < savedLoot.length) {
            cm.loot.drops = savedLoot;
            this._flagLootForRender(cm.loot);
            logger.info(`[COMBAT] Restored ${savedLoot.length} loot items after stop`);
          }
        }
        this._combatOwner = null;
        this._renderCombat();
      }
    }, { save: false });
  }

  /** Flag a combat loot container for re-render (shared by loot sync + stop-restore). */
  _flagLootForRender(loot) {
    if (loot.renderRequired !== undefined) loot.renderRequired = true;
    if (loot.render) loot.render();
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
    logger.info(`[COMBAT] Peer claimed combat: ${msg.monsterId}, area: ${msg.areaId}`);
    this._combatOwner = 'peer';
    // DON'T call selectMonster — it auto-starts combat and forces the
    // spectator into a fight, preventing them from doing other tasks.
    // Instead, set up the enemy visually WITHOUT starting a fight.
    // The spectator sees the enemy image/HP but their combat doesn't run.
    // The attacker's damage events update the enemy HP visually.
    if (msg.monsterId) {
      this._applyRemote('applyCombatClaim', () => {
        const monster = game.monsters.getObjectByID(msg.monsterId);
        if (monster && cm.enemy) {
          const currentId = cm.enemy.monster ? cm.enemy.monster.id : null;
          if (currentId !== msg.monsterId || cm.enemy.hitpoints <= 0) {
            // Set up enemy without starting combat
            if (cm.enemy.setNewMonster) cm.enemy.setNewMonster(monster);
            if (cm.enemy.setStatsFromMonster) cm.enemy.setStatsFromMonster(monster);
            if (cm.enemy.initializeForCombat) cm.enemy.initializeForCombat();
            // Set the enemy to full HP
            if (cm.enemy.stats && cm.enemy.stats.maxHitpoints) {
              cm.enemy.hitpoints = cm.enemy.stats.maxHitpoints;
            }
            // Store selected monster/area for reference
            cm.selectedMonster = monster;
            if (msg.areaId) {
              const area = game.combatAreas.getObjectByID(msg.areaId)
                  || game.slayerAreas.getObjectByID(msg.areaId)
                  || (game.dungeons && game.dungeons.getObjectByID(msg.areaId))
                  || (game.strongholds && game.strongholds.getObjectByID(msg.areaId))
                  || (game.abyssDepths && game.abyssDepths.getObjectByID(msg.areaId));
              if (area && cm.selectedArea !== undefined) cm.selectedArea = area;
            }
            if (cm.enemy.setRenderAll) cm.enemy.setRenderAll();
            logger.info(`[COMBAT] Spectator set up enemy: ${cm.enemy.monster ? cm.enemy.monster.id : 'none'}, hp=${cm.enemy.hitpoints}`);
          } else {
            logger.info(`[COMBAT] Spectator: monster already selected, hp=${cm.enemy.hitpoints}`);
          }
        }
      }, { save: false, level: 'warn' });
    }
    this._renderCombat();
  }

  _applyCombatRelease() {
    const cm = game.combat;
    if (!cm) return;
    logger.info(`[COMBAT] Peer released combat`);
    this._combatOwner = null;
    // Don't auto-unpause; let the player decide
  }

  // ---- Combat loot sync (both players get drops) ------------------------
  _applyCombatLoot(msg) {
    const cm = game.combat;
    if (!cm) return;
    logger.info(`[COMBAT] Received loot: ${msg.itemId} x${msg.quantity}`);
    // Guard with _applyingRemote so applying this loot doesn't re-trigger
    // our own Currency/Bank/CombatLoot patches and echo a phantom
    // delta/qty message back to the sender (which would double-count the
    // GP/items on the attacker's side).
    this._applyRemote('applyCombatLoot', () => {
      // Handle currencies (GP, Slayer Coins) — these are Currency objects, use .add()
      for (const [currencyId, getCurrency] of [['melvorD:GP', () => game.gp], ['melvorD:SlayerCoins', () => game.slayerCoins]]) {
        const currency = getCurrency();
        if (msg.itemId === currencyId && currency !== undefined) {
          if (typeof currency.add === 'function') currency.add(msg.quantity);
          return;
        }
      }
      // Handle items — add to combat loot so player can collect
      const item = game.items.getObjectByID(msg.itemId);
      if (item && cm.loot) {
        cm.loot.add(item, msg.quantity);
        this._flagLootForRender(cm.loot);
        logger.info(`[COMBAT] Added loot to container: ${msg.itemId} x${msg.quantity}`);
      } else if (item && game.bank && game.bank.addItem) {
        // Fallback: add directly to bank
        game.bank.addItem(item, msg.quantity, false, true, false, false, 'Co-op Combat');
        logger.info(`[COMBAT] Added loot to bank: ${msg.itemId} x${msg.quantity}`);
      }
    }, { level: 'warn' });
  }

  // ---- Ancient relics sync ----------------------------------------------
  _patchAncientRelics() {
    if (!game.ancientRelics) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this.transport.send({ t: Msg.ANCIENT_RELIC, relics: this._serializeAncientRelics() });
    };
    // Patch addRelic on the prototype (once, not per-instance)
    if (typeof AncientRelicSet !== 'undefined' && typeof AncientRelicSet.prototype.addRelic === 'function') {
      this.ctx.patch(AncientRelicSet, 'addRelic').after(() => send());
    }
  }

  _serializeAncientRelics() {
    const relics = [];
    // AncientRelicSet objects are stored per-skill: skill.ancientRelicSets (Map<Realm, AncientRelicSet>)
    for (const skill of game.skills.allObjects) {
      if (!skill.ancientRelicSets) continue;
      for (const [realm, set] of skill.ancientRelicSets) {
        if (set.foundRelics) {
          for (const [relic, count] of set.foundRelics) {
            relics.push({ skillId: skill.id, realmId: realm.id, relicId: relic.id, count });
          }
        }
      }
    }
    return relics;
  }

  _applyAncientRelic(msg) {
    if (!game.ancientRelics || !msg.relics) return;
    this._applyRemote('applyAncientRelic', () => {
      for (const r of msg.relics) {
        // Find the AncientRelicSet by skill + realm
        const skill = game.skills.getObjectByID(r.skillId);
        if (!skill || !skill.ancientRelicSets) continue;
        const realm = game.realms.getObjectByID(r.realmId);
        if (!realm) continue;
        const set = skill.ancientRelicSets.get(realm);
        if (!set || !set.foundRelics) continue;
        // Find the relic by ID in the game's ancientRelics registry
        const relic = game.ancientRelics.getObjectByID(r.relicId);
        if (relic) set.foundRelics.set(relic, Math.max(set.foundRelics.get(relic) || 0, r.count));
      }
    }, { save: false });
  }

  // ---- Skill tree sync --------------------------------------------------
  _patchSkillTree() {
    // Skill trees are per-skill, not global. Iterate all skills.
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this.transport.send({ t: Msg.SKILL_TREE, trees: this._serializeSkillTrees() });
    };
    // Patch SkillTree prototype methods once (not per-tree in a loop)
    if (typeof SkillTree !== 'undefined' && SkillTree.prototype) {
      for (const m of ['unlockNode', 'addPoints']) {
        if (typeof SkillTree.prototype[m] === 'function') {
          this.ctx.patch(SkillTree, m).after(() => send());
        }
      }
    }
  }

  _serializeSkillTrees() {
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
    return trees;
  }

  _applySkillTree(msg) {
    if (!msg.trees) return;
    this._applyRemote('applySkillTree', () => {
      for (const t of msg.trees) {
        const skill = game.skills.getObjectByID(t.skillId);
        if (!skill || !skill.skillTrees) continue;
        const tree = skill.skillTrees.getObjectByID(t.treeId);
        if (!tree) continue;
        if (typeof t.points === 'number') tree._points = Math.max(tree._points || 0, t.points);
        if (t.nodes && tree.unlockedNodes) {
          // Don't clear existing unlocks — only add new ones. Clearing would
          // remove nodes the local player already unlocked.
          for (const nid of t.nodes) {
            const node = tree.nodes?.getObjectByID(nid);
            if (node && !node.isUnlocked) { node.isUnlocked = true; tree.unlockedNodes.add(node); }
          }
        }
      }
    }, { save: false });
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
    // Building purchases go through TownshipBiome.addBuildings/removeBuildings,
    // NOT Township.prototype. Patch the biome class directly.
    if (typeof TownshipBiome !== 'undefined') {
      for (const m of ['addBuildings', 'removeBuildings', 'setBuildingEfficiency', 'reduceBuildingEfficiency']) {
        if (typeof TownshipBiome.prototype[m] === 'function') {
          this.ctx.patch(TownshipBiome, m).after(() => sendImmediate());
        }
      }
    }
    // Township-level methods
    if (typeof Township !== 'undefined') {
      for (const m of ['repairAllBuildings', 'repairAllBuildingsInCurrentBiome',
                       'repairAllBuildingsFromStorageType', 'selectWorship', 'updateConvertType']) {
        if (typeof Township.prototype[m] === 'function') this.ctx.patch(Township, m).after(() => sendImmediate());
      }
    }
    if (typeof TownshipTasks !== 'undefined' && tw.tasks && typeof tw.tasks.completeTask === 'function') {
      this.ctx.patch(TownshipTasks, 'completeTask').after(() => sendImmediate());
    }
    // passiveTick fires every game tick — throttle to 5s intervals
    if (typeof Township !== 'undefined' && tw.passiveTick) {
      this.ctx.patch(Township, 'passiveTick').after(() => send());
    }
  }

  _serializeTownship() {
    const tw = game.township;
    if (!tw) return null;
    const biomes = [];
    if (tw.biomes) for (const biome of tw.biomes.allObjects) {
      const buildings = {};
      if (biome.buildingsBuilt) for (const [b, count] of biome.buildingsBuilt) buildings[b.id] = count;
      const efficiency = {};
      if (biome.buildingEfficiency) for (const [b, eff] of biome.buildingEfficiency) efficiency[b.id] = eff;
      biomes.push({ id: biome.id, buildings, efficiency });
    }
    const resources = {};
    if (tw.resources) for (const r of tw.resources.allObjects) {
      resources[r.id] = { amount: r._amount, cap: r._cap };
    }
    // Town data — the live town state (population, happiness, education,
    // worship, season, fortification, souls, health, etc.)
    const townData = {};
    if (tw.townData) {
      const td = tw.townData;
      townData.happiness = td.happiness;
      townData.education = td.education;
      townData.healthPercent = td.healthPercent;
      townData.buildingStorage = td.buildingStorage;
      townData.worshipCount = td.worshipCount;
      townData.sectionsPurchased = td.sectionsPurchased;
      townData.worshipId = td.worship ? td.worship.id : null;
      townData.townCreated = td.townCreated;
      townData.population = td.population;
      townData.seasonTicksRemaining = td.seasonTicksRemaining;
      townData.seasonId = td.season ? td.season.id : null;
      townData.previousSeasonId = td.previousSeason ? td.previousSeason.id : null;
      townData.health = td.health;
      townData.fortification = td.fortification;
      townData.souls = td.souls;
      townData.soulStorage = td.soulStorage;
      townData.abyssalWaveTicksRemaining = td.abyssalWaveTicksRemaining;
    }
    return {
      biomes,
      resources,
      totalTicks: tw.totalTicks,
      legacyTicks: tw.legacyTicks,
      townData,
      worshipInSelectionId: tw.worshipInSelection ? tw.worshipInSelection.id : null,
    };
  }

  _sendTownship() {
    const payload = this._serializeTownship();
    if (!payload) return;
    this.transport.send({ t: Msg.TOWNSHIP, ...payload });
  }

  _applyTownship(msg) {
    const tw = game.township;
    if (!tw) return;
    this._applyRemote('applyTownship', () => {
      if (msg.biomes) for (const b of msg.biomes) {
        const biome = tw.biomes.getObjectByID(b.id);
        if (!biome || !biome.buildingsBuilt) continue;
        for (const [bid, count] of Object.entries(b.buildings)) {
          const building = tw.buildings.getObjectByID(bid);
          if (building) biome.buildingsBuilt.set(building, Math.max(biome.buildingsBuilt.get(building) || 0, count));
        }
        // Sync building efficiency (decays over time; otherwise diverges).
        if (b.efficiency && biome.buildingEfficiency) {
          for (const [bid, eff] of Object.entries(b.efficiency)) {
            const building = tw.buildings.getObjectByID(bid);
            if (building) biome.buildingEfficiency.set(building, eff);
          }
        }
      }
      if (msg.resources) for (const [rid, data] of Object.entries(msg.resources)) {
        const r = tw.resources.getObjectByID(rid);
        if (r) {
          // _amount fluctuates (consumed/produced) — direct assignment.
          if (typeof data.amount === 'number') r._amount = data.amount;
          // _cap only increases via buildings — use Math.max.
          if (typeof data.cap === 'number') r._cap = Math.max(r._cap || 0, data.cap);
        }
      }
      if (typeof msg.totalTicks === 'number') tw.totalTicks = msg.totalTicks;
      if (typeof msg.legacyTicks === 'number') tw.legacyTicks = msg.legacyTicks;
      // Town data
      if (msg.townData && tw.townData) {
        const td = tw.townData;
        const d = msg.townData;
        if (typeof d.happiness === 'number') td.happiness = d.happiness;
        if (typeof d.education === 'number') td.education = d.education;
        if (typeof d.healthPercent === 'number') td.healthPercent = d.healthPercent;
        if (typeof d.buildingStorage === 'number') td.buildingStorage = Math.max(td.buildingStorage || 0, d.buildingStorage);
        if (typeof d.worshipCount === 'number') td.worshipCount = d.worshipCount;
        if (typeof d.sectionsPurchased === 'number') td.sectionsPurchased = Math.max(td.sectionsPurchased || 0, d.sectionsPurchased);
        if (typeof d.townCreated === 'boolean') td.townCreated = d.townCreated;
        if (typeof d.population === 'number') td.population = d.population;
        if (typeof d.seasonTicksRemaining === 'number') td.seasonTicksRemaining = d.seasonTicksRemaining;
        if (typeof d.health === 'number') td.health = d.health;
        if (typeof d.fortification === 'number') td.fortification = d.fortification;
        if (typeof d.souls === 'number') td.souls = d.souls;
        if (typeof d.soulStorage === 'number') td.soulStorage = Math.max(td.soulStorage || 0, d.soulStorage);
        if (typeof d.abyssalWaveTicksRemaining === 'number') td.abyssalWaveTicksRemaining = d.abyssalWaveTicksRemaining;
        if (d.worshipId !== undefined) {
          td.worship = d.worshipId ? (tw.worships && tw.worships.getObjectByID(d.worshipId)) : (tw.noWorship || undefined);
        }
        if (d.seasonId !== undefined) {
          td.season = d.seasonId ? (tw.seasons && tw.seasons.getObjectByID(d.seasonId)) : undefined;
        }
        if (d.previousSeasonId !== undefined) {
          td.previousSeason = d.previousSeasonId ? (tw.seasons && tw.seasons.getObjectByID(d.previousSeasonId)) : undefined;
        }
      }
      if (msg.worshipInSelectionId !== undefined) {
        tw.worshipInSelection = msg.worshipInSelectionId ? (tw.worships && tw.worships.getObjectByID(msg.worshipInSelectionId)) : undefined;
      }
      if (tw.render) tw.render();
    });
  }

  // ---- Clue Hunt sync ---------------------------------------------------
  _patchClueHunt() {
    if (!game.clueHunt) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const payload = this._serializeClueHunt();
      if (!payload) return;
      this.transport.send({ t: Msg.CLUE_HUNT, ...payload });
    };
    // Patch any method that advances clue progress
    if (typeof ClueHunt !== 'undefined') {
      for (const m of ['startClueHunt', 'giveReward', 'updateClue1Progress', 'updateClue2Progress', 'updateClue3Progress', 'updateClue4Progress', 'updateClue5Progress', 'updateClue6Progress']) {
        if (typeof ClueHunt.prototype[m] === 'function') {
          this.ctx.patch(ClueHunt, m).after(() => send());
        }
      }
    }
  }

  _serializeClueHunt() {
    const ch = game.clueHunt;
    if (!ch) return null;
    const steps = (ch.clueProgress || []).map(s => ({
      id: s.id, progress: s.progress, required: s.required, complete: s.complete,
    }));
    return { steps, currentStep: ch.currentStep };
  }

  _applyClueHunt(msg) {
    if (!game.clueHunt || !msg.steps) return;
    this._applyRemote('applyClueHunt', () => {
      const ch = game.clueHunt;
      if (ch.clueProgress) {
        for (let i = 0; i < msg.steps.length && i < ch.clueProgress.length; i++) {
          const remote = msg.steps[i];
          const local = ch.clueProgress[i];
          if (remote.id && local.id === remote.id) {
            local.progress = Math.max(local.progress, remote.progress);
            if (remote.complete) local.complete = true;
          }
        }
      }
      if (typeof msg.currentStep === 'number') ch.currentStep = msg.currentStep;
    });
  }

  // ---- Corruption sync --------------------------------------------------
  _patchCorruption() {
    const co = game.corruption;
    if (!co) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this.transport.send({ t: Msg.CORRUPTION, rows: this._serializeCorruptionRows() });
    };
    if (typeof CorruptionEffectTable !== 'undefined' && co.corruptionEffects && typeof co.corruptionEffects.unlockRow === 'function') {
      this.ctx.patch(CorruptionEffectTable, 'unlockRow').after(() => send());
    }
  }

  _serializeCorruptionRows() {
    const co = game.corruption;
    if (!co) return [];
    const rows = [];
    // CorruptionEffectTableRow has no .id — send only the effect id.
    if (co.corruptionEffects && co.corruptionEffects.unlockedRows) {
      for (const row of co.corruptionEffects.unlockedRows) {
        rows.push({ effectId: row.effect ? row.effect.id : null });
      }
    }
    return rows;
  }

  _applyCorruption(msg) {
    const co = game.corruption;
    if (!co || !co.corruptionEffects || !msg.rows) return;
    this._applyRemote('applyCorruption', () => {
      // CorruptionEffectTableRow has no .id — match by effect.id.
      // Unlock rows that are unlocked on the remote side.
      const table = co.corruptionEffects;
      for (const r of msg.rows) {
        if (!r.effectId) continue;
        const effect = game.combatEffects && game.combatEffects.getObjectByID(r.effectId);
        if (!effect) continue;
        // Check if already unlocked
        const alreadyUnlocked = table.unlockedRows && table.unlockedRows.some(row => row.effect && row.effect.id === r.effectId);
        if (!alreadyUnlocked && table.allRows) {
          const row = table.allRows.find(row => row.effect && row.effect.id === r.effectId);
          if (row && !row.isUnlocked && table.unlockRow) {
            try { table.unlockRow(row); } catch { /* skip */ }
          }
        }
      }
    }, { save: false });
  }

  // ---- Raid sync (Golbin raids) -----------------------------------------
  _patchRaids() {
    if (!game.golbinRaid) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const r = game.golbinRaid;
      const history = this._serializeRaidHistory();
      // Live raid loadout: equipment, food, passives, modifiers, state.
      const loadout = this._serializeRaidLoadout();
      // Item selection state (when choosing items during raid)
      const itemSelection = this._serializeRaidSelection('itemSelection');
      const exclusiveItemSelection = this._serializeRaidSelection('exclusiveItemSelection');
      this.transport.send({
        t: Msg.RAID,
        wave: r.wave,
        waveProgress: r.waveProgress,
        // selectedDifficulty is a RaidDifficulty enum value (number), not an object.
        selectedDifficulty: (typeof r.selectedDifficulty === 'number') ? r.selectedDifficulty
          : (r.selectedDifficulty && r.selectedDifficulty.id != null ? r.selectedDifficulty.id : null),
        history,
        loadout,
        itemSelection,
        exclusiveItemSelection,
        itemCategoryBeingSelected: r.itemCategoryBeingSelected || null,
        isSelectingPositiveModifier: r.isSelectingPositiveModifier || false,
        randomModifiersBeingSelected: (r.randomModifiersBeingSelected || []).map(m => ({ id: m.modifier?.id || m.id, value: m.value })),
      });
    };
    if (typeof RaidManager !== 'undefined') {
      for (const m of ['startRaid', 'skipWave', 'changeDifficulty', 'continueRaid', 'equipItemCallback', 'addFoodCallback', 'selectRandomModifier', 'rerollPassiveCallback', 'pause', 'unpause']) {
        if (typeof RaidManager.prototype[m] === 'function') {
          this.ctx.patch(RaidManager, m).after(() => send());
        }
      }
    }
    // Also patch RaidPlayer equip methods
    if (typeof RaidPlayer !== 'undefined') {
      for (const m of ['equipItem', 'equipFood', 'setEquipmentToDefault']) {
        if (typeof RaidPlayer.prototype[m] === 'function') {
          this.ctx.patch(RaidPlayer, m).after(() => send());
        }
      }
    }
  }

  /** Raid history wire entries: { wave, coins, timestamp }. limit=undefined → full history. */
  _serializeRaidHistory(limit) {
    const r = game.golbinRaid;
    const history = (r && r.history) || [];
    const slice = limit === undefined ? history : history.slice(-limit);
    return slice.map(h => ({
      wave: h.wave, coins: h.raidCoinsEarned, timestamp: h.timestamp,
    }));
  }

  /** Live raid loadout: equipment, food, passives, modifiers, state. */
  _serializeRaidLoadout() {
    const r = game.golbinRaid;
    const loadout = {};
    if (!r) return loadout;
    if (r.player) {
      const p = r.player;
      loadout.equipment = {};
      if (p.equipment && p.equipment.equippedItems) {
        // equippedItems is Record<string, EquippedItem>; EquippedItem has .item and .quantity
        for (const [slotId, eqItem] of Object.entries(p.equipment.equippedItems)) {
          if (eqItem && eqItem.item && !eqItem.isEmpty) {
            loadout.equipment[slotId] = { itemId: eqItem.item.id, qty: eqItem.quantity };
          }
        }
      }
      loadout.food = null;
      if (p.food && p.food.currentSlot && p.food.currentSlot.item) {
        loadout.food = { itemId: p.food.currentSlot.item.id, qty: p.food.currentSlot.quantity };
      }
    }
    loadout.randomPlayerModifiers = (r.randomPlayerModifiers || []).map(m => ({ id: m.modifier?.id || m.id, value: m.value }));
    loadout.randomEnemyModifiers = (r.randomEnemyModifiers || []).map(m => ({ id: m.modifier?.id || m.id, value: m.value }));
    loadout.state = r.state;
    loadout.killCount = r.killCount;
    loadout.posModsSelected = r.posModsSelected;
    loadout.negModsSelected = r.negModsSelected;
    loadout.isPaused = r.isPaused;
    loadout.isFightingITMBoss = r.isFightingITMBoss;
    return loadout;
  }

  /** Serialize a raid item-selection map ({ category: Item[] } → { category: itemId[] }). */
  _serializeRaidSelection(field) {
    const out = {};
    const r = game.golbinRaid;
    const selection = r ? r[field] : null;
    if (selection) {
      for (const [cat, items] of Object.entries(selection)) {
        out[cat] = items ? items.map(it => it ? it.id : null) : [];
      }
    }
    return out;
  }

  /** Rehydrate a raid item-selection map from wire ids back into Items. */
  _rehydrateRaidSelection(r, field, wire) {
    if (wire && r[field]) {
      for (const [cat, ids] of Object.entries(wire)) {
        r[field][cat] = ids.map(id => id ? game.items.getObjectByID(id) : null).filter(Boolean);
      }
    }
  }

  /** Rehydrate a wire modifier list [{ id, value }] into ModifierValue[] ({ modifier, value }). */
  _rehydrateModifiers(arr) {
    return arr.map(m => {
      const modifier = game.modifierRegistry && game.modifierRegistry.getObjectByID(m.id);
      return modifier ? { modifier, value: m.value } : null;
    }).filter(Boolean);
  }

  _applyRaid(msg) {
    if (!game.golbinRaid) return;
    this._applyRemote('applyRaid', () => {
      const r = game.golbinRaid;
      if (typeof msg.wave === 'number') r.wave = msg.wave;
      if (typeof msg.waveProgress === 'number') r.waveProgress = msg.waveProgress;
      if (msg.selectedDifficulty != null) {
        // selectedDifficulty is a RaidDifficulty enum (number). Use
        // changeDifficulty() if available so UI/state updates properly,
        // otherwise set directly.
        if (typeof msg.selectedDifficulty === 'number') {
          if (typeof r.changeDifficulty === 'function') {
            try { r.changeDifficulty(msg.selectedDifficulty); } catch { r._setDifficulty = msg.selectedDifficulty; }
          } else {
            r._setDifficulty = msg.selectedDifficulty;
            r.selectedDifficulty = msg.selectedDifficulty;
          }
        } else if (typeof msg.selectedDifficulty === 'string') {
          // Legacy: map string id back to enum value if possible.
          const map = { Easy: 0, Medium: 1, Hard: 2 };
          const v = map[msg.selectedDifficulty];
          if (v != null) r._setDifficulty = v;
        }
      }
      // History is append-only — just add new entries
      if (msg.history && r.history) {
        for (const h of msg.history) {
          const exists = r.history.find(local => local.wave === h.wave && local.timestamp === h.timestamp);
          if (!exists) {
            // RaidHistory requires: skillLevels, equipment, inventory, food,
            // wave, kills, timestamp, raidCoinsEarned, difficulty.
            // We only sync the primitive fields; fill the rest with defaults.
            r.history.push({
              wave: h.wave || 0,
              kills: h.kills || 0,
              timestamp: h.timestamp || 0,
              raidCoinsEarned: h.coins || h.raidCoinsEarned || 0,
              difficulty: h.difficulty || 0,
              skillLevels: h.skillLevels || [],
              equipment: h.equipment || [],
              inventory: h.inventory || [],
              food: h.food || null,
            });
          }
        }
      }
      // Live raid loadout
      if (msg.loadout) {
        const lo = msg.loadout;
        if (typeof lo.state === 'number') r.state = lo.state;
        if (typeof lo.killCount === 'number') r.killCount = lo.killCount;
        if (typeof lo.posModsSelected === 'number') r.posModsSelected = lo.posModsSelected;
        if (typeof lo.negModsSelected === 'number') r.negModsSelected = lo.negModsSelected;
        if (typeof lo.isPaused === 'boolean') r.isPaused = lo.isPaused;
        if (typeof lo.isFightingITMBoss === 'boolean') r.isFightingITMBoss = lo.isFightingITMBoss;
        // Equipment
        if (lo.equipment && r.player && r.player.equipment) {
          for (const [slotId, eq] of Object.entries(lo.equipment)) {
            const item = game.items.getObjectByID(eq.itemId);
            // equipItem expects an EquipmentSlot object, not a string id.
            const slot = game.equipmentSlots && game.equipmentSlots.getObjectByID(slotId);
            if (item && slot && typeof r.player.equipItem === 'function') {
              try { r.player.equipItem(item, eq.set || 0, slot, eq.qty || 1); } catch { /* noop */ }
            }
          }
        }
        // Food
        if (lo.food && r.player && typeof r.player.equipFood === 'function') {
          const foodItem = game.items.getObjectByID(lo.food.itemId);
          if (foodItem) {
            try { r.player.equipFood(foodItem, lo.food.qty || 1); } catch { /* noop */ }
          }
        }
        // Modifiers — set directly (these are runtime-only during a raid)
        // ModifierValue has { modifier, value }, not { id, value }.
        if (lo.randomPlayerModifiers) {
          r.randomPlayerModifiers = this._rehydrateModifiers(lo.randomPlayerModifiers);
        }
        if (lo.randomEnemyModifiers) {
          r.randomEnemyModifiers = this._rehydrateModifiers(lo.randomEnemyModifiers);
        }
        if (r.render) try { r.render(); } catch { /* noop */ }
      }
      // Item selection state (for raid item choosing UI)
      this._rehydrateRaidSelection(r, 'itemSelection', msg.itemSelection);
      this._rehydrateRaidSelection(r, 'exclusiveItemSelection', msg.exclusiveItemSelection);
      if (msg.itemCategoryBeingSelected !== undefined) r.itemCategoryBeingSelected = msg.itemCategoryBeingSelected;
      if (typeof msg.isSelectingPositiveModifier === 'boolean') r.isSelectingPositiveModifier = msg.isSelectingPositiveModifier;
      if (msg.randomModifiersBeingSelected) {
        // randomModifiersBeingSelected is ModifierValue[] ({ modifier, value })
        r.randomModifiersBeingSelected = this._rehydrateModifiers(msg.randomModifiersBeingSelected);
      }
    }, { save: false });
  }

  // ---- Fishing Contest sync ---------------------------------------------
  _patchFishingContest() {
    const fc = game.fishing?.contest;
    if (!fc) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const payload = this._serializeFishingContest();
      if (!payload) return;
      this.transport.send({ t: Msg.FISHING_CONTEST, ...payload });
    };
    if (typeof FishingContest !== 'undefined') {
      for (const m of ['startFishingContest', 'stopFishingContest', 'setFishingContestDifficulty', 'onFishingAction', 'peformPlayerFishingContestAction', 'finalizeFishingContest', 'generateNewFishingContestLeaderboard', 'updateBestFishResultForPlayer', 'updateBestFishResultForContestant']) {
        if (typeof FishingContest.prototype[m] === 'function') {
          this.ctx.patch(FishingContest, m).after(() => send());
        }
      }
    }
  }

  _serializeFishingContest() {
    const fc = game.fishing && game.fishing.contest;
    if (!fc) return null;
    const results = (fc.playerResults || []).map(r => ({
      length: r.length || 0, weight: r.weight || 0,
    }));
    const leaderboard = (fc.contestantLeaderboard || []).map(e => ({
      isPlayer: !!e.isPlayer, name: e.name || '',
      bestResult: e.bestResult ? { length: e.bestResult.length || 0, weight: e.bestResult.weight || 0 } : null,
    }));
    return {
      isActive: fc.isActive,
      // FishingContestFish has no .id — send the underlying item id.
      activeFishId: fc.activeFish ? (fc.activeFish.fish ? fc.activeFish.fish.id : null) : null,
      actionsRemaining: fc.actionsRemaining,
      currentDifficulty: fc.currentDifficulty,
      completionTracker: fc.completionTracker ? [...fc.completionTracker] : [],
      masteryTracker: fc.masteryTracker ? [...fc.masteryTracker] : [],
      results,
      leaderboard,
    };
  }

  _applyFishingContest(msg) {
    const fc = game.fishing?.contest;
    if (!fc) return;
    this._applyRemote('applyFishingContest', () => {
      fc.isActive = !!msg.isActive;
      // activeFish is a FishingContestFish (not an Item). Find the matching
      // one in fc.availableFish by the underlying item id.
      if (msg.activeFishId && fc.availableFish) {
        fc.activeFish = fc.availableFish.find(f => f.fish && f.fish.id === msg.activeFishId);
      }
      if (typeof msg.actionsRemaining === 'number') fc.actionsRemaining = msg.actionsRemaining;
      if (typeof msg.currentDifficulty === 'number') fc.currentDifficulty = msg.currentDifficulty;
      if (msg.completionTracker) fc.completionTracker = [...msg.completionTracker];
      if (msg.masteryTracker) fc.masteryTracker = [...msg.masteryTracker];
      if (msg.results) {
        // FishingContestResult = { length, weight }. Merge by taking the best
        // result (highest length, then weight) for each slot.
        const incoming = msg.results.map(r => ({ length: r.length || 0, weight: r.weight || 0 }));
        if (!fc.playerResults) fc.playerResults = [];
        // Replace if remote has more results, otherwise merge best per index.
        if (incoming.length >= fc.playerResults.length) {
          fc.playerResults = incoming;
        } else {
          for (let i = 0; i < incoming.length; i++) {
            const cur = fc.playerResults[i];
            const inc = incoming[i];
            if (!cur || inc.length > cur.length || (inc.length === cur.length && inc.weight > cur.weight)) {
              fc.playerResults[i] = inc;
            }
          }
        }
      }
      if (msg.leaderboard) {
        if (!fc.contestantLeaderboard) fc.contestantLeaderboard = [];
        for (let i = 0; i < msg.leaderboard.length; i++) {
          const inc = msg.leaderboard[i];
          const cur = fc.contestantLeaderboard[i];
          const bestResult = inc.bestResult ? { length: inc.bestResult.length, weight: inc.bestResult.weight } : null;
          if (!cur) {
            fc.contestantLeaderboard[i] = { isPlayer: inc.isPlayer, name: inc.name, bestResult };
          } else {
            cur.isPlayer = inc.isPlayer; cur.name = inc.name;
            if (bestResult && (!cur.bestResult || bestResult.length > cur.bestResult.length || (bestResult.length === cur.bestResult.length && bestResult.weight > cur.bestResult.weight))) {
              cur.bestResult = bestResult;
            }
          }
        }
      }
      if (fc.renderQueue) {
        fc.renderQueue.status = true;
        fc.renderQueue.results = true;
        fc.renderQueue.leaderboard = true;
        fc.renderQueue.remainingActions = true;
      }
      if (fc.render) try { fc.render(); } catch { /* noop */ }
    }, { save: false });
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
        // TownshipCasualTask has no .progress/.completed directly —
        // progress is on each goal in t.goals.allGoals. Sync per-goal
        // progress so the receiver can update each goal's _progress.
        for (const t of tw.casualTasks.currentCasualTasks) {
          const goals = [];
          if (t.goals && t.goals.allGoals) {
            for (const g of t.goals.allGoals) {
              goals.push({ progress: g.progress || 0 });
            }
          }
          casual.push({ id: t.id, goals });
        }
      }
      this.transport.send({
        t: Msg.TOWNSHIP_TASKS, completed,
        casualTasksCompleted: tw.casualTasks ? tw.casualTasks.casualTasksCompleted : 0,
        casual,
      });
    };
    if (typeof TownshipTasks !== 'undefined' && tw.tasks && typeof tw.tasks.completeTask === 'function') {
      // completeTask is also patched by _patchTownship (fires first, sending TOWNSHIP).
      this.ctx.patch(TownshipTasks, 'completeTask').after(() => send());
    }
    if (typeof TownshipCasualTasks !== 'undefined' && tw.casualTasks) {
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
    this._applyRemote('applyTownshipTasks', () => {
      if (msg.completed && tw.tasks && tw.tasks.completedTasks) {
        for (const tid of msg.completed) {
          // tw.tasks is TownshipTasks; the task registry is tw.tasks.tasks
          // (NamespaceRegistry<TownshipTask>), not tw.tasks itself.
          const task = tw.tasks.tasks.getObjectByID(tid);
          if (task && !tw.tasks.completedTasks.has(task)) tw.tasks.completedTasks.add(task);
        }
      }
      if (typeof msg.casualTasksCompleted === 'number' && tw.casualTasks) {
        tw.casualTasks.casualTasksCompleted = Math.max(tw.casualTasks.casualTasksCompleted || 0, msg.casualTasksCompleted);
      }
      if (msg.casual && tw.casualTasks && tw.casualTasks.currentCasualTasks) {
        // TownshipCasualTask has no .progress/.completed — progress is
        // per-goal in task.goals.allGoals. Use setProgress() if available.
        for (const c of msg.casual) {
          const task = tw.casualTasks.currentCasualTasks.find(t => t.id === c.id);
          if (!task || !task.goals || !task.goals.allGoals) continue;
          for (let i = 0; i < (c.goals || []).length && i < task.goals.allGoals.length; i++) {
            const goal = task.goals.allGoals[i];
            const progress = c.goals[i].progress;
            if (typeof progress === 'number' && typeof goal.setProgress === 'function') {
              try { goal.setProgress(progress); } catch { /* skip */ }
            }
          }
        }
      }
    }, { save: false });
  }

  // ---- Cartography sync -------------------------------------------------
  _patchCartography() {
    const ca = game.cartography;
    if (!ca) return;
    logger.info('[CARTO] _patchCartography: starting');

    // Use setTimeout(0) to make the send asynchronous — this prevents
    // _sendCartography() from blocking the click handler that triggered
    // the patch (e.g. createNewMapForDigSite → selectDigSiteMapOnClick).
    // _sendCartography() iterates over all hexes/POIs/digSiteMaps which
    // can be slow for large maps, and doing it synchronously inside a
    // click handler freezes the game.
    let cartoSendPending = false;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      if (cartoSendPending) return; // batch multiple calls into one
      cartoSendPending = true;
      setTimeout(() => {
        cartoSendPending = false;
        try { this._sendCartography(); } catch (e) { logger.error('[CARTO] send failed', e); }
      }, 0);
    };

    // Patch survey, discovery, travel, and paper methods.
    // Includes createNewMapForDigSite — the actual method that creates a
    // dig site map (createMapOnClick only opens the modal).
    // The second half (surveyHex … unsurveyWholeMap) covers survey progress.
    // NOTE: 'action' is called every tick during surveying — don't patch
    // it directly as that would send cartography data every tick (huge
    // payload). The patched methods below are throttled by the setTimeout
    // batch in send() alone.
    if (typeof Cartography !== 'undefined') {
      for (const m of ['discoverPOI', 'selectPaperRecipeOnClick', 'autoSurveyOnClick',
                       'travelOnClick', 'surveyOnClick', 'startAutoSurvey',
                       'startSurveyQueue', 'movePlayer', 'onHexTap',
                       'makePaperOnClick', 'startMakingPaper',
                       'createMapOnClick', 'startMapUpgradeOnClick',
                       'startUpgradingMap', 'selectDigSiteOnClick',
                       'selectDigSiteMapOnClick', 'deleteDigSiteMapOnClick',
                       'selectRefinementOnClick', 'unlockFastTravelOnClick',
                       'goToWorldMapOnClick', 'goToPlayerOnClick',
                       'createNewMapForDigSite', 'destroyDigSiteMap',
                       'surveyHex', 'onHexFullSurvey', 'onHexMastery',
                       'surveyAuto', 'surveyActionQueue',
                       'useDigSiteMapCharges', 'mapUpgradeAction',
                       'paperMakingAction', 'unsurveyWholeMap']) {
        if (typeof Cartography.prototype[m] === 'function') {
          this.ctx.patch(Cartography, m).after(() => send());
        }
      }
    }
  }

  _sendCartography() {
    const payload = this._serializeCartography();
    if (!payload) return;
    this.transport.send({ t: Msg.CARTOGRAPHY, ...payload });
  }

  _serializeCartography() {
    const ca = game.cartography;
    if (!ca) return null;
    const maps = [];
    if (ca.worldMaps) {
      for (const wm of ca.worldMaps.allObjects) {
        const mapData = {
          id: wm.id,
          hexes: [],
          pois: [],
          playerPos: null,
          fullySurveyedHexes: wm.fullySurveyedHexes || 0,
          masteredHexes: wm.masteredHexes || 0,
        };
        // Send hex survey levels — only hexes that have been surveyed
        if (wm.hexes) {
          for (const [q, qMap] of wm.hexes) {
            for (const [r, hex] of qMap) {
              if (hex._surveyLevel > 0 || hex._surveyXP > 0) {
                mapData.hexes.push({
                  q, r,
                  surveyLevel: hex._surveyLevel,
                  surveyXP: hex._surveyXP,
                });
              }
            }
          }
        }
        // Send POI discoveries, discovery modifiers (movesLeft), and fast travel unlock status
        if (wm.pointsOfInterest) {
          for (const poi of wm.pointsOfInterest.allObjects) {
            if (poi.isDiscovered) {
              const poiData = { poiId: poi.id };
              // Fast travel unlock status
              if (poi.fastTravel && typeof poi.fastTravel.isUnlocked === 'boolean') {
                poiData.fastTravelUnlocked = poi.fastTravel.isUnlocked;
              }
              mapData.pois.push(poiData);
            }
          }
        }
        // Send player position
        if (wm._playerPosition) {
          const pos = wm._playerPosition;
          mapData.playerPos = { q: pos.q, r: pos.r };
        }
        maps.push(mapData);
      }
    }
    return {
      maps,
      activeMapId: ca.activeMap ? ca.activeMap.id : null,
      paperRecipeId: ca.selectedPaperRecipe ? ca.selectedPaperRecipe.id : null,
      selectedMapUpgradeDigsiteId: ca.selectedMapUpgradeDigsite ? ca.selectedMapUpgradeDigsite.id : null,
      // Dig site maps (tier, upgrade actions, charges, refinements)
      digSiteMaps: this._serializeDigSiteMaps(),
    };
  }

  _serializeDigSiteMaps() {
    const ca = game.cartography;
    if (!ca) return [];
    const out = [];
    if (game.archaeology && game.archaeology.actions) {
      for (const digSite of game.archaeology.actions.allObjects) {
        if (!digSite.maps) continue;
        const maps = [];
        for (const m of digSite.maps) {
          maps.push({
            tierIndex: m.tier ? m.tier.index : 0,
            upgradeActions: m._upgradeActions || 0,
            charges: m.charges || 0,
            refinements: (m.refinements || []).map(r => ({ id: r.modifier ? r.modifier.id : null, value: r.value })),
            artefactValues: m.artefactValues ? { tiny: m.artefactValues.tiny || 0, small: m.artefactValues.small || 0, medium: m.artefactValues.medium || 0, large: m.artefactValues.large || 0 } : null,
          });
        }
        out.push({ digSiteId: digSite.id, maps });
      }
    }
    return out;
  }

  _applyCartography(msg) {
    const ca = game.cartography;
    if (!ca) return;
    this._applyRemote('applyCartography', () => {
      if (msg.maps && ca.worldMaps) {
        for (const mData of msg.maps) {
          const wm = ca.worldMaps.getObjectByID(mData.id);
          if (!wm) continue;

          // Apply hex survey levels
          if (mData.hexes && wm.hexes) {
            for (const h of mData.hexes) {
              const qMap = wm.hexes.get(h.q);
              if (!qMap) continue;
              const hex = qMap.get(h.r);
              if (!hex) continue;
              // Only update if the remote has more progress
              if (h.surveyLevel > hex._surveyLevel) {
                hex._surveyLevel = h.surveyLevel;
                hex._surveyXP = Math.max(hex._surveyXP || 0, h.surveyXP || 0);
                // Queue render updates
                if (ca.renderQueue) {
                  if (ca.renderQueue.hexBackground) ca.renderQueue.hexBackground.add(hex);
                  if (ca.renderQueue.hexProgress) ca.renderQueue.hexProgress.add(hex);
                  if (ca.renderQueue.masteryMarkers) ca.renderQueue.masteryMarkers.add(hex);
                }
              }
            }
          }

          // Apply POI discoveries and fast travel unlock status.
          // We can't call ca.discoverPOI() directly because it gives rewards
          // (which the host already got) and triggers UI cascading that can
          // freeze. But we DO need to update the map's discovered/undiscovered
          // lists and create the initial dig site map, otherwise the
          // archaeology UI won't show the dig site as available.
          if (mData.pois && wm.pointsOfInterest) {
            for (const p of mData.pois) {
              const poi = wm.pointsOfInterest.getObjectByID(p.poiId);
              if (poi && !poi.isDiscovered) {
                poi.isDiscovered = true;
                // Update map's discovered/undiscovered lists
                if (wm.discoveredPOIs && !wm.discoveredPOIs.includes(poi)) {
                  wm.discoveredPOIs.push(poi);
                }
                if (wm.undiscoveredPOIs) {
                  const idx = wm.undiscoveredPOIs.indexOf(poi);
                  if (idx !== -1) wm.undiscoveredPOIs.splice(idx, 1);
                }
                if (ca.renderQueue && ca.renderQueue.poiMarkers) {
                  ca.renderQueue.poiMarkers.add(poi);
                }
                // If this is a DigSitePOI, create the initial free map and
                // trigger archaeology render so the dig site shows up.
                // discoverPOI() does this normally; we replicate it here
                // without giving rewards.
                if (poi.digSite && typeof DigSiteMap !== 'undefined') {
                  try {
                    if (poi.digSite.maps.length === 0) {
                      poi.digSite.maps.push(DigSiteMap.createAverageMap(poi.digSite, game, ca, DigSiteMap.tiers[2]));
                      poi.digSite.selectedUpgradeIndex = 0;
                    }
                    if (ca.renderQueue) {
                      ca.renderQueue.digSiteSelect = true;
                    }
                    if (game.archaeology) {
                      if (game.archaeology.renderQueue) {
                        game.archaeology.renderQueue.digSiteVisibility = true;
                        game.archaeology.renderQueue.mapSelection.add(poi.digSite);
                      }
                    }
                  } catch (e) { logger.warn('[CARTO] failed to create initial dig site map for', p.poiId, e); }
                }
              }
              // Apply fast travel unlock status
              if (poi && p.fastTravelUnlocked === true && poi.fastTravel) {
                poi.fastTravel.isUnlocked = true;
              }
            }
          }

          // Apply player position
          if (mData.playerPos && wm.hexes) {
            const qMap = wm.hexes.get(mData.playerPos.q);
            const hex = qMap ? qMap.get(mData.playerPos.r) : null;
            if (hex) {
              wm._playerPosition = hex;
              if (ca.renderQueue) {
                ca.renderQueue.playerMarker = true;
                ca.renderQueue.visionRange = true;
              }
            }
          }

          // Update survey counts
          if (typeof mData.fullySurveyedHexes === 'number') {
            wm.fullySurveyedHexes = Math.max(wm.fullySurveyedHexes || 0, mData.fullySurveyedHexes);
          }
          if (typeof mData.masteredHexes === 'number') {
            wm.masteredHexes = Math.max(wm.masteredHexes || 0, mData.masteredHexes);
          }
        }
      }

      // Set active map — only if the local player is not currently
      // viewing cartography (to avoid disrupting their view). Don't
      // add all hexes to the render queue — that can be thousands of
      // hexes and freeze the game.
      if (msg.activeMapId && ca.worldMaps) {
        const wm = ca.worldMaps.getObjectByID(msg.activeMapId);
        if (wm && ca.activeMap !== wm) {
          ca.activeMap = wm;
          // Just set flags, let the game's render loop handle it.
          if (ca.renderQueue) {
            ca.renderQueue.visionRange = true;
            ca.renderQueue.playerMarker = true;
          }
        }
      }

      // Set paper recipe
      if (msg.paperRecipeId) {
        ca.selectedPaperRecipe = game.items.getObjectByID(msg.paperRecipeId);
      }

      // Set selected map upgrade digsite
      if (msg.selectedMapUpgradeDigsiteId !== undefined) {
        ca.selectedMapUpgradeDigsite = msg.selectedMapUpgradeDigsiteId
          ? (game.archaeology && game.archaeology.actions.getObjectByID(msg.selectedMapUpgradeDigsiteId))
          : undefined;
      }

      // Apply dig site maps (tier, upgrade actions, charges, refinements)
      if (msg.digSiteMaps && game.archaeology && game.archaeology.actions) {
        for (const dsm of msg.digSiteMaps) {
          try {
            const digSite = game.archaeology.actions.getObjectByID(dsm.digSiteId);
            if (!digSite || !digSite.maps) continue;
            // Ensure we have the right number of maps; create missing ones.
            // Do NOT call ca.createNewMapForDigSite() — it consumes costs from
            // the bank and triggers render queue flags that call expensive DOM
            // operations (setDigSite, setDigSiteMap) which freeze the game.
            // Instead, create the DigSiteMap object directly and push it.
            while (digSite.maps.length < dsm.maps.length) {
              logger.info('[CARTO] Creating new DigSiteMap for', dsm.digSiteId, 'current:', digSite.maps.length, 'target:', dsm.maps.length);
              try {
                if (typeof DigSiteMap !== 'undefined') {
                  const newMap = new DigSiteMap(digSite, game, ca);
                  digSite.maps.push(newMap);
                  logger.info('[CARTO] DigSiteMap created successfully');
                } else {
                  logger.warn('[CARTO] DigSiteMap class not found globally');
                  break;
                }
              } catch (e) { logger.warn('[CARTO] failed to create DigSiteMap', e); break; }
            }
            for (let i = 0; i < dsm.maps.length && i < digSite.maps.length; i++) {
              try {
                const remote = dsm.maps[i];
                const local = digSite.maps[i];
                if (!local) continue;
                if (typeof remote.upgradeActions === 'number') local._upgradeActions = Math.max(local._upgradeActions || 0, remote.upgradeActions);
                if (typeof remote.charges === 'number') local.charges = remote.charges;
                // Recompute tier from upgrade actions
                if (typeof local.computeTier === 'function') {
                  try { local.computeTier(); } catch { /* noop */ }
                }
                // Refinements — replace if remote has more
                if (remote.refinements && remote.refinements.length > (local.refinements || []).length) {
                  local.refinements = this._rehydrateModifiers(remote.refinements);
                }
                // Artefact values — take max per size to preserve best drops
                if (remote.artefactValues && local.artefactValues) {
                  for (const sz of ['tiny', 'small', 'medium', 'large']) {
                    if (typeof remote.artefactValues[sz] === 'number') {
                      local.artefactValues[sz] = Math.max(local.artefactValues[sz] || 0, remote.artefactValues[sz]);
                    }
                  }
                }
              } catch (e) { logger.warn('[CARTO] failed to apply map data for index', i, e); }
            }
          } catch (e) { logger.warn('[CARTO] failed to process digSite', dsm.digSiteId, e); }
        }
      }

      // Don't call ca.render() — it's extremely expensive for cartography
      // (re-renders the entire hex map) and can freeze the game. The render
      // queue entries we set above will be processed by the game's normal
      // render loop on the next tick.
    });
  }

  // ---- Stats sync -------------------------------------------------------
  // game.stats is a Statistics object with named StatTracker properties
  // (Woodcutting, Fishing, ..., General, Combat, GolbinRaid, Shop) plus
  // MappedStatTracker properties (Items, Monsters).
  // Each StatTracker has a .stats Map<number, number>.
  // We patch StatTracker.prototype.add/set/inc to detect changes and sync
  // all trackers as { trackerName: { statId: value, ... }, ... }.
  _patchStats() {
    if (!game.stats) return;
    // Build a map from tracker instance -> tracker name for quick lookup
    const trackerNames = new Map();
    for (const key of STATS_TRACKER_KEYS) {
      if (game.stats[key]) trackerNames.set(game.stats[key], key);
    }
    // MappedStatTrackers (Items, Monsters) — track separately
    for (const key of STATS_MAPPED_TRACKER_KEYS) {
      if (game.stats[key]) trackerNames.set(game.stats[key], key);
    }

    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this.transport.send({ t: Msg.STATS, stats: this._serializeStats() });
    };
    // Throttle — stats change very frequently during active play
    let lastStatsSend = 0;
    const throttledSend = () => {
      const now = Date.now();
      if (now - lastStatsSend < 3000) return;
      lastStatsSend = now;
      send();
    };

    // Patch StatTracker.prototype.add/set/inc — these are the actual methods
    if (typeof StatTracker !== 'undefined' && StatTracker.prototype) {
      for (const m of ['add', 'set', 'inc']) {
        if (typeof StatTracker.prototype[m] === 'function') {
          try {
            this.ctx.patch(StatTracker, m).after(function () {
              // Only sync if this tracker is one of ours (not a dummy)
              const name = trackerNames.get(this);
              if (!name) return;
              throttledSend();
            });
          } catch { /* skip */ }
        }
      }
    }
  }

  _serializeStats() {
    const data = {};
    // Named StatTrackers
    for (const key of STATS_TRACKER_KEYS) {
      const tracker = game.stats[key];
      if (!tracker || !tracker.stats) continue;
      const entries = {};
      for (const [statId, val] of tracker.stats) entries[statId] = val;
      data[key] = entries;
    }
    // MappedStatTrackers (Items, Monsters) — keyed by object ID
    for (const key of STATS_MAPPED_TRACKER_KEYS) {
      const mst = game.stats[key];
      if (!mst || !mst.statsMap) continue;
      const mapped = {};
      for (const [obj, tracker] of mst.statsMap) {
        if (!tracker || !tracker.stats) continue;
        const entries = {};
        for (const [statId, val] of tracker.stats) entries[statId] = val;
        if (obj && obj.id) mapped[obj.id] = entries;
      }
      data[key] = mapped;
    }
    return data;
  }

  /** Merge wire stat entries into a StatTracker (higher value wins). */
  _mergeStatTracker(tracker, entries) {
    for (const [statId, val] of Object.entries(entries)) {
      const numKey = Number(statId);
      const k = isNaN(numKey) ? statId : numKey;
      // Use Math.max to avoid overwriting higher stat values with stale lower ones
      const current = tracker.stats.get(k) || 0;
      tracker.stats.set(k, Math.max(current, val));
    }
  }

  _applyStats(msg) {
    if (!game.stats || !msg.stats) return;
    this._applyRemote('applyStats', () => {
      for (const key of STATS_TRACKER_KEYS) {
        const tracker = game.stats[key];
        const remoteData = msg.stats[key];
        if (!tracker || !tracker.stats || !remoteData) continue;
        this._mergeStatTracker(tracker, remoteData);
      }
      // MappedStatTrackers (Items, Monsters)
      for (const key of STATS_MAPPED_TRACKER_KEYS) {
        const mst = game.stats[key];
        const remoteMapped = msg.stats[key];
        if (!mst || !mst.statsMap || !remoteMapped) continue;
        for (const [objId, entries] of Object.entries(remoteMapped)) {
          // Find the object in the registry
          const registry = mst.registry;
          if (!registry) continue;
          const obj = registry.getObjectByID(objId);
          if (!obj) continue;
          const tracker = mst.statsMap.get(obj);
          if (!tracker || !tracker.stats) continue;
          this._mergeStatTracker(tracker, entries);
        }
      }
      if (game.stats.renderMutatedStats) try { game.stats.renderMutatedStats(); } catch { /* noop */ }
    }, { save: false });
  }

  // ---- Skill level cap increases sync -----------------------------------
  // Purchased from the shop; tracked on Game as _levelCapIncreasesBought,
  // _abyssalLevelCapIncreasesBought, and activeLevelCapIncreases (the
  // specific caps currently applied to skills).
  _patchLevelCaps() {
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendLevelCaps();
    };
    for (const m of ['purchaseSkillLevelCaps', 'purchaseAbyssalSkillLevelCaps', 'increaseSkillLevelCaps', 'selectRandomLevelCapIncrease']) {
      if (typeof Game !== 'undefined' && typeof Game.prototype[m] === 'function') {
        this.ctx.patch(Game, m).after(() => send());
      }
    }
  }

  _serializeLevelCaps() {
    const data = {
      levelCapIncreasesBought: game._levelCapIncreasesBought,
      abyssalLevelCapIncreasesBought: game._abyssalLevelCapIncreasesBought,
      active: [],
      beingSelected: [],
    };
    if (game.activeLevelCapIncreases) {
      for (const cap of game.activeLevelCapIncreases) {
        // SkillLevelCapIncrease has no .skill property; only send the id,
        // which is all _applyLevelCaps uses to look up the cap object.
        if (cap && cap.id) data.active.push({ id: cap.id });
      }
    }
    if (game.levelCapIncreasesBeingSelected) {
      for (const cap of game.levelCapIncreasesBeingSelected) {
        if (cap && cap.id) data.beingSelected.push(cap.id);
      }
    }
    return data;
  }

  _sendLevelCaps() {
    this.transport.send({ t: Msg.LEVEL_CAP, ...this._serializeLevelCaps() });
  }

  _applyLevelCaps(msg) {
    this._applyRemote('applyLevelCaps', () => {
      // Only increase, never decrease — preventing wiping abyssal unlocks.
      if (typeof msg.levelCapIncreasesBought === 'number') {
        game._levelCapIncreasesBought = Math.max(game._levelCapIncreasesBought || 0, msg.levelCapIncreasesBought);
      }
      if (typeof msg.abyssalLevelCapIncreasesBought === 'number') {
        game._abyssalLevelCapIncreasesBought = Math.max(game._abyssalLevelCapIncreasesBought || 0, msg.abyssalLevelCapIncreasesBought);
      }
      // Only update activeLevelCapIncreases if the remote has MORE than local.
      // This prevents wiping abyssal skill unlocks from an empty/stale snapshot.
      if (msg.active && game.skillLevelCapIncreases) {
        const remoteCaps = msg.active.map(a => game.skillLevelCapIncreases.getObjectByID(a.id)).filter(Boolean);
        if (remoteCaps.length >= (game.activeLevelCapIncreases || []).length) {
          game.activeLevelCapIncreases = remoteCaps;
        }
      }
      if (msg.beingSelected && game.skillLevelCapIncreases) {
        const remoteSelected = msg.beingSelected.map(id => game.skillLevelCapIncreases.getObjectByID(id)).filter(Boolean);
        if (remoteSelected.length >= (game.levelCapIncreasesBeingSelected || []).length) {
          game.levelCapIncreasesBeingSelected = remoteSelected;
        }
      }
      // Recompute skill level caps so the effect applies.
      if (typeof game.validateRandomLevelCapIncreases === 'function') {
        try { game.validateRandomLevelCapIncreases(); } catch { /* noop */ }
      }
    });
  }

  // ---- Game state sync (tickTimestamp, merchantsPermitRead, pause) ------
  _patchGameState() {
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendGameState();
    };
    // Pause/unpause — Game has pauseActiveSkill/unpauseActiveSkill (not pause/unpause)
    if (typeof Game !== 'undefined' && typeof Game.prototype.pauseActiveSkill === 'function') this.ctx.patch(Game, 'pauseActiveSkill').after(() => send());
    if (typeof Game !== 'undefined' && typeof Game.prototype.unpauseActiveSkill === 'function') this.ctx.patch(Game, 'unpauseActiveSkill').after(() => send());
    // merchantsPermitRead is a direct boolean property — no setter method to patch.
    // It's synced via snapshot only (one-time flag, rarely changes).
  }

  _serializeGameState() {
    return {
      tickTimestamp: game.tickTimestamp,
      merchantsPermitRead: game.merchantsPermitRead,
      isPaused: game._isPaused,
      visibleCompletion: game.completion ? game.completion.visibleCompletion : undefined,
      secretAreaUnlocked: !!(game.fishing && game.fishing.secretAreaUnlocked),
    };
  }

  _sendGameState() {
    this.transport.send({ t: Msg.GAME_STATE, ...this._serializeGameState() });
  }

  _applyGameState(msg) {
    this._applyRemote('applyGameState', () => {
      if (typeof msg.tickTimestamp === 'number') game.tickTimestamp = msg.tickTimestamp;
      if (typeof msg.merchantsPermitRead === 'boolean') game.merchantsPermitRead = msg.merchantsPermitRead;
      if (typeof msg.isPaused === 'boolean') {
        // Use the game's pauseActiveSkill/unpauseActiveSkill methods if available
        // to keep UI in sync. Fall back to direct boolean set.
        if (msg.isPaused && !game._isPaused && typeof game.pauseActiveSkill === 'function') {
          try { game.pauseActiveSkill(); } catch { game._isPaused = true; }
        } else if (!msg.isPaused && game._isPaused && typeof game.unpauseActiveSkill === 'function') {
          try { game.unpauseActiveSkill(); } catch { game._isPaused = false; }
        } else {
          game._isPaused = msg.isPaused;
        }
      }
      if (msg.visibleCompletion !== undefined && game.completion) {
        try { game.completion.setVisibleCompletion(msg.visibleCompletion); } catch { /* noop */ }
      }
      if (msg.secretAreaUnlocked && game.fishing && !game.fishing.secretAreaUnlocked) {
        try { game.fishing.unlockSecretArea(); } catch { /* noop */ }
      }
    }, { save: false });
  }

  // ---- One-off unlock sync (message in a bottle, skill unlocks) -----------
  _patchUnlocks() {
    // Message in a bottle -> secret fishing area. The bottle is a ReadableItem
    // (just a modal); the state change is Fishing.unlockSecretArea().
    if (game.fishing && typeof Fishing !== 'undefined') {
      this._afterEach(Fishing, ['unlockSecretArea'], () => {
        this._send({ t: Msg.SECRET_AREA });
      });
    }
    // Skills unlocked mid-game via the lock icon (e.g. Corruption). Snapshots
    // already carry skill unlock state; this makes it propagate live.
    this._afterEach(Skill, ['setUnlock'], function (isUnlocked) {
      if (!isUnlocked) return;
      sync._send({ t: Msg.SKILL_UNLOCK, skillId: this.id });
    });
  }

  _applySecretArea() {
    if (!game.fishing) return;
    this._applyRemote('applySecretArea', () => {
      if (!game.fishing.secretAreaUnlocked) game.fishing.unlockSecretArea();
    });
  }

  _applySkillUnlock(msg) {
    const skill = this._skillById(msg.skillId);
    if (!skill || !skill.setUnlock) return;
    this._applyRemote('applySkillUnlock', () => {
      if (!skill.isUnlocked) skill.setUnlock(true);
    });
  }

  // ---- Lore books read sync ---------------------------------------------
  _patchLore() {
    if (!game.lore) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendLore();
    };
    if (typeof Lore !== 'undefined' && typeof Lore.prototype.readLore === 'function') this.ctx.patch(Lore, 'readLore').after(() => send());
    if (typeof Lore !== 'undefined' && typeof Lore.prototype.updateLoreBookUnlocks === 'function') this.ctx.patch(Lore, 'updateLoreBookUnlocks').after(() => send());
  }

  _serializeLoreRead() {
    const lore = game.lore;
    if (!lore) return [];
    const read = [];
    if (lore.books) for (const book of lore.books.allObjects) {
      // LoreBook has no public read-state field in the DTS; the game tracks
      // read state internally (likely via the bookButtons map / save data).
      // Use any available read flag defensively, plus the button state.
      let isRead = !!(book._read || book.isRead);
      if (!isRead && lore.bookButtons) {
        const btn = lore.bookButtons.get(book);
        if (btn && btn.readButton && btn.readButton.disabled) isRead = true;
      }
      if (isRead) read.push(book.id);
    }
    return read;
  }

  _sendLore() {
    const lore = game.lore;
    if (!lore) return;
    this.transport.send({ t: Msg.LORE, read: this._serializeLoreRead() });
  }

  _applyLore(msg) {
    if (!game.lore || !msg.read) return;
    this._applyRemote('applyLore', () => {
      // LoreBook has no public read-state field. readLore() opens the book
      // viewer modal, which spams the UI if called for every book. Instead,
      // just disable the read button visually (matching what readLore does
      // internally) without opening the modal.
      for (const bookId of msg.read) {
        const book = game.lore.books && game.lore.books.getObjectByID(bookId);
        if (!book) continue;
        if (game.lore.bookButtons) {
          const btn = game.lore.bookButtons.get(book);
          if (btn && btn.readButton) {
            try { btn.readButton.disabled = true; } catch { /* noop */ }
          }
        }
      }
      if (game.lore.render) try { game.lore.render(); } catch { /* noop */ }
    }, { save: false });
  }

  // ---- Realm selection sync ----------------------------------------------
  _patchRealmSelection() {
    if (typeof game.selectRealm !== 'function') return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      if (!game.currentRealm) return;
      this.transport.send({ t: Msg.REALM, realmId: game.currentRealm.id });
    };
    if (typeof Game !== 'undefined') this.ctx.patch(Game, 'selectRealm').after(() => send());
  }

  _applyRealmSelection(msg) {
    if (!msg.realmId || !game.realms) return;
    this._applyRemote('applyRealmSelection', () => {
      const realm = game.realms.getObjectByID(msg.realmId);
      if (realm && game.currentRealm !== realm && typeof game.selectRealm === 'function') {
        game.selectRealm(realm);
      }
    }, { save: false });
  }

  // ---- Slayer task category completions sync -----------------------------
  // SlayerTaskCategory has no public method that increments tasksCompleted;
  // it's incremented internally by SlayerTask.selectTask. We piggyback on
  // the existing SlayerTask patches (selectTask, addKill) to broadcast
  // category completions whenever the slayer task state changes.
  _patchSlayerCategories() {
    if (!game.combat || !game.combat.slayerTask) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      let cats = [];
      try { cats = this._serializeSlayerCategories(); } catch { /* noop */ }
      this.transport.send({ t: Msg.SLAYER_CAT, cats });
    };
    // Piggyback on SlayerTask methods that are called when tasks complete
    if (typeof SlayerTask !== 'undefined' && SlayerTask.prototype) {
      for (const m of ['selectTask', 'addKill', 'clickNewTask']) {
        if (typeof SlayerTask.prototype[m] === 'function') {
          this.ctx.patch(SlayerTask, m).after(() => send());
        }
      }
    }
  }

  _serializeSlayerCategories() {
    const cats = [];
    const task = game.combat.slayerTask;
    if (task.categories) for (const cat of task.categories.allObjects) {
      cats.push({ catId: cat.id, tasksCompleted: cat.tasksCompleted || 0 });
    }
    return cats;
  }

  _applySlayerCategories(msg) {
    if (!msg.cats || !game.combat || !game.combat.slayerTask) return;
    this._applyRemote('applySlayerCategories', () => {
      const task = game.combat.slayerTask;
      if (!task.categories) return;
      for (const c of msg.cats) {
        const cat = task.categories.getObjectByID(c.catId);
        if (cat && typeof c.tasksCompleted === 'number') {
          cat.tasksCompleted = Math.max(cat.tasksCompleted || 0, c.tasksCompleted);
        }
      }
    }, { save: false });
  }

  // ---- Cooking stockpile sync --------------------------------------------
  _patchCookingStockpile() {
    if (!game.cooking || !game.cooking.stockpileItems) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      let stockpiles = [];
      try { stockpiles = this._serializeCookingStockpiles(); } catch { /* noop */ }
      this.transport.send({ t: Msg.COOKING_STOCKPILE, stockpiles });
    };
    // Patch methods that modify stockpiles
    if (typeof Cooking !== 'undefined' && Cooking.prototype) {
      for (const m of ['addItemToStockpile', 'onCollectStockpileClick']) {
        if (typeof Cooking.prototype[m] === 'function') {
          this.ctx.patch(Cooking, m).after(() => send());
        }
      }
    }
  }

  _serializeCookingStockpiles() {
    const stockpiles = [];
    for (const [cat, iq] of game.cooking.stockpileItems) {
      stockpiles.push({ catId: cat.id, itemId: iq.item ? iq.item.id : null, qty: iq.quantity || 0 });
    }
    return stockpiles;
  }

  _applyCookingStockpile(msg) {
    if (!msg.stockpiles || !game.cooking || !game.cooking.stockpileItems) return;
    this._applyRemote('applyCookingStockpile', () => {
      for (const sp of msg.stockpiles) {
        const cat = game.cooking.categories.getObjectByID(sp.catId);
        if (!cat) continue;
        const item = sp.itemId ? game.items.getObjectByID(sp.itemId) : null;
        if (item) {
          const cur = game.cooking.stockpileItems.get(cat);
          const curQty = cur ? (cur.quantity || 0) : 0;
          // Only update if remote has more (absolute-value delta sync)
          if (sp.qty > curQty) {
            game.cooking.stockpileItems.set(cat, { item, quantity: sp.qty });
          }
        }
      }
    }, { save: false });
  }

  // ---- Equipment set count sync ------------------------------------------
  _patchEquipSetCount() {
    if (!game.combat || !game.combat.player) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const n = game.combat.player.numEquipSets;
      if (typeof n === 'number') {
        this.transport.send({ t: Msg.EQUIP_SET_COUNT, count: n });
      }
    };
    // Patch the method that updates equipment set count (via shop modifier)
    if (typeof Player !== 'undefined' && Player.prototype && typeof Player.prototype.updateEquipmentSets === 'function') {
      this.ctx.patch(Player, 'updateEquipmentSets').after(() => send());
    }
  }

  _applyEquipSetCount(msg) {
    if (typeof msg.count !== 'number' || !game.combat || !game.combat.player) return;
    this._applyRemote('applyEquipSetCount', () => {
      // numEquipSets is a getter computed from shop modifiers, not a
      // settable property. Call updateEquipmentSets() to recompute from
      // the (already synced) shop upgrade count.
      const current = game.combat.player.numEquipSets || 0;
      if (msg.count > current && typeof game.combat.player.updateEquipmentSets === 'function') {
        try { game.combat.player.updateEquipmentSets(); } catch { /* skip */ }
      }
    }, { save: false });
  }

  // ---- Game settings sync (gameplay-affecting only) ----------------------
  _patchGameSettings() {
    if (!game.settings) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this.transport.send({ t: Msg.SETTINGS, settings: this._serializeSettings() });
    };
    // Patch the Settings class methods that change settings
    if (typeof Settings !== 'undefined' && Settings.prototype) {
      for (const m of ['toggleSetting', 'setTogglesChecked', 'changeChoiceSetting']) {
        if (typeof Settings.prototype[m] === 'function') {
          this.ctx.patch(Settings, m).after(() => send());
        }
      }
    }
  }

  _serializeSettings() {
    const s = game.settings;
    const settings = {};
    for (const key of SETTINGS_BOOL_KEYS) settings[key] = s[key];
    return settings;
  }

  _applyGameSettings(msg) {
    if (!msg.settings || !game.settings) return;
    this._applyRemote('applyGameSettings', () => {
      this._applySettingsPayload(msg.settings);
    }, { save: false });
  }

  // Shared settings apply (live GAME_SETTINGS message + snapshot settings
  // block). Guard-neutral: never touches _applyingRemote or _scheduleSave.
  _applySettingsPayload(settings) {
    const s = game.settings;
    // Settings are getter-only properties on the Settings class.
    // Use setTogglesChecked() to actually change them (it sets the
    // internal backing field and updates the UI checkbox).
    for (const key of SETTINGS_BOOL_KEYS) {
      if (typeof settings[key] === 'boolean') {
        try { s.setTogglesChecked(key, settings[key]); } catch { /* skip */ }
      }
    }
  }

  _patchActionStartStop() {
    // Patch game.stopActiveAction and game.clearActiveAction to broadcast stops.
    if (typeof Game !== 'undefined') {
      for (const m of ['stopActiveAction', 'clearActiveAction']) {
        this.ctx.patch(Game, m).after(function () {
          if (sync._applyingRemote || !sync.transport.isConnected) return;
          sync.transport.send({ t: Msg.ACTION_STOP });
        });
      }
    }
  }

  _startProgressBroadcaster() {
    // Every 500ms, if we have an active action, broadcast the timer progress
    // so the other player's panel progress bar moves in sync.
    this._progressTimer = setInterval(() => {
      if (!this._canSend()) return;
      const active = game.activeAction;
      if (!active) return;
      try {
        let timer = null;
        let skillId = null;
        let skillName = null;

        if (active.actionTimer) {
          timer = active.actionTimer;
          skillId = active.id;
          skillName = active.name || skillId;
        } else if (active.skill && active.skill.actionTimer) {
          timer = active.skill.actionTimer;
          skillId = active.skill.id;
          skillName = active.skill.name || skillId;
        }

        if (!timer) {
          const skill = game.skills.getObjectByID(active.id);
          if (skill && skill.actionTimer) {
            timer = skill.actionTimer;
            skillId = skill.id;
            skillName = skill.name || skillId;
          }
        }

        if (!timer || !skillId) return;

        // Gather recipe info — for woodcutting, multiple trees can be active.
        // Send the list of active recipe IDs and their names.
        const recipes = [];
        try {
          if (active.activeTrees && active.activeTrees.size > 0) {
            // Woodcutting: multiple trees
            for (const tree of active.activeTrees) {
              recipes.push({ id: tree.id, name: tree.name || tree.id });
            }
          } else {
            const ma = active.masteryAction;
            if (ma) recipes.push({ id: ma.id, name: ma.name || ma.id });
          }
        } catch { /* noop */ }

        this.transport.send({
          t: Msg.ACTION_START,
          skillId,
          skillName,
          actionId: active.id,
          recipeId: this._currentRecipeId || skillId,
          recipes,
          progress: timer.progress,
          ticksLeft: timer._ticksLeft,
          maxTicks: timer._maxTicks,
        });

        // Also update the panel's local progress bar.
        if (this._onLocalActionCb) {
          this._onLocalActionCb({
            skillId,
            skillName,
            recipeId: this._currentRecipeId || skillId,
            recipes,
            progress: timer.progress,
            label: skillName,
          });
        }
      } catch { /* noop */ }
    }, 500);
  }

  _applyActionStart(msg) {
    // Show the remote player's action in the panel's fake progress bars.
    // We do NOT touch any game objects — no timers, no skill methods, no
    // game progress bar elements. Any call to skill methods can have side
    // effects that activate the action on the local game, causing crashes.
    try {
      // Only update the panel's mini progress bar — nothing else.
      const progress = msg.progress || 0;
      this._remoteAction = {
        skillId: msg.skillId || msg.actionId,
        skillName: msg.skillName || msg.skillId || msg.actionId,
        recipeId: msg.recipeId,
        recipes: msg.recipes || [],
        progress,
        label: msg.skillName || msg.skillId || msg.actionId,
      };
      if (this._onRemoteActionCb) this._onRemoteActionCb(this._remoteAction);
    } catch (e) { logger.warn('applyActionStart failed', e); }
  }

  _applyActionStop(msg) {
    // Just clear the panel's mini progress bar. Don't touch any game
    // objects — calling skill.stopActiveProgressBar() or similar methods
    // can interfere with the local player's action and cause crashes.
    try {
      this._remoteAction = null;
      if (this._onRemoteActionCb) this._onRemoteActionCb(null);
    } catch (e) { logger.warn('applyActionStop failed', e); }
  }

  // ---- Active-action watcher -------------------------------------------

  _startPeriodicStateSync() {
    // Every 60 seconds, send a lightweight sync of only currencies.
    // XP, mastery, and other state are already synced in real-time via
    // individual patches. This is just a safety net for currencies.
    this._stateSyncTimer = setInterval(() => {
      if (!this._canSend()) return;
      try {
        if (game.currencies) for (const c of game.currencies.allObjects) {
          this.transport.send({ t: Msg.CURRENCY, currencyId: c.id, qty: c._amount });
        }
      } catch (e) { logger.warn('periodic state sync failed', e); }
    }, 60000);
  }

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
      const e = { id: skill.id, xp: skill.xp, unlocked: !!skill.isUnlocked };
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
      equipSets.push(...this._serializeEquipSets());
      // Player combat state
      playerState.selectedSet = game.combat.player.selectedEquipmentSet;
      // Destructured to keep the historical key order (prayerPoints, soulPoints, prayers)
      const { prayers, prayerPoints, soulPoints } = this._serializePrayers();
      Object.assign(playerState, { prayerPoints, soulPoints, prayers });
      Object.assign(playerState, this._serializeFood());
      playerState.attackStyles = this._serializeAttackStyles();
      Object.assign(playerState, this._serializeAttackSpell());
    }
    const pets = [];
    if (game.petManager) for (const pet of game.petManager.unlocked) pets.push(pet.id);
    const charges = [];
    if (game.itemCharges) for (const [item, ch] of game.itemCharges.charges) {
      if (ch > 0) charges.push({ itemId: item.id, charges: ch });
    }
    // Shop upgrades
    const shopUpgrades = game.shop ? this._serializeShopUpgrades() : {};
    // Bank tab count (purchased via shop)
    const bankTabCount = game.bank ? game.bank.tabCount : undefined;
    // Tutorial
    const tutorial = this._buildTutorialState();
    // Mining rock HP (full array, no delta filter — joiners need every rock)
    const rockHP = game.mining ? this._serializeRockHP() : null;
    // Harvesting veins (intensity)
    const harvestingVeins = game.harvesting ? this._serializeVeins() : null;
    // Farming plots
    const farmingPlots = game.farming ? this._serializeAllPlots() : null;
    // Combat state (core only — the live sender adds kind/areaId/playerStats)
    const combatState = (game.combat && game.combat.enemy) ? this._serializeCombatState() : null;
    // Combat Event system state (Into the Mist, Spider Lair, etc.) + snapshot-only extras
    const combatEventState = game.combat ? {
      ...this._serializeCombatEventState(),
      strongholdTier: game.combat.strongholdTier,
      areaProgress: game.combat.areaProgress,
    } : null;
    // Active potions
    const potions = (game.potions && game.potions.activePotions) ? this._serializePotions() : [];

    const snapshot = { t: Msg.STATE_SNAPSHOT, skills, bank, currencies, equipSets, playerState, pets, charges, shopUpgrades, bankTabCount, tutorial, rockHP, harvestingVeins, farming: farmingPlots, combat: combatState, combatEventState, potions };

    // Mastery (per-action XP + mastery pool XP per realm)
    const mastery = [];
    for (const skill of game.skills.allObjects) {
      if (!skill.hasMastery || !skill.actionMastery) continue;
      const actions = [];
      for (const [action, am] of skill.actionMastery) {
        if (action && action.id && am) actions.push({ actionId: action.id, xp: am.xp });
      }
      const pools = [];
      if (skill._masteryPoolXP) {
        skill._masteryPoolXP.forEach((xp, realm) => {
          if (realm && realm.id) pools.push({ realmId: realm.id, xp });
        });
      }
      mastery.push({ skillId: skill.id, actions, pools });
    }
    if (mastery.length > 0) snapshot.mastery = mastery;

    // Agility courses (buildCounts deliberately omitted — snapshot omits, sender sends)
    if (game.agility) {
      snapshot.agility = { courses: this._serializeAgilityCourses(), activeObstacle: game.agility.currentlyActiveObstacle };
    }

    // Astrology upgrades (+ snapshot-only studied/explored selection)
    if (game.astrology) {
      const as = game.astrology;
      const astrology = {
        upgrades: [],
        studiedId: as.studiedConstellation ? as.studiedConstellation.id : null,
        exploredId: as.exploredConstellation ? as.exploredConstellation.id : null,
      };
      this._tryAssign(astrology, 'upgrades', () => this._serializeAstrologyUpgrades());
      snapshot.astrology = astrology;
    }

    // Summoning (marks + selected non-shard costs)
    if (game.summoning) {
      snapshot.summoning = { marks: [], costs: [] };
      this._tryAssign(snapshot, 'summoning', () => this._serializeSummoning());
    }

    // Slayer task + unlocks (sender shape adapted: coercions + omit-vs-null keys)
    if (game.slayer) {
      snapshot.slayer = {};
      if (game.combat && game.combat.slayerTask) {
        this._tryAssign(snapshot, 'slayer', () => {
          const t = this._serializeSlayerTask();
          t.active = !!t.active;
          t.killsLeft = t.killsLeft || 0;
          t.extended = !!t.extended;
          if (!t.realmId) delete t.realmId;
          if (!t.categoryId) delete t.categoryId;
          return t;
        });
      }
    }

    // Township
    // Deliberate subset of _serializeTownship() (no efficiency/townData/worship; ticks coerced) — do not unify.
    if (game.township) {
      const tw = game.township;
      const townshipData = { biomes: [], resources: {}, totalTicks: 0, legacyTicks: 0 };
      try {
        if (tw.biomes) for (const biome of tw.biomes.allObjects) {
          const buildings = {};
          if (biome.buildingsBuilt) for (const [b, count] of biome.buildingsBuilt) buildings[b.id] = count;
          townshipData.biomes.push({ id: biome.id, buildings });
        }
        if (tw.resources) for (const r of tw.resources.allObjects) {
          townshipData.resources[r.id] = { amount: r._amount, cap: r._cap };
        }
        townshipData.totalTicks = tw.totalTicks || 0;
        townshipData.legacyTicks = tw.legacyTicks || 0;
      } catch { /* noop */ }
      snapshot.township = townshipData;
    }

    // Cartography (attach only on success — skip-on-throw)
    if (game.cartography) {
      this._tryAssign(snapshot, 'cartography', () => this._serializeCartography());
    }

    // Archaeology (dig sites, tools, museum donations, museum rewards) — one
    // serialization shared by BOTH wire keys (snapshot.archaeology here and
    // skillSelects.archaeology below; the peer receives two JSON copies).
    let archData;
    if (game.archaeology) {
      archData = {};
      try { archData = this._serializeArchaeology(); } catch { /* noop */ }
      snapshot.archaeology = archData;
    }

    // Clue hunt (defaults + guards preserved: currentStep stays 0 unless numeric)
    if (game.clueHunt) {
      const clueData = { steps: [], currentStep: 0 };
      try {
        const s = this._serializeClueHunt();
        if (s) {
          clueData.steps = s.steps;
          if (typeof s.currentStep === 'number') clueData.currentStep = s.currentStep;
        }
      } catch { /* noop */ }
      snapshot.clueHunt = clueData;
    }

    // Corruption (abyssal)
    if (game.corruption) {
      snapshot.corruption = { rows: [] };
      this._tryAssign(snapshot.corruption, 'rows', () => this._serializeCorruptionRows());
    }

    // Raids (golbin raid) — the 5 live selection-state fields stay sender-only
    if (game.golbinRaid) {
      const r = game.golbinRaid;
      const raidData = {};
      try {
        if (typeof r.wave === 'number') raidData.wave = r.wave;
        if (typeof r.waveProgress === 'number') raidData.waveProgress = r.waveProgress;
        if (r.selectedDifficulty) raidData.selectedDifficulty = (typeof r.selectedDifficulty === 'number') ? r.selectedDifficulty : r.selectedDifficulty.id;
        if (r.history) raidData.history = this._serializeRaidHistory(20); // last 20 entries, primitive fields only
        raidData.loadout = this._serializeRaidLoadout();
      } catch { /* noop */ }
      snapshot.raid = raidData;
    }

    // Fishing contest (sender shape adapted: !! coercion + conditional attaches)
    if (game.fishing && game.fishing.contest) {
      const fc = game.fishing.contest;
      const fishData = {};
      try {
        const s = this._serializeFishingContest();
        if (s) {
          fishData.isActive = !!s.isActive;
          fishData.activeFishId = s.activeFishId;
          if (typeof s.actionsRemaining === 'number') fishData.actionsRemaining = s.actionsRemaining;
          if (typeof s.currentDifficulty === 'number') fishData.currentDifficulty = s.currentDifficulty;
          if (fc.completionTracker) fishData.completionTracker = s.completionTracker;
          if (fc.masteryTracker) fishData.masteryTracker = s.masteryTracker;
          if (fc.playerResults) fishData.results = s.results;
          if (fc.contestantLeaderboard) fishData.leaderboard = s.leaderboard;
        }
      } catch { /* noop */ }
      snapshot.fishContest = fishData;
    }

    // Game stats — all StatTrackers on the Statistics object
    if (game.stats) {
      snapshot.stats = {};
      this._tryAssign(snapshot, 'stats', () => this._serializeStats());
    }

    // Skill level cap increases
    snapshot.levelCaps = this._serializeLevelCaps();

    // Game state (tickTimestamp, merchantsPermitRead, pause, visibleCompletion)
    snapshot.gameState = this._serializeGameState();

    // Lore books read
    if (game.lore && game.lore.books) {
      snapshot.lore = { read: this._serializeLoreRead() };
    }

    // Ancient relics (which relics have been found per set)
    if (game.ancientRelics) {
      snapshot.ancientRelics = [];
      this._tryAssign(snapshot, 'ancientRelics', () => this._serializeAncientRelics());
    }

    // Skill trees (unlocked nodes + points per tree) — attach only when non-empty
    this._tryAssign(snapshot, 'skillTrees', () => {
      const trees = this._serializeSkillTrees();
      return trees.length > 0 ? trees : undefined;
    });

    // Skill selections (cooking, woodcutting, firemaking, fishing, thieving, alt magic, fletching, artisan recipes, harvesting, archaeology)
    const skillSelects = {};
    try {
      // Cooking
      if (game.cooking && game.cooking.selectedRecipes) {
        skillSelects.cooking = this._serializeCookingSelection();
      }
      // Woodcutting: active trees NOT synced (per-player UI choice).
      // Firemaking
      if (game.firemaking) {
        skillSelects.firemaking = this._serializeFiremakingSelection();
      }
      // Fishing
      if (game.fishing && game.fishing.selectedAreaFish) {
        skillSelects.fishing = this._serializeFishingSelection();
      }
      // Thieving
      if (game.thieving) {
        skillSelects.thieving = this._serializeThievingSelection();
      }
      // Alt Magic
      if (game.altMagic) {
        skillSelects.altMagic = this._serializeAltMagicSelection();
      }
      // Fletching
      if (game.fletching && game.fletching.setAltRecipes) {
        skillSelects.fletching = this._serializeFletchingSelection();
      }
      // Artisan skills (Herblore, Smithing, Crafting, Runecrafting, Fletching)
      for (const skillName of ['herblore', 'smithing', 'crafting', 'runecrafting', 'fletching']) {
        const sk = game[skillName];
        if (!sk || !sk.selectedRecipeInRealm) continue;
        skillSelects[skillName] = this._serializeArtisanSelection(sk);
      }
      // Harvesting
      if (game.harvesting) {
        skillSelects.harvesting = this._serializeHarvestingSelection();
      }
      // Archaeology — same object as snapshot.archaeology (serialized once above)
      if (archData) {
        skillSelects.archaeology = archData;
      }
    } catch { /* noop */ }
    if (Object.keys(skillSelects).length > 0) snapshot.skillSelects = skillSelects;

    // Current realm selection
    if (game.currentRealm) {
      snapshot.currentRealmId = game.currentRealm.id;
    }

    // Equipment set count (number of unlocked equipment set slots)
    if (game.combat && game.combat.player) {
      snapshot.numEquipSets = game.combat.player.numEquipSets;
    }

    // Cooking stockpiles
    if (game.cooking && game.cooking.stockpileItems) {
      snapshot.cookingStockpiles = [];
      this._tryAssign(snapshot, 'cookingStockpiles', () => this._serializeCookingStockpiles());
    }

    // Slayer task category completions
    if (game.combat && game.combat.slayerTask && game.combat.slayerTask.categories) {
      snapshot.slayerCategories = [];
      this._tryAssign(snapshot, 'slayerCategories', () => this._serializeSlayerCategories());
    }

    // Game settings (gameplay-affecting only)
    if (game.settings) {
      snapshot.settings = this._serializeSettings();
    }

    logger.info(`[SNAPSHOT] Built: ${Object.keys(snapshot).join(', ')}`);
    logger.info('========== [MP] SNAPSHOT BUILT ==========');
    return snapshot;
  }

  _applySnapshot(msg) {
    logger.info('========== [MP] APPLYING SNAPSHOT ==========');
    logger.info(`[SNAPSHOT] Received: ${msg.skills?.length || 0} skills, ${msg.bank?.length || 0} bank items, ` +
      `${msg.currencies?.length || 0} currencies, ${msg.equipSets?.length || 0} equip sets, ${msg.pets?.length || 0} pets, ` +
      `${msg.charges?.length || 0} charges, ${msg.rockHP?.length || 0} rocks, ${msg.farming?.length || 0} farming plots`);
    this._applyingRemote = true;
    try {
      // ---- Skills ----
      for (const s of (msg.skills || [])) {
        const skill = this._skillById(s.id);
        if (!skill) continue;
        // Unlock the skill if it's unlocked on the sender's side
        if (s.unlocked && !skill.isUnlocked && skill.setUnlock) {
          try { skill.setUnlock(true); } catch { /* skip */ }
        }
        // Set level caps to max before setting XP so levels aren't capped
        if (skill._currentLevelCap !== undefined && skill.maxLevelCap) {
          skill._currentLevelCap = skill.maxLevelCap;
        }
        // Use max to avoid losing locally-earned XP from a stale snapshot.
        if (typeof s.xp === 'number') {
          skill._xp = Math.max(skill._xp || 0, s.xp);
          const cap = skill.currentLevelCap || skill.maxLevelCap || Infinity;
          skill._level = Math.min(cap, exp.xpToLevel(skill._xp));
        }
        // Abyssal XP — enable abyssal levels if the sender has them.
        // Don't check skill.hasAbyssalLevels — the receiver may not have
        // unlocked abyssal yet, so we force-enable it.
        if (typeof s.abyssalXp === 'number' && s.abyssalXp > 0) {
          if (skill._hasAbyssalLevels === false) skill._hasAbyssalLevels = true;
          if (skill._currentAbyssalLevelCap !== undefined && skill.maxAbyssalLevelCap) {
            skill._currentAbyssalLevelCap = skill.maxAbyssalLevelCap;
          }
          skill._abyssalXP = Math.max(skill._abyssalXP || 0, s.abyssalXp);
          const cap = skill.currentAbyssalLevelCap || skill.maxAbyssalLevelCap || Infinity;
          skill._abyssalLevel = Math.min(cap, abyssalExp.xpToLevel(skill._abyssalXP));
        }
      }
      // ---- Bank ----
      for (const b of (msg.bank || [])) {
        const item = this._itemById(b.id);
        if (!item || !item.name) continue; // skip invalid/dummy items
        const cur = game.bank.getQty(item);
        const delta = b.qty - cur;
        // Only add items, never remove from the receiver's bank during
        // snapshot apply — the receiver may have items the sender doesn't
        // know about (earned after the snapshot was built).
        if (delta > 0) {
          try { game.bank.addItem(item, delta, false, true, true, false); } catch (e) { /* skip */ }
        }
      }
      // ---- Currencies ----
      for (const c of (msg.currencies || [])) {
        const cur = this._currencyById(c.id);
        if (!cur) continue;
        // Use max to avoid resetting currencies to 0 if the snapshot has
        // stale data or the receiver has earned more since the snapshot.
        const newAmt = Math.max(cur._amount || 0, c.qty || 0);
        cur._amount = newAmt;
        if (cur.renderAmount) cur.renderAmount();
        if (cur.onAmountChange) cur.onAmountChange();
      }
      // Equipment sets — unequipItem/equipItem handle bank internally
      if (msg.equipSets && game.combat.player) {
        this._applyEquipmentSets(msg.equipSets);
        this._updateEquipmentAfterSync();
      }
      // ---- Player state ----
      if (msg.playerState && game.combat.player) {
        const ps = msg.playerState;
        const p = game.combat.player;
        if (typeof ps.prayerPoints === 'number') p.prayerPoints = ps.prayerPoints;
        if (typeof ps.soulPoints === 'number') p.soulPoints = ps.soulPoints;
        if (ps.prayers && p.activePrayers) {
          p.activePrayers.clear();
          for (const pid of ps.prayers) {
            // game.prayers is NamespaceRegistry<ActivePrayer>, so getObjectByID
            // already returns an ActivePrayer — no wrapper needed.
            const prayer = game.prayers.getObjectByID(pid);
            if (prayer) { try { p.activePrayers.add(prayer); } catch { /* noop */ } }
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
        // attackStyles is { melee?, ranged?, magic? } of AttackStyle
        if (ps.attackStyles && p.attackStyles) {
          for (const a of ps.attackStyles) {
            if (!a.attackType) continue;
            const style = a.styleId ? game.attackStyles.getObjectByID(a.styleId) : undefined;
            if (style) p.attackStyles[a.attackType] = style;
          }
        }
        if (typeof ps.selectedSet === 'number') p.selectedEquipmentSet = ps.selectedSet;
        if (ps.attackSpellId) {
          const spell = game.attackSpells.getObjectByID(ps.attackSpellId);
          if (spell && p.selectAttackSpell) p.selectAttackSpell(spell, false);
        }
        if (ps.curseSpellId) {
          const spell = game.curseSpells && game.curseSpells.getObjectByID(ps.curseSpellId);
          if (spell && p.toggleCurse) p.toggleCurse(spell, false);
        }
        if (ps.auroraSpellId) {
          const spell = game.auroraSpells && game.auroraSpells.getObjectByID(ps.auroraSpellId);
          if (spell && p.toggleAurora) p.toggleAurora(spell, false);
        }
        if (p.render) p.render();
      }
      // ---- Pets ----
      if (msg.pets && game.petManager) {
        for (const petId of msg.pets) {
          const pet = game.pets.getObjectByID(petId);
          if (pet && !game.petManager.unlocked.has(pet)) game.petManager.unlocked.add(pet);
        }
      }
      // ---- Item charges ----
      if (msg.charges && game.itemCharges) {
        for (const ch of msg.charges) {
          const item = this._itemById(ch.itemId);
          if (!item) continue;
          const cur = game.itemCharges.getCharges(item);
          // Only increase charges — never decrease via sync.
          if (ch.charges > cur) game.itemCharges.addCharges(item, ch.charges - cur);
        }
      }
      // ---- Shop upgrades ----
      if (msg.shopUpgrades && game.shop) {
        for (const [purchaseId, count] of Object.entries(msg.shopUpgrades)) {
          const purchase = game.shop.purchases.getObjectByID(purchaseId);
          if (purchase) game.shop.upgradesPurchased.set(purchase, Math.max(game.shop.upgradesPurchased.get(purchase) || 0, count));
        }
        if (game.shop.computeProvidedStats) game.shop.computeProvidedStats();
      }
      // ---- Bank tab count ----
      if (typeof msg.bankTabCount === 'number' && game.bank) {
        const curTabs = game.bank.tabCount || 0;
        if (msg.bankTabCount > curTabs && typeof game.bank.addTabs === 'function') {
          try { game.bank.addTabs(msg.bankTabCount - curTabs); } catch (e) { logger.warn('snapshot addTabs failed', e); }
        }
      }
      // ---- Tutorial ----
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
      // Active potions from snapshot
      if (msg.potions && game.potions) {
        try {
          // Remove all existing potions
          game.potions.activePotions.forEach((ap, action) => {
            try { game.potions.removePotion(action, true); } catch { /* skip */ }
          });
          // Add remote potions
          for (const p of msg.potions) {
            const item = this._itemById(p.itemId);
            if (item) {
              try { game.potions.usePotion(item, true); } catch { /* skip */ }
            }
          }
          if (game.potions.computeProvidedStats) game.potions.computeProvidedStats();
          if (game.potions.render) game.potions.render();
        } catch { /* skip */ }
      }
      // Mining rock HP — skip the rock the local player is mining.
      if (msg.rockHP && game.mining) {
        this._applyRockHPList(msg.rockHP);
        if (game.mining.renderRockHP) game.mining.renderRockHP();
        if (game.mining.renderRockStatus) game.mining.renderRockStatus();
      }
      // Harvesting veins — skip the vein the local player is harvesting
      if (msg.harvestingVeins && game.harvesting) {
        let localVeinId = null;
        try {
          if (game.harvesting.selectedVein && game.harvesting.selectedVein.id) localVeinId = game.harvesting.selectedVein.id;
          else if (game.harvesting.activeProgressVein && game.harvesting.activeProgressVein.id) localVeinId = game.harvesting.activeProgressVein.id;
        } catch { /* noop */ }
        for (const v of msg.harvestingVeins) {
          if (localVeinId && v.id === localVeinId) continue;
          const vein = game.harvesting.actions.getObjectByID(v.id);
          if (!vein) continue;
          if (typeof v.intensity === 'number') vein.currentIntensity = v.intensity;
          if (typeof v.max === 'number') vein.maxIntensity = Math.max(vein.maxIntensity || 0, v.max);
        }
        if (game.harvesting.renderVeinIntensity) game.harvesting.renderVeinIntensity();
        if (game.harvesting.renderVeinStatus) game.harvesting.renderVeinStatus();
      }
      // Farming plots
      if (msg.farming && game.farming) {
        for (const p of msg.farming) {
          const plot = game.farming.plots.getObjectByID(p.id);
          if (!plot) continue;
          // Unlock plots that are unlocked on the other side
          if (typeof p.state === 'number' && p.state > 0 && plot.state === 0) {
            plot.state = 1; // Empty
          }
          if (typeof p.state === 'number') plot.state = p.state;
          if (p.plantedRecipeId !== undefined) {
            // FarmingRecipe is a MasteryAction in game.farming.actions, not an Item
            plot.plantedRecipe = p.plantedRecipeId ? game.farming.actions.getObjectByID(p.plantedRecipeId) : undefined;
          }
          if (p.compostItemId !== undefined) {
            // CompostItem extends Item, so game.items is correct
            plot.compostItem = p.compostItemId ? game.items.getObjectByID(p.compostItemId) : undefined;
          }
          if (typeof p.compostLevel === 'number') plot.compostLevel = p.compostLevel;
          if (typeof p.growthTime === 'number') plot.growthTime = p.growthTime;
          if (p.selectedRecipeId !== undefined) {
            plot.selectedRecipe = p.selectedRecipeId ? game.farming.actions.getObjectByID(p.selectedRecipeId) : undefined;
          }
          if (typeof p.abyssalLevel === 'number' && 'abyssalLevel' in plot) {
            plot.abyssalLevel = p.abyssalLevel;
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
        if (typeof cs.enemyBarrier === 'number' && game.combat.enemy && 'barrier' in game.combat.enemy) {
          game.combat.enemy.barrier = cs.enemyBarrier;
        }
        if (typeof cs.playerHp === 'number' && game.combat.player) {
          game.combat.player.hitpoints = cs.playerHp;
          if (game.combat.player.renderHitpoints) game.combat.player.renderHitpoints();
        }
        // Apply combat pause state
        if (typeof cs.paused === 'boolean') {
          try {
            if (cs.paused && !game.combat.paused) game.combat.pause();
            else if (!cs.paused && game.combat.paused) game.combat.start();
          } catch { /* skip */ }
        }
      }
      // Combat Event system state from snapshot
      if (msg.combatEventState) {
        this._applyCombatEventState(msg.combatEventState);
        // _applyCombatEventState resets _applyingRemote in its finally;
        // re-assert so the rest of the snapshot apply stays guarded.
        this._applyingRemote = true;
      }
      // Mastery from snapshot
      if (msg.mastery) {
        for (const ms of msg.mastery) {
          const skill = this._skillById(ms.skillId);
          if (!skill || !skill.hasMastery || !skill.actionMastery) continue;
          for (const a of (ms.actions || [])) {
            const action = skill.actions && skill.actions.getObjectByID(a.actionId);
            if (!action) continue;
            const am = skill.actionMastery.get(action);
            if (!am) continue;
            if (typeof a.xp === 'number') {
              am.xp = Math.max(am.xp || 0, a.xp);
              am.level = exp.xpToLevel(am.xp);
            }
          }
          for (const p of (ms.pools || [])) {
            const realm = game.realms.getObjectByID(p.realmId);
            if (realm && skill._masteryPoolXP) {
              skill._masteryPoolXP.set(realm, Math.max(skill._masteryPoolXP.get(realm) || 0, p.xp));
            }
          }
          if (skill.renderQueue && skill.renderQueue.actionMastery) {
            for (const a of (ms.actions || [])) {
              const action = skill.actions && skill.actions.getObjectByID(a.actionId);
              if (action) skill.renderQueue.actionMastery.add(action);
            }
          }
          if (skill.renderMasteryPool) try { skill.renderMasteryPool(); } catch { /* skip */ }
        }
      }
      // Agility from snapshot
      if (msg.agility && game.agility) {
        this._applyAgility({ courses: msg.agility.courses, activeObstacle: msg.agility.activeObstacle });
      }
      // Astrology from snapshot
      if (msg.astrology && game.astrology) {
        this._applyAstrology({ upgrades: msg.astrology.upgrades });
        this._applyingRemote = true;
        if (msg.astrology.studiedId !== undefined || msg.astrology.exploredId !== undefined) {
          this._applyAstrologySelect(msg.astrology);
          this._applyingRemote = true;
        }
      }
      // Summoning from snapshot
      if (msg.summoning && game.summoning) {
        this._applySummoning(msg.summoning);
      }
      // Slayer from snapshot
      if (msg.slayer && game.slayer) {
        this._applySlayer(msg.slayer);
      }
      // Township from snapshot
      if (msg.township && game.township) {
        this._applyTownship(msg.township);
      }
      // Cartography from snapshot
      if (msg.cartography && game.cartography) {
        this._applyCartography(msg.cartography);
      }
      // Archaeology from snapshot
      if (msg.archaeology && game.archaeology) {
        const ad = msg.archaeology;
        try {
          this._applyArchaeologyBulk(ad);
          // NOTE: Do NOT call museum.render() — freezes game from sync handlers.
        } catch { /* noop */ }
      }
      // Clue hunt from snapshot
      if (msg.clueHunt && game.clueHunt) {
        this._applyClueHunt(msg.clueHunt);
      }
      // Corruption from snapshot
      if (msg.corruption && game.corruption) {
        this._applyCorruption(msg.corruption);
      }
      // Raid from snapshot
      if (msg.raid && game.golbinRaid) {
        this._applyRaid(msg.raid);
      }
      // Fishing contest from snapshot
      if (msg.fishContest && game.fishing && game.fishing.contest) {
        this._applyFishingContest(msg.fishContest);
      }
      // Stats from snapshot
      if (msg.stats && game.stats) {
        this._applyStats({ stats: msg.stats });
        this._applyingRemote = true;
      }
      // Level cap increases from snapshot
      if (msg.levelCaps) {
        this._applyLevelCaps(msg.levelCaps);
        this._applyingRemote = true;
      }
      // Game state from snapshot
      if (msg.gameState) {
        this._applyGameState(msg.gameState);
        this._applyingRemote = true;
      }
      // Lore from snapshot
      if (msg.lore) {
        this._applyLore(msg.lore);
        this._applyingRemote = true;
      }
      // Ancient relics from snapshot
      if (msg.ancientRelics) {
        this._applyAncientRelic({ relics: msg.ancientRelics });
      }
      // Skill trees from snapshot
      if (msg.skillTrees) {
        this._applySkillTree({ trees: msg.skillTrees });
      }
      // Skill selections from snapshot
      if (msg.skillSelects) {
        const ss = msg.skillSelects;
        try {
          // Helper: skip syncing a skill's selection if it's actively running.
          // Changing selectedRecipe/selectedAreaFish/etc. while the action is
          // active can cause actionInterval to compute to -Infinity and crash.
          const canSync = (skillName) => {
            const sk = game[skillName];
            return !sk || !sk.isActive;
          };
          if (ss.cooking && game.cooking && canSync('cooking')) this._applyCookingSelection(ss.cooking);
          // Woodcutting: active trees NOT synced (per-player UI choice).
          if (ss.firemaking && game.firemaking && canSync('firemaking')) this._applyFiremakingSelection(ss.firemaking);
          if (ss.fishing && game.fishing && canSync('fishing')) this._applyFishingSelection(ss.fishing);
          if (ss.thieving && game.thieving && canSync('thieving')) this._applyThievingSelection(ss.thieving);
          if (ss.altMagic && game.altMagic && canSync('altMagic')) this._applyAltMagicSelection(ss.altMagic);
          if (ss.fletching && game.fletching && game.fletching.setAltRecipes && canSync('fletching')) {
            for (const a of ss.fletching.altRecipes || []) {
              const recipe = game.fletching.actions.getObjectByID(a.recipeId);
              if (recipe) game.fletching.setAltRecipes.set(recipe, a.altIndex);
            }
          }
          // Artisan recipes
          for (const skillName of ['herblore', 'smithing', 'crafting', 'runecrafting', 'fletching']) {
            const data = ss[skillName];
            const sk = game[skillName];
            if (!data || !sk || !sk.selectedRecipeInRealm || !canSync(skillName)) continue;
            this._applyArtisanSelection(sk, data);
          }
          // Harvesting
          if (ss.harvesting && game.harvesting && canSync('harvesting')) this._applyHarvestingSelection(ss.harvesting);
          // Archaeology
          if (ss.archaeology && game.archaeology) {
            this._applyArchaeologyBulk(ss.archaeology, { requireDonatedItems: false });
          }
        } catch (e) { logger.warn('applySkillSelects snapshot failed', e); }
      }
      // Current realm from snapshot
      if (msg.currentRealmId && game.realms) {
        try {
          const realm = game.realms.getObjectByID(msg.currentRealmId);
          if (realm && game.currentRealm !== realm) {
            game.selectRealm(realm);
          }
        } catch { /* noop */ }
      }
      // Equipment set count from snapshot
      if (typeof msg.numEquipSets === 'number' && game.combat && game.combat.player) {
        try {
          // numEquipSets is a getter computed from shop modifiers, not
          // a settable property. Call updateEquipmentSets() to recompute.
          const current = game.combat.player.numEquipSets || 0;
          if (msg.numEquipSets > current && typeof game.combat.player.updateEquipmentSets === 'function') {
            game.combat.player.updateEquipmentSets();
          }
        } catch { /* noop */ }
      }
      // Cooking stockpiles from snapshot
      if (msg.cookingStockpiles && game.cooking && game.cooking.stockpileItems) {
        try {
          for (const sp of msg.cookingStockpiles) {
            const cat = game.cooking.categories.getObjectByID(sp.catId);
            if (!cat) continue;
            const item = sp.itemId ? game.items.getObjectByID(sp.itemId) : null;
            if (item) game.cooking.stockpileItems.set(cat, { item, quantity: sp.qty });
          }
        } catch { /* noop */ }
      }
      // Slayer category completions from snapshot
      if (msg.slayerCategories && game.combat && game.combat.slayerTask && game.combat.slayerTask.categories) {
        try {
          for (const sc of msg.slayerCategories) {
            const cat = game.combat.slayerTask.categories.getObjectByID(sc.catId);
            if (cat && typeof sc.tasksCompleted === 'number') {
              cat.tasksCompleted = Math.max(cat.tasksCompleted || 0, sc.tasksCompleted);
            }
          }
        } catch { /* noop */ }
      }
      // Game settings from snapshot
      if (msg.settings && game.settings) {
        try {
          this._applySettingsPayload(msg.settings);
        } catch { /* noop */ }
      }
      // Refresh completion log after all state applied
      if (game.completion && typeof game.completion.updateAllCompletion === 'function') {
        try { game.completion.updateAllCompletion(); } catch { /* noop */ }
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
    // Flat section runner: iterates a registry, counts non-throwing items,
    // then logs `[UNLOCK] <label>: <n>`. Inside `fn`, `throw 0` skips an item
    // without counting it — the catch-all swallows the sentinel exactly like
    // a real error (the original sections treat both identically).
    const each = (label, registry, fn) => { let n = 0; if (registry && registry.allObjects) for (const o of registry.allObjects) { try { fn(o); n++; } catch { /* skip */ } } logger.info(`[UNLOCK] ${label}: ${n}`); };
    // Same as `each`, for sections whose log line has text after the count.
    const eachS = (label, suffix, registry, fn) => { let n = 0; if (registry && registry.allObjects) for (const o of registry.allObjects) { try { fn(o); n++; } catch { /* skip */ } } logger.info(`[UNLOCK] ${label}: ${n} ${suffix}`); };
    try {
      // 1. All skills to level 120 + abyssal level 60
      // Normal level 120 ≈ 104M XP; abyssal level 60 needs much more XP
      // because the abyssal XP curve starts at normal level 99.
      // Use abyssalExp.levelToXP(60) for the exact abyssal XP target.
      const targetXp = exp.levelToXP(120);
      const targetAxp = abyssalExp.levelToXP(60);
      for (const skill of game.skills.allObjects) {
        try {
          // Set level caps to max BEFORE adding XP so levels aren't capped
          if (skill._currentLevelCap !== undefined && skill.maxLevelCap) {
            skill._currentLevelCap = skill.maxLevelCap;
          }
          // Normal XP
          if (skill._xp !== undefined && skill.xp < targetXp) {
            skill.addXP(targetXp - skill.xp);
          }
          // Abyssal XP — only for skills that actually have abyssal levels
          if (skill._abyssalXP !== undefined && skill._hasAbyssalLevels) {
            // Set the abyssal level cap to max so addAbyssalXP doesn't cap
            if (skill.maxAbyssalLevelCap && skill._currentAbyssalLevelCap !== undefined) {
              skill._currentAbyssalLevelCap = skill.maxAbyssalLevelCap;
            }
            if (skill.abyssalXP < targetAxp) {
              try {
                skill.addAbyssalXP(targetAxp - skill.abyssalXP);
              } catch (e) {
                // Force-set directly if addAbyssalXP fails
                skill._abyssalXP = targetAxp;
                if (skill._abyssalLevel !== undefined) skill._abyssalLevel = 60;
              }
            }
          }
          count++;
        } catch (e) { logger.warn(`[UNLOCK] Skill ${skill.id} failed: ${e.message}`); }
      }
      logger.info(`[UNLOCK] Skills: ${count} processed`);

      // 1b. Unlock all skills (some like Corruption/Harvesting need setUnlock(true))
      each('Skills unlocked', game.skills, (skill) => {
        if (skill.isUnlocked || !skill.setUnlock) throw 0; // skip without counting
        skill.setUnlock(true);
      });

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
      eachS('Bank items', 'added', game.items, (item) => {
        if (!item || !item.id) throw 0;
        // Skip dummy items
        if (item.id.startsWith('melvorD:Dummy')) throw 0;
        game.bank.addItemOnLoad(item, 1000);
      });

      // 3. Currencies are set LAST (after all spending operations like
      // agility buildObstacle/buildPillar) to prevent going negative.
      // See step 23b at the end.

      // 4. All pets — use isPetUnlocked + unlockPet, with fallback to unlockPetByID and direct set add
      eachS('Pets', 'unlocked', game.petManager ? game.pets : null, (pet) => {
        if (!(pet && pet.id && !game.petManager.isPetUnlocked(pet))) throw 0;
        try {
          game.petManager.unlockPet(pet);
        } catch (e) {
          try { game.petManager.unlockPetByID(pet.id); }
          catch (e2) {
            // Last resort: add directly to the unlocked set
            if (game.petManager.unlocked) game.petManager.unlocked.add(pet);
          }
        }
      });

      // 5. All item charges — use addCharges for equipment items that support charges
      eachS('Item charges', 'set', game.itemCharges && game.itemCharges.addCharges ? game.items : null, (item) => {
        if (!item || !item.id) throw 0;
        // EquipmentItem subclasses can have charges
        if (item.equipSlot === undefined && item.charges === undefined) throw 0;
        game.itemCharges.addCharges(item, 10000);
      });

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
      eachS('Mastery pools', 'maxed', game.skills, (skill) => {
        if (!(skill.addMasteryPoolXP && skill._masteryPoolXP !== undefined)) throw 0;
        // Add pool XP for each realm
        if (game.realms && game.realms.allObjects) {
          for (const realm of game.realms.allObjects) {
            try { skill.addMasteryPoolXP(realm, 5000000); } catch (e) { /* skip */ }
          }
        }
      });

      // 8. All shop upgrades — use purchases registry and upgradesPurchased map
      eachS('Shop upgrades', 'purchased', game.shop && game.shop.purchases, (purchase) => {
        if (game.shop.isUpgradePurchased(purchase)) throw 0;
        // Directly set the purchase count in the map
        game.shop.upgradesPurchased.set(purchase, 1);
      });

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
      eachS('Summoning marks', 'discovered', game.summoning && game.summoning.actions, (recipe) => {
        // Check if mark is already in marksUnlocked map
        if (game.summoning.marksUnlocked && game.summoning.marksUnlocked.has(recipe)) throw 0;
        game.summoning.discoverMark(recipe);
      });

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
      // Regular dungeons — completion tracked in cm.dungeonCompletion (Map<Dungeon, number>),
      // NOT on the Dungeon object (only AbyssDepth and Stronghold have timesCompleted).
      if (cm && cm.dungeonCompletion && game.dungeons && game.dungeons.allObjects) {
        for (const dungeon of game.dungeons.allObjects) {
          try {
            const cur = cm.dungeonCompletion.get(dungeon) || 0;
            if (cur < 100) cm.dungeonCompletion.set(dungeon, 100);
            dungeonCount++;
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
          if (game.clueHunt.clueProgress) {
            for (const step of game.clueHunt.clueProgress) {
              if (step && step.complete !== undefined) step.complete = true;
            }
          }
          logger.info('[UNLOCK] Clue hunt: all steps completed');
        } catch (e) { /* skip */ }
      }

      // 16. All corruption effect rows unlocked
      if (game.corruption && game.corruption.corruptionEffects) {
        try {
          // CorruptionEffectTable has allRows/unlockedRows/lockedRows, not .rows.
          // Use unlockRow() to properly unlock each row.
          const table = game.corruption.corruptionEffects;
          if (table.allRows) for (const row of table.allRows) {
            if (row && !row.isUnlocked && table.unlockRow) {
              try { table.unlockRow(row); } catch { /* skip */ }
            }
          }
          logger.info('[UNLOCK] Corruption: all rows unlocked');
        } catch (e) { /* skip */ }
      }

      // 17. All astrology modifiers upgraded
      if (game.astrology) {
        try {
          // AstrologyRecipe has standardModifiers, uniqueModifiers, abyssalModifiers
          // (each AstrologyModifier[]), not a single .modifiers array.
          for (const recipe of game.astrology.actions.allObjects) {
            for (const modList of [recipe.standardModifiers, recipe.uniqueModifiers, recipe.abyssalModifiers]) {
              if (!modList) continue;
              for (const mod of modList) {
                try { if (mod && 'timesBought' in mod) mod.timesBought = 10; } catch { /* skip */ }
              }
            }
          }
          logger.info('[UNLOCK] Astrology: all modifiers upgraded');
        } catch (e) { /* skip */ }
      }

      // 18. All archaeology dig sites unlocked + museum donations
      if (game.archaeology) {
        try {
          // ArchaeologyDigSite has no isUnlocked property — dig sites are
          // unlocked via their associated POI being discovered. Discover the
          // POI if it exists.
          for (const site of game.archaeology.actions.allObjects) {
            if (site.poi && !site.poi.isDiscovered) {
              try { site.poi.isDiscovered = true; } catch { /* skip */ }
            }
          }
          logger.info('[UNLOCK] Archaeology: all dig sites unlocked');
        } catch (e) { /* skip */ }
      }

      // 19. All cartography POIs discovered
      if (game.cartography) {
        try {
          // Cartography uses worldMaps (NamespaceRegistry<WorldMap>), not .maps.
          // WorldMap.pointsOfInterest is NamespaceRegistry<PointOfInterest>.
          for (const map of game.cartography.worldMaps.allObjects) {
            if (map.pointsOfInterest) {
              for (const poi of map.pointsOfInterest.allObjects) {
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
          // HarvestingVein has no isUnlocked property — veins are unlocked
          // via their associated shopItemPurchased. Purchase the shop upgrade
          // if not already purchased.
          for (const vein of game.harvesting.actions.allObjects) {
            if (vein.shopItemPurchased && game.shop && !game.shop.isUpgradePurchased(vein.shopItemPurchased)) {
              try { game.shop.upgradesPurchased.set(vein.shopItemPurchased, 1); } catch { /* skip */ }
            }
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

      // 23. All level cap increases purchased + per-skill caps maxed
      try {
        if (game._levelCapIncreasesBought !== undefined) game._levelCapIncreasesBought = 50;
        if (game._abyssalLevelCapIncreasesBought !== undefined) game._abyssalLevelCapIncreasesBought = 50;
        // Set per-skill level caps to their maximum
        for (const skill of game.skills.allObjects) {
          try {
            if (skill._currentLevelCap !== undefined && skill.maxLevelCap) {
              skill._currentLevelCap = skill.maxLevelCap;
            }
            if (skill._hasAbyssalLevels && skill._currentAbyssalLevelCap !== undefined && skill.maxAbyssalLevelCap) {
              skill._currentAbyssalLevelCap = skill.maxAbyssalLevelCap;
            }
          } catch (e) { /* skip */ }
        }
        logger.info('[UNLOCK] Level cap increases: 50 purchased, per-skill caps maxed');
      } catch (e) { /* skip */ }

      // 23b. Max all currencies LAST — after all spending operations
      // (agility buildObstacle/buildPillar, shop purchases, etc.) are done.
      // Use set(max) so we never decrease, and never go negative.
      let curCount = 0;
      if (game.currencies && game.currencies.allObjects) {
        for (const cur of game.currencies.allObjects) {
          try {
            cur.set(Math.max(cur._amount || 0, 1000000000));
            curCount++;
          } catch (e) { /* skip */ }
        }
      }
      logger.info(`[UNLOCK] Currencies: ${curCount} maxed (set last to avoid negative)`);

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

  // Message dispatch table, built once in the constructor. Action claims are
  // routed straight to the ActionLock; everything else goes to an _applyX.
  _buildHandlers() {
    return {
      [Msg.ACTION_CLAIM]: (m) => this.actionLock.applyRemoteClaim(m),
      [Msg.ACTION_RELEASE]: (m) => this.actionLock.applyRemoteRelease(m),
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
      [Msg.ASTROLOGY_SELECT]: (m) => this._applyAstrologySelect(m),
      [Msg.SUMMONING]: (m) => this._applySummoning(m),
      [Msg.SLAYER]: (m) => this._applySlayer(m),
      [Msg.SKILL_SELECT]: (m) => this._applySkillSelect(m),
      [Msg.MUSEUM_DONATE]: (m) => this._applyMuseumDonate(m),
      [Msg.PLAYER_STATE]: (m) => this._applyPlayerState(m),
      [Msg.COMBAT_AREA]: (m) => this._applyCombatArea(m),
      [Msg.COMBAT_EVENT_STATE]: (m) => this._applyCombatEventState(m),
      [Msg.COMBAT_EVENT]: (m) => this._applyCombatEvent(m),
      [Msg.COMBAT_CLAIM]: (m) => this._applyCombatClaim(m),
      [Msg.COMBAT_RELEASE]: () => this._applyCombatRelease(),
      [Msg.COMBAT_LOOT]: (m) => this._applyCombatLoot(m),
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
      [Msg.LEVEL_CAP]: (m) => this._applyLevelCaps(m),
      [Msg.GAME_STATE]: (m) => this._applyGameState(m),
      [Msg.LORE]: (m) => this._applyLore(m),
      [Msg.SECRET_AREA]: () => this._applySecretArea(),
      [Msg.SKILL_UNLOCK]: (m) => this._applySkillUnlock(m),
      [Msg.REALM]: (m) => this._applyRealmSelection(m),
      [Msg.SLAYER_CAT]: (m) => this._applySlayerCategories(m),
      [Msg.COOKING_STOCKPILE]: (m) => this._applyCookingStockpile(m),
      [Msg.EQUIP_SET_COUNT]: (m) => this._applyEquipSetCount(m),
      [Msg.BANK_TAB_COUNT]: (m) => this._applyBankTabCount(m),
      [Msg.SETTINGS]: (m) => this._applyGameSettings(m),
      [Msg.STATE_REQUEST]: () => this.transport.send(this._buildSnapshot()),
      [Msg.STATE_SNAPSHOT]: (m) => this._applySnapshot(m),
      [Msg.UNLOCK_ALL]: () => this._unlockAll(),
    };
  }

  handle(msg) {
    // Log every incoming message with a readable name
    const msgName = Object.keys(Msg).find(k => Msg[k] === msg.t) || msg.t;
    logger.info(`[RECV] ${msgName}`, JSON.stringify(msg).slice(0, 200));
    const handler = this._handlers[msg.t];
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

// Trigger a browser download of a text file (Blob → object URL → anchor click).
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
    dlBtn.addEventListener('click', () => downloadText(opts.download, text));
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
          <input class="rmp-input" data-rmp="nameInput" placeholder="Your name" maxlength="16" value="${getSavedName()}"
            style="flex:1;background:#111827;border:1px solid #4b5563;color:#f3f4f6;border-radius:6px;padding:5px 8px;font-size:12px;outline:none;" />
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="rmp-input" data-rmp="serverInput" value="${getSavedServerUrl()}" title="WebSocket relay server URL"
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
        <div data-rmp="playersSection" style="display:flex;flex-direction:column;gap:6px;">
          <!-- Local player -->
          <div data-rmp="localPlayerBlock" class="rmp-player-block">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border-radius:50%;background:#34d399;flex:0 0 auto;"></span>
              <span style="font-weight:600;min-width:48px;" data-rmp="localName">You</span>
              <span style="color:#9ca3af;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-rmp="localAction">Idle</span>
            </div>
            <div data-rmp="localProgressBar" hidden class="rmp-fake-bar" style="margin-left:14px;width:calc(100% - 14px);">
              <div data-rmp="localProgressFill" class="rmp-fake-bar-fill rmp-fill-local" style="width:0%;"></div>
            </div>
            <div data-rmp="localRecipes" hidden style="margin-left:14px;display:flex;flex-wrap:wrap;gap:2px;"></div>
          </div>
          <!-- Remote player -->
          <div data-rmp="remotePlayerBlock" class="rmp-player-block">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border-radius:50%;background:#60a5fa;flex:0 0 auto;"></span>
              <span style="font-weight:600;min-width:48px;" data-rmp="remoteName">Peer</span>
              <span style="color:#9ca3af;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-rmp="remoteAction">Idle</span>
            </div>
            <div data-rmp="remoteProgressBar" hidden class="rmp-fake-bar" style="margin-left:14px;width:calc(100% - 14px);">
              <div data-rmp="remoteProgressFill" class="rmp-fake-bar-fill rmp-fill-remote" style="width:0%;"></div>
            </div>
            <div data-rmp="remoteRecipes" hidden style="margin-left:14px;display:flex;flex-wrap:wrap;gap:2px;"></div>
          </div>
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
      // Persist the server URL and name so they survive reloads.
      saveServerUrl(serverUrl);
      saveName(name);
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
        downloadText('realMP-log.txt', text);
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
      $('saveSyncRow').textContent = 'Sending save to peer...';
    });
    this.transport.on('save_sync', () => {
      this._showRow('saveSyncRow');
      $('saveSyncRow').textContent = 'Loading host save...';
    });
    this.transport.on('error', (e) => {
      $('status').textContent = 'Error';
      logger.error('transport error', e);
    });
    this.actionLock.setOnChange(() => this._refreshActions());

    // Listen for remote action progress updates.
    if (this.sync && this.sync.onRemoteAction) {
      this.sync.onRemoteAction((r) => this._renderProgress('remote', r));
    }

    // Listen for local action progress updates.
    if (this.sync && this.sync.onLocalAction) {
      this.sync.onLocalAction((l) => this._renderProgress('local', l));
    }
  }

  // Render an action progress bar + recipe chips for one side ('local'|'remote').
  _renderProgress(side, data) {
    const bar = this.$(`${side}ProgressBar`);
    const fill = this.$(`${side}ProgressFill`);
    const recipesEl = this.$(`${side}Recipes`);
    if (!bar || !fill) return;
    if (data) {
      bar.hidden = false;
      fill.style.width = (data.progress * 100).toFixed(1) + '%';
      // Apply skill-specific color class
      fill.className = 'rmp-fake-bar-fill ' + this._skillColorClass(data.skillId, side);
      // Show recipe chips (e.g. tree names for woodcutting)
      if (recipesEl) {
        const recipes = data.recipes || [];
        if (recipes.length > 0) {
          recipesEl.hidden = false;
          recipesEl.innerHTML = recipes.map(r =>
            `<span class="rmp-recipe-chip">${this._esc(r.name || r.id)}</span>`
          ).join('');
        } else {
          recipesEl.hidden = true;
          recipesEl.innerHTML = '';
        }
      }
    } else {
      bar.hidden = true;
      fill.style.width = '0%';
      if (recipesEl) { recipesEl.hidden = true; recipesEl.innerHTML = ''; }
    }
  }

  /** Escape HTML to prevent injection in recipe chips. */
  _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Get a skill-specific color class for the progress bar fill.
   *  Matches the game's ProgressBarStyle colors where possible. */
  _skillColorClass(skillId, side) {
    // Map skill IDs to game-like bar colors
    const map = {
      'melvorD:Woodcutting': 'rmp-fill-woodcutting',
      'melvorD:Mining': 'rmp-fill-mining',
      'melvorD:Fishing': 'rmp-fill-fishing',
      'melvorD:Firemaking': 'rmp-fill-firemaking',
      'melvorD:Cooking': 'rmp-fill-cooking',
      'melvorD:Smithing': 'rmp-fill-smithing',
      'melvorD:Thieving': 'rmp-fill-thieving',
      'melvorD:Farming': 'rmp-fill-farming',
      'melvorD:Fletching': 'rmp-fill-fletching',
      'melvorD:Crafting': 'rmp-fill-crafting',
      'melvorD:Runecrafting': 'rmp-fill-runecrafting',
      'melvorD:Herblore': 'rmp-fill-herblore',
      'melvorD:Agility': 'rmp-fill-agility',
      'melvorD:Summoning': 'rmp-fill-summoning',
      'melvorD:Astrology': 'rmp-fill-astrology',
      'melvorD:Archaeology': 'rmp-fill-archaeology',
      'melvorD:Cartography': 'rmp-fill-cartography',
      'melvorD:Harvesting': 'rmp-fill-harvesting',
      'melvorD:Corruption': 'rmp-fill-corruption',
      'melvorD:AltMagic': 'rmp-fill-altmagic',
    };
    return map[skillId] || (side === 'local' ? 'rmp-fill-local' : 'rmp-fill-remote');
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

  // Route incoming messages — action claims are dispatched to the ActionLock
  // by Sync.handle's table, everything else to the matching _applyX.
  transport.on('message', (msg) => syncInstance.handle(msg));

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
  // game.character doesn't exist; check game.combat.player instead, which
  // is set up during character load.
  try {
    if (game && game.combat && game.combat.player) {
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
