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

## Architecture of this mod
"Shared save, parallel actions, absolute-value delta sync."
- Each client runs only its own action; broadcasts absolute new values of any
  state change; peer writes values into internal fields (bypassing modifiers) and
  re-renders. Re-entrancy guarded by `sync._applyingRemote`.
- Networking: PeerJS (CDN-injected UMD) -> `Transport` (host/join/send/events).
- `ActionLock` tracks who trains what; advisory conflict warning in the UI.
- `Panel` is an imperative floating DOM panel (top-right).

## Verifying changes
- No build. Syntax-check with node: `node --check src/setup.mjs` (per file).
- Optional typecheck: `npm install && npx tsc --noEmit` (uses melvor-idle-mod-dts).
- Real testing requires loading the mod in Melvor Idle via the Creator Toolkit
  (Directory Link mode on Steam). Back up saves before testing.

## Conventions
- Plain `.mjs`, ES modules, no bundler.
- All DOM/CSS class names prefixed `rmp-`.
- Logger via `src/util/logger.mjs` (tagged `[realMP]`).
- Wire message types centralised in `src/net/protocol.mjs` (`Msg`).
