# Melvor Idle: realMultiplayer

A seamless **co-op multiplayer** mod for [Melvor Idle](https://melvoridle.com).
Two players share **one profile/save** and each train different things at the
same time. Whatever one player earns (XP, mastery, bank items, currencies) is
mirrored onto the other player's game in real time over a direct peer-to-peer
connection.

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
5. The mod patches `Skill.addXP`, `Skill.addAbyssalXP`, `SkillWithMastery.addMasteryXP`,
   `Bank.addItem` / `Bank.removeItemQuantity`, and `Currency.add/remove/set` to
   broadcast the **absolute new value** of any state change to the peer.
6. The peer writes that value straight into the game's internal fields and
   re-renders, bypassing the modifier pipeline so progress is never counted
   twice. Both clients converge on identical state.

A "current action" watcher reports which skill each player is training and
warns in the UI when both pick the same skill (since that would duplicate
effort rather than parallelise it).

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
    ├── setup.mjs          # entry point; wires everything together
    ├── util/
    │   └── logger.mjs
    ├── net/
    │   ├── transport.mjs  # PeerJS wrapper (host/join, send, events)
    │   └── protocol.mjs   # wire message types + (de)serialisation
    ├── state/
    │   ├── actionLock.mjs # who-is-training-what reservation
    │   └── sync.mjs       # patches + broadcast/apply of XP/mastery/bank/currency
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

## Known limitations & caveats

- **Combat is shared state.** Combat involves equipment, food, prayer, and a
  single `CombatManager`. Syncing combat fully is out of scope; both players
  should avoid combat during a session, or treat combat results as
  best-effort (XP/bank still sync, but the live fight isn't mirrored).
- **Random drops** are resolved on the acting client and broadcast as bank
  deltas, so both clients end up with the same items. Good. But seed-based
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
