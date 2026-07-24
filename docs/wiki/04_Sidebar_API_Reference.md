# Web Content from https://wiki.melvoridle.com/w/Mod_Creation/Sidebar_API_Reference

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# Mod Creation/Sidebar API Reference

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

< [Mod Creation][8]

The `sidebar` object is a global variable and is used to customize the side (left-hand) navigation
menu.

The sidebar is organized into four levels:
* **Sidebar**
  * **Category**
    
      e.g. "Combat"
    * **Item**
      
        e.g. "Attack" under "Combat"
      * **Subitem**
        
          e.g. "Skills" under "Completion Log"

## Contents
* [1 Sidebar][9]
  * [1.1 category(id: string, config?: CategoryConfig, builder?: (category: Category) => void):
    Category][10]
  * [1.2 categories(): Category[]][11]
  * [1.3 removeCategory(id: string): void][12]
  * [1.4 removeAllCategories(): void][13]
* [2 Category][14]
  * [2.1 CategoryConfig][15]
  * [2.2 id: string][16]
  * [2.3 rootEl: HTMLLIElement][17]
  * [2.4 categoryEl: HTMLDivElement][18]
  * [2.5 nameEl: HTMLSpanElement][19]
  * [2.6 toggleEl: HTMLElement][20]
  * [2.7 click(): void][21]
  * [2.8 toggle(force?: boolean): void][22]
  * [2.9 remove(): void][23]
  * [2.10 item(id: string, config?: ItemConfig, builder?: (item: Item) => void): Item][24]
  * [2.11 removeItem(id: string): void][25]
  * [2.12 removeAllItems(): void][26]
* [3 Item][27]
  * [3.1 ItemConfig][28]
  * [3.2 id: string][29]
  * [3.3 rootEl: HTMLLIElement][30]
  * [3.4 itemEl: HTMLAnchorElement][31]
  * [3.5 iconEl: HTMLSpanElement][32]
  * [3.6 nameEl: HTMLSpanElement][33]
  * [3.7 asideEl: HTMLElement][34]
  * [3.8 subMenuEl: HTMLUListElement][35]
  * [3.9 category: Category][36]
  * [3.10 click(): void][37]
  * [3.11 toggle(force?: boolean): void][38]
  * [3.12 remove(): void][39]
  * [3.13 subitem(id: string, config?: SubitemConfig, builder?: (subitem: Subitem) => void):
    Subitem][40]
  * [3.14 removeSubitem(id: string): void][41]
  * [3.15 removeAllSubitems(): void][42]
* [4 Subitem][43]
  * [4.1 SubitemConfig][44]
  * [4.2 id: string][45]
  * [4.3 rootEl: HTMLLIElement][46]
  * [4.4 subitemEl: HTMLAnchorElement][47]
  * [4.5 nameEl: HTMLSpanElement][48]
  * [4.6 asideEl: HTMLElement][49]
  * [4.7 item: Item][50]
  * [4.8 click(): void][51]
  * [4.9 remove(): void][52]

## Sidebar

The global `sidebar` object.

### category(id: string, config?: CategoryConfig, builder?: (category: Category) => void): Category

Alternatively `category(id: string, builder?: (category: Category) => void): Category`

Gets or creates then gets a category by its `id`.

**Parameters**

`id: string` The id of the category to get or create

`config?: CategoryConfig` An optional configuration object that may be used to configure either a
new or existing category. See CategoryConfig within the Category section below.

`builder?: (category: Category) => void` An optional callback that receives the category as a
parameter. Useful for adding items to the category without needing to store it as a variable.

**Returns**

`Category` The category object.

**Example**

// Move COMBAT skills to be below NON-COMBAT
sidebar.category('Combat', { after: 'Non-Combat' });

// Create a new category "GREETINGS" and add an item beneath it
sidebar.category('Greetings', { toggleable: true }, (greetings) => {
  greetings.item('Hello');
});

### categories(): Category[]

**Returns**

`Category[]` An ordered array of all categories.

**Example**

const allCategories = sidebar.categories();

### removeCategory(id: string): void

Remove a category by its `id`.

**Parameters**

`id: string` The id of the category to remove.

**Example**

sidebar.removeCategory('Combat');

### removeAllCategories(): void

