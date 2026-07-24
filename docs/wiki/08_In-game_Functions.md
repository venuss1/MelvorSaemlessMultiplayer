# Web Content from https://wiki.melvoridle.com/w/In-game_Functions

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# In-game Functions

From Melvor Idle

### Namespaces
* [Page][3]
* [Discussion][4]

### More
* More

### Page actions
* [Read][5]
* [View source][6]
* [History][7]

In-game functions are responsible for most things in the game. It is possible to interact directly
with them through the console. This can be used to add items, levels, GP and more. These functions
can be executed though the console. To access the console open Developer Tools (usually by pressing
F12) in your browser and navigate to the console. Then, simply paste the code in the input field and
press enter. Most functions will require you to fill out variables in the code before executing
them. Note that all code is case sensitive.

**Disclaimer:** Blindly adding items and experience will most likely take away game enjoyment. It is
highly encouraged only to use this to either test things or recoup lost items/progress due to lost
saves.

You are playing around with the code of the game, as such if you make mistakes it is possible that
could corrupt your game. It is highly recommended to **BACKUP YOUR SAVE** before running any in-game
functions.

## Contents
* [1 Using In-game Functions][8]
* [2 Add Item to Bank][9]
  * [2.1 Attributes][10]
  * [2.2 Examples][11]
* [3 Remove Item from Bank][12]
  * [3.1 Attributes][13]
  * [3.2 Examples][14]
* [4 Adjust Shop Purchases][15]
  * [4.1 Attributes][16]
    * [4.1.1 Examples][17]
* [5 Adjust Currencies][18]
  * [5.1 Attributes][19]
  * [5.2 Examples][20]
* [6 Adjust Prayer Points or Soul Points][21]
  * [6.1 Attributes][22]
  * [6.2 Examples][23]
* [7 Adjust XP and Abyssal XP][24]
  * [7.1 Attributes][25]
  * [7.2 Examples][26]
* [8 Adjust Mastery XP][27]
  * [8.1 Attributes][28]
  * [8.2 Examples][29]
* [9 Adjust Mastery Pool XP][30]
  * [9.1 Attributes][31]
  * [9.2 Examples][32]
* [10 Unlock a Pet][33]
  * [10.1 Attributes][34]
  * [10.2 Examples][35]
* [11 Discover Summoning Marks][36]
  * [11.1 Attributes][37]
  * [11.2 Examples][38]
* [12 Locate an Ancient Relic][39]
  * [12.1 Attributes][40]
  * [12.2 Examples][41]
* [13 Reset all Equipment Quick Equip Items][42]
  * [13.1 Examples][43]
* [14 Adjust Dungeon Completions][44]
  * [14.1 Attributes][45]
  * [14.2 Examples][46]
* [15 Ancient Relics Level Caps][47]
  * [15.1 Increasing or Setting level caps][48]
    * [15.1.1 Attributes][49]
    * [15.1.2 Examples][50]
  * [15.2 Awarding random level caps][51]

## Using In-game Functions

Players can use the [dev.Console mod][52] to execute these functions within the Steam, Epic,
Android, and iOS versions of Melvor Idle.

On Web, Steam, and Epic, the console can be opened with F12. If using Steam or Epic, you must
[enable the dev console first][53] before you are able to open it.

## Add Item to Bank

The `addItemByID` function can be used to add any item in the game to the bank.

game.bank.addItemByID(itemID, quantity, logLost, found, ignoreSpace, notify)

### Attributes

───┬───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Def│Description                                                                         
rib│e  │ion│aul│                                                                                    
ute│   │al?│t  │                                                                                    
   │   │   │Val│                                                                                    
   │   │   │ue │                                                                                    
───┼───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────
ite│str│No │   │The ID of the item.                                                                 
mID│ing│   │   │                                                                                    
   │   │   │   │For a complete list of items, see: [Table of Items][54]. Item IDs are on their      
   │   │   │   │respective wiki page.                                                               
   │   │   │   │                                                                                    
   │   │   │   │To search for a specific item by name, the following can be used. Replace           
   │   │   │   │`REPLACEME` with the full or partial name of the item (case insensitive).           
   │   │   │   │                                                                                    
   │   │   │   │let searchTerm = 'REPLACEME';                                                       
   │   │   │   │console.log(game.items.filter(x => x.name.toLowerCase().includes(searchTerm.toLowerC
   │   │   │   │ase())).map((a) => a.id + ' - ' + a.name).join('\n'))                               
