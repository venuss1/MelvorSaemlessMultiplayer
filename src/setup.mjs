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
  ASTROLOGY_SELECT: 'astro_select', // studied/explored constellation
  REALM: 'realm',                   // current realm selection
  SLAYER_CAT: 'slayer_cat',         // slayer task category completions
  COOKING_STOCKPILE: 'cook_stock',  // cooking stockpile items
  EQUIP_SET_COUNT: 'equip_set_count', // number of equipment set slots
  SETTINGS: 'settings',             // gameplay-affecting game settings
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

const DEFAULT_SERVER = 'wss://solo-tradition-respiratory-factors.trycloudflare.com';

/** Get the saved server URL from localStorage, or fall back to DEFAULT_SERVER. */
function getSavedServerUrl() {
  try {
    const saved = localStorage.getItem('rmp_server_url');
    if (saved && saved.trim()) return saved.trim();
  } catch { /* noop */ }
  return DEFAULT_SERVER;
}

/** Save the server URL to localStorage so it persists across reloads. */
function saveServerUrl(url) {
  try { localStorage.setItem('rmp_server_url', url); } catch { /* noop */ }
}

/** Get the saved player name from localStorage. */
function getSavedName() {
  try {
    const saved = localStorage.getItem('rmp_player_name');
    if (saved && saved.trim()) return saved.trim();
  } catch { /* noop */ }
  return '';
}