Remove all categories from the sidebar. Not completely sure why you'd want to do that, though.

**Example**

sidebar.removeAllCategories();

## Category

See sidebar's `category` method for category creation.

### CategoryConfig

All properties are optional.

interface CategoryConfig {
  rootClass?: string | null; // String separated classes to add to the rootEl
  categoryClass?: string | null; // String separated classes to add to the categoryEl
  name?: string | HTMLElement | null; // Override the displayed name (defaults to category id)
  nameClass?: string | null; // String separated classes to add to the nameEl
  
toggleable?: boolean | null; // Determines if the category can be hidden (example: Combat & Non-Comb
at)
  
before?: string; // Places the category before another category by id. Cannot be present if after is
 defined.
  
after?: string; // Places the category after another category by id. Cannot be present if before is 
defined.
  onClick?: (() => void) | null; // Code to execute if the category title is clicked
  onRender?: (elements: CategoryElements) => void; // See notes below
}

If creating a new category and neither a `before` nor `after` is defined, the category is added to
the bottom of the sidebar.

You can pass null to any property to remove previously configured options. For example, setting
`name` to `null` sets the display of the category back to its id.

The `onRender` property can be set to a callback that will receive an object containing the
category's HTML element properties once the sidebar is rendered. This is because the sidebar can be
configured before it is rendered so a category's `rootEl` property will be `undefined` until it has
been rendered. The elements parameter contains the following:

interface CategoryElements {
  rootEl: HTMLLIElement;
  categoryEl: HTMLDivElement;
  nameEl: HTMLSpanElement;
  toggleEl?: HTMLElement;
}

### id: string

(Property) The category's id.

### rootEl: HTMLLIElement

(Property) The category's root HTML element. This contains the `categoryEl` and all item's
`rootEl's`.

### categoryEl: HTMLDivElement

(Property) The category's primary HTML element. This contains the `nameEl` and `toggleEl`, if
defined.

### nameEl: HTMLSpanElement

(Property) The category's name HTML element. This contains the defined `name` property.

### toggleEl: HTMLElement

(Property) The category's toggle HTML element (the visibility eyecon). This is `undefined` if the
category's `toggleable` property is set to `false` or `null`.

### click(): void

Trigger's the category's configured `onClick` property, if present.

**Example**

const clickMe = sidebar.category('Click Me', {
  onClick() {
    console.log('I have been clicked!');
  }
});

clickMe.click(); // I have been clicked!

### toggle(force?: boolean): void

Toggles the category's visibility.

**Parameters**

`force?: boolean` Optionally set to `true` to force display the category, `false` to hide.

**Example**

// Show Combat items if currently hidden, or hide if currently being shown
sidebar.category('Combat').toggle();

// Hide Non-Combat items
sidebar.category('Non-Combat').toggle(false);

### remove(): void

Removes this category from the sidebar.

**Example**

// Remove Non-Combat skills
sidebar.category('Non-Combat').remove();

### item(id: string, config?: ItemConfig, builder?: (item: Item) => void): Item

Alternatively `item(id: string, builder?: (item: Item) => void): Item`

Gets or creates then gets an item by its `id`.

**Parameters**

`id: string` The id of the item to get or create

`config?: ItemConfig` An optional configuration object that may be used to configure either a new or
existing item. See ItemConfig within the Item section below.

`builder?: (item: Item) => void` An optional callback that receives the item as a parameter. Useful
for adding subitems to the item without needing to store it as a variable.

**Returns**

`Item` The item object.

**Example**

// Move Astrology above Firemaking
sidebar.category('Non-Combat').item('melvorD:Astrology', { before: 'melvorD:Firemaking' });

// Create a new item and add a subitem beneath it
sidebar.category('General').item('Greetings', { nameClass: 'text-warning' }, (greetings) => {
  greetings.subitem('Hello');
});

### removeItem(id: string): void

Remove an item from the category by its `id`.

**Parameters**

`id: string` The id of the item to remove

**Example**

sidebar.category('Combat').removeItem('melvorD:Attack');

### removeAllItems(): void

Remove all items from the category.

**Example**

sidebar.category('Combat').removeAllItems();

## Item

### ItemConfig

All properties are optional.