───┼───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────
qua│int│No │   │Quantity of item to add.                                                            
nti│   │   │   │                                                                                    
ty │   │   │   │                                                                                    
───┼───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────
log│boo│Yes│fal│If `true`, items that did not fit into the bank will be logged as lost              
Los│lea│   │se │                                                                                    
t  │n  │   │   │                                                                                    
───┼───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────
fou│boo│Yes│fal│Determines if items added by this function will be included within the "Times Found"
nd │lea│   │se │statistic for that item within the completion log. Therefore, unless this parameter 
   │n  │   │   │is set to `true`, any items added in this way will not contribute towards the       
   │   │   │   │player's item completion percentage.                                                
   │   │   │   │                                                                                    
   │   │   │   │**Note:** When adding [Bank Slot Tokens][55], it is suggested that this parameter is
   │   │   │   │set to `true`, otherwise this may cause issues with the way the game calculates the 
   │   │   │   │amount of bank space a player has.                                                  
───┼───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────
ign│boo│Yes│fal│If `true`, the item will be added to the bank even if the bank is already full      
ore│lea│   │se │                                                                                    
Spa│n  │   │   │                                                                                    
ce │   │   │   │                                                                                    
───┼───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────
not│boo│Yes│tru│If `true`, there will be a notification that the item was added along with the      
ify│lea│   │e  │quantity.                                                                           
   │n  │   │   │                                                                                    
───┴───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────

### Examples

game.bank.addItemByID("melvorD:Oak_Logs", 10, true, true, false);

The above code will result in attempting to add 10 [Oak Logs][56] to the Bank. If they do not fit,
10 will be added to the # of Oak Logs lost on the item's stats. Additionally, Oak Logs will be
marked as discovered in the Completion Log.

game.items.forEach((item) => game.bank.addItem(item, 1000000, false, true, true, false));

The above code will add 1,000,000 of every item in the game. The items will be forced into the bank
even if you do not have room and there will be no notifications upon adding the items.

## Remove Item from Bank

The `removeItemQuantityByID` function can be used to remove any item from the bank

game.bank.removeItemQuantityByID(itemID, quantity, removeItemCharges)

Note that if an item's quantity is in an invalid state, such as `NaN` or `Infinity`, then this
function will not be able to remove that item from the bank. For any such items, use the below
snippet instead:

────────────────────────────────────────────────────────────────────────────────────────────────────
Code                                                                                                
────────────────────────────────────────────────────────────────────────────────────────────────────
First, enter the below into the console:                                                            
                                                                                                    
function removeItemByID(itemID) {                                                                   
        const item = game.items.getObjectSafe(itemID);                                              
        const bankItem = game.bank.items.get(item);                                                 
        if (bankItem === undefined)                                                                 
        throw new Error(                                                                            
        `Tried to remove quantity from bank, but item is not in bank.`                              
        );                                                                                          
        bankItem.quantity = 1;                                                                      
        game.bank.removeItemQuantity(item, 1, true);                                                
}                                                                                                   
                                                                                                    
After this, invoke the newly-created function with the appropriate item ID to remove items from the 
bank. For example: `removeItemByID('melvorD:Oak_Logs');`                                            
────────────────────────────────────────────────────────────────────────────────────────────────────

### Attributes

───────────┬────┬─────┬────────┬────────────────────────────────────────────────────────────────────
Attribute  │Type│Optio│Default │Description                                                         
           │    │nal? │Value   │                                                                    
───────────┼────┼─────┼────────┼────────────────────────────────────────────────────────────────────
itemID     │stri│No   │        │The ID of the item.                                                 
           │ng  │     │        │For a complete list of items and their IDs, see: [Table of          
           │    │     │        │Items][57]                                                          
───────────┼────┼─────┼────────┼────────────────────────────────────────────────────────────────────
quantity   │int │No   │        │The number of items to remove.                                      
───────────┼────┼─────┼────────┼────────────────────────────────────────────────────────────────────
removeItemC│bool│Yes  │true    │If `true`, the count of glove charges will be set to 0 if the itemID
harges     │ean │     │        │is for a pair of gloves with charges.                               
───────────┴────┴─────┴────────┴────────────────────────────────────────────────────────────────────

### Examples

game.bank.removeItemQuantityByID('melvorD:Oak_Logs', 10);

The above code will result in 10 [Oak Logs][58] being removed from the bank.

## Adjust Shop Purchases

