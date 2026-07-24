# Melvor Idle Modding Reference

Local copy of the modding wiki and game type definitions for offline reference.

## Wiki Pages (`docs/wiki/`)

| File | Content |
|------|---------|
| `01_Getting_Started.md` | Quick start, project setup, packaging, manifest basics |
| `02_Essentials.md` | **Most useful** — manifest, context object, lifecycle hooks, patching/hooking, modifiers, settings, data storage, APIs |
| `03_Mod_Context_API_Reference.md` | Full API reference for `ctx` — loadModule, loadScript, patch, settings, storage, lifecycle hooks |
| `04_Sidebar_API_Reference.md` | Sidebar customization API — categories, items, subitems |
| `05_Migrating_from_Scripts_and_Extensions.md` | Migration guide (less useful for this mod) |
| `06_Reusable_Components_with_PetiteVue.md` | PetiteVue UI components — ui.create, ui.createStore, ui.createStatic |
| `07_Enabling_DevTools.md` | How to enable F12 DevTools in Steam/Epic client |
| `08_In-game_Functions.md` | Console functions — addItemByID, addXP, adjustGP, mastery, pets, dungeon completions, level caps |

## Type Definitions (`docs/dts/`)

167 `.d.ts` files from `melvor-idle-mod-dts`. Key files for this mod:

### Core
| File | Classes |
|------|---------|
| `gameTypes/game.d.ts` | `Game` — the main global, has `bank`, `combat`, `skills`, `items`, `currencies`, `realms`, `completion`, `lore`, `stats`, `tickTimestamp`, `_isPaused`, `activeLevelCapIncreases`, `skillLevelCapIncreases` |
| `gameTypes/bank2.d.ts` | `Bank` — `addItem`, `removeItemQuantity`, `getQty`, `items` (Map), `updateSearchArray`, `processItemSale` |
| `gameTypes/currency.d.ts` | `Currency` — `add`, `remove`, `set`, `_amount`, `render` |
| `gameTypes/item.d.ts` | `Item`, `EquipmentItem`, `FoodItem`, `PotionItem`, `CompostItem`, etc. |
| `gameTypes/equipment.d.ts` | `Equipment`, `EquipmentSet` — `equipItem`, `unequipItem`, `equippedItems`, `slotArray` |
| `gameTypes/player.d.ts` | `Player` — `equipmentSets`, `equipItem`, `unequipItem`, `updateForEquipmentChange`, `selectedAttackSpell`, `attackStyles` |
| `gameTypes/skill.d.ts` | `Skill`, `SkillWithMastery` — `_xp`, `_level`, `addXP`, `addAbyssalXP`, `_masteryPoolXP`, `actionMastery`, `hasAbyssalLevels`, `currentLevelCap`, `maxLevelCap` |
| `gameTypes/namespaceRegistry.d.ts` | `NamespaceRegistry` — `getObjectByID`, `allObjects`, `register` |
| `gameTypes/modifiers.d.ts` | `Modifier`, `ModifierValue` — `id`, `value`, `getModifier` |
| `gameTypes/save.d.ts` | Save encoding/decoding |