interface ItemConfig {
  rootClass?: string | null; // String separated classes to add to the rootEl
  itemClass?: string | null; // String separated classes to add to the itemEl
  
icon?: string | HTMLElement | null; // Either a URL (string) or an HTMLElement to appear in the item
's icon slot.
  iconClass?: string | null; // String separated classes to add to the iconEl
  name?: string | HTMLElement | null; // Override the displayed name (defaults to item id)
  nameClass?: string | null; // String separated classes to add to the nameEl
  
aside?: string | HTMLElement | null; // Text or HTMLElement to be displayed in the aside slot. Examp
le: level (1/99) text on skills.
  asideClass?: string | null; // String separated classes to add to the asideEl
  link?: string | null; // URL to open if this item is clicked
  
ignoreToggle?: boolean | null; // Set to true if this item should be visible even if its parent cate
gory is hidden. Example: Combat Level under the Combat category.
  
before?: string; // Places the item before another item by id. Cannot be present if after is defined
.
  
after?: string; // Places the item after another item by id. Cannot be present if before is defined.
  onClick?: (() => void) | null; // Code to be executed if the item is clicked
  onRender?: (elements: ItemElements) => void; // See notes below
}

If creating a new item and neither a `before` nor `after` is defined, the item is added to the
bottom of the category.

You can pass null to any property to remove previously configured options. For example, setting
`name` to `null` sets the display of the item back to its id.

The `onRender` property can be set to a callback that will receive an object containing the item's
HTML element properties once the sidebar is rendered. This is because the sidebar can be configured
before it is rendered so an item's HTML element properties will be `undefined` until it has been
rendered. The `elements` parameter contains the following:

interface ItemElements {
  rootEl: HTMLLIElement;
  itemEl: HTMLAnchorElement;
  iconEl: HTMLSpanElement;
  nameEl: HTMLSpanElement;
  asideEl?: HTMLElement;
  subMenuEl?: HTMLUListElement;
}

### id: string

(Property) The item's id.

### rootEl: HTMLLIElement

(Property) The item's root HTML element. This contains the `itemEl` and `subMenuEl`.

### itemEl: HTMLAnchorElement

(Property) The item's primary HTML element. This contains the `iconEl`, `nameEl`, and `asideEl`.

### iconEl: HTMLSpanElement

(Property) The item's icon HTML element. This contains the defined `icon` property.

### nameEl: HTMLSpanElement

(Property) The item's name HTML element. This contains the defined `name` property.

### asideEl: HTMLElement

(Property) The item's aside HTML element. This contains the defined `aside` property. This is
`undefined` if no `aside` property is set.

### subMenuEl: HTMLUListElement

(Property) The item's sub-menu HTML element. Contains any subitems defined. This is `undefined` if
no subitems exist.

### category: Category

(Property) The parent category of the item.

### click(): void

Triggers the item's configured `onClick` property, if present.

**Example**

// Navigate to the Woodcutting page
sidebar.category('Non-Combat').item('melvorD:Woodcutting').click();

### toggle(force?: boolean): void

Toggles the visibility of the item's subitem menu, if any subitems exist.

**Parameters**

`force?: boolean` Optionally set to `true` to force display the category, `false` to hide.

**Example**

// Collapse (hide) the Completion Log's submenu if currently expanded (shown)
// Or expand (show) the submenu if currently collapsed (hidden)
sidebar.category('General').item('Completion Log').toggle();

// Collapse (hide) the Completion Log's submenu
sidebar.category('General').item('Completion Log').toggle(false);

### remove(): void

Removes this item from the parent category.

**Example**

// Removes the Summoning skill from the sidebar
sidebar.category('Non-Combat').item('melvorD:Summoning').remove();

### subitem(id: string, config?: SubitemConfig, builder?: (subitem: Subitem) => void): Subitem

Alternatively `subitem(id: string, builder: (subitem: Subitem) => void): Subitem`

Gets or creates then gets a subitem by its id.

**Parameters**

`id: string` The id of the subitem to get or create

`config?: SubitemConfig` An optional configuration object that may be used to configure either a new
or existing subitem. See SubitemConfig within the Subitem section below.

`builder?: (subitem: Subitem) => void` An optional callback that receives the subitem as a parameter

**Returns**

`Subitem` The subitem object