The below script will add a shop purchase into `upgradesPurchased` which is where all purchases are
stored. Alternatively, `game.shop.buyItemOnClick(purchase, true);` can be used however using this
function will remove the costs of the purchase as well.

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
pur│str│No │The ID of the Purchase. A complete list of purchase IDs can be generated with:          
cha│ing│   │`console.log(game.shop.purchases.allObjects.map((a) => a.id + ' - ' +                   
seI│   │   │a.name).join('\n'))`                                                                    
D  │   │   │                                                                                        
   │   │   │To search for a specific purchase by name, the following can be used. Replace           
   │   │   │`REPLACEME` with the full or partial name of the purchase (case insensitive).           
   │   │   │                                                                                        
   │   │   │let searchTerm = 'REPLACEME';                                                           
   │   │   │console.log(game.shop.purchases.filter(x => x.name.toLowerCase().includes(searchTerm.toL
   │   │   │owerCase())).map((a) => a.id + ' - ' + a.name).join('\n'))                              
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
qua│int│No │The number of purchases to buy                                                          
nti│   │   │                                                                                        
ty │   │   │                                                                                        
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

#### Examples

// Settings //
let purchase = game.shop.purchases.getObjectSafe('melvorD:Extra_Bank_Slot');
let quantity = 100;
// End of Settings //
game.shop.upgradesPurchased.set(purchase, (game.shop.upgradesPurchased.get(purchase) || 0) + quantit
y);
game.shop.computeProvidedStats();
shopMenu.tabs.get(purchase.category).menu.updateItemSelection();
game.shop.renderQueue.costs = true;

The above will add 100 Bank Slot purchases then do the necessary render.

## Adjust Currencies

All [Currencies][59] within the game, being [[GP]][60] [GP][61], [[AP]][62] [Abyssal Pieces][63]
(AP), [[SC]][64] [Slayer Coins][65] (SC), [[ASC]][66] [Abyssal Slayer Coins][67] (ASC), and
[[RC]][68] [Raid Coins][69] (RC) can be adjusted using the same set of functions:
* To adjust GP, use `game.gp`
* To adjust AP, use `game.abyssalPieces`
* To adjust SC, use `game.slayerCoins`
* To adjust ASC, use `game.abyssalSlayerCoins`
* To adjust RC, use `game.raidCoins`

The following functions are used to add, remove, and set currencies. `set` may be of particular use
to players who have inadvertently found their currency balance is set to an invalid value such as
`NaN`.

game.<currency>.add(amount);
game.<currency>.remove(amount);
game.<currency>.set(amount);

#### Attributes

─────────┬────┬─────────┬────────────────────────────────────────────────────────
Attribute│Type│Optional?│Description                                             
─────────┼────┼─────────┼────────────────────────────────────────────────────────
amount   │int │No       │The amount to adjust the specified currency's balance by
─────────┴────┴─────────┴────────────────────────────────────────────────────────

#### Examples

game.gp.add(1000);
game.abyssalSlayerCoins.remove(2500);
game.raidCoins.set(10000);

The first function will add 1,000[[GP]][70], the second function will remove 2,500[[ASC]][71] and
lastly, the third function will set the balance of [[RC]][72] [Raid Coins][73] to 10,000.

## Adjust Prayer Points or Soul Points

The `addPrayerPoints` and `addSoulPoints` functions can be used to add prayer points or soul points
to a player.

 game.combat.player.addPrayerPoints(amount);
 game.combat.player.addSoulPoints(amount);

### Attributes

────────┬───┬────────┬──────────────────────────────────────────────────────────────────────────────
Attribut│Typ│Optional│Description                                                                   
e       │e  │?       │                                                                              
────────┼───┼────────┼──────────────────────────────────────────────────────────────────────────────
amount  │int│No      │The quantity of prayer or soul points to add. A negative value will remove    
        │   │        │points.                                                                       
────────┴───┴────────┴──────────────────────────────────────────────────────────────────────────────

### Examples

 game.combat.player.addPrayerPoints(1);
 game.combat.player.addSoulPoints(-50);

The first line will add 1 prayer point to the player while the second will remove 50 soul points.

## Adjust XP and Abyssal XP

The `addXP` and `addAbyssalXP` functions can be used to add or remove experience and abyssal
experience from any skill. The `setXP` and `setAbyssalXP` can be used to set the new experience or
abyssal experience value.

game.<skill>.addXP(xp);
game.<skill>.addAbyssalXP(xp);
game.<skill>.setXP(xp);
game.<skill>.setAbyssalXP(xp);

where `<skill>` is the lowercase name of the skill you are adding experience to.

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
xp │int│No │Amount of experience to add. A negative number will remove experience. When removing XP,
   │   │   │it's best to use the Set function as these will also visually update your current level 
   │   │   │if the removed experience results in a lower level.                                     
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

### Examples

