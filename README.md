# Melvor Idle: realMultiplayer

A seamless **co-op multiplayer** mod for [Melvor Idle](https://melvoridle.com).
Two players share **one profile/save** and each train different things at the
same time. Whatever one player earns (XP, mastery, bank items, currencies,
pets, shop upgrades, farming plots, agility courses, and much more)
is mirrored onto the other player's game in real time over a WebSocket relay
connection. **Equipment is the one exception** — it is per-player (see
[Inventory & equipment](#inventory--equipment)).

> **Repo:** <https://github.com/venuss1/melvor-idle-real-multiplayer>

> **Status:** experimental. There is no official multiplayer in Melvor Idle and
> the game engine assumes a single active action per client. This mod works
> around that by having each client run only its own action and synchronising
> the *results*. Back up your save before using it.

---

## How it works

1. Both players open the panel, enter the **same relay server URL** (the
   default works) and their own name, then click **Connect**. The relay pairs
   the first two waiting clients; the first to connect becomes the **host**.
2. On the **first join after a game launch**, the peer asks for the host's
   full save and loads it **in place** — the save is decoded straight into
   the running game (`SaveWriter` → `game.decode` → `onSaveDataLoad`),
   exactly what the game's own loader does after the interface is up. No
   page reload, no trip back to the menu.
3. **Reconnects within the same session never re-copy**: the join handshake
   reconciles drift with an absolute state snapshot instead — instant, no
   dialogs. Dropped connections auto-reconnect with backoff.
4. Either side can request a **full state snapshot** (every skill, bank item,
   currency, pet, plot, obstacle, etc.) so both clients
   converge.
5. Each player trains a different skill (e.g. one woodcuts, the other mines).
6. The mod patches dozens of game methods (`Skill.addXP`,
   `SkillWithMastery.addMasteryXP`, `Bank.addItem` / `removeItemQuantity`,
   `Currency.add/remove/set`, `Farming.plantPlot`,
   `Agility.buildObstacle`, `Shop.buyItemOnClick`, and many more) to broadcast
   the **absolute new value** of any state change to the peer.
8. The peer writes that value straight into the game's internal fields and
   re-renders, bypassing the modifier pipeline so progress is never counted
   twice. Both clients converge on identical state.
---

## What gets synced

Nearly every game system is synchronised in real time:

### Skills & progression

| System | Coverage |
|--------|----------|
| **Skills (XP & levels)** | Normal and abyssal XP for all skills, with level cap handling |
| **Mastery** | Per-action mastery XP and mastery pool per realm |
| **Level caps** | Purchased caps, active increases, per-skill selections |
| **Stats** | All stat trackers (per-skill, general, combat, items, monsters) — throttled to 3s |
| **Skill trees** | Node unlocks and points per tree |
| **Ancient relics** | Relic unlocks per skill per realm |

### Skill selections & actions

| System | Coverage |
|--------|----------|
| **Skill selections** | Cooking, Woodcutting, Firemaking, Fishing, Thieving, Alt Magic, Fletching, Herblore, Smithing, Crafting, Runecrafting, Harvesting, Archaeology |
| **Mining** | Rock HP / ore depletion (skips locally-mined rock) |
| **Fishing** | **Secret area unlock** (message in a bottle) — live + snapshot |
| **Farming** | Plot unlocks, planted seeds, compost, growth state, harvest, dead plot clearing, abyssal farming levels, selected recipes |
| **Agility** | Built obstacles/pillars, blueprints, build counts, active obstacle (crash-proofed) |
| **Astrology** | Modifier upgrades (standard/unique/abyssal), studied/explored constellation selection |
| **Summoning** | Mark discoveries, non-shard cost selections |
| **Slayer** | Active task, monster, kills left, extended flag, realm, category completions |
| **Cartography** | Hex survey levels, POI discoveries, fast travel, player position, dig site maps (tier, upgrade actions, charges, refinements, artefact values), paper recipe, map upgrade digsite selection |
| **Archaeology museum** | Dig site selection, tools, **auto-donation sync** (when one player donates an artifact, the peer receives it automatically — bank removal, rewards, UI update) |
| **Cooking stockpiles** | Per-category stockpile items and quantities |
| **Harvesting** | Selected vein, vein intensity (throttled to 2s) |

### Inventory & equipment

| System | Coverage |
|--------|----------|
| **Bank** | Item quantities (add/remove/sell), corrupted entry cleanup, render queue batching |
| **Currencies** | GP, Slayer Coins, Raid Coins, Abyssal Pieces, Abyssal Slayer Coins, and all modded currencies — with 60s periodic safety-net sync |
| **Equipment** | **Per-player, not synced.** Each player wears their own gear, drawn from the shared bank (equipping removes from the bank for both; unequipping returns it for both). On disconnect/page close your gear is auto-returned to the shared bank; on joining via the host's save you start naked and re-equip from the bank |
| **Equipment set count** | Number of unlocked equipment set slots |
| **Food** | Equipped food slots and selected slot |
| **Prayers / Curses / Auroras** | Active prayers, prayer/soul points |
| **Attack styles & spells** | Melee/ranged/magic styles, attack/curse/aurora selection |
| **Pets** | Pet unlocks |
| **Item charges** | Charged item counts (amulets, rings, etc.) |
| **Potions** | Active potions per action |
| **Shop / Upgrades** | Purchased upgrade counts |

### Combat

| System | Coverage |
|--------|----------|
| **Combat areas** | Dungeons, abyss depths, strongholds — completion counts, stronghold tier, area progress |
| **Combat events** | Into the Mist, Spider Lair — event progress, passives, areas |
| **Combat damage** | Real-time HP sync for player and enemy with damage splashes |
| **Combat claim/release** | Only one player attacks at a time; the other spectates (spectator deals 0 damage to prevent double-damage) |
| **Combat loot** | Both players receive all drops (items, GP, Slayer Coins, bones, barrier dust, signet halves, birthday presents) |
| **Player combat state** | Prayer/soul points, active prayers, attack styles, spell selection |

### Endgame & meta systems

| System | Coverage |
|--------|----------|
| **Township** | Buildings, efficiency, resources, town data (population, happiness, education, worship, seasons, fortification, souls), worship selection — throttled to 5s |
| **Township tasks** | Completed tasks, casual tasks with per-goal progress |
| **Clue hunt** | Step progress and current step |
| **Corruption** | Unlocked corruption effect rows |
| **Raids (Golbin Raid)** | Wave, difficulty, history, loadout (equipment, food, modifiers), state, item selection, modifier selection |
| **Fishing contest** | Active fish, actions remaining, difficulty, completion/mastery trackers, results, leaderboard |
| **Tutorial** | Stage progress, task progress, stage claims, completion |

### Game state & meta

| System | Coverage |
|--------|----------|
| **Game state** | merchant's permit, pause state, visible completion, secret fishing area unlock |
| **Skill unlocks** | Mid-game skill unlocks via the lock icon (e.g. Corruption) |
| **Lore books** | Read lore books (button disable state) |
| **Realm selection** | Current active realm |
| **Game settings** | Gameplay-affecting boolean settings (continueIfBankFull, continueThievingOnStun, autoRestartDungeon, enableAutoSlayer, enableAutoEquipFood, enableAutoSwapFood, enablePerfectCooking, enablePermaCorruption, enableOfflineCombat) |

When a peer first connects, the host sends a **full state snapshot** covering
all of the above so both clients start from the same baseline.

---

## UI features

The mod adds a **floating, draggable panel** (top-right of the screen) with
two tabs:

**Main**

- **Connection controls** — relay server URL + player name fields, connect/
  disconnect button (URL and name persist across sessions)
- **Connection status** — paired state, peer name, ping/latency display
- **Progress bars** — fake progress bars showing both players' current action
  progress, color-coded per skill type to match the game's skill colors
- **Recipe chips** — shows active recipes (e.g. multiple tree names for
  woodcutting) so you can see exactly what the other player is doing
- **Action labels** — skill name and recipe for each player's current action
- **Hide/show toggle** — collapsible panel to minimize UI footprint
- **Export save button** — generates a save string in a modal with download
  option
- **Download log button** — exports the mod's in-memory log as a text file
  (useful for debugging)

**Console** (dev/test tab)

- **Live log view** — the mod's log ring buffer, color-coded by level,
  auto-refreshing (verbose tracing: `realMP.logger.setMinLevel('debug')`)
- **JS console** — evaluate expressions in mod scope (`game`, `sync`,
  `transport`, `logger`, `realMP`), with result printing and ↑/↓ input history
- **Quick actions** — Unlock all (debug), request snapshot, clear console

---

## Networking

Connectivity uses a **WebSocket relay server** with ping/pong (10s interval),
latency tracking, and auto-reconnect after save sync. Both clients connect to
the same relay URL; the relay pairs the first two waiting clients and shuttles
messages between them. No server of your own is required for basic use; a
default public relay is provided.

> The bundled default relay is a temporary Cloudflare tunnel — fine for
> testing, but it can move or disappear. For anything serious, self-host a
> relay (see **Running your own relay server** below) and paste its URL into
> the panel (the URL persists in localStorage).

Features:
- **Ping/pong** heartbeat every 10s with real RTT latency display
- **Message batching** — all game messages produced within a frame are coalesced
  into a single envelope (one WebSocket frame per ~16ms), preserving order while
  cutting packet count during bursts (bank operations, snapshot traffic)
- **Auto-reconnect** after save sync reload (remembers server URL + name)
- **Throttled updates** for high-frequency systems (Harvesting 2s, Township 5s,
  Stats 3s, Combat events 80ms) to avoid flooding the connection
- **Render queue batching** — debounced rendering via `requestAnimationFrame`
  to avoid performance issues from rapid remote updates
- **Re-entrancy guard** (`_applyingRemote` flag) prevents recursive sync loops
  during remote application
- **Auto-save** — debounced save 5s after state changes

---

## Running your own relay server (recommended)

The mod needs a tiny WebSocket relay so the two players can find each other
and exchange messages. The relay is dumb by design: it pairs the first two
connected players and shuttles messages between them. It cannot play the game,
but it **does see all traffic** (including the save sync) — another reason to
run your own instead of trusting a stranger's.

The whole setup takes ~5 minutes, is free, and requires no account and no
router changes.

### Step 1 — Install Node.js

1. Go to <https://nodejs.org> and download the **LTS** version.
2. Run the installer with default options (Windows: keep *Add to PATH* checked).
3. Open a terminal (Windows: PowerShell or Command Prompt; macOS/Linux: Terminal) and verify:

   ```
   node --version
   ```

   You must see something like `v20.x.x`. If you get "not recognized", close
   and reopen the terminal, or reinstall Node.js.

### Step 2 — Get the server file

**Easiest — download it:** grab **`relay-server.zip`** from the
[releases page](https://github.com/venuss1/melvor-idle-real-multiplayer/releases),
unzip it, and open a terminal inside the extracted `relay` folder (Windows:
Shift + right-click → *Open in Terminal*). Then continue with Step 3.
(The same files live in the [`relay/`](relay/) folder of this repo.)

**By hand:**

1. Create a folder, e.g. `melvor-relay`, and open a terminal inside it
   (Windows: Shift + right-click the folder → *Open in Terminal* /
   *Open PowerShell window here*).
2. Create a file named **exactly** `server.js`. Windows: make sure it is not
   secretly `server.js.txt` — in Notepad use *Save as → Save as type: All files*.
3. Paste this code and save:

   ```js
   // Simple WebSocket relay server for the Melvor Idle realMultiplayer mod.
   //
   // Two players connect to this server. The server pairs them and relays
   // every message from one to the other. No WebRTC, no NAT traversal — just
   // plain WebSocket, which works through any firewall that allows HTTPS.
   //
   // Usage:
   //   node server.js [port]
   //
   // Default port: 8080

   const { WebSocketServer } = require('ws');

   const PORT = parseInt(process.argv[2] || '8080', 10);
   const wss = new WebSocketServer({ port: PORT });

   // Simple room model: first player to connect becomes the host and waits.
   // Second player joins the same room. They get paired and messages relay.
   let host = null;
   let peer = null;

   console.log(`[mp-server] Listening on port ${PORT}`);
   console.log(`[mp-server] Waiting for players to connect...`);

   function tryPair() {
     if (host && peer && host.readyState === 1 && peer.readyState === 1) {
       console.log('[mp-server] Paired! Relaying messages between host and peer.');
       host.send(JSON.stringify({ t: 'paired', role: 'host' }));
       peer.send(JSON.stringify({ t: 'paired', role: 'peer' }));
     }
   }

   wss.on('connection', (ws, req) => {
     const ip = req.socket.remoteAddress;
     console.log(`[mp-server] New connection from ${ip}`);

     if (!host) {
       host = ws;
       console.log('[mp-server] Assigned as HOST. Waiting for peer...');
       ws.send(JSON.stringify({ t: 'waiting' }));
       ws.on('message', (data) => {
         if (peer && peer.readyState === 1) peer.send(data.toString());
       });
       ws.on('close', () => {
         console.log('[mp-server] Host disconnected.');
         host = null;
         if (peer) { try { peer.send(JSON.stringify({ t: 'peer_left' })); } catch {} }
       });
     } else if (!peer) {
       peer = ws;
       console.log('[mp-server] Assigned as PEER. Attempting to pair...');
       ws.on('message', (data) => {
         if (host && host.readyState === 1) host.send(data.toString());
       });
       ws.on('close', () => {
         console.log('[mp-server] Peer disconnected.');
         peer = null;
         if (host) { try { host.send(JSON.stringify({ t: 'peer_left' })); } catch {} }
       });
       tryPair();
     } else {
       console.log('[mp-server] Room full — rejecting extra connection.');
       ws.send(JSON.stringify({ t: 'error', msg: 'Room is full (2 players max).' }));
       ws.close();
     }

     ws.on('error', (err) => console.error('[mp-server] WS error:', err.message));
   });

   wss.on('error', (err) => console.error('[mp-server] Server error:', err.message));
   ```

### Step 3 — Install the one dependency

In the server folder, run:

```
npm install
```

(Downloaded zip: this reads the included `package.json`. By hand: run
`npm init -y` first, then `npm install ws`.)

### Step 4 — Start the relay

```
node server.js
```

Expected output:

```
[mp-server] Listening on port 8080
[mp-server] Waiting for players to connect...
```

Keep this window open while you play. To use a different port:
`node server.js 9000`.

### Step 5 — Get your relay address

Pick **one** of the options below.

#### Option A — Same network / same house (LAN)

Use this when both players are on the same Wi-Fi/network.

1. Find your local IP:
   - Windows: run `ipconfig`, look for **IPv4 Address** (e.g. `192.168.1.50`).
   - macOS/Linux: run `ip addr` (or `ifconfig`), look for `192.168.x.x` or `10.x.x.x`.
2. If Windows Firewall asks about Node.js, allow access on **Private networks**.
3. Your relay address is:

   ```
   ws://192.168.1.50:8080
   ```

   (Replace with your actual IP; keep `ws://` and `:8080`.)

#### Option B — Over the internet via Cloudflare quick tunnel (easiest)

Free, no account, no port forwarding, encrypted (`wss://`).

1. Download `cloudflared` from
   <https://github.com/cloudflare/cloudflared/releases>:
   - Windows: `cloudflared-windows-amd64.msi` (installer) or the `.exe`,
   - macOS: `cloudflared-darwin-amd64.pkg`,
   - Linux: the `.deb` / `.rpm` for your distro.
2. Open a **second** terminal (keep the relay running in the first one) and run:

   ```
   cloudflared tunnel --url http://localhost:8080
   ```

   Windows, standalone exe: open a terminal in the folder where you downloaded
   it and run `cloudflared-windows-amd64.exe tunnel --url http://localhost:8080`.
3. The output contains a line like:

   ```
   https://some-random-words.trycloudflare.com
   ```

4. Your relay address is that URL with `https://` replaced by `wss://`:

   ```
   wss://some-random-words.trycloudflare.com
   ```

   (No port number — Cloudflare handles that.)

> A quick tunnel gets a **new random address every time** you restart
> cloudflared — keep the window open while playing, and re-share the address
> after a restart. For a permanent address, create a free Cloudflare account
> and set up a *named tunnel* (see Cloudflare's docs).

#### Option C — Port forwarding (advanced)

Forward TCP port `8080` to your PC in your router settings, then use
`ws://<your public IP>:8080`. Note: plain `ws://` is unencrypted — prefer
Option B unless you know what you're doing.

### Step 6 — Connect both players

1. Both players open the **Multiplayer** panel in the game.
2. Paste the **exact same relay address** into the server URL field on both
   sides, enter your names, and click **Connect**.
3. The first to connect becomes the **host**; the host's save is synced to the
   peer automatically.

### Verify it works

- The relay window prints `[mp-server] New connection from ...` and then
  `[mp-server] Paired! Relaying messages between host and peer.`
- The panel shows the paired state, your peer's name, and a live ping.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `node is not recognized` | Close and reopen the terminal; reinstall Node.js with *Add to PATH* checked. |
| `EADDRINUSE` / port 8080 in use | Start on another port: `node server.js 9000`, and use that port in the URL. |
| Friend can't connect | Both sides pasted the **exact same** URL? Relay window still open? Tunnel window still open? Correct `ws://` vs `wss://` prefix (see below)? |
| `Room is full (2 players max)` | Someone else connected first. Restart the relay, or run your own on a different port. |

**URL prefix cheat sheet**

| Situation | Address format |
|-----------|----------------|
| Same network (LAN) | `ws://192.168.x.x:8080` |
| Own IP / port forward | `ws://<public-ip>:8080` |
| Cloudflare tunnel | `wss://<random-words>.trycloudflare.com` (no port) |

---

## Installation

### Option A — Directory Link (Steam, recommended for dev)

1. Place this folder somewhere stable.
2. In Melvor Idle, open the **Creator Toolkit** (enable it in settings first).
3. Choose **Directory Link** mode and point it at this folder.
4. Reload the game. The mod appears in your mod list.

### Option B — Modfile / mod.io

1. Download the latest `melvor_idle_realMultiplayer.zip` from the
   [releases page](https://github.com/venuss1/melvor-idle-real-multiplayer/releases).
2. In the Creator Toolkit, add the zip as a local mod, or upload it to mod.io.

> The mod has no build step. The `.mjs` files are loaded directly by the game.

---

## Usage

1. Load a character.
2. Open the **Multiplayer** panel (top-right of the screen).
3. Both players: enter the **same relay server URL** (the prefilled default
   works) and your own name, then click **Connect**. The relay pairs you; the
   first to connect becomes the host.
4. The host's save is automatically sent to the peer. The peer reloads with the
   host's character and auto-reconnects.
5. Each player picks a different skill and starts training. Watch the other
   player's progress appear in the panel and on your skills/bank.

### Unlock All (debug)

The mod includes an `UNLOCK_ALL` command (sent via the bot or console) that
mass-unlocks everything in the game for testing:

- All skills to level 120 + abyssal level 60
- All dungeons, abyss depths, strongholds completed
- All realms unlocked
- 1000 of every item in the bank
- All pets unlocked
- All item charges set to 10000
- All mastery to level 99, all mastery pools maxed
- All shop upgrades purchased
- All agility obstacles/pillars built
- All summoning marks discovered
- All ancient relics found
- All combat areas completed 100x
- All skill tree nodes unlocked
- All clue hunt steps completed
- All corruption rows unlocked
- All astrology modifiers upgraded
- All archaeology dig sites unlocked
- All cartography POIs discovered
- All harvesting veins unlocked
- Tutorial completed
- Prayer/soul points maxed
- All level cap increases purchased
- All currencies maxed (done last to avoid negative)

---

## Project layout

```
melvor_idle_realMultiplayer/
├── manifest.json          # mod manifest (namespace, entry point, css)
├── package.json           # dev-only: type definitions for IDE support
├── tsconfig.json          # dev-only: JS typecheck config
├── .modignore             # files excluded when the toolkit zips the mod
├── assets/
│   └── icon.svg
├── docs/                  # offline copy of the modding wiki + game .d.ts (dev-only)
└── src/
    ├── setup.mjs          # single-file entry point (~7.5k lines, see header)
    └── ui/
        └── styles.css     # panel styles (Panel also inlines critical styles)
```

`setup.mjs` is intentionally one file: Melvor's mod loader cannot resolve
static `import` paths between mod resource files, so the logger, wire protocol
(`Msg`), WebSocket `Transport`, `ActionLock`, the `Sync` engine (all
patch/serialize/apply logic), the floating `Panel`, and the `setup(ctx)` entry
all live in it, in that order, behind clear section banners.

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

---

## Known limitations & caveats

- **Combat is partially synced.** Monster selection, damage events, HP, and
  loot drops are mirrored between clients. However, combat involves a single
  `CombatManager` per client — both players see the fight progress, but the
  live animation/splash rendering is best-effort. One player should be the
  designated "attacker" (via combat claim) while the other spectates. The
  spectator's attacks deal 0 damage to prevent double-damage.
- **Random drops** are resolved on the acting client and broadcast as bank
  deltas, so both clients end up with the same items. But seed-based
  deterministic events that read local RNG state won't match — only the
  *results* are synced.
- **Save ownership:** each client still owns its own local save. The host's
  save is sent to the peer on connection (written to slot 0 + reload).
  Periodically one player should export and the other re-import to stay
  aligned, or just rely on the live delta sync.
- **Relay server availability** depends on the default public relay. For
  guaranteed uptime you can self-host a relay and pass its URL to the
  transport.
- **No anti-cheat.** This is a co-op tool for trusted friends, not a
  competitive multiplayer layer.

---

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

---

## License

MIT — see repository metadata. Not affiliated with Games by Malcs Ltd.
Melvor Idle is their property; this is a community mod.