**Example**

// Move Pets above Skills in the Completion Log
sidebar.category('General').item('Completion Log').subitem('Pets', { before: 'Skills' });

// Add a shortcut to Alt. Magic beneath Magic
sidebar.category('Combat').item('melvorD:Magic').subitem('Alt. Magic', {
  onClick() {
    sidebar.category('Non-Combat').item('melvorD:Magic').click();
  }
});

### removeSubitem(id: string): void

Remove a subitem from the item by its `id`.

**Parameters**

`id: string` The id of the subitem to remove

**Example**

sidebar.category('General').item('Completion Log').removeSubitem('Skills');

### removeAllSubitems(): void

Removes all subitems from the item.

**Example**

sidebar.category('General').item('Completion Log').removeAllSubitems();

## Subitem

### SubitemConfig

interface SubitemConfig {
  rootClass?: string | null; // String separated classes to add to the rootEl
  subitemClass?: string | null; // String separated classes to add to the subitemEl
  name?: string | HTMLElement | null; // Override the displayed name (defaults to subitem id)
  nameClass?: string | null; // String separated classes to add to the nameEl
  
aside?: string | HTMLElement | null; // Text or HTMLElement to be displayed in the aside slot. Examp
le: completion percentages in the Completion Log.
  asideClass?: string | null; // String separated classes to add to the asideEl
  link?: string | null; // URL to open if this item is clicked
  
before?: string; // Places the subitem before another subitem by id. Cannot be present if after is d
efined.
  
after?: string; // Places the item after another item by id. Cannot be present if before is defined.
  onClick?: (() => void) | null; // Code to be executed if the subitem is clicked
  onRender?: (elements: SubitemElements) => void; // See notes below
}

If creating a new subitem and neither a `before` nor `after` is defined, the subitem is added to the
bottom of the parent item's sub-menu.

You can pass `null` to any property to remove previously configured options. For example, setting
`name` to `null` sets the display of the subitem back to its id.

The onRender property can be set to a callback that will receive an object containing the subitem's
HTML element properties once the sidebar is rendered. This is because the sidebar can be configured
before it is rendered so a subitem's HTML element properties will be `undefined` until it has been
rendered. The `elements` parameter contains the following:

interface SubitemElements {
  rootEl: HTMLLIElement;
  subitemEl: HTMLAnchorElement;
  nameEl: HTMLSpanElement;
  asideEl?: HTMLElement;
}

### id: string

(Property) The subitem's id.

### rootEl: HTMLLIElement

(Property) The subitem's root HTML element. This contains the `ubitemEl`.

### subitemEl: HTMLAnchorElement

(Property) The subitem's primary HTML element. This contains the `nameEl` and `asideEl`.

### nameEl: HTMLSpanElement

(Property) The subitem's name HTML element. This contains the defined `name` property.

### asideEl: HTMLElement

(Property) The subitem's aside HTML element. This contains the defined `aside` property. This is
`undefined` if no `aside` property is set.

### item: Item

(Property) The parent item of the subitem.

### click(): void

Triggers the subitem's configured `onClick` property, if present.

**Example**

// Navigate to the Completion Log's Items page
sidebar.category('General').item('Completion Log').subitem('Items').click();

### remove(): void

Removes this subitem from the parent item.

**Example**

// Remove Items from the Completion Log sidebar
sidebar.category('General').item('Completion Log').subitem('Items').remove();

────────────────────────────────────────────────────────────────────────────────────────────────────
Modding Guides                                                                                      
────────┬────────┬─────────────────┬──────┬────────────┬────────┬────────────────┬──────────────────
[Getting│[Creator│[Migrating from  │[Essen│[Mod Context│Sidebar │[Reusable       │[Enabling DevTools
Started]│Toolkit]│Scripts and      │tials]│API         │API     │Components with │for the Steam and 
[53]    │[54]    │Extensions][55]  │[56]  │Reference][5│Referenc│PetiteVue][58]  │Epic Clients][59] 
        │        │                 │      │7]          │e       │                │                  