game.thieving.addXP(1000);
game.astrology.setAbyssalXP(game.astrology.abyssalXP - 700); // For XP, use game.astrology.xp with t
he addXP function
game.attack.setXP(exp.levelToXP(120) + 1); // For Abyssal XP, use abyssalExp.levelToXP with the setA
byssalXP function

The first line will result in 1,000 experience being added to [Thieving][74]. The second line will
remove 700 abyssal xp from Astrology. The third line will set Attack's level to 120.

## Adjust Mastery XP

The `addMasteryXP` function can be used to add experience to any specific [Mastery][75] in a skill.

game.<skill>.addMasteryXP(masteryAction, xp)

where `<skill>` is the lowercase name of the skill you are adding mastery experience to.

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
mas│obj│No │The action to add Mastery XP to. Obtained with                                          
ter│ect│   │`game.<skill>.actions.getObjectSafe(id);`.                                              
yAc│   │   │                                                                                        
tio│   │   │A list of actions IDs can be generated with                                             
n  │   │   │`console.log(game.<skill>.actions.allObjects.map((a) => a.id + ' - ' +                  
   │   │   │a.name).join('\n'));`                                                                   
   │   │   │                                                                                        
   │   │   │In both of the provided functions, `<skill>` must be replaced with the name of the skill
   │   │   │(all lowercase).                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
xp │int│Yes│Amount of experience to add. A negative value will remove mastery xp.                   
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

### Examples

 game.farming.addMasteryXP(game.farming.actions.getObjectSafe('melvorD:Carrot'), 300);
 game.farming.addMasteryXP(game.farming.actions.getObjectSafe('melvorTotH:Starfruit'), -500);

The first line will result in 300 [Mastery][76] XP being added to [Farming][77] for [Carrot
Seeds][78] whereas the second line will remove 500 Mastery XP from [Starfruit][79].

game.masterySkills.forEach(skill => skill.actions.forEach(action => skill.addMasteryXP(action, 5000)
));

The above code will result in 5,000 [Mastery][80] XP being added to every action within every skill
with a mastery action.

## Adjust Mastery Pool XP

The `addMasteryPoolXP` function can be used to add [Mastery Pool][81] experience to a skill

game.<skill>.addMasteryPoolXP(realm, xp)

where `<skill>` is the lowercase name of the skill you are adding mastery experience to.

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
rea│obj│No │The realm to add the Mastery Pool XP to. Obtained with                                  
lm │ect│   │`game.realms.getObjectSafe(realmID)`.                                                   
   │   │   │                                                                                        
   │   │   │A list of realm IDs can be obtained by entering the following into the console:         
   │   │   │`console.log(game.realms.allObjects.map((a) => a.id + ' - ' + a.name).join('\n'))`.     
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
xp │int│Yes│Amount of experience to add. A negative value will remove mastery pool xp.              
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

### Examples

 game.woodcutting.addMasteryPoolXP(game.realms.getObjectSafe('melvorD:Melvor'), 600);
 game.woodcutting.addMasteryPoolXP(game.realms.getObjectSafe('melvorItA:Abyssal'), -400);

The first line will result in 600 [Mastery Pool][82] XP being added to [Woodcutting][83] in the
Melvor Realm whereas the second line will remove 400 mastery pool xp from Woodcutting in the abyssal
realm.

game.realms.forEach(realm => game.masterySkills.forEach(skill => skill.addMasteryPoolXP(realm, 1000)
));

The above code will result in 1,000 [Mastery Pool][84] XP being added to all skills in every realm.

## Unlock a Pet

The `unlockPetByID` function is used to unlock [Pets][85].

game.petManager.unlockPetByID(petID)

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
pet│str│No │The ID of the pet, which can be found on the individual pet pages (such as [Ty][86] for 
ID │ing│   │example) or by using the following function: `console.log(game.pets.allObjects.map((a)  
   │   │   │=> a.id + ' - ' + a.name).join('\n'))`                                                  
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

### Examples

 game.petManager.unlockPetByID('melvorD:CoolRock');
 
game.petManager.unlocked.delete(game.pets.getObjectSafe('melvorD:CoolRock'));game.petManager.compute
ProvidedStats();

The first line will result in the unlocking of [Cool Rock][87] while the second line will remove the
Cool Rock then reload the player's stats.

game.pets.forEach(pet => game.petManager.unlockPet(pet));

The above code will unlock every single pet.

## Discover Summoning Marks

The `discoverMark` function is used to discover [Summoning Marks][88].

