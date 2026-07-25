# Melvor Idle: realMultiplayer

A seamless **co-op multiplayer** mod for [Melvor Idle](https://melvoridle.com).
Two players share **one profile/save** and each train different things at the
same time. Whatever one player earns (XP, mastery, bank items, currencies,
equipment, pets, shop upgrades, farming plots, agility courses, and much more)
is mirrored onto the other player's game in real time over a direct
peer-to-peer connection.

> **Status:** experimental. There is no official multiplayer in Melvor Idle and
> the game engine assumes a single active action per client. This mod works
> around that by having each client run only its own action and synchronising
> the *results*. Back up your save before using it.

## How it works

1. Both players load the **same save** (one exports it, the other imports it
   through the game's normal save manager).
2. One player clicks **Host** and shares the generated code.
3. The other player enters the code and clicks **Connect**.
4. Each player trains a different skill (e.g. one woodcuts, the other mines).
5. The mod patches dozens of game methods (`Skill.addXP`,
   `SkillWithMastery.addMasteryXP`, `Bank.addItem` / `removeItemQuantity`,
   `Currency.add/remove/set`, `Player.equipItem`, `Farming.plantPlot`,
   `Agility.buildObstacle`, `Shop.buyItemOnClick`, and many more) to broadcast
   the **absolute new value** of any state change to the peer.
6. The peer writes that value straight into the game's internal fields and
   re-renders, bypassing the modifier pipeline so progress is never counted
   twice. Both clients converge on identical state.

A "current action" watcher reports which skill each player is training and
warns in the UI when both pick the same skill (since that would duplicate
effort rather than parallelise it). When both players *do* gather the same
resource, a **co-op boost** kicks in and halves the action interval (2x speed)
for both clients.

### What gets synced

Nearly every game system is synchronised in real time:

| System | Coverage |
|--------|----------|
| **Skills (XP & levels)** | Normal and abyssal XP for all skills |
| **Mastery** | Per-action mastery XP and mastery pool per realm |
| **Bank** | Item quantities (add/remove/sell) |
| **Currencies** | GP, Slayer Coins, Abyssal Pieces, and all modded currencies |
| **Equipment** | All equipment sets, slots, quantities, spell/prayer selections |
| **Food** | Equipped food slots and selected slot |
| **Prayers / Curses / Auroras** | Active prayers, prayer/soul points |
| **Attack styles & spells** | Melee/ranged/magic styles, attack/curse/aurora selection |
| **Pets** | Pet unlocks |
| **Item charges** | Charged item counts |
| **Potions** | Active potions per action |
| **Shop / Upgrades** | Purchased upgrade counts |
| **Tutorial** | Stage progress, task progress, claims, completion |
| **Mining** | Rock HP (available ore) |
| **Farming** | Plot unlocks, planted seeds, compost, growth state |
| **Agility** | Built obstacles/pillars, blueprints, build counts |
| **Astrology** | Modifier upgrades (timesBought), constellation selection |
| **Summoning** | Mark discoveries, non-shard cost selections |
| **Slayer** | Active task, monster, kills left, category completions |
| **Skill selections** | Cooking, Woodcutting, Firemaking, Fishing, Thieving, Alt Magic, Fletching, Herblore, Smithing, Crafting, Runecrafting, Harvesting, Archaeology |
| **Combat events** | Active event, progress, passives, event areas |
| **Combat** | Monster selection, damage events, HP, loot drops |
| **Ancient relics** | Relic unlocks per skill |
| **Skill trees** | Node unlocks |
| **Township** | Buildings, resources, town data, worship, seasons |
| **Township tasks** | Completed tasks, casual task progress |
| **Clue hunt** | Step progress |
| **Corruption** | Corruption row unlocks |
| **Raids** | Raid state, modifiers, equipment |
| **Fishing contest** | Active fish, results, leaderboard, trackers |
| **Cartography** | Hex survey levels, POI discoveries, fast travel, dig site maps, paper recipes |
| **Stats** | All stat trackers (per-skill, general, combat, items, monsters) |
| **Level caps** | Purchased caps, active increases, selections |
| **Game state** | Pause, tick timestamp, merchant's permit |
| **Lore** | Book read status |
| **Realm selection** | Current realm |
| **Cooking stockpiles** | Passive cooking stockpile items |
| **Equipment set count** | Number of equipment sets |
| **Game settings** | Gameplay-affecting boolean settings |

When a peer first connects, the host sends a **full state snapshot** covering
all of the above so both clients start from the same baseline.

### Networking

Connectivity uses [PeerJS](https://peerjs.com) (loaded from a CDN at runtime),
which provides a free public signalling broker for WebRTC. No server of your
own is required. The connection is direct between the two players once
established.

## Installation

### Option A — Directory Link (Steam, recommended for dev)

1. Place this folder somewhere stable.
2. In Melvor Idle, open the **Creator Toolkit** (enable it in settings first).
3. Choose **Directory Link** mode and point it at this folder.
4. Reload the game. The mod appears in your mod list.

### Option B — Modfile / mod.io

1. Zip the **contents** of this folder (so `manifest.json` is at the zip root).
2. In the Creator Toolkit, add the zip as a local mod, or upload it to mod.io.

> The mod has no build step. The `.mjs` files are loaded directly by the game.

## Usage

1. Load a character.
2. Open the **Multiplayer** panel (top-right of the screen).
3. Enter your name.
4. **Player A:** click **Host**, then send the displayed code to Player B.
5. **Player B:** click **Join**, paste the code, click **Connect**.
6. (Optional) Click **Copy current save to clipboard** and have the other
   player import it so you start from the same profile.
7. Each player picks a different skill and starts training. Watch the other
   player's progress appear in the panel and on your skills/bank.

## Project layout

```
melvor_idle_realMultiplayer/
├── manifest.json          # mod manifest (namespace, entry point, css)
├── package.json           # dev-only: type definitions for IDE support
├── tsconfig.json          # dev-only: JS typecheck config
├── .modignore             # files excluded when the toolkit zips the mod
├── assets/
│   └── icon.svg
└── src/
    ├── setup.mjs          # entry point: all patch/apply logic (~7700 lines)
    ├── util/
    │   └── logger.mjs     # tagged console logger
    ├── net/
    │   ├── transport.mjs  # PeerJS wrapper (host/join, send, events)
    │   └── protocol.mjs   # wire message types + (de)serialisation
    ├── state/
    │   ├── actionLock.mjs # who-is-training-what reservation
    │   └── sync.mjs       # core sync class (patches, broadcast, apply)
    └── ui/
        ├── panel.mjs      # floating connection/status panel
        └── styles.css
```

## Dev / type checking (optional)

The mod itself needs no build. For IDE type support against the game's API:

```bash
npm install        # pulls melvor-idle-mod-dts from GitHub
npx tsc --noEmit   # typecheck the .mjs files
```

Syntax-check without installing anything:

```bash
node --check src/setup.mjs
```

## Known limitations & caveats

- **Combat is partially synced.** Monster selection, damage events, HP, and
  loot drops are mirrored between clients. However, combat involves a single
  `CombatManager` per client — both players see the fight progress, but the
  live animation/splash rendering is best-effort. One player should be the
  designated "attacker" while the other spectates.
- **Random drops** are resolved on the acting client and broadcast as bank
  deltas, so both clients end up with the same items. But seed-based
  deterministic events that read local RNG state won't match — only the
  *results* are synced.
- **Save ownership:** each client still owns its own local save. Periodically
  one player should export and the other re-import to stay aligned, or just
  rely on the live delta sync. The mod does not write to your save file
  directly beyond what the game itself persists.
- **PeerJS broker availability** depends on the public PeerJS cloud. For
  guaranteed uptime you can self-host a broker and pass its config to the
  `new Peer(...)` call in `src/net/transport.mjs`.
- **No anti-cheat.** This is a co-op tool for trusted friends, not a
  competitive multiplayer layer.

## Public API (for other mods)

Other mods can talk to this one via `mod.api.realMultiplayer`:

```js
const mp = mod.api.realMultiplayer;
mp.transport;     // Transport instance
mp.actionLock;    // ActionLock instance
mp.sync;          // Sync instance
mp.teardown();    // full teardown
```

There is also a `window.realMP` shorthand for the dev console.

## License

MIT — see repository metadata. Not affiliated with Games by Malcs Ltd.
Melvor Idle is their property; this is a community mod.