### Skills
| File | Classes |
|------|---------|
| `gameTypes/farming2.d.ts` | `Farming`, `FarmingPlot`, `FarmingRecipe` — `plots`, `state`, `plantedRecipe`, `compostItem`, `compostLevel`, `growthTime`, `growthTimerMap`, `createGrowthTimer`, `harvestPlot`, `destroyPlot`, `compostPlot`, `growPlots` |
| `gameTypes/township.d.ts` | `Township`, `TownshipBiome`, `TownshipData`, `TownshipResource` — `biomes`, `buildingsBuilt`, `buildingEfficiency`, `townData`, `resources`, `passiveTick`, `addBuildings`, `worship`, `season` |
| `gameTypes/agility.d.ts` | `Agility`, `AgilityCourse`, `AgilityObstacle`, `AgilityPillar` — `buildObstacle`, `destroyObstacle`, `activeObstacle` |
| `gameTypes/astrology.d.ts` | `Astrology`, `AstrologyRecipe`, `AstrologyModifier` — `standardModifierUpgrades`, `uniqueModifierUpgrades`, `abyssalModifierUpgrades`, `studiedConstellation`, `exploredConstellation` |
| `gameTypes/summoning.d.ts` | `Summoning`, `SummoningRecipe` — `marksUnlocked`, `discoverMark`, `selectedShardCosts` |
| `gameTypes/cartography.d.ts` | `Cartography`, `WorldMap`, `Hex`, `DigSiteMap`, `DigSiteMapTier` — `worldMaps`, `hexes`, `_surveyLevel`, `_surveyXP`, `pointsOfInterest`, `activeMap`, `selectedPaperRecipe`, `selectedMapUpgradeDigsite`, `createNewMapForDigSite`, `refinements`, `_upgradeActions`, `charges`, `tier`, `computeTier` |
| `gameTypes/archaeology.d.ts` | `Archaeology`, `ArchaeologyDigSite`, `ArchaeologyMuseum` — `actions`, `maps`, `selectedMap`, `museum`, `donatedItems` |
| `gameTypes/harvesting.d.ts` | `Harvesting` — `actions`, `veins`, `rockData` |
| `gameTypes/fishing.d.ts` | `Fishing`, `FishingContest` — `contest`, `isActive`, `playerResults`, `activeFish` |
| `gameTypes/corruption.d.ts` | `Corruption` — abyssal combat skill |
| `gameTypes/herblore.d.ts` | `Herblore`, `Potion` — `activePotions`, `potionTimerMap` |
| `gameTypes/runecrafting.d.ts` | `Runecrafting` — `runes`, `comboRunes` |
| `gameTypes/fletching.d.ts` | `Fletching` |
| `gameTypes/crafting.d.ts` | `Crafting` |
| `gameTypes/smithing.d.ts` | `Smithing` |
| `gameTypes/cooking.d.ts` | `Cooking` |
| `gameTypes/thieving2.d.ts` | `Thieving` — `pickpocket` |
| `gameTypes/woodcutting.d.ts` | `Woodcutting` |
| `gameTypes/firemakingTicks.d.ts` | `Firemaking` — `bonfires` |
| `gameTypes/altMagic.d.ts` | `AltMagic` — alternative magic recipes |
| `gameTypes/mastery2.d.ts` | `Mastery` — `actionMastery`, `masteryPool` |

### Combat
| File | Classes |
|------|---------|
| `gameTypes/combat.d.ts` | `CombatManager` — `enemy`, `player`, `selectedMonster`, `selectedArea`, `activeEvent`, `eventProgress`, `eventPassives`, `availableEventPassives`, `activeEventAreas`, `eventDungeonLength`, `loot` |
| `gameTypes/combatAreas.d.ts` | `CombatArea`, `SlayerArea`, `Dungeon`, `Stronghold`, `AbyssDepth` — `timesCompleted`, `strongholdTier`, `areaProgress` |
| `gameTypes/combatManager.d.ts` | `CombatManager` detailed |
| `gameTypes/enemy.d.ts` | `Enemy` — `hitpoints`, `stats`, `setNewMonster`, `setStatsFromMonster`, `initializeForCombat` |
| `gameTypes/combatLoot.d.ts` | `CombatLoot` — `add`, `items`, `render` |
| `gameTypes/raidManager.d.ts` | `RaidManager` — `wave`, `waveProgress`, `selectedDifficulty`, `history`, `player`, `randomPlayerModifiers`, `randomEnemyModifiers`, `state`, `killCount`, `posModsSelected`, `negModsSelected`, `isPaused`, `isFightingITMBoss` |
| `gameTypes/raidPlayer.d.ts` | `RaidPlayer` — `equipment`, `food`, `equipItem`, `equipFood` |
| `gameTypes/prayer.d.ts` | `Prayer`, `ActivePrayer` — `activePrayers`, `points` |
| `gameTypes/spells.d.ts` | `Spell`, `AttackSpell` |
| `gameTypes/attacks.d.ts` | `Attack`, `AttackStyle` |
| `gameTypes/passives.d.ts` | `Passive`, `CombatPassive` |
| `gameTypes/combatEffects.d.ts` | `CombatEffect` |
| `gameTypes/eventManager.d.ts` | `EventManager` — combat events system |