game.summoning.discoverMark(mark)

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
mar│obj│No │The mark to discover. Obtained with `game.summoning.actions.getObjectSafe(markID)` where
k  │ect│   │`markID` is the ID of the mark.                                                         
   │   │   │                                                                                        
   │   │   │A list of mark IDs can be obtained by entering the following into the console:          
   │   │   │`console.log(game.summoning.actions.allObjects.map((a) => a.id + ' - ' +                
   │   │   │a.name).join('\n'))`.                                                                   
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

### Examples

 game.summoning.discoverMark(game.summoning.actions.getObjectSafe('melvorF:Dragon'));
 game.summoning.marksUnlocked.delete(game.summoning.actions.getObjectSafe('melvorF:Dragon'));

The first line discovers a single mark for the [Dragon][89] familiar whereas the second line removes
all marks from the Dragon.

game.summoning.actions.forEach((mark) => {
        game.summoning.marksUnlocked.set(mark, (mark.realm.id === 'melvorD:Melvor') ? 61 : 31);
        game.summoning.renderQueue.markCount.add(mark);
        game.summoning.renderQueue.markState.add(mark);
});

The above code will set every single mark to level 61 if it's in the Melvor Realm and 31 if it's in
the Abyssal Realm then update the mark count and mark states.

## Locate an Ancient Relic

The `locateAncientRelic` function is used to locate [Ancient Relics][90].

game.<skill>.locateAncientRelic(relicSet, relic)

where `<skill>` is the lowercase name of the skill you wish to add a relic to.

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
rel│obj│No │The relicSet that the relic belongs to. Obtained with                                   
icS│ect│   │`game.<skill>.ancientRelicSets.get(realm)`                                              
et │   │   │                                                                                        
   │   │   │A list of realms IDs can be obtained by entering the following into the console:        
   │   │   │`console.log(game.realms.allObjects.map((a) => a.id + ' - ' + a.name).join('\n'))`. To  
   │   │   │convert the realmID into a realm object, use `game.realms.getObjectSafe(realmID)`.      
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
rel│obj│No │The relic that you wish to add.                                                         
ic │ect│   │                                                                                        
   │   │   │The relic can be obtained with `relicSet.relicDrops[#].relic;` where `#` is replaced    
   │   │   │with the relic number, starting from 0 for the first relic and ending with 4 for the 5th
   │   │   │relic.                                                                                  
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

### Examples

let realm = game.realms.getObjectSafe('melvorD:Melvor');
let relicSet = game.woodcutting.ancientRelicSets.get(realm);
let relic = relicSet.relicDrops[0].relic;
if (!relicSet.foundRelics.has(relic))
        game.woodcutting.locateAncientRelic(relicSet, relic);

The above code locates Woodcutting Relic 1 in the Melvor Realm.

game.skills.forEach(skill => {
        game.realms.forEach(realm => {
                let relicSet = skill.ancientRelicSets.get(realm);
                if (skill.hasAncientRelics && relicSet !== undefined)
                        relicSet.relicDrops.forEach(({ relic }) => {
                                if (!relicSet.foundRelics.has(relic))
                                        skill.locateAncientRelic(relicSet, relic)
                        });
        });
});

The above will add all the ancient relics to every skill, including modded skills, for all realms
that have relics.

## Reset all Equipment Quick Equip Items

The below script will reset the Equipment Quick Equip items back to an empty item. These are the
Quick Equip items that are found when clicking on an equipment slot, not the ones found in the
skilling minibar (that are set through the bank settings).

### Examples

game.combat.player.equipment.equippedArray.forEach(equipped => {
        
equipped.quickEquipItems = [game.emptyEquipmentItem, game.emptyEquipmentItem, game.emptyEquipmentIte
m];
        equipped.trimQuickEquipItems();
});

The above code will reset all the quick equip items for the **current** equipment set.

game.combat.player.equipmentSets.forEach(({ equipment }) => {
        equipment.equippedArray.forEach(equipped => {
                
equipped.quickEquipItems = [game.emptyEquipmentItem, game.emptyEquipmentItem, game.emptyEquipmentIte
m];
                equipped.trimQuickEquipItems();
        });
});

The above code will reset all the quick equip items for **all** equipment sets.

## Adjust Dungeon Completions

The `addDungeonCompletion` and `setDungeonCompleteCount` functions are used to modify a dungeon's
completion count.

game.combat.player.manager.addDungeonCompletion(dungeon);
game.combat.player.manager.setDungeonCompleteCount(dungeon, amount);

### Attributes

