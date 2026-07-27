# AGENTS.md — project notes for AI agents working on this repo

## What this is
A Melvor Idle mod (`manifest.json` based, JS modules) that adds seamless 2-player
co-op over a shared save. No build step — `.mjs` files are loaded directly by the game.

## Key Melvor modding facts (learned from the wiki + official dts)
- Entry point: `manifest.json` -> `setup` -> exported `setup(ctx)` function.
- `ctx` (ModContext) provides: `patch(Class, 'method')` -> `.before/.after/.replace`,
  lifecycle hooks (`onCharacterLoaded`, `onInterfaceReady`, `onModsLoaded`, ...),
  `characterStorage`/`accountStorage`, `settings`, `loadModule/loadScript/loadStylesheet`.
- Game globals available in mod code: `game` (Game), `Skill`, `SkillWithMastery`,
  `Bank`, `Currency`, `exp`, `abyssalExp`, `mod`.
- `game.skills` / `game.items` / `game.currencies` / `game.realms` are
  `NamespaceRegistry` with `.getObjectByID('ns:LocalID')`, `.allObjects`.
- Single active action: `game.activeAction` (an `ActiveAction` with `.isActive`,
  `.activeTick()`, `.stop()`). Each skill that implements `ActiveAction` (e.g.
  `GatheringSkill`) has its own `isActive` and `actionTimer`.
- XP: `Skill.addXP(amount, action?)`, `addAbyssalXP`. Internal fields `_xp`, `_level`,
  `_abyssalXP`, `_abyssalLevel`. Level from XP: `exp.xpToLevel(xp)` / `abyssalExp.xpToLevel`.
- Mastery: `SkillWithMastery.addMasteryXP(action, xp)`, `addMasteryForAction(action, interval)`.
  Per-action mastery in `skill.actionMastery.get(action)` = `{ xp, level }`.
  Pool in `skill._masteryPoolXP` (a `SparseNumericMap<Realm>`: `.get/.set/.forEach`).
- Bank: `game.bank.addItem(item, qty, logLost, found, ignoreSpace?, notify?, source?)`,
  `removeItemQuantity(item, qty, removeCharges)`, `getQty(item)`. `bank.items` is
  `Map<AnyItem, BankItem>` where `BankItem.quantity`.
- Currency: `Currency.add/remove/set`, internal `_amount`, `.render()`.

### Verified against the actual v1.3.1 game source (144 modules)
- **`ctx.patch(...).after` hooks are called `(returnValue, ...args)`** (game's
  loader, mod.js). Always declare the leading `_ret` param in callbacks —
  omitting it silently shifts every argument one position left.
- `Game.selectRealm` performs the switch ~1s later via setTimeout behind a
  modal — read the target realm from the method ARGUMENT, not `game.currentRealm`.
- `Settings.setTogglesChecked` only updates DOM checkboxes; real state is
  `settings.boolData[key].currentValue` (+ optional onChange/saveOnChange).
- `Skill(WithMastery).addMasteryPoolXP(realm, xp)` is called directly by
  mastery-token claims and pool spending — patch it, not just addMasteryForAction.
- `CombatManager.pause()/start()` do not exist (pause = `pauseDungeon()` +
  `paused` field). `ClueHunt.updateClueNProgress` are constructor arrow instance
  props, unpatchable via prototype; the system is inert outside the 2023 event.
- `game.tickTimestamp` is rewritten by the game loop every frame — syncing it
  is dead weight. `equipmentSwapPurchased` is legacy-save-only (vestigial).
- Mastery-token claims: `Bank.claimMasteryTokenOnClick` → `addMasteryPoolXP`.
  Token stats derive from the Items tracker (TimesClaimed) via
  `game.computeTokenItemStats(true)`.

## Architecture of this mod
"Shared save, parallel actions, absolute-value delta sync."
- Each client runs only its own action; broadcasts absolute new values of any
  state change; peer writes values into internal fields (bypassing modifiers) and
  re-renders. Re-entrancy guarded by `sync._applyingRemote`.