### Other Systems
| File | Classes |
|------|---------|
| `gameTypes/pets.d.ts` | `Pet`, `PetManager` — `unlocked`, `unlock` |
| `gameTypes/itemCharges.d.ts` | `ItemCharges` — gem charges, item charges |
| `gameTypes/completionLog.d.ts` | `CompletionLog` — `visibleCompletion`, `updateAllCompletion`, `isItemCompleted` |
| `gameTypes/lore.d.ts` | `Lore`, `LoreBook` — `books`, `read` |
| `gameTypes/clueHunt.d.ts` | `ClueHunt` |
| `gameTypes/ancientRelics.d.ts` | `AncientRelic`, `AncientRelicsManager` — level cap increases |
| `gameTypes/shop.d.ts` | `Shop`, `ShopPurchase` |
| `gameTypes/gamemode.d.ts` | `GameMode` |
| `gameTypes/statTracker.d.ts` | `StatTracker` — `stats` (Map) |
| `gameTypes/achievements.d.ts` | `Achievement` |
| `gameTypes/milestones.d.ts` | `Milestone` |
| `gameTypes/townshipTasks.d.ts` | `TownshipTasks` — `completeTask` |

### UI / Menus
| File | Content |
|------|---------|
| `gameTypes/ui.d.ts` | `ui` global — `create`, `createStore`, `createStatic` |
| `gameTypes/sidebar.d.ts` | `sidebar` global |
| `gameTypes/bankMenus.d.ts` | Bank UI |
| `gameTypes/combatMenus.d.ts` | Combat UI |
| `gameTypes/farmingMenus.d.ts` | Farming UI |
| `gameTypes/townshipMenus.d.ts` | Township UI |
| `gameTypes/cartographyMenu.d.ts` | Cartography UI |
| `gameTypes/raidPlayer.d.ts` | Raid UI |

## Quick Reference

### Patching
```js
ctx.patch(ClassName, 'methodName').before((...args) => { /* return modified args */ });
ctx.patch(ClassName, 'methodName').after((returnValue, ...args) => { /* side effects */ });
ctx.patch(ClassName, 'methodName').replace((original, ...args) => { /* return new value */ });
```

### Lifecycle Hooks
```js
ctx.onModsLoaded(() => { /* all mods loaded */ });
ctx.onCharacterSelectionLoaded(() => { /* char select ready */ });
ctx.onInterfaceAvailable(() => { /* UI injected, pre-character */ });
ctx.onCharacterLoaded(() => { /* character loaded */ });
ctx.onInterfaceReady(() => { /* everything ready, offline progress done */ });
```

### Key Globals
- `game` — the Game instance
- `Bank`, `Currency`, `Skill`, `SkillWithMastery`, `exp`, `abyssalExp`, `mod`
- `sidebar`, `ui` (PetiteVue helpers)
- `game.skills`, `game.items`, `game.currencies`, `game.realms` — NamespaceRegistry
- `game.bank`, `game.combat`, `game.completion`, `game.lore`, `game.stats`
- `game.golbinRaid` — RaidManager
- `game.township`, `game.farming`, `game.agility`, `game.astrology`, `game.summoning`
- `game.cartography`, `game.archaeology`, `game.harvesting`, `game.fishing`