───┬───┬───┬────────────────────────────────────────────────────────────────────────────────────────
Att│Typ│Opt│Description                                                                             
rib│e  │ion│                                                                                        
ute│   │al?│                                                                                        
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
dun│obj│No │The dungeon you wish to add a completion to. Obtained with                              
geo│ect│   │`game.dungeons.getObjectSafe(dungeonID);` where `dungeonID` is the ID of the dungeon.   
n  │   │   │                                                                                        
   │   │   │A list of dungeon IDs can be obtained by entering the following into the console:       
   │   │   │`console.log(game.dungeons.allObjects.map((a) => a.id + ' - ' + a.name).join('\n'))`.   
   │   │   │                                                                                        
   │   │   │If an invalid dungeonID is entered, your game will be unable to be saved until the entry
   │   │   │is either removed or the game is reloaded. You can remove the undefined entry with      
   │   │   │`game.combat.player.manager.dungeonCompletion.delete(undefined)` which should return    
   │   │   │`true` and the errors should stop appearing.                                            
───┼───┼───┼────────────────────────────────────────────────────────────────────────────────────────
amo│num│No │The amount of dungeons clears you wish to add when using `setDungeonCompleteCount`. An  
unt│ber│   │amount is only required for setDungeonCompleteCount.                                    
───┴───┴───┴────────────────────────────────────────────────────────────────────────────────────────

### Examples

 let dungeon = game.dungeons.getObjectSafe('melvorF:Into_the_Mist');
 game.combat.player.manager.addDungeonCompletion(dungeon);

 let dungeon = game.dungeons.getObjectSafe('melvorItA:Into_The_Abyss')
 game.combat.player.manager.setDungeonCompleteCount(dungeon, 15);

The first example will add a single completion to [Into the Mist][91] while the second example will
set [Into the Abyss][92] completions to 15.

After modifying the dungeon completion count, run `game.queueRequirementRenders();` to apply UI
updates without having to restart the game.

## Ancient Relics Level Caps

### Increasing or Setting level caps

The `increaseLevelCap` and `setLevelCap` functions are used to modify the current level cap of a
given skill in the [Ancient Relics][93] [gamemode][94].

 game.<skill>.increaseLevelCap(value);
 game.<skill>.setLevelCap(value);
 game.<skill>.increaseAbyssalLevelCap(value);
 game.<skill>.setAbyssalLevelCap(value);

#### Attributes

─────────┬────┬─────────┬───────────────────────────────────────────────────────────────
Attribute│Type│Optional?│Description                                                    
─────────┼────┼─────────┼───────────────────────────────────────────────────────────────
value    │int │No       │The value to increase the level cap by, or set the level cap to
─────────┴────┴─────────┴───────────────────────────────────────────────────────────────

#### Examples

 game.slayer.increaseLevelCap(20);
 game.thieving.setAbyssalLevelCap(45);