────────┴────────┴─────────────────┴──────┴────────────┴────────┴────────────────┴──────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
[Melvor Idle][60] version [v1.3.1][61] (Released: 30th October 2024)                                
────────────────────────────────────────────────────────────────────────────────────────────────────
** [Combat][62]:** [Attack][63] • [Strength][64] • [Defence][65] • [Hitpoints][66] • [Ranged][67] • 
[Magic][68] • [Prayer][69] • [Slayer][70] • [Corruption][71]                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Skills:** [Farming][72] • [Township][73] • [Woodcutting][74] • [Fishing][75] • [Firemaking][76] • 
[Cooking][77] • [Mining][78] • [Smithing][79] • [Thieving][80] • [Fletching][81] • [Crafting][82] • 
[Runecrafting][83] • [Herblore][84] • [Agility][85] • [Summoning][86] • [Astrology][87] •           
[Alternative Magic][88] • [Cartography][89] • [Archaeology][90] • [Harvesting][91]                  
────────────────────────────────────────────────────────────────────────────────────────────────────
**Other**: [Beginners Guide][92] • [Guides][93] • [Bank][94] • [Combat][95] • [Mastery][96] • [Money
Making][97] • [Shop][98] • [Easter Eggs][99] • [Pets][100] • [Golbin Raid][101] • [Full             
Version][102] • [Throne of the Herald][103] • [Atlas of Discovery][104] • [Into the Abyss][105]     
────────────────────────────────────────────────────────────────────────────────────────────────────
**Reference Tables:** [Items][106], [Equipment][107], [Experience Table][108], [Upgrading           
Items][109], [Combat Areas][110], [Slayer Areas][111], [Dungeons][112], [Strongholds][113], [The    
Abyss][114], [Monsters][115]                                                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
Retrieved from
"[https://wiki.melvoridle.com/index.php?title=Mod_Creation/Sidebar_API_Reference&oldid=61527][116]"

## Navigation

### Navigation
* [Main page][117]
* [Recent changes][118]
* [Random page][119]
* [Help about MediaWiki][120]

### Contributing
* [Contribute to this wiki][121]
* [Maintenance][122]

## Wiki tools

### Wiki tools
* [Special pages][123]

## Page tools

### Page tools

### User page tools

### More
* [What links here][124]
* [Related changes][125]
* [Printable version][126]
* [Permanent link][127]
* [Page information][128]
* [Page logs][129]
* [[Powered by MediaWiki]][130]
* This page was last edited on 15 June 2023, at 01:07.
* This page has been accessed 15,951 times.
* [Privacy policy][131]
* [About Melvor Idle][132]
* [Disclaimers][133]
* [Mobile view][134]