/** Save the player name to localStorage. */
function saveName(name) {
  try { localStorage.setItem('rmp_player_name', name); } catch { /* noop */ }
}

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
    this._watcher = null;
    this._lastActiveSkillId = null;
    this._saveTimer = null;
    this._progressTimer = null;
    this._installed = false;
    this._remoteAction = null; // { skillId, progress, actionLabel }
    this._onRemoteActionCb = null;
    this._onLocalActionCb = null;
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
      ['CombatEventSystem', () => this._patchCombatEventSystem()],
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
      ['LevelCaps', () => this._patchLevelCaps()],
      ['GameState', () => this._patchGameState()],
      ['Lore', () => this._patchLore()],
      ['Tutorial', () => this._patchTutorial()],
      ['RealmSelection', () => this._patchRealmSelection()],
      ['SlayerCategories', () => this._patchSlayerCategories()],
      ['CookingStockpile', () => this._patchCookingStockpile()],
      ['EquipSetCount', () => this._patchEquipSetCount()],
      ['GameSettings', () => this._patchGameSettings()],
    ];
    let ok = 0, fail = 0;
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
    this._startPeriodicStateSync();
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
    if (this._stateSyncTimer) { clearInterval(this._stateSyncTimer); this._stateSyncTimer = null; }
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
    if (!item || !item.name) { logger.warn('bank apply: item not found or invalid', msg.itemId); return; }
    const bank = game.bank;
    const current = bank.getQty(item);
    const delta = msg.qty - current;
    if (delta === 0) return;
    logger.info('Bank sync apply:', msg.itemId, 'current:', current, 'target:', msg.qty, 'delta:', delta);
    this._applyingRemote = true;
    try {
      if (delta > 0) {
        // found=true marks the item as discovered in the completion log,
        // which reveals its picture in the museum and item log. notify=false
        // suppresses the "new item" popup so syncs are silent.
        try { bank.addItem(item, delta, false, true, true, false); } catch (e) { logger.warn('bank addItem failed', msg.itemId, e); }
      } else {
        try { bank.removeItemQuantity(item, -delta, false); } catch (e) { logger.warn('bank removeItem failed', msg.itemId, e); }
      }
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
      // Use max to avoid resetting currencies to 0 from stale messages.
      // Never go negative — ignore remote values below 0.
      const remote = Math.max(0, msg.qty || 0);
      const newAmt = Math.max(c._amount || 0, remote);
      c.set(newAmt);
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
      if (game.combat.player.activePrayers) for (const ap of game.combat.player.activePrayers) prayers.push(ap.id);
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
        attackSpellId: (game.combat.player.spellSelection && game.combat.player.spellSelection.attack) ? game.combat.player.spellSelection.attack.id : null,
        curseSpellId: (game.combat.player.spellSelection && game.combat.player.spellSelection.curse) ? game.combat.player.spellSelection.curse.id : null,
        auroraSpellId: (game.combat.player.spellSelection && game.combat.player.spellSelection.aurora) ? game.combat.player.spellSelection.aurora.id : null,
      });
    };
    this.ctx.patch(Player, 'selectAttackSpell').after(function () { sendAttackSpell(); });

    // --- Attack styles ---
    const sendAttackStyles = () => {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      // attackStyles is { melee?: AttackStyle, ranged?: AttackStyle, magic?: AttackStyle }
      const styles = [];
      const as = game.combat.player.attackStyles;
      if (as) {
        for (const at of ['melee', 'ranged', 'magic']) {
          const style = as[at];
          styles.push({ attackType: at, styleId: style ? style.id : null });
        }
      }
      sync.transport.send({ t: Msg.PLAYER_STATE, attackStyles });
    };
    // Patch Player class prototype (works even if player instance not ready yet)
    if (Player.prototype && typeof Player.prototype.setAttackStyle === 'function') {
      this.ctx.patch(Player, 'setAttackStyle').after(function () { sendAttackStyles(); });
    }

    // --- Prayer/soul points changes (combat) ---
    for (const m of ['consumePrayerPoints', 'addPrayerPoints', 'consumeSoulPoints', 'addSoulPoints']) {
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
          if (remoteSlots[slotId] === undefined) {
            const slot = game.equipmentSlots.getObjectByID(slotId);
            if (slot) {
              try { eq.unequipItem(slot); } catch (e) { logger.warn(`unequip ${slotId} failed: ${e.message}`); }
            }
          }
        }
        // Equip / update slots to match remote.
        // equipItem already removes the item from bank internally
        for (const [slotId, remote] of Object.entries(remoteSlots)) {
          if (slotId === '__spellSelection' || slotId === '__prayerSelection') continue;
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
            try { game.bank.addItem(item, remote.qty, false, true, true, false); } catch (e) { /* skip */ }
          }
          // Equip — equipItem removes from bank internally
          try {
            eq.equipItem(item, slot, remote.qty);
          } catch (e) {
            logger.warn(`equip ${slotId} with ${remote.itemId} failed: ${e.message}`);
          }
        }
        // Per-set spell selection
        if (remoteSlots.__spellSelection && eqSet.spellSelection) {
          const ss = remoteSlots.__spellSelection;
          try {
            if (ss.attackId) {
              const sp = game.attackSpells.getObjectByID(ss.attackId);
              if (sp && game.combat.player.selectAttackSpell) game.combat.player.selectAttackSpell(sp, false);
            }
            if (ss.curseId) {
              const sp = game.curseSpells && game.curseSpells.getObjectByID(ss.curseId);
              if (sp && game.combat.player.toggleCurse) game.combat.player.toggleCurse(sp, false);
            }
            if (ss.auroraId) {
              const sp = game.auroraSpells && game.auroraSpells.getObjectByID(ss.auroraId);
              if (sp && game.combat.player.toggleAurora) game.combat.player.toggleAurora(sp, false);
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
    // try/catch so one broken plot doesn't break the rest.
    try {
      const wrapMethod = (proto, name) => {
        if (!proto || !proto[name]) return false;
        const orig = proto[name];
        proto[name] = function (...args) {
          try { return orig.apply(this, args); }
          catch (e) { logger.warn(`[FARM] ${proto.constructor.name}.${name} threw: ${e.message}`); }
        };
        return true;
      };

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
      const origRenderGrowth = Farming.prototype.renderGrowthStatus;
      Farming.prototype.renderGrowthStatus = function () {
        try { return origRenderGrowth.call(this); }
        catch (e) { logger.warn(`[FARM] renderGrowthStatus threw: ${e.message}`); }
      };
      logger.info('[FARM] Patched Farming.renderGrowthStatus');
    }

    // Patch Farming.render — the main render method called from the game
    // render loop. If it throws, the entire game UI breaks.
    if (typeof Farming.prototype.render === 'function') {
      const origRender = Farming.prototype.render;
      Farming.prototype.render = function () {
        try { return origRender.call(this); }
        catch (e) { logger.warn(`[FARM] Farming.render threw: ${e.message}`); }
      };
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

    // Planting — sync so both players plant the same seeds
    this.ctx.patch(Farming, 'plantPlot').after(function (_ret, plot) {
      logger.info(`[FARM] plantPlot called: plot=${plot ? plot.id : 'null'}, state=${plot ? plot.state : 'null'}`);
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'plantPlotOnClick').after(function (_ret, plot) {
      logger.info(`[FARM] plantPlotOnClick called: plot=${plot ? plot.id : 'null'}, state=${plot ? plot.state : 'null'}`);
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

    // Harvesting — sync so both players harvest
    this.ctx.patch(Farming, 'harvestPlot').after(function (_ret, plot) {
      logger.info(`[FARM] harvestPlot called: plot=${plot ? plot.id : 'null'}, state=${plot ? plot.state : 'null'}`);
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'harvestPlotOnClick').after(function (_ret, plot) {
      logger.info(`[FARM] harvestPlotOnClick called: plot=${plot ? plot.id : 'null'}, state=${plot ? plot.state : 'null'}`);
      sendPlot(plot);
    });
    this.ctx.patch(Farming, 'harvestAllOnClick').after(function () {
      if (sync._applyingRemote || !sync.transport.isConnected) return;
      sync._sendAllFarmingPlots();
    });

    // Compost — sync so both players compost (weird gloop, abyssal compost, etc.)
    this.ctx.patch(Farming, 'compostPlot').after(function (_ret, plot) {
      logger.info(`[FARM] compostPlot called: plot=${plot ? plot.id : 'null'}, compostLevel=${plot ? plot.compostLevel : 'null'}, compostItem=${plot && plot.compostItem ? plot.compostItem.id : 'null'}`);
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
      logger.info('[FARM] growPlots tick — sending all plots');
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
    logger.info(`[FARM] Sending plot: ${JSON.stringify(data)}`);
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

  _applyFarming(msg) {
    const farming = game.farming;
    if (!farming || !msg.plots) return;
    logger.info(`[FARM] _applyFarming: received ${msg.plots.length} plots`);
    this._applyingRemote = true;
    try {
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
          let recipe = null;
          if (game.farming.actions) {
            recipe = game.farming.actions.getObjectByID(p.plantedRecipeId);
          }
          if (!recipe && game.farming.actions && game.farming.actions.allObjects) {
            for (const r of game.farming.actions.allObjects) {
              if (r.id === p.plantedRecipeId) { recipe = r; break; }
            }
          }
          if (recipe) {
            // Set plot state directly (don't consume seeds on the receiver)
            plot.state = p.state;
            plot.plantedRecipe = recipe;
            plot.growthTime = p.growthTime || 0;
            logger.info(`[FARM] Synced plant: ${p.id} → ${p.plantedRecipeId}, state=${p.state}`);

            // Create a growth timer so the UI shows the remaining time
            // and the crop eventually grows/hrows on the receiver too.
            if (p.state === 2 && farming.createGrowthTimer) {
              // Use the remaining time from the sender if available,
              // otherwise compute the full interval.
              let intervalMs = p.remainingTimeMs || 0;
              if (intervalMs <= 0 && farming.modifyInterval && recipe.baseInterval) {
                try { intervalMs = farming.modifyInterval(recipe.baseInterval, recipe); }
                catch { intervalMs = recipe.baseInterval; }
              }
              if (intervalMs > 0) {
                // Remove any existing timer for this plot first
                const oldTimer = farming.growthTimerMap.get(plot);
                if (oldTimer) {
                  try { oldTimer.stop(); } catch { /* noop */ }
                  if (farming.growthTimers && farming.growthTimers.delete) {
                    try { farming.growthTimers.delete(oldTimer); } catch { /* noop */ }
                  }
                  farming.growthTimerMap.delete(plot);
                }
                // Create a new growth timer with the remaining time
                try {
                  farming.createGrowthTimer([plot], intervalMs);
                  logger.info(`[FARM] Created growth timer for ${p.id}, interval=${intervalMs}ms`);
                } catch (e) {
                  logger.warn(`[FARM] Failed to create growth timer: ${e.message}`);
                }
              }
            }
            // Queue render updates
            if (farming.renderQueue) {
              if (farming.renderQueue.growthState) farming.renderQueue.growthState.add(plot);
              if (farming.renderQueue.growthTime) {
                const timer = farming.growthTimerMap.get(plot);
                if (timer) farming.renderQueue.growthTime.add(timer);
              }
            }
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
          let recipe = null;
          if (game.farming.actions) {
            recipe = game.farming.actions.getObjectByID(p.plantedRecipeId);
          }
          if (recipe && plot.plantedRecipe !== recipe) {
            // Different recipe — update it
            plot.plantedRecipe = recipe;
            plot.growthTime = p.growthTime || 0;
            logger.info(`[FARM] Updated planted recipe: ${p.id} → ${p.plantedRecipeId}`);
          }
          // If the receiver has no timer but the sender does, create one
          if (p.state === 2 && farming.growthTimerMap && !farming.growthTimerMap.get(plot) && farming.createGrowthTimer) {
            let intervalMs = p.remainingTimeMs || 0;
            if (intervalMs <= 0 && farming.modifyInterval && recipe && recipe.baseInterval) {
              try { intervalMs = farming.modifyInterval(recipe.baseInterval, recipe); }
              catch { intervalMs = recipe.baseInterval; }
            }
            if (intervalMs > 0) {
              try {
                farming.createGrowthTimer([plot], intervalMs);
                logger.info(`[FARM] Created missing growth timer for ${p.id}, interval=${intervalMs}ms`);
              } catch (e) {
                logger.warn(`[FARM] Failed to create missing growth timer: ${e.message}`);
              }
            }
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
              let plantedRecipe = null;
              if (p.plantedRecipeId && game.farming.actions) {
                plantedRecipe = game.farming.actions.getObjectByID(p.plantedRecipeId);
              }
              plot.plantedRecipe = plantedRecipe || undefined;
            }
            if (typeof p.growthTime === 'number') plot.growthTime = p.growthTime;
          }

          // Remove growth timer if the plot is no longer growing
          if (p.state !== 2 && farming.growthTimerMap) {
            const timer = farming.growthTimerMap.get(plot);
            if (timer) {
              try { timer.stop(); } catch { /* noop */ }
              if (farming.growthTimers && farming.growthTimers.delete) {
                try { farming.growthTimers.delete(timer); } catch { /* noop */ }
              }
              farming.growthTimerMap.delete(plot);
            }
          }
          // Queue render updates
          if (farming.renderQueue) {
            if (farming.renderQueue.growthState) farming.renderQueue.growthState.add(plot);
            if (farming.renderQueue.growthTime) {
              const timer = farming.growthTimerMap.get(plot);
              if (timer) farming.renderQueue.growthTime.add(timer);
            }
          }
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
          let selectedRecipe = null;
          if (p.selectedRecipeId && farming.actions) {
            selectedRecipe = farming.actions.getObjectByID(p.selectedRecipeId);
          }
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
    const courses = [];
    for (const [realm, course] of ag.courses) {
      const obstacles = {};
      for (const [tier, ob] of course.builtObstacles) obstacles[tier] = ob ? ob.id : null;
      const pillars = {};
      for (const [tier, pi] of course.builtPillars) pillars[tier] = pi ? pi.id : null;
      // Blueprints: { name, obstacles: {tier: id}, pillars: {tier: id} }
      const blueprints = [];
      if (course.blueprints) for (const [slot, bp] of course.blueprints) {
        const bpObstacles = {};
        if (bp.obstacles) for (const [tier, ob] of bp.obstacles) bpObstacles[tier] = ob ? ob.id : null;
        const bpPillars = {};
        if (bp.pillars) for (const [tier, pi] of bp.pillars) bpPillars[tier] = pi ? pi.id : null;
        blueprints.push({ slot, name: bp.name || '', obstacles: bpObstacles, pillars: bpPillars });
      }
      courses.push({ realmId: realm.id, obstacles, pillars, blueprints });
    }
    // obstacleBuildCount: how many times each obstacle has been built
    const buildCounts = [];
    if (ag.obstacleBuildCount) for (const [ob, count] of ag.obstacleBuildCount) {
      buildCounts.push({ id: ob.id, count });
    }
    this.transport.send({ t: Msg.AGILITY, courses, activeObstacle: ag.currentlyActiveObstacle, buildCounts });
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

        // Sync obstacles — try buildObstacle first, fall back to direct set
        for (const [tier, obId] of Object.entries(c.obstacles)) {
          const tierNum = Number(tier);
          const currentOb = course.builtObstacles.get(tierNum);
          const currentId = currentOb ? currentOb.id : null;
          if (obId === currentId) continue; // already in sync

          if (obId) {
            // AgilityObstacle is a MasteryAction in ag.actions, not an Item.
            const ob = ag.actions && ag.actions.getObjectByID(obId);
            if (!ob) { logger.warn(`[AGILITY] Obstacle not found: ${obId}`); continue; }
            // Direct set the obstacle — don't call buildObstacle() because:
            // 1. buildObstacle(obstacle) takes only 1 param (not course+tier)
            // 2. It would consume resources (spectator shouldn't pay again)
            // 3. We want to replicate exact state, not trigger build side-effects
            course.builtObstacles.set(tierNum, ob);
            logger.info(`[AGILITY] Set obstacle ${obId} at tier ${tierNum}`);
          } else {
            // Remove obstacle at this tier
            course.builtObstacles.delete(tierNum);
          }
        }

        // Sync pillars
        for (const [tier, piId] of Object.entries(c.pillars)) {
          const tierNum = Number(tier);
          const currentPi = course.builtPillars.get(tierNum);
          const currentId = currentPi ? currentPi.id : null;
          if (piId === currentId) continue;

          if (piId) {
            // AgilityPillar is a MasteryAction in ag.pillars, not an Item.
            const pi = ag.pillars && ag.pillars.getObjectByID(piId);
            if (!pi) { logger.warn(`[AGILITY] Pillar not found: ${piId}`); continue; }
            // Direct set — same reasoning as obstacles above
            course.builtPillars.set(tierNum, pi);
          } else {
            course.builtPillars.delete(tierNum);
          }
        }
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
          const bpObstacles = new Map();
          for (const [tier, obId] of Object.entries(bp.obstacles || {})) {
            if (obId) {
              const ob = ag.actions && ag.actions.getObjectByID(obId);
              if (ob) bpObstacles.set(Number(tier), ob);
            }
          }
          const bpPillars = new Map();
          for (const [tier, piId] of Object.entries(bp.pillars || {})) {
            if (piId) {
              const pi = ag.pillars && ag.pillars.getObjectByID(piId);
              if (pi) bpPillars.set(Number(tier), pi);
            }
          }
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
    const upgrades = [];
    // Astrology has no aggregated *ModifierUpgrades arrays — the upgrade
    // state (timesBought) is stored directly on the AstrologyModifier
    // objects in each recipe's standardModifiers/uniqueModifiers/
    // abyssalModifiers arrays.
    try {
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
        const type = u.type || 'standard';
        // Astrology has no standardModifierUpgrades/uniqueModifierUpgrades/
        // abyssalModifierUpgrades arrays — the upgrade state (timesBought) is
        // stored directly on the AstrologyModifier objects in the recipe's
        // standardModifiers/uniqueModifiers/abyssalModifiers arrays.
        const arr = type === 'standard' ? recipe.standardModifiers
          : (type === 'unique' ? recipe.uniqueModifiers : recipe.abyssalModifiers);
        if (arr && arr[u.tier]) arr[u.tier].timesBought = u.timesBought;
      }
      // Recompute provided stats so modifier effects take effect.
      if (as.computeProvidedStats) try { as.computeProvidedStats(); } catch { /* noop */ }
      if (as.addProvidedStats) try { as.addProvidedStats(); } catch { /* noop */ }
      if (as.render) as.render();
    } catch (e) { logger.error('applyAstrology failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  _applyAstrologySelect(msg) {
    const as = game.astrology;
    if (!as) return;
    this._applyingRemote = true;
    try {
      if (msg.studiedId !== undefined) {
        as.studiedConstellation = msg.studiedId ? as.actions.getObjectByID(msg.studiedId) : undefined;
      }
      if (msg.exploredId !== undefined) {
        as.exploredConstellation = msg.exploredId ? as.actions.getObjectByID(msg.exploredId) : undefined;
      }
      if (as.render) try { as.render(); } catch { /* noop */ }
      if (as.renderVisibleConstellations) try { as.renderVisibleConstellations(); } catch { /* noop */ }
    } catch (e) { logger.error('applyAstrologySelect failed', e); }
    finally { this._applyingRemote = false; }
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
          const current = su.marksUnlocked.get(recipe) || 0;
          // Only credit new mark discoveries via the game method so that
          // discovery side-effects (XP/rewards) fire. discoverMark takes
          // only the recipe (not a count) — call it once per new discovery.
          if (m.count > current && typeof su.discoverMark === 'function') {
            try { su.discoverMark(recipe); su.marksUnlocked.set(recipe, m.count); }
            catch (e) { su.marksUnlocked.set(recipe, m.count); }
          } else {
            su.marksUnlocked.set(recipe, m.count);
          }
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

    // Woodcutting: active trees are NOT synced — tree selection is a
    // per-player UI choice. Syncing activeTrees corrupts the receiver's
    // woodcutting state (trees set without the action being started,
    // causing -Infinity tick crashes when trees are deselected).

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

    // Generic artisan skill recipe selection sync (Herblore, Smithing, Crafting, Runecrafting, Fletching)
    // These all extend ArtisanSkill which has selectedRecipe and selectedRecipeInRealm.
    for (const skillName of ['herblore', 'smithing', 'crafting', 'runecrafting', 'fletching']) {
      const sk = game[skillName];
      if (!sk || !sk.selectedRecipeInRealm) continue;
      const sendArtisan = () => {
        if (this._applyingRemote || !this.transport.isConnected) return;
        const recipes = [];
        // selectedRecipeInRealm: Map<Realm, Recipe>
        for (const [realm, recipe] of sk.selectedRecipeInRealm) {
          recipes.push({ realmId: realm.id, recipeId: recipe ? recipe.id : null });
        }
        this.transport.send({
          t: Msg.SKILL_SELECT, skillId: `melvorD:${skillName.charAt(0).toUpperCase() + skillName.slice(1)}`,
          artisanRecipes: recipes,
          selectedRecipeId: sk.selectedRecipe ? sk.selectedRecipe.id : null,
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
        const museumRewards = [];
        if (ar.museum && ar.museum.rewards) for (const rw of ar.museum.rewards.allObjects) {
          if (rw.awarded) museumRewards.push(rw.id);
        }
        this.transport.send({ t: Msg.SKILL_SELECT, skillId: 'melvorD:Archaeology', digSites, donatedItems: donated, museumRewards });
      };
      for (const m of ['setMapAsActive', 'toggleTool', 'setToolAsActive', 'startDigging']) {
        if (typeof Archaeology.prototype[m] === 'function') this.ctx.patch(Archaeology, m).after(() => send());
      }
      if (ar.museum) {
        const MuseumClass = ar.museum.constructor;
        for (const m of ['donateItem', 'donateAllGenericArtefacts', 'giveReward', 'giveUnawardedRewards']) {
          if (typeof MuseumClass.prototype[m] === 'function') {
            try { this.ctx.patch(MuseumClass, m).after(() => send()); } catch { /* skip */ }
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
          for (const r of msg.recipes) {
            const cat = s.categories.getObjectByID(r.catId);
            if (!cat) continue;
            const recipe = r.recipeId ? s.actions.getObjectByID(r.recipeId) : null;
            if (recipe) s.selectedRecipes.set(cat, recipe);
          }
          if (s.render) s.render();
          break;
        }
        // Woodcutting: active trees are NOT synced (per-player UI choice).
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
            // Fishing areas are in s.areas (NamespaceRegistry<FishingArea>),
            // not s.actions (which contains Fish objects).
            const area = s.areas && s.areas.getObjectByID(af.areaId);
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
          // Thieving areas are in s.areas (NamespaceRegistry<ThievingArea>),
          // not s.actions (which contains ThievingNPC objects).
          if (msg.areaId) s.currentArea = s.areas && s.areas.getObjectByID(msg.areaId);
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
          if (!s) break;
          if (msg.altRecipes) for (const a of msg.altRecipes) {
            const recipe = s.actions.getObjectByID(a.recipeId);
            if (recipe) s.setAltRecipes.set(recipe, a.altIndex);
          }
          // Artisan recipe selection (from generic artisan sync)
          if (msg.artisanRecipes && s.selectedRecipeInRealm) {
            for (const ar of msg.artisanRecipes) {
              const realm = game.realms.getObjectByID(ar.realmId);
              if (!realm) continue;
              const recipe = ar.recipeId ? s.actions.getObjectByID(ar.recipeId) : null;
              if (recipe) s.selectedRecipeInRealm.set(realm, recipe);
            }
          }
          if (msg.selectedRecipeId) s.selectedRecipe = s.actions.getObjectByID(msg.selectedRecipeId);
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
          if (msg.artisanRecipes && s.selectedRecipeInRealm) {
            for (const ar of msg.artisanRecipes) {
              const realm = game.realms.getObjectByID(ar.realmId);
              if (!realm) continue;
              const recipe = ar.recipeId ? s.actions.getObjectByID(ar.recipeId) : null;
              if (recipe) s.selectedRecipeInRealm.set(realm, recipe);
            }
          }
          if (msg.selectedRecipeId) s.selectedRecipe = s.actions.getObjectByID(msg.selectedRecipeId);
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
            // ArchaeologyTool extends NamespacedObject, not Item — use s.tools
            if (ds.tools) digSite.selectedTools = ds.tools.map(tid => tid ? s.tools.getObjectByID(tid) : null).filter(Boolean);
          }
          if (msg.donatedItems && s.museum && s.museum.donatedItems) {
            for (const itemId of msg.donatedItems) {
              const item = game.items.getObjectByID(itemId);
              if (!item) continue;
              s.museum.donatedItems.add(item);
              // The museum checks game.stats.itemFindCount(item) > 0 to
              // decide whether to show the artifact's picture or a question
              // mark. If the peer never "found" the artifact (it was donated
              // on the host side, or bank-synced with found=false before the
              // fix), itemFindCount is 0 and the museum shows a question mark.
              // Fix: add+remove from bank with found=true to increment the
              // TimesFound stat. Check itemFindCount instead of hasItem
              // because the item may already be in the bank but not "found".
              try {
                if (game.stats && game.stats.itemFindCount(item) === 0) {
                  game.bank.addItem(item, 1, false, true, true, false);
                  game.bank.removeItemQuantity(item, 1, false);
                }
              } catch { /* noop */ }
            }
            // Queue museum renders so the DOM updates (donation count +
            // artifact pictures). Setting render queue flags is safe —
            // the game's render loop processes them on the next animation
            // frame when the archaeology tab is visible. Do NOT call
            // museum.render() directly — it freezes the game from sync
            // handlers.
            if (s.museum.renderQueue) {
              s.museum.renderQueue.donationProgress = true;
              s.museum.renderQueue.allArtefacts = true;
            }
          }
          if (msg.museumRewards && s.museum && s.museum.rewards) {
            for (const rwId of msg.museumRewards) {
              const rw = s.museum.rewards.getObjectByID(rwId);
              if (rw) rw.awarded = true;
            }
          }
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

      // Attack spell
      if (msg.attackSpellId !== undefined) {
        if (msg.attackSpellId) {
          const spell = game.attackSpells.getObjectByID(msg.attackSpellId);
          if (spell && p.selectAttackSpell) p.selectAttackSpell(spell, false);
        }
      }
      // Curse spell
      if (msg.curseSpellId !== undefined) {
        if (msg.curseSpellId) {
          const spell = game.curseSpells.getObjectByID(msg.curseSpellId);
          if (spell && p.toggleCurse) p.toggleCurse(spell, false);
        }
      }
      // Aurora spell
      if (msg.auroraSpellId !== undefined) {
        if (msg.auroraSpellId) {
          const spell = game.auroraSpells.getObjectByID(msg.auroraSpellId);
          if (spell && p.toggleAurora) p.toggleAurora(spell, false);
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
    // Patch progress/completion increases (all on CombatManager per DTS)
    for (const m of ['increaseDungeonProgress', 'increaseAbyssProgress', 'increaseStrongholdProgress', 'addDungeonCompletion']) {
      if (typeof CombatManager.prototype[m] === 'function') this.ctx.patch(CombatManager, m).after(() => send());
    }
  }

  _sendCombatAreas() {
    const cm = game.combat;
    if (!cm) return;
    const completions = [];
    // Dungeons — stored in cm.dungeonCompletion (Map<Dungeon, number>)
    if (cm.dungeonCompletion) {
      for (const [d, count] of cm.dungeonCompletion) completions.push({ id: d.id, count, kind: 'dungeon' });
    }
    // Abyss depths — AbyssDepth.timesCompleted is a save-state field on each depth
    if (game.abyssDepths) {
      for (const depth of game.abyssDepths.allObjects) {
        if (depth && typeof depth.timesCompleted === 'number') {
          completions.push({ id: depth.id, count: depth.timesCompleted, kind: 'abyssDepth' });
        }
      }
    }
    // Strongholds — Stronghold.timesCompleted is a save-state field on each stronghold
    if (game.strongholds) {
      for (const sh of game.strongholds.allObjects) {
        if (sh && typeof sh.timesCompleted === 'number') {
          completions.push({ id: sh.id, count: sh.timesCompleted, kind: 'stronghold' });
        }
      }
    }
    // Also sync the current stronghold tier and area progress so the peer
    // sees the same combat location state.
    const extra = {};
    if (typeof cm.strongholdTier !== 'undefined') extra.strongholdTier = cm.strongholdTier;
    if (typeof cm.areaProgress === 'number') extra.areaProgress = cm.areaProgress;
    this.transport.send({ t: Msg.COMBAT_AREA, completions, ...extra });
  }

  _applyCombatArea(msg) {
    const cm = game.combat;
    if (!cm || !msg.completions) return;
    this._applyingRemote = true;
    try {
      for (const c of msg.completions) {
        const kind = c.kind || 'dungeon';
        if (kind === 'dungeon') {
          const d = game.dungeons.getObjectByID(c.id);
          if (d && cm.dungeonCompletion) cm.dungeonCompletion.set(d, c.count);
        } else if (kind === 'abyssDepth') {
          const depth = game.abyssDepths && game.abyssDepths.getObjectByID(c.id);
          if (depth) depth.timesCompleted = c.count;
        } else if (kind === 'stronghold') {
          const sh = game.strongholds && game.strongholds.getObjectByID(c.id);
          if (sh) sh.timesCompleted = c.count;
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
    } catch (e) { logger.error('applyCombatArea failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
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
    const data = {
      t: Msg.COMBAT_EVENT_STATE,
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
    this.transport.send(data);
  }

  _applyCombatEventState(msg) {
    const cm = game.combat;
    if (!cm) return;
    this._applyingRemote = true;
    try {
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
    } catch (e) { logger.error('applyCombatEventState failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
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
      // Don't send state if we're spectating — the attacker sends state
      if (sync._combatOwner === 'peer') return;
      const cm = game.combat;
      const enemy = cm.enemy;
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
        paused: cm.paused,
        monsterId: enemy.monster ? enemy.monster.id : null,
        areaId: cm._rmpSelectedArea ? cm._rmpSelectedArea.id : null,
        enemyHp: enemy.hitpoints,
        enemyMaxHp: enemy.stats ? enemy.stats.maxHitpoints : 0,
        enemyBarrier: typeof enemy.barrier === 'number' ? enemy.barrier : 0,
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
    if (typeof CombatManager.prototype.dropEnemyCurrency === 'function') {
      const origDropCurrency = CombatManager.prototype.dropEnemyCurrency;
      CombatManager.prototype.dropEnemyCurrency = function (monster) {
        const gpBefore = game.gp ? game.gp.amount : 0;
        try { origDropCurrency.call(this, monster); } catch (e) { /* skip */ }
        // If we're the attacker, sync currency gained
        if (sync._combatOwner === 'me' && !sync._applyingRemote && sync.transport.isConnected) {
          const gpAfter = game.gp ? game.gp.amount : 0;
          const gpGained = gpAfter - gpBefore;
          if (gpGained > 0) {
            sync.transport.send({ t: Msg.COMBAT_LOOT, itemId: 'melvorD:GP', quantity: gpGained });
          }
        }
      };
    }

    // Patch dropEnemyBones, dropBarrierDust, dropSignetHalfB, dropBirthdayPresent
    // These add items directly to bank (not via CombatLoot), so sync them.
    for (const m of ['dropEnemyBones', 'dropBarrierDust', 'dropSignetHalfB', 'dropBirthdayPresent']) {
      if (typeof CombatManager.prototype[m] === 'function') {
        const orig = CombatManager.prototype[m];
        CombatManager.prototype[m] = function (...args) {
          if (sync._combatOwner === 'peer') return; // skip when spectating
          const bankBefore = new Map();
          try { for (const [item, bi] of game.bank.items) bankBefore.set(item.id, bi.quantity); } catch { /* skip */ }
          try { orig.apply(this, args); } catch (e) { /* skip */ }
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
        };
      }
    }

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
    if (typeof CombatManager.prototype.rewardSlayerTaskCurrency === 'function') {
      const orig = CombatManager.prototype.rewardSlayerTaskCurrency;
      CombatManager.prototype.rewardSlayerTaskCurrency = function (category) {
        if (!category || !category.currencyRewards) return; // skip if invalid
        try { return orig.call(this, category); }
        catch (e) { logger.warn(`rewardSlayerTaskCurrency caught: ${e.message}`); }
      };
    }

    // Also patch rewardForEnemyDeath — when spectating, skip local loot
    // generation entirely. The spectator only gets loot via COMBAT_LOOT
    // sync messages from the attacker. This prevents double items.
    if (typeof CombatManager.prototype.rewardForEnemyDeath === 'function') {
      const orig2 = CombatManager.prototype.rewardForEnemyDeath;
      CombatManager.prototype.rewardForEnemyDeath = function (monster, area) {
        // Skip all local rewards when spectating
        if (sync._combatOwner === 'peer') {
          logger.info(`[COMBAT] Spectator: skipping local rewardForEnemyDeath`);
          return;
        }
        try { return orig2.call(this, monster, area); }
        catch (e) { logger.warn(`rewardForEnemyDeath caught: ${e.message}`); }
      };
    }

    // Patch loadNextEnemy — prevent crash when area/monster not selected
    // AND skip when spectating (attacker handles enemy spawning)
    if (typeof CombatManager.prototype.loadNextEnemy === 'function') {
      const orig3 = CombatManager.prototype.loadNextEnemy;
      CombatManager.prototype.loadNextEnemy = function () {
        if (sync._combatOwner === 'peer') {
          logger.info(`[COMBAT] Spectator: skipping loadNextEnemy`);
          return;
        }
        try { return orig3.call(this); }
        catch (e) { logger.warn(`loadNextEnemy caught: ${e.message}`); }
      };
    }

    // Note: When spectating (_combatOwner === 'peer'), the spectator's combat
    // is NOT started (we don't call selectMonster). The spectator can do other
    // tasks (mining, fishing, etc.) while watching the attacker's combat.
    // The attacker's damage events update the spectator's enemy HP visually.
    // The spectator gets loot via COMBAT_LOOT sync messages, not local drops.

    // Patch pause/unpause — sync combat pause state and release claim on stop
    for (const m of ['pause', 'stop', 'start']) {
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
    this._applyingRemote = true;
    try {
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
        if (msg.amount > 0 && target.splashManager && target.splashManager.add) {
          try {
            target.splashManager.add({
              source: msg.source || 'Attack',
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
      } else if (msg.kind === 'heal') {
        const target = msg.target === 'enemy' ? cm.enemy : cm.player;
        if (!target) return;
        if (msg.hp !== undefined) {
          target.hitpoints = msg.hp;
        } else {
          target.hitpoints = Math.min(target.stats ? target.stats.maxHitpoints : target.hitpoints, target.hitpoints + msg.amount);
        }
        if (msg.amount > 0 && target.splashManager && target.splashManager.add) {
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
            if (cm.loot.renderRequired !== undefined) cm.loot.renderRequired = true;
            if (cm.loot.render) cm.loot.render();
            logger.info(`[COMBAT] Restored ${savedLoot.length} loot items after stop`);
          }
        }
        this._combatOwner = null;
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
    logger.info(`[COMBAT] Peer claimed combat: ${msg.monsterId}, area: ${msg.areaId}`);
    this._combatOwner = 'peer';
    // DON'T call selectMonster — it auto-starts combat and forces the
    // spectator into a fight, preventing them from doing other tasks.
    // Instead, set up the enemy visually WITHOUT starting a fight.
    // The spectator sees the enemy image/HP but their combat doesn't run.
    // The attacker's damage events update the enemy HP visually.
    if (msg.monsterId) {
      this._applyingRemote = true;
      try {
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
      } catch (e) { logger.warn(`[COMBAT] claim set up enemy failed: ${e.message}`); }
      finally { this._applyingRemote = false; }
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
    try {
      // Handle GP (gold coins) — game.gp is a Currency, use .add()
      if (msg.itemId === 'melvorD:GP' && game.gp !== undefined) {
        if (typeof game.gp.add === 'function') game.gp.add(msg.quantity);
        return;
      }
      // Handle Slayer Coins — game.slayerCoins is a Currency, use .add()
      if (msg.itemId === 'melvorD:SlayerCoins' && game.slayerCoins !== undefined) {
        if (typeof game.slayerCoins.add === 'function') game.slayerCoins.add(msg.quantity);
        return;
      }
      // Handle items — add to combat loot so player can collect
      const item = game.items.getObjectByID(msg.itemId);
      if (item && cm.loot) {
        cm.loot.add(item, msg.quantity);
        if (cm.loot.renderRequired !== undefined) cm.loot.renderRequired = true;
        if (cm.loot.render) cm.loot.render();
        logger.info(`[COMBAT] Added loot to container: ${msg.itemId} x${msg.quantity}`);
      } else if (item && game.bank && game.bank.addItem) {
        // Fallback: add directly to bank
        game.bank.addItem(item, msg.quantity, false, true, false, false, 'Co-op Combat');
        logger.info(`[COMBAT] Added loot to bank: ${msg.itemId} x${msg.quantity}`);
      }
    } catch (e) { logger.warn(`[COMBAT] Loot sync failed: ${e.message}`); }
  }

  // ---- Ancient relics sync ----------------------------------------------
  _patchAncientRelics() {
    if (!game.ancientRelics) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
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
      this.transport.send({ t: Msg.ANCIENT_RELIC, relics });
    };
    // Patch addRelic on the prototype (once, not per-instance)
    if (typeof AncientRelicSet !== 'undefined' && typeof AncientRelicSet.prototype.addRelic === 'function') {
      this.ctx.patch(AncientRelicSet, 'addRelic').after(() => send());
    }
  }

  _applyAncientRelic(msg) {
    if (!game.ancientRelics || !msg.relics) return;
    this._applyingRemote = true;
    try {
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
    // Patch SkillTree prototype methods once (not per-tree in a loop)
    if (typeof SkillTree !== 'undefined' && SkillTree.prototype) {
      for (const m of ['unlockNode', 'addPoints']) {
        if (typeof SkillTree.prototype[m] === 'function') {
          this.ctx.patch(SkillTree, m).after(() => send());
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
    for (const m of ['repairAllBuildings', 'repairAllBuildingsInCurrentBiome',
                     'repairAllBuildingsFromStorageType', 'selectWorship', 'updateConvertType']) {
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
    this.transport.send({
      t: Msg.TOWNSHIP,
      biomes,
      resources,
      totalTicks: tw.totalTicks,
      legacyTicks: tw.legacyTicks,
      townData,
      worshipInSelectionId: tw.worshipInSelection ? tw.worshipInSelection.id : null,
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
        if (r) { r._amount = data.amount; r._cap = data.cap; }
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
        if (typeof d.buildingStorage === 'number') td.buildingStorage = d.buildingStorage;
        if (typeof d.worshipCount === 'number') td.worshipCount = d.worshipCount;
        if (typeof d.sectionsPurchased === 'number') td.sectionsPurchased = d.sectionsPurchased;
        if (typeof d.townCreated === 'boolean') td.townCreated = d.townCreated;
        if (typeof d.population === 'number') td.population = d.population;
        if (typeof d.seasonTicksRemaining === 'number') td.seasonTicksRemaining = d.seasonTicksRemaining;
        if (typeof d.health === 'number') td.health = d.health;
        if (typeof d.fortification === 'number') td.fortification = d.fortification;
        if (typeof d.souls === 'number') td.souls = d.souls;
        if (typeof d.soulStorage === 'number') td.soulStorage = d.soulStorage;
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
    for (const m of ['startClueHunt', 'giveReward', 'updateClue1Progress', 'updateClue2Progress', 'updateClue3Progress', 'updateClue4Progress', 'updateClue5Progress', 'updateClue6Progress']) {
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
      // CorruptionEffectTableRow has no .id — send only the effect id.
      if (co.corruptionEffects && co.corruptionEffects.unlockedRows) {
        for (const row of co.corruptionEffects.unlockedRows) {
          rows.push({ effectId: row.effect ? row.effect.id : null });
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
        wave: h.wave, coins: h.raidCoinsEarned, timestamp: h.timestamp,
      }));
      // Live raid loadout: equipment, food, passives, modifiers, state.
      const loadout = {};
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
      // Item selection state (when choosing items during raid)
      const itemSelection = {};
      if (r.itemSelection) {
        for (const [cat, items] of Object.entries(r.itemSelection)) {
          itemSelection[cat] = items ? items.map(it => it ? it.id : null) : [];
        }
      }
      const exclusiveItemSelection = {};
      if (r.exclusiveItemSelection) {
        for (const [cat, items] of Object.entries(r.exclusiveItemSelection)) {
          exclusiveItemSelection[cat] = items ? items.map(it => it ? it.id : null) : [];
        }
      }
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
    for (const m of ['startRaid', 'skipWave', 'changeDifficulty', 'continueRaid', 'equipItemCallback', 'addFoodCallback', 'selectRandomModifier', 'rerollPassiveCallback', 'pause', 'unpause']) {
      if (typeof RaidManager.prototype[m] === 'function') {
        this.ctx.patch(RaidManager, m).after(() => send());
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

  _applyRaid(msg) {
    if (!game.golbinRaid) return;
    this._applyingRemote = true;
    try {
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
          r.randomPlayerModifiers = lo.randomPlayerModifiers.map(m => {
            const modifier = game.modifierRegistry && game.modifierRegistry.getObjectByID(m.id);
            return modifier ? { modifier, value: m.value } : null;
          }).filter(Boolean);
        }
        if (lo.randomEnemyModifiers) {
          r.randomEnemyModifiers = lo.randomEnemyModifiers.map(m => {
            const modifier = game.modifierRegistry && game.modifierRegistry.getObjectByID(m.id);
            return modifier ? { modifier, value: m.value } : null;
          }).filter(Boolean);
        }
        if (r.render) try { r.render(); } catch { /* noop */ }
      }
      // Item selection state (for raid item choosing UI)
      if (msg.itemSelection && r.itemSelection) {
        for (const [cat, ids] of Object.entries(msg.itemSelection)) {
          r.itemSelection[cat] = ids.map(id => id ? game.items.getObjectByID(id) : null).filter(Boolean);
        }
      }
      if (msg.exclusiveItemSelection && r.exclusiveItemSelection) {
        for (const [cat, ids] of Object.entries(msg.exclusiveItemSelection)) {
          r.exclusiveItemSelection[cat] = ids.map(id => id ? game.items.getObjectByID(id) : null).filter(Boolean);
        }
      }
      if (msg.itemCategoryBeingSelected !== undefined) r.itemCategoryBeingSelected = msg.itemCategoryBeingSelected;
      if (typeof msg.isSelectingPositiveModifier === 'boolean') r.isSelectingPositiveModifier = msg.isSelectingPositiveModifier;
      if (msg.randomModifiersBeingSelected) {
        // randomModifiersBeingSelected is ModifierValue[] ({ modifier, value })
        r.randomModifiersBeingSelected = msg.randomModifiersBeingSelected.map(m => {
          const modifier = game.modifierRegistry && game.modifierRegistry.getObjectByID(m.id);
          return modifier ? { modifier, value: m.value } : null;
        }).filter(Boolean);
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
        length: r.length || 0, weight: r.weight || 0,
      }));
      const leaderboard = (fc.contestantLeaderboard || []).map(e => ({
        isPlayer: !!e.isPlayer, name: e.name || '',
        bestResult: e.bestResult ? { length: e.bestResult.length || 0, weight: e.bestResult.weight || 0 } : null,
      }));
      this.transport.send({
        t: Msg.FISHING_CONTEST,
        isActive: fc.isActive,
        // FishingContestFish has no .id — send the underlying item id.
        activeFishId: fc.activeFish ? (fc.activeFish.fish ? fc.activeFish.fish.id : null) : null,
        actionsRemaining: fc.actionsRemaining,
        currentDifficulty: fc.currentDifficulty,
        completionTracker: fc.completionTracker ? [...fc.completionTracker] : [],
        masteryTracker: fc.masteryTracker ? [...fc.masteryTracker] : [],
        results,
        leaderboard,
      });
    };
    for (const m of ['startFishingContest', 'stopFishingContest', 'setFishingContestDifficulty', 'onFishingAction', 'peformPlayerFishingContestAction', 'finalizeFishingContest', 'generateNewFishingContestLeaderboard', 'updateBestFishResultForPlayer', 'updateBestFishResultForContestant']) {
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
          // tw.tasks is TownshipTasks; the task registry is tw.tasks.tasks
          // (NamespaceRegistry<TownshipTask>), not tw.tasks itself.
          const task = tw.tasks.tasks.getObjectByID(tid);
          if (task && !tw.tasks.completedTasks.has(task)) tw.tasks.completedTasks.add(task);
        }
      }
      if (typeof msg.casualTasksCompleted === 'number' && tw.casualTasks) {
        tw.casualTasks.casualTasksCompleted = msg.casualTasksCompleted;
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
    } catch (e) { logger.error('applyTownshipTasks failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Cartography sync -------------------------------------------------
  _patchCartography() {
    const ca = game.cartography;
    if (!ca) return;
    logger.info('[CARTO] _patchCartography: starting');

    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendCartography();
    };

    // Patch survey, discovery, travel, and paper methods
    for (const m of ['discoverPOI', 'selectPaperRecipeOnClick', 'autoSurveyOnClick',
                     'travelOnClick', 'surveyOnClick', 'startAutoSurvey',
                     'startSurveyQueue', 'movePlayer', 'onHexTap',
                     'makePaperOnClick', 'startMakingPaper',
                     'createMapOnClick', 'startMapUpgradeOnClick',
                     'startUpgradingMap', 'selectDigSiteOnClick',
                     'selectDigSiteMapOnClick', 'deleteDigSiteMapOnClick',
                     'selectRefinementOnClick', 'unlockFastTravelOnClick',
                     'goToWorldMapOnClick', 'goToPlayerOnClick']) {
      if (typeof Cartography.prototype[m] === 'function') {
        this.ctx.patch(Cartography, m).after(() => send());
      }
    }

    // Also patch surveyHex and onHexFullSurvey for survey progress.
    // NOTE: 'action' is called every tick during surveying — don't patch
    // it directly as that would send cartography data every tick (huge
    // payload). Instead, throttle via the periodic state sync.
    for (const m of ['surveyHex', 'onHexFullSurvey', 'onHexMastery',
                     'surveyAuto', 'surveyActionQueue']) {
      if (typeof Cartography.prototype[m] === 'function') {
        this.ctx.patch(Cartography, m).after(() => send());
      }
    }
  }

  _sendCartography() {
    const ca = game.cartography;
    if (!ca) return;
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
    this.transport.send({
      t: Msg.CARTOGRAPHY,
      maps,
      activeMapId: ca.activeMap ? ca.activeMap.id : null,
      paperRecipeId: ca.selectedPaperRecipe ? ca.selectedPaperRecipe.id : null,
      selectedMapUpgradeDigsiteId: ca.selectedMapUpgradeDigsite ? ca.selectedMapUpgradeDigsite.id : null,
      // Dig site maps (tier, upgrade actions, charges, refinements)
      digSiteMaps: this._serializeDigSiteMaps(),
    });
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
    this._applyingRemote = true;
    try {
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
                hex._surveyXP = h.surveyXP;
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
          // Do NOT call ca.discoverPOI() — it triggers rewards, UI cascading,
          // and potentially recursive rendering that freezes the game.
          // Just set the fields directly.
          if (mData.pois && wm.pointsOfInterest) {
            for (const p of mData.pois) {
              const poi = wm.pointsOfInterest.getObjectByID(p.poiId);
              if (poi && !poi.isDiscovered) {
                poi.isDiscovered = true;
                if (ca.renderQueue && ca.renderQueue.poiMarkers) {
                  ca.renderQueue.poiMarkers.add(poi);
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
          const digSite = game.archaeology.actions.getObjectByID(dsm.digSiteId);
          if (!digSite || !digSite.maps) continue;
          // Ensure we have the right number of maps; create missing ones.
          while (digSite.maps.length < dsm.maps.length) {
            try { ca.createNewMapForDigSite(digSite); } catch { break; }
          }
          for (let i = 0; i < dsm.maps.length && i < digSite.maps.length; i++) {
            const remote = dsm.maps[i];
            const local = digSite.maps[i];
            if (typeof remote.upgradeActions === 'number') local._upgradeActions = remote.upgradeActions;
            if (typeof remote.charges === 'number') local.charges = remote.charges;
            // Recompute tier from upgrade actions
            if (typeof local.computeTier === 'function') {
              try { local.computeTier(); } catch { /* noop */ }
            }
            // Refinements — replace if remote has more
            // refinements is ModifierValue[] ({ modifier, value }), not { id, value }
            if (remote.refinements && remote.refinements.length > (local.refinements || []).length) {
              local.refinements = remote.refinements.map(r => {
                const modifier = game.modifierRegistry && game.modifierRegistry.getObjectByID(r.id);
                return modifier ? { modifier, value: r.value } : null;
              }).filter(Boolean);
            }
            // Artefact values — take max per size to preserve best drops
            if (remote.artefactValues && local.artefactValues) {
              for (const sz of ['tiny', 'small', 'medium', 'large']) {
                if (typeof remote.artefactValues[sz] === 'number') {
                  local.artefactValues[sz] = Math.max(local.artefactValues[sz] || 0, remote.artefactValues[sz]);
                }
              }
            }
          }
        }
      }

      // Don't call ca.render() — it's extremely expensive for cartography
      // (re-renders the entire hex map) and can freeze the game. The render
      // queue entries we set above will be processed by the game's normal
      // render loop on the next tick.
    } catch (e) { logger.error('applyCartography failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
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
    const namedTrackerKeys = [
      'Woodcutting', 'Fishing', 'Firemaking', 'Cooking', 'Mining', 'Smithing',
      'Attack', 'Strength', 'Defence', 'Hitpoints', 'Thieving', 'Farming',
      'Ranged', 'Fletching', 'Crafting', 'Runecrafting', 'Magic', 'Prayer',
      'Slayer', 'Herblore', 'Agility', 'Summoning', 'Astrology', 'Township',
      'Archaeology', 'Cartography', 'Corruption', 'Harvesting',
      'General', 'Combat', 'GolbinRaid', 'Shop',
    ];
    for (const key of namedTrackerKeys) {
      if (game.stats[key]) trackerNames.set(game.stats[key], key);
    }
    // MappedStatTrackers (Items, Monsters) — track separately
    const mappedTrackerKeys = ['Items', 'Monsters'];
    for (const key of mappedTrackerKeys) {
      if (game.stats[key]) trackerNames.set(game.stats[key], key);
    }

    const serializeAll = () => {
      const data = {};
      // Named StatTrackers
      for (const key of namedTrackerKeys) {
        const tracker = game.stats[key];
        if (!tracker || !tracker.stats) continue;
        const entries = {};
        for (const [statId, val] of tracker.stats) entries[statId] = val;
        data[key] = entries;
      }
      // MappedStatTrackers (Items, Monsters) — keyed by object ID
      for (const key of mappedTrackerKeys) {
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
    };

    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this.transport.send({ t: Msg.STATS, stats: serializeAll() });
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

  _applyStats(msg) {
    if (!game.stats || !msg.stats) return;
    this._applyingRemote = true;
    try {
      const namedTrackerKeys = [
        'Woodcutting', 'Fishing', 'Firemaking', 'Cooking', 'Mining', 'Smithing',
        'Attack', 'Strength', 'Defence', 'Hitpoints', 'Thieving', 'Farming',
        'Ranged', 'Fletching', 'Crafting', 'Runecrafting', 'Magic', 'Prayer',
        'Slayer', 'Herblore', 'Agility', 'Summoning', 'Astrology', 'Township',
        'Archaeology', 'Cartography', 'Corruption', 'Harvesting',
        'General', 'Combat', 'GolbinRaid', 'Shop',
      ];
      for (const key of namedTrackerKeys) {
        const tracker = game.stats[key];
        const remoteData = msg.stats[key];
        if (!tracker || !tracker.stats || !remoteData) continue;
        for (const [statId, val] of Object.entries(remoteData)) {
          const numKey = Number(statId);
          const k = isNaN(numKey) ? statId : numKey;
          // Use Math.max to avoid overwriting higher stat values with stale lower ones
          const current = tracker.stats.get(k) || 0;
          tracker.stats.set(k, Math.max(current, val));
        }
      }
      // MappedStatTrackers (Items, Monsters)
      for (const key of ['Items', 'Monsters']) {
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
          for (const [statId, val] of Object.entries(entries)) {
            const numKey = Number(statId);
            const k = isNaN(numKey) ? statId : numKey;
            const current = tracker.stats.get(k) || 0;
            tracker.stats.set(k, Math.max(current, val));
          }
        }
      }
      if (game.stats.renderMutatedStats) try { game.stats.renderMutatedStats(); } catch { /* noop */ }
    } catch (e) { logger.error('applyStats failed', e); }
    finally { this._applyingRemote = false; }
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
      if (typeof Game.prototype[m] === 'function') {
        this.ctx.patch(Game, m).after(() => send());
      }
    }
  }

  _sendLevelCaps() {
    const data = {
      t: Msg.LEVEL_CAP,
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
    this.transport.send(data);
  }

  _applyLevelCaps(msg) {
    this._applyingRemote = true;
    try {
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
    } catch (e) { logger.error('applyLevelCaps failed', e); }
    finally { this._applyingRemote = false; this._scheduleSave(); }
  }

  // ---- Game state sync (tickTimestamp, merchantsPermitRead, pause) ------
  _patchGameState() {
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendGameState();
    };
    // Pause/unpause — Game has pauseActiveSkill/unpauseActiveSkill (not pause/unpause)
    if (typeof Game.prototype.pauseActiveSkill === 'function') this.ctx.patch(Game, 'pauseActiveSkill').after(() => send());
    if (typeof Game.prototype.unpauseActiveSkill === 'function') this.ctx.patch(Game, 'unpauseActiveSkill').after(() => send());
    // merchantsPermitRead is a direct boolean property — no setter method to patch.
    // It's synced via snapshot only (one-time flag, rarely changes).
    // Periodic tickTimestamp sync (so offline progress baseline matches)
    // — send every 60s via the action tick loop instead of patching internal tick.
  }

  _sendGameState() {
    this.transport.send({
      t: Msg.GAME_STATE,
      tickTimestamp: game.tickTimestamp,
      merchantsPermitRead: game.merchantsPermitRead,
      isPaused: game._isPaused,
      visibleCompletion: game.completion ? game.completion.visibleCompletion : undefined,
    });
  }

  _applyGameState(msg) {
    this._applyingRemote = true;
    try {
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
    } catch (e) { logger.error('applyGameState failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Lore books read sync ---------------------------------------------
  _patchLore() {
    if (!game.lore) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      this._sendLore();
    };
    if (typeof Lore.prototype.readLore === 'function') this.ctx.patch(Lore, 'readLore').after(() => send());
    if (typeof Lore.prototype.updateLoreBookUnlocks === 'function') this.ctx.patch(Lore, 'updateLoreBookUnlocks').after(() => send());
  }

  _sendLore() {
    const lore = game.lore;
    if (!lore) return;
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
    this.transport.send({ t: Msg.LORE, read });
  }

  _applyLore(msg) {
    if (!game.lore || !msg.read) return;
    this._applyingRemote = true;
    try {
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
    } catch (e) { logger.error('applyLore failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Realm selection sync ----------------------------------------------
  _patchRealmSelection() {
    if (typeof game.selectRealm !== 'function') return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      if (!game.currentRealm) return;
      this.transport.send({ t: Msg.REALM, realmId: game.currentRealm.id });
    };
    this.ctx.patch(Game, 'selectRealm').after(() => send());
  }

  _applyRealmSelection(msg) {
    if (!msg.realmId || !game.realms) return;
    this._applyingRemote = true;
    try {
      const realm = game.realms.getObjectByID(msg.realmId);
      if (realm && game.currentRealm !== realm && typeof game.selectRealm === 'function') {
        game.selectRealm(realm);
      }
    } catch (e) { logger.error('applyRealmSelection failed', e); }
    finally { this._applyingRemote = false; }
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
      const cats = [];
      try {
        const task = game.combat.slayerTask;
        if (task.categories) for (const cat of task.categories.allObjects) {
          cats.push({ catId: cat.id, tasksCompleted: cat.tasksCompleted || 0 });
        }
      } catch { /* noop */ }
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

  _applySlayerCategories(msg) {
    if (!msg.cats || !game.combat || !game.combat.slayerTask) return;
    this._applyingRemote = true;
    try {
      const task = game.combat.slayerTask;
      if (!task.categories) return;
      for (const c of msg.cats) {
        const cat = task.categories.getObjectByID(c.catId);
        if (cat && typeof c.tasksCompleted === 'number') {
          cat.tasksCompleted = Math.max(cat.tasksCompleted || 0, c.tasksCompleted);
        }
      }
    } catch (e) { logger.error('applySlayerCategories failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Cooking stockpile sync --------------------------------------------
  _patchCookingStockpile() {
    if (!game.cooking || !game.cooking.stockpileItems) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const stockpiles = [];
      try {
        for (const [cat, iq] of game.cooking.stockpileItems) {
          stockpiles.push({ catId: cat.id, itemId: iq.item ? iq.item.id : null, qty: iq.quantity || 0 });
        }
      } catch { /* noop */ }
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

  _applyCookingStockpile(msg) {
    if (!msg.stockpiles || !game.cooking || !game.cooking.stockpileItems) return;
    this._applyingRemote = true;
    try {
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
    } catch (e) { logger.error('applyCookingStockpile failed', e); }
    finally { this._applyingRemote = false; }
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
    this._applyingRemote = true;
    try {
      // numEquipSets is a getter computed from shop modifiers, not a
      // settable property. Call updateEquipmentSets() to recompute from
      // the (already synced) shop upgrade count.
      const current = game.combat.player.numEquipSets || 0;
      if (msg.count > current && typeof game.combat.player.updateEquipmentSets === 'function') {
        try { game.combat.player.updateEquipmentSets(); } catch { /* skip */ }
      }
    } catch (e) { logger.error('applyEquipSetCount failed', e); }
    finally { this._applyingRemote = false; }
  }

  // ---- Game settings sync (gameplay-affecting only) ----------------------
  _patchGameSettings() {
    if (!game.settings) return;
    const send = () => {
      if (this._applyingRemote || !this.transport.isConnected) return;
      const s = game.settings;
      this.transport.send({
        t: Msg.SETTINGS,
        settings: {
          continueIfBankFull: s.continueIfBankFull,
          continueThievingOnStun: s.continueThievingOnStun,
          autoRestartDungeon: s.autoRestartDungeon,
          enableAutoSlayer: s.enableAutoSlayer,
          enableAutoEquipFood: s.enableAutoEquipFood,
          enableAutoSwapFood: s.enableAutoSwapFood,
          enablePerfectCooking: s.enablePerfectCooking,
          enablePermaCorruption: s.enablePermaCorruption,
          enableOfflineCombat: s.enableOfflineCombat,
        },
      });
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

  _applyGameSettings(msg) {
    if (!msg.settings || !game.settings) return;
    this._applyingRemote = true;
    try {
      const s = game.settings;
      const m = msg.settings;
      // Settings are getter-only properties on the Settings class.
      // Use setTogglesChecked() to actually change them (it sets the
      // internal backing field and updates the UI checkbox).
      const boolKeys = [
        'continueIfBankFull', 'continueThievingOnStun', 'autoRestartDungeon',
        'enableAutoSlayer', 'enableAutoEquipFood', 'enableAutoSwapFood',
        'enablePerfectCooking', 'enablePermaCorruption', 'enableOfflineCombat',
      ];
      for (const key of boolKeys) {
        if (typeof m[key] === 'boolean') {
          try { s.setTogglesChecked(key, m[key]); } catch { /* skip */ }
        }
      }
    } catch (e) { logger.error('applyGameSettings failed', e); }
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
  }

  _startProgressBroadcaster() {
    // Every 500ms, if we have an active action, broadcast the timer progress
    // so the other player's panel progress bar moves in sync.
    this._progressTimer = setInterval(() => {
      if (!this.transport.isConnected || this._applyingRemote) return;
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
      if (!this.transport.isConnected || this._applyingRemote) return;
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
      for (let i = 0; i < game.combat.player.equipmentSets.length; i++) {
        const set = game.combat.player.equipmentSets[i];
        const slots = {};
        for (const [slotId, eqItem] of Object.entries(set.equipment.equippedItems)) {
          slots[slotId] = { itemId: eqItem.item.id, qty: eqItem.quantity };
        }
        // Per-set spell selection (attack/curse/aurora) and prayer selection
        const spellSel = set.spellSelection || {};
        const prayerSel = set.prayerSelection;
        slots.__spellSelection = {
          attackId: spellSel.attack ? spellSel.attack.id : null,
          curseId: spellSel.curse ? spellSel.curse.id : null,
          auroraId: spellSel.aurora ? spellSel.aurora.id : null,
        };
        slots.__prayerSelection = prayerSel ? [...prayerSel].map(ap => ap.id) : [];
        equipSets.push(slots);
      }
      // Player combat state
      playerState.selectedSet = game.combat.player.selectedEquipmentSet;
      playerState.prayerPoints = game.combat.player.prayerPoints;
      playerState.soulPoints = game.combat.player.soulPoints;
      playerState.prayers = [];
      if (game.combat.player.activePrayers) for (const ap of game.combat.player.activePrayers) playerState.prayers.push(ap.id);
      playerState.food = [];
      if (game.combat.player.food && game.combat.player.food.slots) {
        for (let i = 0; i < game.combat.player.food.slots.length; i++) {
          const s = game.combat.player.food.slots[i];
          playerState.food.push({ slot: i, itemId: s.item ? s.item.id : null, qty: s.quantity });
        }
        playerState.selectedFoodSlot = game.combat.player.food.selectedSlot;
      }
      // attackStyles is { melee?, ranged?, magic? } of AttackStyle
      playerState.attackStyles = [];
      const as = game.combat.player.attackStyles;
      if (as) {
        for (const at of ['melee', 'ranged', 'magic']) {
          const style = as[at];
          playerState.attackStyles.push({ attackType: at, styleId: style ? style.id : null });
        }
      }
      playerState.attackSpellId = (game.combat.player.spellSelection && game.combat.player.spellSelection.attack) ? game.combat.player.spellSelection.attack.id : null;
      playerState.curseSpellId = (game.combat.player.spellSelection && game.combat.player.spellSelection.curse) ? game.combat.player.spellSelection.curse.id : null;
      playerState.auroraSpellId = (game.combat.player.spellSelection && game.combat.player.spellSelection.aurora) ? game.combat.player.spellSelection.aurora.id : null;
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
    // Harvesting veins (intensity)
    let harvestingVeins = null;
    if (game.harvesting) {
      harvestingVeins = [];
      for (const vein of game.harvesting.actions.allObjects) {
        if (vein && typeof vein.currentIntensity === 'number') {
          harvestingVeins.push({ id: vein.id, intensity: vein.currentIntensity, max: vein.maxIntensity });
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
        enemyBarrier: typeof game.combat.enemy.barrier === 'number' ? game.combat.enemy.barrier : 0,
        playerHp: game.combat.player ? game.combat.player.hitpoints : 0,
        playerMaxHp: game.combat.player && game.combat.player.stats ? game.combat.player.stats.maxHitpoints : 0,
        paused: game.combat.paused,
      };
    }
    // Combat Event system state (Into the Mist, Spider Lair, etc.)
    let combatEventState = null;
    if (game.combat) {
      const cm = game.combat;
      combatEventState = {
        activeEventId: cm.activeEvent ? cm.activeEvent.id : null,
        eventProgress: cm.eventProgress,
        eventDungeonLength: cm.eventDungeonLength,
        eventPassives: (cm.eventPassives || []).map(p => p.id),
        availableEventPassives: (cm.availableEventPassives || []).map(p => p.id),
        eventPassivesBeingSelected: (cm.eventPassivesBeingSelected ? [...cm.eventPassivesBeingSelected] : []).map(p => p.id),
        shouldResetEvent: cm.shouldResetEvent,
        activeEventAreas: [],
        strongholdTier: cm.strongholdTier,
        areaProgress: cm.areaProgress,
      };
      if (cm.activeEventAreas) {
        for (const [area, count] of cm.activeEventAreas) {
          if (area && area.id) combatEventState.activeEventAreas.push({ areaId: area.id, count });
        }
      }
    }
    // Active potions
    const potions = [];
    if (game.potions && game.potions.activePotions) {
      game.potions.activePotions.forEach((active, action) => {
        potions.push({ actionId: action.id, itemId: active.item.id, charges: active.charges });
      });
    }

    const snapshot = { t: Msg.STATE_SNAPSHOT, skills, bank, currencies, equipSets, playerState, pets, charges, shopUpgrades, tutorial, rockHP, harvestingVeins, farming: farmingPlots, combat: combatState, combatEventState, potions };

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

    // Agility courses
    if (game.agility) {
      const ag = game.agility;
      const agilityData = [];
      for (const [realm, course] of ag.courses) {
        const obstacles = {};
        for (const [tier, ob] of course.builtObstacles) obstacles[tier] = ob ? ob.id : null;
        const pillars = {};
        for (const [tier, pi] of course.builtPillars) pillars[tier] = pi ? pi.id : null;
        agilityData.push({ realmId: realm.id, obstacles, pillars });
      }
      snapshot.agility = { courses: agilityData, activeObstacle: ag.currentlyActiveObstacle };
    }

    // Astrology upgrades
    if (game.astrology) {
      const as = game.astrology;
      const astrologyUpgrades = [];
      try {
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
                  astrologyUpgrades.push({ recipeId: recipe.id, tier: i, timesBought: m.timesBought, type: tName });
                }
              }
            }
          }
        }
      } catch { /* noop */ }
      snapshot.astrology = {
        upgrades: astrologyUpgrades,
        studiedId: as.studiedConstellation ? as.studiedConstellation.id : null,
        exploredId: as.exploredConstellation ? as.exploredConstellation.id : null,
      };
    }

    // Summoning (marks + selected non-shard costs)
    if (game.summoning) {
      const su = game.summoning;
      const summoningData = { marks: [], costs: [] };
      try {
        if (su.marksUnlocked) {
          for (const [recipe, count] of su.marksUnlocked) {
            if (recipe && recipe.id) summoningData.marks.push({ recipeId: recipe.id, count });
          }
        }
        if (su.selectedNonShardCosts) {
          for (const [recipe, item] of su.selectedNonShardCosts) {
            if (recipe && recipe.id) summoningData.costs.push({ recipeId: recipe.id, itemId: item ? item.id : null });
          }
        }
      } catch { /* noop */ }
      snapshot.summoning = summoningData;
    }

    // Slayer task + unlocks
    if (game.slayer) {
      const sl = game.slayer;
      const slayerData = {};
      try {
        if (game.combat && game.combat.slayerTask) {
          const t = game.combat.slayerTask;
          slayerData.active = !!t.active;
          slayerData.monsterId = t.monster ? t.monster.id : null;
          slayerData.killsLeft = t.killsLeft || 0;
          slayerData.extended = !!t.extended;
          if (t.realm) slayerData.realmId = t.realm.id;
          if (t.category) slayerData.categoryId = t.category.id;
        }
      } catch { /* noop */ }
      snapshot.slayer = slayerData;
    }

    // Township
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

    // Cartography — use the same format as _sendCartography
    if (game.cartography) {
      try {
        const ca = game.cartography;
        const maps = [];
        if (ca.worldMaps) {
          for (const wm of ca.worldMaps.allObjects) {
            const mapData = {
              id: wm.id, hexes: [], pois: [],
              playerPos: null,
              fullySurveyedHexes: wm.fullySurveyedHexes || 0,
              masteredHexes: wm.masteredHexes || 0,
            };
            if (wm.hexes) for (const [q, qMap] of wm.hexes) {
              for (const [r, hex] of qMap) {
                if (hex._surveyLevel > 0 || hex._surveyXP > 0) {
                  mapData.hexes.push({ q, r, surveyLevel: hex._surveyLevel, surveyXP: hex._surveyXP });
                }
              }
            }
            if (wm.pointsOfInterest) for (const poi of wm.pointsOfInterest.allObjects) {
              if (poi.isDiscovered) {
                const poiData = { poiId: poi.id };
                if (poi.fastTravel && typeof poi.fastTravel.isUnlocked === 'boolean') {
                  poiData.fastTravelUnlocked = poi.fastTravel.isUnlocked;
                }
                mapData.pois.push(poiData);
              }
            }
            if (wm._playerPosition) mapData.playerPos = { q: wm._playerPosition.q, r: wm._playerPosition.r };
            maps.push(mapData);
          }
        }
        snapshot.cartography = {
          maps,
          activeMapId: ca.activeMap ? ca.activeMap.id : null,
          paperRecipeId: ca.selectedPaperRecipe ? ca.selectedPaperRecipe.id : null,
          selectedMapUpgradeDigsiteId: ca.selectedMapUpgradeDigsite ? ca.selectedMapUpgradeDigsite.id : null,
          digSiteMaps: this._serializeDigSiteMaps(),
        };
      } catch { /* noop */ }
    }

    // Archaeology (dig sites, tools, museum donations, museum rewards)
    if (game.archaeology) {
      const ar = game.archaeology;
      const archData = {};
      try {
        archData.digSites = [];
        if (ar.actions) for (const ds of ar.actions.allObjects) {
          archData.digSites.push({
            id: ds.id,
            mapIndex: ds.selectedMapIndex,
            tools: (ds.selectedTools || []).map(t => t ? t.id : null),
          });
        }
        archData.donatedItems = [];
        if (ar.museum && ar.museum.donatedItems) for (const item of ar.museum.donatedItems) archData.donatedItems.push(item.id);
        archData.museumRewards = [];
        if (ar.museum && ar.museum.rewards) for (const rw of ar.museum.rewards.allObjects) {
          if (rw.awarded) archData.museumRewards.push(rw.id);
        }
      } catch { /* noop */ }
      snapshot.archaeology = archData;
    }

    // Clue hunt
    if (game.clueHunt) {
      const ch = game.clueHunt;
      const clueData = { steps: [], currentStep: 0 };
      try {
        if (ch.clueProgress) clueData.steps = ch.clueProgress.map(s => ({
          id: s.id, progress: s.progress, required: s.required, complete: s.complete,
        }));
        if (typeof ch.currentStep === 'number') clueData.currentStep = ch.currentStep;
      } catch { /* noop */ }
      snapshot.clueHunt = clueData;
    }

    // Corruption (abyssal)
    if (game.corruption) {
      const co = game.corruption;
      const corruptionData = { rows: [] };
      try {
        // CorruptionEffectTableRow has no .id property — the id is on
        // row.effect (a CombatEffect extending NamespacedObject).
        if (co.corruptionEffects && co.corruptionEffects.unlockedRows) {
          for (const row of co.corruptionEffects.unlockedRows) {
            corruptionData.rows.push({ effectId: row.effect ? row.effect.id : null });
          }
        }
      } catch { /* noop */ }
      snapshot.corruption = corruptionData;
    }

    // Raids (golbin raid)
    if (game.golbinRaid) {
      const r = game.golbinRaid;
      const raidData = {};
      try {
        if (typeof r.wave === 'number') raidData.wave = r.wave;
        if (typeof r.waveProgress === 'number') raidData.waveProgress = r.waveProgress;
        if (r.selectedDifficulty) raidData.selectedDifficulty = (typeof r.selectedDifficulty === 'number') ? r.selectedDifficulty : r.selectedDifficulty.id;
        if (r.history) raidData.history = r.history.slice(-20).map(h => ({
          wave: h.wave, coins: h.raidCoinsEarned, timestamp: h.timestamp,
        })); // last 20 entries, primitive fields only
        // Live raid loadout
        const loadout = {};
        if (r.player) {
          const p = r.player;
          loadout.equipment = {};
          if (p.equipment && p.equipment.equippedItems) {
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
        raidData.loadout = loadout;
      } catch { /* noop */ }
      snapshot.raid = raidData;
    }

    // Fishing contest
    if (game.fishing && game.fishing.contest) {
      const fc = game.fishing.contest;
      const fishData = {};
      try {
        fishData.isActive = !!fc.isActive;
        // FishingContestFish has no .id — it has { fish, level, minLength,
        // maxLength }. Send the underlying item id so the receiver can find
        // the matching FishingContestFish in fc.availableFish.
        fishData.activeFishId = fc.activeFish ? (fc.activeFish.fish ? fc.activeFish.fish.id : null) : null;
        if (typeof fc.actionsRemaining === 'number') fishData.actionsRemaining = fc.actionsRemaining;
        if (typeof fc.currentDifficulty === 'number') fishData.currentDifficulty = fc.currentDifficulty;
        if (fc.completionTracker) fishData.completionTracker = [...fc.completionTracker];
        if (fc.masteryTracker) fishData.masteryTracker = [...fc.masteryTracker];
        if (fc.playerResults) fishData.results = fc.playerResults.map(r => ({
          length: r.length || 0, weight: r.weight || 0,
        }));
        if (fc.contestantLeaderboard) fishData.leaderboard = fc.contestantLeaderboard.map(e => ({
          isPlayer: !!e.isPlayer, name: e.name || '',
          bestResult: e.bestResult ? { length: e.bestResult.length || 0, weight: e.bestResult.weight || 0 } : null,
        }));
      } catch { /* noop */ }
      snapshot.fishContest = fishData;
    }

    // Game stats — serialize all StatTrackers on the Statistics object
    if (game.stats) {
      const statsData = {};
      try {
        const namedKeys = [
          'Woodcutting', 'Fishing', 'Firemaking', 'Cooking', 'Mining', 'Smithing',
          'Attack', 'Strength', 'Defence', 'Hitpoints', 'Thieving', 'Farming',
          'Ranged', 'Fletching', 'Crafting', 'Runecrafting', 'Magic', 'Prayer',
          'Slayer', 'Herblore', 'Agility', 'Summoning', 'Astrology', 'Township',
          'Archaeology', 'Cartography', 'Corruption', 'Harvesting',
          'General', 'Combat', 'GolbinRaid', 'Shop',
        ];
        for (const key of namedKeys) {
          const tracker = game.stats[key];
          if (!tracker || !tracker.stats) continue;
          const entries = {};
          for (const [statId, val] of tracker.stats) entries[statId] = val;
          statsData[key] = entries;
        }
        // MappedStatTrackers
        for (const key of ['Items', 'Monsters']) {
          const mst = game.stats[key];
          if (!mst || !mst.statsMap) continue;
          const mapped = {};
          for (const [obj, tracker] of mst.statsMap) {
            if (!tracker || !tracker.stats) continue;
            const entries = {};
            for (const [statId, val] of tracker.stats) entries[statId] = val;
            if (obj && obj.id) mapped[obj.id] = entries;
          }
          statsData[key] = mapped;
        }
      } catch { /* noop */ }
      snapshot.stats = statsData;
    }

    // Skill level cap increases
    snapshot.levelCaps = {
      levelCapIncreasesBought: game._levelCapIncreasesBought,
      abyssalLevelCapIncreasesBought: game._abyssalLevelCapIncreasesBought,
      active: (game.activeLevelCapIncreases || []).map(c => ({ id: c.id })),
      beingSelected: (game.levelCapIncreasesBeingSelected || []).map(c => c.id),
    };

    // Game state (tickTimestamp, merchantsPermitRead, pause, visibleCompletion)
    snapshot.gameState = {
      tickTimestamp: game.tickTimestamp,
      merchantsPermitRead: game.merchantsPermitRead,
      isPaused: game._isPaused,
      visibleCompletion: game.completion ? game.completion.visibleCompletion : undefined,
    };

    // Lore books read
    if (game.lore && game.lore.books) {
      const read = [];
      for (const book of game.lore.books.allObjects) {
        let isRead = !!(book._read || book.isRead);
        if (!isRead && game.lore.bookButtons) {
          const btn = game.lore.bookButtons.get(book);
          if (btn && btn.readButton && btn.readButton.disabled) isRead = true;
        }
        if (isRead) read.push(book.id);
      }
      snapshot.lore = { read };
    }

    // Ancient relics (which relics have been found per set)
    if (game.ancientRelics) {
      const relics = [];
      try {
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
      } catch { /* noop */ }
      snapshot.ancientRelics = relics;
    }

    // Skill trees (unlocked nodes + points per tree)
    const skillTrees = [];
    try {
      for (const skill of game.skills.allObjects) {
        if (skill.skillTrees) {
          for (const tree of skill.skillTrees.allObjects) {
            const nodes = [];
            if (tree.unlockedNodes) for (const n of tree.unlockedNodes) nodes.push(n.id);
            skillTrees.push({ skillId: skill.id, treeId: tree.id, points: tree._points, nodes });
          }
        }
      }
    } catch { /* noop */ }
    if (skillTrees.length > 0) snapshot.skillTrees = skillTrees;

    // Skill selections (cooking, woodcutting, firemaking, fishing, thieving, alt magic, fletching, artisan recipes, harvesting, archaeology)
    const skillSelects = {};
    try {
      // Cooking
      if (game.cooking && game.cooking.selectedRecipes) {
        const recipes = [];
        for (const [cat, r] of game.cooking.selectedRecipes) {
          recipes.push({ catId: cat.id, recipeId: r ? r.id : null });
        }
        skillSelects.cooking = { recipes };
      }
      // Woodcutting: active trees NOT synced (per-player UI choice).
      // Firemaking
      if (game.firemaking) {
        skillSelects.firemaking = {
          recipeId: game.firemaking.selectedRecipe ? game.firemaking.selectedRecipe.id : null,
          oilId: game.firemaking.selectedOil ? game.firemaking.selectedOil.id : null,
          bonfireId: game.firemaking.litBonfireRecipe ? game.firemaking.litBonfireRecipe.id : null,
        };
      }
      // Fishing
      if (game.fishing && game.fishing.selectedAreaFish) {
        const sel = [];
        for (const [area, f] of game.fishing.selectedAreaFish) {
          sel.push({ areaId: area.id, fishId: f ? f.id : null });
        }
        skillSelects.fishing = { areaFish: sel };
      }
      // Thieving
      if (game.thieving) {
        skillSelects.thieving = {
          areaId: game.thieving.currentArea ? game.thieving.currentArea.id : null,
          npcId: game.thieving.currentNPC ? game.thieving.currentNPC.id : null,
        };
      }
      // Alt Magic
      if (game.altMagic) {
        skillSelects.altMagic = {
          spellId: game.altMagic.selectedSpell ? game.altMagic.selectedSpell.id : null,
          smithingRecipeId: game.altMagic.selectedSmithingRecipe ? game.altMagic.selectedSmithingRecipe.id : null,
          conversionItemId: game.altMagic.selectedConversionItem ? game.altMagic.selectedConversionItem.id : null,
        };
      }
      // Fletching
      if (game.fletching && game.fletching.setAltRecipes) {
        const alts = [];
        for (const [recipe, idx] of game.fletching.setAltRecipes) {
          alts.push({ recipeId: recipe.id, altIndex: idx });
        }
        skillSelects.fletching = { altRecipes: alts };
      }
      // Artisan skills (Herblore, Smithing, Crafting, Runecrafting, Fletching)
      for (const skillName of ['herblore', 'smithing', 'crafting', 'runecrafting', 'fletching']) {
        const sk = game[skillName];
        if (!sk || !sk.selectedRecipeInRealm) continue;
        const recipes = [];
        for (const [realm, recipe] of sk.selectedRecipeInRealm) {
          recipes.push({ realmId: realm.id, recipeId: recipe ? recipe.id : null });
        }
        skillSelects[skillName] = { artisanRecipes: recipes, selectedRecipeId: sk.selectedRecipe ? sk.selectedRecipe.id : null };
      }
      // Harvesting
      if (game.harvesting) {
        const veins = [];
        for (const v of game.harvesting.actions.allObjects) {
          if (typeof v.currentIntensity === 'number') veins.push({ id: v.id, intensity: v.currentIntensity, max: v.maxIntensity });
        }
        skillSelects.harvesting = {
          veinId: game.harvesting.selectedVein ? game.harvesting.selectedVein.id : null,
          veins,
        };
      }
      // Archaeology
      if (game.archaeology) {
        const ar = game.archaeology;
        const digSites = [];
        if (ar.actions) for (const ds of ar.actions.allObjects) {
          digSites.push({ id: ds.id, mapIndex: ds.selectedMapIndex, tools: (ds.selectedTools || []).map(t => t ? t.id : null) });
        }
        const donated = [];
        if (ar.museum && ar.museum.donatedItems) for (const item of ar.museum.donatedItems) donated.push(item.id);
        const museumRewards = [];
        if (ar.museum && ar.museum.rewards) for (const rw of ar.museum.rewards.allObjects) {
          if (rw.awarded) museumRewards.push(rw.id);
        }
        skillSelects.archaeology = { digSites, donatedItems: donated, museumRewards };
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
      const stockpiles = [];
      try {
        for (const [cat, iq] of game.cooking.stockpileItems) {
          stockpiles.push({ catId: cat.id, itemId: iq.item ? iq.item.id : null, qty: iq.quantity || 0 });
        }
      } catch { /* noop */ }
      snapshot.cookingStockpiles = stockpiles;
    }

    // Slayer task category completions
    if (game.combat && game.combat.slayerTask && game.combat.slayerTask.categories) {
      const slayerCats = [];
      try {
        for (const cat of game.combat.slayerTask.categories.allObjects) {
          slayerCats.push({ catId: cat.id, tasksCompleted: cat.tasksCompleted || 0 });
        }
      } catch { /* noop */ }
      snapshot.slayerCategories = slayerCats;
    }

    // Game settings (gameplay-affecting only)
    if (game.settings) {
      const s = game.settings;
      snapshot.settings = {
        continueIfBankFull: s.continueIfBankFull,
        continueThievingOnStun: s.continueThievingOnStun,
        autoRestartDungeon: s.autoRestartDungeon,
        enableAutoSlayer: s.enableAutoSlayer,
        enableAutoEquipFood: s.enableAutoEquipFood,
        enableAutoSwapFood: s.enableAutoSwapFood,
        enablePerfectCooking: s.enablePerfectCooking,
        enablePermaCorruption: s.enablePermaCorruption,
        enableOfflineCombat: s.enableOfflineCombat,
      };
    }

    logger.info(`[SNAPSHOT] Built: ${skills.length} skills, ${bank.length} bank items, ${currencies.length} currencies, ${equipSets.length} equip sets, ${pets.length} pets, ${charges.length} charges, ${rockHP?.length || 0} rocks, ${farmingPlots?.length || 0} farming plots, ${mastery.length} mastery skills, combat: ${combatState ? 'yes' : 'no'}`);
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
        for (let i = 0; i < msg.equipSets.length; i++) {
          const remoteSlots = msg.equipSets[i];
          const eqSet = game.combat.player.equipmentSets[i];
          if (!eqSet) continue;
          const eq = eqSet.equipment;
          // Remove local items not present remotely (skip internal keys)
          for (const [slotId, eqItem] of Object.entries(eq.equippedItems)) {
            if (remoteSlots[slotId] === undefined) {
              const slot = game.equipmentSlots.getObjectByID(slotId);
              if (slot) {
                try { eq.unequipItem(slot); } catch (e) { /* skip */ }
              }
            }
          }
          // Equip remote items (skip internal __ keys)
          for (const [slotId, remote] of Object.entries(remoteSlots)) {
            if (slotId === '__spellSelection' || slotId === '__prayerSelection') continue;
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
              try { game.bank.addItem(item, remote.qty, false, true, true, false); } catch (e) { /* skip */ }
            }
            try { eq.equipItem(item, slot, remote.qty); } catch (e) { /* skip */ }
          }
          // Per-set spell selection
          if (remoteSlots.__spellSelection && eqSet.spellSelection) {
            const ss = remoteSlots.__spellSelection;
            try {
              if (ss.attackId) {
                const sp = game.attackSpells.getObjectByID(ss.attackId);
                if (sp && game.combat.player.selectAttackSpell) game.combat.player.selectAttackSpell(sp, false);
              }
              if (ss.curseId) {
                const sp = game.curseSpells && game.curseSpells.getObjectByID(ss.curseId);
                if (sp && game.combat.player.toggleCurse) game.combat.player.toggleCurse(sp, false);
              }
              if (ss.auroraId) {
                const sp = game.auroraSpells && game.auroraSpells.getObjectByID(ss.auroraId);
                if (sp && game.combat.player.toggleAurora) game.combat.player.toggleAurora(sp, false);
              }
            } catch { /* skip */ }
          }
          // Per-set prayer selection
          if (remoteSlots.__prayerSelection && eqSet.prayerSelection) {
            try {
              eqSet.prayerSelection.clear();
              for (const pid of remoteSlots.__prayerSelection) {
                const pr = game.prayers && game.prayers.getObjectByID(pid);
                if (pr) eqSet.prayerSelection.add(pr);
              }
            } catch { /* skip */ }
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
          if (typeof v.max === 'number') vein.maxIntensity = v.max;
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
              am.xp = a.xp;
              am.level = exp.xpToLevel(a.xp);
            }
          }
          for (const p of (ms.pools || [])) {
            const realm = game.realms.getObjectByID(p.realmId);
            if (realm && skill._masteryPoolXP) {
              skill._masteryPoolXP.set(realm, p.xp);
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
        const ar = game.archaeology;
        const ad = msg.archaeology;
        try {
          if (ad.digSites && ar.actions) for (const ds of ad.digSites) {
            const digSite = ar.actions.getObjectByID(ds.id);
            if (!digSite) continue;
            if (typeof ds.mapIndex === 'number') digSite.selectedMapIndex = ds.mapIndex;
            // ArchaeologyTool extends NamespacedObject, not Item — use ar.tools
            if (ds.tools) digSite.selectedTools = ds.tools.map(tid => tid ? ar.tools.getObjectByID(tid) : null).filter(Boolean);
          }
          if (ad.donatedItems && ar.museum && ar.museum.donatedItems) {
            for (const itemId of ad.donatedItems) {
              const item = game.items.getObjectByID(itemId);
              if (!item) continue;
              ar.museum.donatedItems.add(item);
              // Mark as found so museum shows picture (see _applySkillSelect)
              try {
                if (game.stats && game.stats.itemFindCount(item) === 0) {
                  game.bank.addItem(item, 1, false, true, true, false);
                  game.bank.removeItemQuantity(item, 1, false);
                }
              } catch { /* noop */ }
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
          if (ss.cooking && game.cooking && canSync('cooking')) {
            for (const r of ss.cooking.recipes || []) {
              const cat = game.cooking.categories.getObjectByID(r.catId);
              if (!cat) continue;
              const recipe = r.recipeId ? game.cooking.actions.getObjectByID(r.recipeId) : null;
              if (recipe) game.cooking.selectedRecipes.set(cat, recipe);
            }
          }
          // Woodcutting: active trees NOT synced (per-player UI choice).
          if (ss.firemaking && game.firemaking && canSync('firemaking')) {
            if (ss.firemaking.recipeId) game.firemaking.selectedRecipe = game.firemaking.actions.getObjectByID(ss.firemaking.recipeId);
            if (ss.firemaking.oilId) game.firemaking.selectedOil = game.items.getObjectByID(ss.firemaking.oilId);
            if (ss.firemaking.bonfireId) game.firemaking.litBonfireRecipe = game.firemaking.actions.getObjectByID(ss.firemaking.bonfireId);
          }
          if (ss.fishing && game.fishing && canSync('fishing')) {
            for (const af of ss.fishing.areaFish || []) {
              // Fishing areas are in game.fishing.areas, not .actions
              const area = game.fishing.areas && game.fishing.areas.getObjectByID(af.areaId);
              if (!area) continue;
              const f = af.fishId ? game.fishing.actions.getObjectByID(af.fishId) : null;
              if (f) game.fishing.selectedAreaFish.set(area, f);
            }
          }
          if (ss.thieving && game.thieving && canSync('thieving')) {
            // Thieving areas are in game.thieving.areas, not .actions
            if (ss.thieving.areaId) game.thieving.currentArea = game.thieving.areas && game.thieving.areas.getObjectByID(ss.thieving.areaId);
            if (ss.thieving.npcId) game.thieving.currentNPC = game.thieving.actions.getObjectByID(ss.thieving.npcId);
          }
          if (ss.altMagic && game.altMagic && canSync('altMagic')) {
            if (ss.altMagic.spellId) game.altMagic.selectedSpell = game.altMagic.actions.getObjectByID(ss.altMagic.spellId);
            if (ss.altMagic.smithingRecipeId) game.altMagic.selectedSmithingRecipe = game.smithing.actions.getObjectByID(ss.altMagic.smithingRecipeId);
            if (ss.altMagic.conversionItemId) game.altMagic.selectedConversionItem = game.items.getObjectByID(ss.altMagic.conversionItemId);
          }
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
            for (const ar of data.artisanRecipes || []) {
              const realm = game.realms.getObjectByID(ar.realmId);
              if (!realm) continue;
              const recipe = ar.recipeId ? sk.actions.getObjectByID(ar.recipeId) : null;
              if (recipe) sk.selectedRecipeInRealm.set(realm, recipe);
            }
            if (data.selectedRecipeId) sk.selectedRecipe = sk.actions.getObjectByID(data.selectedRecipeId);
          }
          // Harvesting
          if (ss.harvesting && game.harvesting && canSync('harvesting')) {
            if (ss.harvesting.veinId) game.harvesting.selectedVein = game.harvesting.actions.getObjectByID(ss.harvesting.veinId);
            for (const v of ss.harvesting.veins || []) {
              const vein = game.harvesting.actions.getObjectByID(v.id);
              if (vein) { vein.currentIntensity = v.intensity; vein.maxIntensity = v.max; }
            }
          }
          // Archaeology
          if (ss.archaeology && game.archaeology) {
            const ar = game.archaeology;
            for (const ds of ss.archaeology.digSites || []) {
              const digSite = ar.actions.getObjectByID(ds.id);
              if (!digSite) continue;
              if (typeof ds.mapIndex === 'number') digSite.selectedMapIndex = ds.mapIndex;
              // ArchaeologyTool extends NamespacedObject, not Item — use ar.tools
              if (ds.tools) digSite.selectedTools = ds.tools.map(tid => tid ? ar.tools.getObjectByID(tid) : null).filter(Boolean);
            }
            if (ar.museum && ar.museum.donatedItems) {
              for (const itemId of ss.archaeology.donatedItems || []) {
                const item = game.items.getObjectByID(itemId);
                if (!item) continue;
                ar.museum.donatedItems.add(item);
                // Mark as found so museum shows picture (see _applySkillSelect)
                try {
                  if (game.stats && game.stats.itemFindCount(item) === 0) {
                    game.bank.addItem(item, 1, false, true, true, false);
                    game.bank.removeItemQuantity(item, 1, false);
                  }
                } catch { /* noop */ }
              }
              if (ar.museum.renderQueue) {
                ar.museum.renderQueue.donationProgress = true;
                ar.museum.renderQueue.allArtefacts = true;
              }
            }
            if (ar.museum && ar.museum.rewards) {
              for (const rwId of ss.archaeology.museumRewards || []) {
                const rw = ar.museum.rewards.getObjectByID(rwId);
                if (rw) rw.awarded = true;
              }
            }
            // NOTE: Do NOT call museum.render() — it freezes the game from
            // sync handlers. The donatedItems set is updated; the game will
            // render the museum naturally when the tab is opened.
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
          const s = game.settings;
          // Settings are getter-only; use setTogglesChecked to change them.
          const boolKeys = [
            'continueIfBankFull', 'continueThievingOnStun', 'autoRestartDungeon',
            'enableAutoSlayer', 'enableAutoEquipFood', 'enableAutoSwapFood',
            'enablePerfectCooking', 'enablePermaCorruption', 'enableOfflineCombat',
          ];
          for (const key of boolKeys) {
            if (typeof msg.settings[key] === 'boolean') {
              try { s.setTogglesChecked(key, msg.settings[key]); } catch { /* skip */ }
            }
          }
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

      // 3. Currencies are set LAST (after all spending operations like
      // agility buildObstacle/buildPillar) to prevent going negative.
      // See step 23b at the end.

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
      [Msg.ASTROLOGY_SELECT]: (m) => this._applyAstrologySelect(m),
      [Msg.SUMMONING]: (m) => this._applySummoning(m),
      [Msg.SLAYER]: (m) => this._applySlayer(m),
      [Msg.SKILL_SELECT]: (m) => this._applySkillSelect(m),
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
      [Msg.REALM]: (m) => this._applyRealmSelection(m),
      [Msg.SLAYER_CAT]: (m) => this._applySlayerCategories(m),
      [Msg.COOKING_STOCKPILE]: (m) => this._applyCookingStockpile(m),
      [Msg.EQUIP_SET_COUNT]: (m) => this._applyEquipSetCount(m),
      [Msg.SETTINGS]: (m) => this._applyGameSettings(m),
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
        const recipesEl = $('remoteRecipes');
        if (!bar || !fill) return;
        if (remote) {
          bar.hidden = false;
          fill.style.width = (remote.progress * 100).toFixed(1) + '%';
          // Apply skill-specific color class
          fill.className = 'rmp-fake-bar-fill ' + this._skillColorClass(remote.skillId, 'remote');
          // Show recipe chips (e.g. tree names for woodcutting)
          if (recipesEl) {
            const recipes = remote.recipes || [];
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
      });
    }

    // Listen for local action progress updates.
    if (this.sync && this.sync.onLocalAction) {
      this.sync.onLocalAction((local) => {
        const $ = (s) => this.$(s);
        const bar = $('localProgressBar');
        const fill = $('localProgressFill');
        const recipesEl = $('localRecipes');
        if (!bar || !fill) return;
        if (local) {
          bar.hidden = false;
          fill.style.width = (local.progress * 100).toFixed(1) + '%';
          fill.className = 'rmp-fake-bar-fill ' + this._skillColorClass(local.skillId, 'local');
          if (recipesEl) {
            const recipes = local.recipes || [];
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
      });
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