The first line will increase [Slayer's][95] level cap by 20 levels whereas the second line will set
[[Thieving]][96][Thieving][97] level cap to 45.

 game.skills.forEach(skill => {
         skill.setLevelCap(skill.maxLevelCap);
         if (skill.hasAbyssalLevels)
                 skill.setAbyssalLevelCap(skill.maxAbyssalLevelCap);
 });

The above code will set both the level caps and abyssal level caps of all skills to their maximum
value.

### Awarding random level caps

The below script will award the standard number of random level cap increases after defeating a
dungeon, without increasing combat level caps (see below for increasing combat caps). The only value
that must be changed is the `capType` at the beginning of the script. `0` for pre-Bane level cap
increases, `2` for TotH level cap increases, and `4` for ItA level cap increases.

let capType = 0; // 0 = pre-Bane, 2 = TotH, 4 = ItA
let capIncrease = game.currentGamemode.levelCapIncreases[capType];
game.validateRandomLevelCapIncreases();
if (capIncrease.randomIncreases.length > 0 && capIncrease.randomCount > 0) {
        if (capIncrease.randomIncreasesLeft === 0)
                game.levelCapIncreasesBeingSelected.push(capIncrease);
        
capIncrease.randomIncreasesLeft += capIncrease.randomCount; // Change "capIncrease.randomCount" to a
ny number if you wish to add more than the standard amount of cap increases
        game.renderQueue.sidebarSkillUnlock = true;
        game.queueNextRandomLevelCapModal();
}

If you wish to also increase combat level caps then the following can be used.

let capType = 0; // 0 = pre-Bane, 2 = TotH, 4 = ItA
let capIncrease = game.currentGamemode.levelCapIncreases[capType];
game.increaseSkillLevelCaps(capIncrease, capIncrease.requirementSets.get(0));



────────────────────────────────────────────────────────────────────────────────────────────────────
[Melvor Idle][98] version [v1.3.1][99] (Released: 30th October 2024)                                
────────────────────────────────────────────────────────────────────────────────────────────────────
** [Combat][100]:** [Attack][101] • [Strength][102] • [Defence][103] • [Hitpoints][104] •           
[Ranged][105] • [Magic][106] • [Prayer][107] • [Slayer][108] • [Corruption][109]                    
────────────────────────────────────────────────────────────────────────────────────────────────────
**Skills:** [Farming][110] • [Township][111] • [Woodcutting][112] • [Fishing][113] •                
[Firemaking][114] • [Cooking][115] • [Mining][116] • [Smithing][117] • [Thieving][118] •            
[Fletching][119] • [Crafting][120] • [Runecrafting][121] • [Herblore][122] • [Agility][123] •       
[Summoning][124] • [Astrology][125] • [Alternative Magic][126] • [Cartography][127] •               
[Archaeology][128] • [Harvesting][129]                                                              
────────────────────────────────────────────────────────────────────────────────────────────────────
**Other**: [Beginners Guide][130] • [Guides][131] • [Bank][132] • [Combat][133] • [Mastery][134] •  
[Money Making][135] • [Shop][136] • [Easter Eggs][137] • [Pets][138] • [Golbin Raid][139] • [Full   
Version][140] • [Throne of the Herald][141] • [Atlas of Discovery][142] • [Into the Abyss][143]     
────────────────────────────────────────────────────────────────────────────────────────────────────
**Reference Tables:** [Items][144], [Equipment][145], [Experience Table][146], [Upgrading           
Items][147], [Combat Areas][148], [Slayer Areas][149], [Dungeons][150], [Strongholds][151], [The    
Abyss][152], [Monsters][153]                                                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
Retrieved from "[https://wiki.melvoridle.com/index.php?title=In-game_Functions&oldid=86698][154]"

## Navigation

### Navigation
* [Main page][155]
* [Recent changes][156]
* [Random page][157]
* [Help about MediaWiki][158]

### Contributing
* [Contribute to this wiki][159]
* [Maintenance][160]

## Wiki tools

### Wiki tools
* [Special pages][161]

## Page tools

### Page tools

### User page tools

### More
* [What links here][162]
* [Related changes][163]
* [Printable version][164]
* [Permanent link][165]
* [Page information][166]
* [Page logs][167]
* [[Powered by MediaWiki]][168]
* This page was last edited on 21 August 2025, at 20:15.
* This page has been accessed 298,498 times.
* [Privacy policy][169]
* [About Melvor Idle][170]
* [Disclaimers][171]
* [Mobile view][172]

[1]: /index.php?title=Special:CreateAccount&returnto=In-game+Functions
[2]: /index.php?title=Special:UserLogin&returnto=In-game+Functions
[3]: /w/In-game_Functions
[4]: /index.php?title=Talk:In-game_Functions&action=edit&redlink=1
[5]: /w/In-game_Functions
[6]: /index.php?title=In-game_Functions&action=edit
[7]: /index.php?title=In-game_Functions&action=history
[8]: #Using_In-game_Functions
[9]: #Add_Item_to_Bank
[10]: #Attributes
[11]: #Examples
[12]: #Remove_Item_from_Bank
[13]: #Attributes_2
[14]: #Examples_2
[15]: #Adjust_Shop_Purchases
[16]: #Attributes_3
[17]: #Examples_3
[18]: #Adjust_Currencies
[19]: #Attributes_4
[20]: #Examples_4
[21]: #Adjust_Prayer_Points_or_Soul_Points
[22]: #Attributes_5
[23]: #Examples_5
[24]: #Adjust_XP_and_Abyssal_XP
[25]: #Attributes_6
[26]: #Examples_6
[27]: #Adjust_Mastery_XP
[28]: #Attributes_7
[29]: #Examples_7
[30]: #Adjust_Mastery_Pool_XP
[31]: #Attributes_8
[32]: #Examples_8
[33]: #Unlock_a_Pet
[34]: #Attributes_9
[35]: #Examples_9
[36]: #Discover_Summoning_Marks
[37]: #Attributes_10
[38]: #Examples_10
[39]: #Locate_an_Ancient_Relic
[40]: #Attributes_11
[41]: #Examples_11
[42]: #Reset_all_Equipment_Quick_Equip_Items
[43]: #Examples_12
[44]: #Adjust_Dungeon_Completions
[45]: #Attributes_12
[46]: #Examples_13
[47]: #Ancient_Relics_Level_Caps
[48]: #Increasing_or_Setting_level_caps
[49]: #Attributes_13
[50]: #Examples_14
[51]: #Awarding_random_level_caps
[52]: https://mod.io/g/melvoridle/m/devconsole
[53]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[54]: /w/Table_of_Items
[55]: /w/Bank_Slot_Token
[56]: /w/Oak_Logs
[57]: /w/Table_of_Items
[58]: /w/Oak_Logs
[59]: /w/Currency
[60]: /w/Gold_Pieces
[61]: /w/GP
[62]: /w/Abyssal_Pieces
[63]: /w/Abyssal_Pieces
[64]: /w/Slayer_Coins
[65]: /w/Slayer_Coins
[66]: /w/Abyssal_Slayer_Coins
[67]: /w/Abyssal_Slayer_Coins
[68]: /w/Raid_Coins
[69]: /w/Raid_Coins
[70]: /w/Gold_Pieces
[71]: /w/Abyssal_Slayer_Coins
[72]: /w/Raid_Coins
[73]: /w/Raid_Coins
[74]: /w/Thieving
[75]: /w/Mastery
[76]: /w/Mastery
[77]: /w/Farming
[78]: /w/Carrot_Seeds
[79]: /w/Starfruit
[80]: /w/Mastery
[81]: /w/Mastery#The_Mastery_Pool
[82]: /w/Mastery#The_Mastery_Pool
[83]: /w/Woodcutting
[84]: /w/Mastery#The_Mastery_Pool
[85]: /w/Pets
[86]: /w/Ty
[87]: /w/Cool_Rock
[88]: /w/Summoning#Summoning_Marks
[89]: /w/Dragon
[90]: /w/Ancient_Relics#List_of_Ancient_Relics
[91]: /w/Into_the_Mist
[92]: /w/Into_the_Abyss
[93]: /w/Ancient_Relics
[94]: /w/Gamemode
[95]: /w/Slayer
[96]: /w/Thieving
[97]: /w/Thieving
[98]: /w/Main_Page
[99]: /w/V1.3.1
[100]: /w/Combat
[101]: /w/Attack
[102]: /w/Strength
[103]: /w/Defence
[104]: /w/Hitpoints
[105]: /w/Ranged
[106]: /w/Magic
[107]: /w/Prayer
[108]: /w/Slayer
[109]: /w/Corruption
[110]: /w/Farming
[111]: /w/Township
[112]: /w/Woodcutting
[113]: /w/Fishing
[114]: /w/Firemaking
[115]: /w/Cooking
[116]: /w/Mining
[117]: /w/Smithing
[118]: /w/Thieving
[119]: /w/Fletching
[120]: /w/Crafting
[121]: /w/Runecrafting
[122]: /w/Herblore
[123]: /w/Agility
[124]: /w/Summoning
[125]: /w/Astrology
[126]: /w/Alternative_Magic
[127]: /w/Cartography
[128]: /w/Archaeology
[129]: /w/Harvesting
[130]: /w/Beginners_Guide
[131]: /w/Guides
[132]: /w/Bank
[133]: /w/Combat
[134]: /w/Mastery
[135]: /w/Money_Making
[136]: /w/Shop
[137]: /w/Easter_Eggs
[138]: /w/Pets
[139]: /w/Golbin_Raid
[140]: /w/Full_Version
[141]: /w/Throne_of_the_Herald_Expansion
[142]: /w/Atlas_of_Discovery_Expansion
[143]: /w/Into_the_Abyss_Expansion
[144]: /w/Table_of_Items
[145]: /w/Equipment
[146]: /w/Experience_Table
[147]: /w/Upgrading_Items
[148]: /w/Combat_Areas
[149]: /w/Slayer_Areas
[150]: /w/Dungeons
[151]: /w/Strongholds
[152]: /w/The_Abyss
[153]: /w/Monsters
[154]: https://wiki.melvoridle.com/index.php?title=In-game_Functions&oldid=86698
[155]: /w/Main_Page
[156]: /w/Special:RecentChanges
[157]: /w/Special:Random
[158]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[159]: /w/Melvor_Idle:Contributing
[160]: /w/Melvor_Idle:Maintenance
[161]: /w/Special:SpecialPages
[162]: /w/Special:WhatLinksHere/In-game_Functions
[163]: /w/Special:RecentChangesLinked/In-game_Functions
[164]: javascript:print();
[165]: /index.php?title=In-game_Functions&oldid=86698
[166]: /index.php?title=In-game_Functions&action=info
[167]: /index.php?title=Special:Log&page=In-game+Functions
[168]: https://www.mediawiki.org/
[169]: /w/Melvor_Idle:Privacy_policy
[170]: /w/Melvor_Idle:About
[171]: /w/Melvor_Idle:General_disclaimer
[172]: https://wiki.melvoridle.com/index.php?title=In-game_Functions&mobileaction=toggle_view_mobile