[1]: /index.php?title=Special:CreateAccount&returnto=Mod+Creation%2FSidebar+API+Reference
[2]: /index.php?title=Special:UserLogin&returnto=Mod+Creation%2FSidebar+API+Reference
[3]: /w/Mod_Creation/Sidebar_API_Reference
[4]: /index.php?title=Talk:Mod_Creation/Sidebar_API_Reference&action=edit&redlink=1
[5]: /w/Mod_Creation/Sidebar_API_Reference
[6]: /index.php?title=Mod_Creation/Sidebar_API_Reference&action=edit
[7]: /index.php?title=Mod_Creation/Sidebar_API_Reference&action=history
[8]: /w/Mod_Creation
[9]: #Sidebar
[10]: #category(id:_string,_config?:_CategoryConfig,_builder?:_(category:_Category)_=>_void):_Catego
ry
[11]: #categories():_Category[]
[12]: #removeCategory(id:_string):_void
[13]: #removeAllCategories():_void
[14]: #Category
[15]: #CategoryConfig
[16]: #id:_string
[17]: #rootEl:_HTMLLIElement
[18]: #categoryEl:_HTMLDivElement
[19]: #nameEl:_HTMLSpanElement
[20]: #toggleEl:_HTMLElement
[21]: #click():_void
[22]: #toggle(force?:_boolean):_void
[23]: #remove():_void
[24]: #item(id:_string,_config?:_ItemConfig,_builder?:_(item:_Item)_=>_void):_Item
[25]: #removeItem(id:_string):_void
[26]: #removeAllItems():_void
[27]: #Item
[28]: #ItemConfig
[29]: #id:_string_2
[30]: #rootEl:_HTMLLIElement_2
[31]: #itemEl:_HTMLAnchorElement
[32]: #iconEl:_HTMLSpanElement
[33]: #nameEl:_HTMLSpanElement_2
[34]: #asideEl:_HTMLElement
[35]: #subMenuEl:_HTMLUListElement
[36]: #category:_Category
[37]: #click():_void_2
[38]: #toggle(force?:_boolean):_void_2
[39]: #remove():_void_2
[40]: #subitem(id:_string,_config?:_SubitemConfig,_builder?:_(subitem:_Subitem)_=>_void):_Subitem
[41]: #removeSubitem(id:_string):_void
[42]: #removeAllSubitems():_void
[43]: #Subitem
[44]: #SubitemConfig
[45]: #id:_string_3
[46]: #rootEl:_HTMLLIElement_3
[47]: #subitemEl:_HTMLAnchorElement
[48]: #nameEl:_HTMLSpanElement_3
[49]: #asideEl:_HTMLElement_2
[50]: #item:_Item
[51]: #click():_void_3
[52]: #remove():_void_3
[53]: /w/Mod_Creation/Getting_Started
[54]: /w/Mod_Creation/Creator_Toolkit
[55]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
[56]: /w/Mod_Creation/Essentials
[57]: /w/Mod_Creation/Mod_Context_API_Reference
[58]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[59]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[60]: /w/Main_Page
[61]: /w/V1.3.1
[62]: /w/Combat
[63]: /w/Attack
[64]: /w/Strength
[65]: /w/Defence
[66]: /w/Hitpoints
[67]: /w/Ranged
[68]: /w/Magic
[69]: /w/Prayer
[70]: /w/Slayer
[71]: /w/Corruption
[72]: /w/Farming
[73]: /w/Township
[74]: /w/Woodcutting
[75]: /w/Fishing
[76]: /w/Firemaking
[77]: /w/Cooking
[78]: /w/Mining
[79]: /w/Smithing
[80]: /w/Thieving
[81]: /w/Fletching
[82]: /w/Crafting
[83]: /w/Runecrafting
[84]: /w/Herblore
[85]: /w/Agility
[86]: /w/Summoning
[87]: /w/Astrology
[88]: /w/Alternative_Magic
[89]: /w/Cartography
[90]: /w/Archaeology
[91]: /w/Harvesting
[92]: /w/Beginners_Guide
[93]: /w/Guides
[94]: /w/Bank
[95]: /w/Combat
[96]: /w/Mastery
[97]: /w/Money_Making
[98]: /w/Shop
[99]: /w/Easter_Eggs
[100]: /w/Pets
[101]: /w/Golbin_Raid
[102]: /w/Full_Version
[103]: /w/Throne_of_the_Herald_Expansion
[104]: /w/Atlas_of_Discovery_Expansion
[105]: /w/Into_the_Abyss_Expansion
[106]: /w/Table_of_Items
[107]: /w/Equipment
[108]: /w/Experience_Table
[109]: /w/Upgrading_Items
[110]: /w/Combat_Areas
[111]: /w/Slayer_Areas
[112]: /w/Dungeons
[113]: /w/Strongholds
[114]: /w/The_Abyss
[115]: /w/Monsters
[116]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Sidebar_API_Reference&oldid=61527
[117]: /w/Main_Page
[118]: /w/Special:RecentChanges
[119]: /w/Special:Random
[120]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[121]: /w/Melvor_Idle:Contributing
[122]: /w/Melvor_Idle:Maintenance
[123]: /w/Special:SpecialPages
[124]: /w/Special:WhatLinksHere/Mod_Creation/Sidebar_API_Reference
[125]: /w/Special:RecentChangesLinked/Mod_Creation/Sidebar_API_Reference
[126]: javascript:print();
[127]: /index.php?title=Mod_Creation/Sidebar_API_Reference&oldid=61527
[128]: /index.php?title=Mod_Creation/Sidebar_API_Reference&action=info
[129]: /index.php?title=Special:Log&page=Mod+Creation%2FSidebar+API+Reference
[130]: https://www.mediawiki.org/
[131]: /w/Melvor_Idle:Privacy_policy
[132]: /w/Melvor_Idle:About
[133]: /w/Melvor_Idle:General_disclaimer
[134]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Sidebar_API_Reference&mobileaction=t
oggle_view_mobile