- Networking: WebSocket relay -> `Transport` (connect/send/events). Both clients
  connect to the same relay URL; the relay pairs the first two waiting clients
  (first = host) and shuttles messages. Works through any firewall that allows HTTPS.
- `ActionLock` tracks who trains what; advisory conflict warning in the UI.
- `Panel` is an imperative floating DOM panel (top-right).
- **Join handshake (smart rejoin):** the peer never plays solo — the host is
  always the authority. On 'open' both sides send `JOIN_INFO {key, tick, v}`;
  the key is derived from the save's OWN fields (`characterName` +
  AccountCreationDate stat) — NOT `characterStorage`: the game keys mod
  storage by numeric mod id, directory-linked dev mods get id -1, and the
  save encoder/decoder (Uint32 round-trip) silently drops it on load, so
  storage-stamped UUIDs never survived a reload (root cause of the
  foreign-key blackout). Save-intrinsic fields travel with the save,
  including to the peer on handoff. Host decides: key mismatch -> push save (foreign
  character, the reload path); `|tick drift| <= JOIN_SLACK_MS` -> nothing
  (instant connect); drift > slack -> absolute join snapshot
  (`join`/`absoluteBank` — bank set EXACTLY, phantoms removed; a peer that
  never plays solo can only hold stale excess); drift < -slack (relay role
  flip after a double reconnect) -> pull via `STATE_REQUEST {join:true}`.
  Transport close carries a reason (`manual`/`peer_left`/`socket`); the panel
  auto-reconnects only on `socket` with [2s, 5s, 15s] backoff — the relay
  keeps a leaver's slot reserved, so roles never change on reconnect.
  **Identity gate:** once JOIN_INFO is exchanged, game-state messages to/from
  a key-mismatched peer are dropped in BOTH directions (`_gateWire` inside
  `Transport.send` and `Sync.handle`) — a foreign character can never mutate
  our state (a fresh peer's absolute 0-GP broadcast once deleted the host's
  Save handoff: the host pushes its ENTIRE save on every pairing, no
  similarity checks (`send_save` on 'open', relay-host only); the peer
  applies it at most once per game launch, reconnects ignore it and
  reconcile. Accept path: `blockCorruptSaving = true` FIRST (otherwise the
  discarded character's autosave fires in the import->reload window and
  clobbers the just-written host save — the peer boots their old character
  and the save 'never arrived'), then `importSaveToSlot` on the CURRENT
  slot, reload in 250ms, auto-boot via `loadLocalSave` (500/1500/3000ms
  retries) from `rmp_autoconnect`, auto-reconnect. In-place decoding via
  `game.decode` was tried and abandoned (one-time boot code throws on
  re-run). `skipLeaveUnequip` guards the import reload.
  arrives (empty/mismatched key = foreign, all blocked); permissive only
  before any handshake (legacy peer). `_initCharKey` retries lazily —
  characterStorage throws before onCharacterLoaded. `MOD_VERSION` rides
  JOIN_INFO — bump it on every protocol/join-behavior change; mismatches and
  missing handshakes (5s) raise a red panel warning.
- **Equipment is PER-PLAYER (never synced).** The shared bank is the single item
  pool: equip -> `Bank.removeItemQuantity` (synced), unequip -> `Bank.addItem`
  (synced), so the pool stays consistent with no equipment messages at all.
  Invariant: an item is either in the shared bank OR in exactly one player's
  gear. Leave (Disconnect button or `pagehide`) = `_unequipAllToBank()` +
  `transport._flushOutbox()` (the 16 ms send batch dies with the page otherwise)
  + sets `localStorage.rmp_clean_leave` (ONLY when paired, so the returns
  actually reached the pool). Join (any role): the clean-leave flag triggers
  `_clearLocalEquipment()` — gear the stale local save still shows equipped is
  stripped WITHOUT bank return, else the snapshot's additive bank heal dupes it
  (equipped AND in bank). The same strip runs after a host-save load (the host
  still holds the save's equipped gear). No flag (crash / offline leave) = gear
  kept — truthful ownership. Snapshots never touch gear or
  `selectedEquipmentSet`. Tablet/ammo consumption
  (`Equipment.removeQuantityFromSlot`) is local-only by design — that's what
  makes summoning tablets deplete correctly for both players.

### Single-file layout (src/setup.mjs, ~7.5k lines)
The mod is ONE module on purpose — the loader cannot resolve static imports
between mod files. Sections, in order: logger -> protocol (`Msg`) -> `Transport`
-> `ActionLock` -> `Sync` (~90% of the file) -> `Panel` -> `setup(ctx)`.

`Sync` conventions every per-system module follows:
- `_patchX()` installs ctx.patch hooks; guarded send closures broadcast.
- `_serializeX()` returns the exact wire payload WITHOUT the `t` field, reads
  via `game.X` paths only, never try/catch-noop inside. Live senders and
  `_buildSnapshot()` both compose these — one source of truth per wire shape.
- `_applyX(msg)` runs inside `_applyRemote(label, fn, { save, level })` which
  holds the re-entrancy guard, logs `${label} failed`, and schedules a save
  (some systems pass `save:false` — never change a site's save flag).
- Shared scaffolding: `_canSend()`/`_send(payload)`, `_afterEach(Cls, names, cb)`.
- Guard-neutral apply helpers (`_applyArchaeologyBulk`,
  per-skill `_apply<Skill>Selection`) NEVER touch `_applyingRemote`/`_scheduleSave`
  — `_applySnapshot` calls them with a data-dependent guard state that is
  load-bearing (some unguarded spans intentionally echo). Do not 'fix' the
  guard dance; do not route snapshot blocks through the wrapped `_applyX`.

### Adding a newly synced system (checklist)
1. Add the message type to `Msg` (protocol section).
2. Write `_serializeX()` (payload sans `t`) + `_patchX()`; register in `install()`'s table.
3. Write `_applyX(msg)`; register in `_buildHandlers()`.
4. Add snapshot coverage: `_buildSnapshot()` composes `_serializeX()`;
   `_applySnapshot` applies it (delegate or guard-neutral helper — see above).
5. Verify: `node --check src/setup.mjs`, then in-game via Creator Toolkit.

## Verifying changes
- No build. Syntax-check with node: `node --check src/setup.mjs` (per file).
- Optional typecheck: `npm install && npx tsc --noEmit` (uses melvor-idle-mod-dts).
- Real testing requires loading the mod in Melvor Idle via the Creator Toolkit
  (Directory Link mode on Steam). Back up saves before testing.

## Conventions
- Plain `.mjs`, ES modules, no bundler. Everything runtime lives in `src/setup.mjs`.
- All DOM/CSS class names prefixed `rmp-`.
- Logger is inlined at the top of `setup.mjs` (tagged `[realMP]`, ring buffer +
  `exportLog()`, persisted to localStorage every 5s).
- Wire message types centralised in `Msg` (protocol section of `setup.mjs`).
  Relay-server control messages (`waiting`/`paired`/`peer_left`) are raw strings
  owned by the server — do NOT move them into `Msg`.

## Git revert workflow
- **Commit after every successful change** — each commit is a known-good revert point.
- If a change breaks something, use `git log --oneline` to find the last working commit.
- Revert a specific commit: `git revert <hash>` (creates a new commit undoing the change).
- Hard reset to a known-good state: `git reset --hard <hash>` (discards all changes after that point).
- Always push after committing: `git push origin main`.
- Commit messages should describe WHAT system was changed (e.g. "Fix equipment sync rendering").
- Never force-push unless explicitly asked.
