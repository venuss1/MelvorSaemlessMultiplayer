# Web Content from https://wiki.melvoridle.com/w/Mod_Creation/Migrating_from_Scripts_and_Extensions

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# Mod Creation/Migrating from Scripts and Extensions

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

This guide is for mod creators that have previously created a userscript or extension and want to
migrate it to be compatible with the new mod system. This guide will not cover new features, will
skim over implementation details, and **may not follow best practices** for the sake of quickly
getting a migrated mod up and running. For a more in-depth view, consider supplementing with the
[Mod Creation/Essentials][9] guide.

## Contents
* [1 Metadata][10]
  * [1.1 Userscript][11]
  * [1.2 Extension][12]
* [2 The "Loading Loop"][13]
* [3 Loading Packaged Resources][14]
* [4 Next Steps][15]

## Metadata

Whether the mod being migrated was a userscript or extension, the majority of metadata that was
previously defined in the respective locations (userscript comment block or extension
`manifest.json` file) will instead be entered in the mod.io profile page for the mod. This includes
the name, author (the uploading mod.io account), description, tags, and versioning.

For the limited metadata managed within the mod's files, there is a **required** `manifest.json`
file. This file must be at the root of the mod's packaged contents.

### Userscript

Userscripts should define a single `"load"` property within the manifest, with a string value
pointing to the script's location relative to the `manifest.json` file. For example, given the
following folder structure:
* my-mod (root folder)
  * manifest.json
  * script.js

The `manifest.json` should simply be:

{
  "load": "script.js"
}

### Extension

Extensions that previously defined icons in the manifest should now define a single value for the
`"icon"` property instead. This icon file will be used in-game and displayed no larger than 38px x
38px by default.

Content scripts / styles that were effectively an entry point to the extension should now be defined
as the `"load"` property within the manifest, with an array of strings for a value with each entry
being the script/stylesheet's location relative to the `manifest.json` file. For example, given the
following folder structure:
* my-mod (root folder)
  * icons
    * my-icon-48.png
  * sources
    * contentScript.js
  * styles
    * mainStyle.css
  * manifest.json

And a previous `manifest.json` of (irrelevant properties stripped):

{
  "icons": {
    "48": "icons/my-icon-48.png"
  },
  "content_scripts": [
    {
      "js": ["sources/contentScript.js"],
      "css": ["styles/mainStyle.css"]
    }
  ]
}

The new `manifest.json` would be:

{
  "icon": "my-icon-48.png",
  "load": ["sources/contentScript.js", "styles/mainStyle.css"]
}

## The "Loading Loop"

Both userscripts and extensions would often end up with a funky loop that is some variation of the
following in order to wait until the game has loaded into a character to perform actions:

var loadInterval = setInterval(() => {
  var isGameLoaded = window.isLoaded && !window.currentlyCatchingUp;

  if (isGameLoaded) {
    clearInterval(loadInterval);
    // Inject script element or execute code...
  }
}, 500);

With the new mod system's context API, that's no longer necessary. Instead, the script should use a
game lifecycle hook, with the most comparable being `onInterfaceReady`:

mod.register(ctx => {
  ctx.onInterfaceReady(() => {
    // Code here will only get executed after the game, character, and
    // offline progress has been loaded.
  });
});

You can learn more about the various game lifecycle hooks in the [Mod Creation/Essentials][16]
guide.

## Loading Packaged Resources

This section is specific to extensions, as this isn't a concept (commonly) supported in userscripts.
If the extension being migrated over contained scripts, stylesheets, images, audio, or other files
that weren't automatically loaded as part of the `content_scripts` but utilized during runtime,
chances are those resources were retrieved using the `browser.runtime.getURL` (or
`chrome.runtime.getURL`) method. Instead, the migrated mod should rely on the new mod context API's
method, `getResourceUrl`. This method takes in a string value that is the requested resource's
location relative to the manifest.json (root) of the mod package.

There are also helper methods for combining `getResourceUrl` with common follow-up tasks. One such
helper for injecting a script into the page is `loadScript`. It's important to note that
`getResourceUrl` is synchronous while all combined helper methods are asynchronous and return a
promise.

For example, given the following folder structure:
* my-mod (root folder)
  * assets
    * icon.png
  * scripts
    * entryScript.js
    * helper.js
  * manifest.json

And assuming `entryScript.js` was loaded as part of the manifest's `"load"` property, the
`entryScript.js` could retrieve and use or load the `icon.png` and `helper.js` with the following:

mod.register(async (ctx) => {
  var iconUrl = ctx.getResourceUrl('assets/icon.png');
  var iconElement = document.createElement('img');
  iconElement.src = iconUrl;

  await ctx.loadScript('scripts/helper.js');
  // Now the contents of helper.js have been injected and executed
});

Use JavaScript modules or want to learn more about the various resource loading methods? Check out
the [Mod Creation/Essentials][17] guide.

## Next Steps

Hopefully the mod has been successfully migrated and is working with the new mod system at this
point. But that's only the beginning - explore all of the new APIs and techniques available to you
in the other Official Mod Making Guides:
* [Mod Creation/Getting Started][18]
* [Mod Creation/Essentials][19]
* [Mod Creation/Mod Context API Reference][20]
* [Mod Creation/Sidebar API Reference][21]

────────────────────────────────────────────────────────────────────────────────────────────────────
Modding Guides                                                                                      
────────┬────────┬───────────────┬──────┬────────────┬──────────┬────────────────┬──────────────────
[Getting│[Creator│Migrating from │[Essen│[Mod Context│[Sidebar  │[Reusable       │[Enabling DevTools
Started]│Toolkit]│Scripts and    │tials]│API         │API       │Components with │for the Steam and 
[22]    │[23]    │Extensions     │[24]  │Reference][2│Reference]│PetiteVue][27]  │Epic Clients][28] 
        │        │               │      │5]          │[26]      │                │                  
────────┴────────┴───────────────┴──────┴────────────┴──────────┴────────────────┴──────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
[Melvor Idle][29] version [v1.3.1][30] (Released: 30th October 2024)                                
────────────────────────────────────────────────────────────────────────────────────────────────────
** [Combat][31]:** [Attack][32] • [Strength][33] • [Defence][34] • [Hitpoints][35] • [Ranged][36] • 
[Magic][37] • [Prayer][38] • [Slayer][39] • [Corruption][40]                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Skills:** [Farming][41] • [Township][42] • [Woodcutting][43] • [Fishing][44] • [Firemaking][45] • 
[Cooking][46] • [Mining][47] • [Smithing][48] • [Thieving][49] • [Fletching][50] • [Crafting][51] • 
[Runecrafting][52] • [Herblore][53] • [Agility][54] • [Summoning][55] • [Astrology][56] •           
[Alternative Magic][57] • [Cartography][58] • [Archaeology][59] • [Harvesting][60]                  
────────────────────────────────────────────────────────────────────────────────────────────────────
**Other**: [Beginners Guide][61] • [Guides][62] • [Bank][63] • [Combat][64] • [Mastery][65] • [Money
Making][66] • [Shop][67] • [Easter Eggs][68] • [Pets][69] • [Golbin Raid][70] • [Full Version][71] •
[Throne of the Herald][72] • [Atlas of Discovery][73] • [Into the Abyss][74]                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Reference Tables:** [Items][75], [Equipment][76], [Experience Table][77], [Upgrading Items][78],  
[Combat Areas][79], [Slayer Areas][80], [Dungeons][81], [Strongholds][82], [The Abyss][83],         
[Monsters][84]                                                                                      
────────────────────────────────────────────────────────────────────────────────────────────────────
Retrieved from
"[https://wiki.melvoridle.com/index.php?title=Mod_Creation/Migrating_from_Scripts_and_Extensions&old
id=60177][85]"

## Navigation

### Navigation
* [Main page][86]
* [Recent changes][87]
* [Random page][88]
* [Help about MediaWiki][89]

### Contributing
* [Contribute to this wiki][90]
* [Maintenance][91]

## Wiki tools

### Wiki tools
* [Special pages][92]

## Page tools

### Page tools

### User page tools

### More
* [What links here][93]
* [Related changes][94]
* [Printable version][95]
* [Permanent link][96]
* [Page information][97]
* [Page logs][98]
* [[Powered by MediaWiki]][99]
* This page was last edited on 2 January 2023, at 00:24.
* This page has been accessed 8,351 times.
* [Privacy policy][100]
* [About Melvor Idle][101]
* [Disclaimers][102]
* [Mobile view][103]

[1]: /index.php?title=Special:CreateAccount&returnto=Mod+Creation%2FMigrating+from+Scripts+and+Exten
sions
[2]: /index.php?title=Special:UserLogin&returnto=Mod+Creation%2FMigrating+from+Scripts+and+Extension
s
[3]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
[4]: /index.php?title=Talk:Mod_Creation/Migrating_from_Scripts_and_Extensions&action=edit&redlink=1
[5]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
[6]: /index.php?title=Mod_Creation/Migrating_from_Scripts_and_Extensions&action=edit
[7]: /index.php?title=Mod_Creation/Migrating_from_Scripts_and_Extensions&action=history
[8]: /w/Mod_Creation
[9]: /w/Mod_Creation/Essentials
[10]: #Metadata
[11]: #Userscript
[12]: #Extension
[13]: #The_"Loading_Loop"
[14]: #Loading_Packaged_Resources
[15]: #Next_Steps
[16]: /w/Mod_Creation/Essentials
[17]: /w/Mod_Creation/Essentials
[18]: /w/Mod_Creation/Getting_Started
[19]: /w/Mod_Creation/Essentials
[20]: /w/Mod_Creation/Mod_Context_API_Reference
[21]: /w/Mod_Creation/Sidebar_API_Reference
[22]: /w/Mod_Creation/Getting_Started
[23]: /w/Mod_Creation/Creator_Toolkit
[24]: /w/Mod_Creation/Essentials
[25]: /w/Mod_Creation/Mod_Context_API_Reference
[26]: /w/Mod_Creation/Sidebar_API_Reference
[27]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[28]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[29]: /w/Main_Page
[30]: /w/V1.3.1
[31]: /w/Combat
[32]: /w/Attack
[33]: /w/Strength
[34]: /w/Defence
[35]: /w/Hitpoints
[36]: /w/Ranged
[37]: /w/Magic
[38]: /w/Prayer
[39]: /w/Slayer
[40]: /w/Corruption
[41]: /w/Farming
[42]: /w/Township
[43]: /w/Woodcutting
[44]: /w/Fishing
[45]: /w/Firemaking
[46]: /w/Cooking
[47]: /w/Mining
[48]: /w/Smithing
[49]: /w/Thieving
[50]: /w/Fletching
[51]: /w/Crafting
[52]: /w/Runecrafting
[53]: /w/Herblore
[54]: /w/Agility
[55]: /w/Summoning
[56]: /w/Astrology
[57]: /w/Alternative_Magic
[58]: /w/Cartography
[59]: /w/Archaeology
[60]: /w/Harvesting
[61]: /w/Beginners_Guide
[62]: /w/Guides
[63]: /w/Bank
[64]: /w/Combat
[65]: /w/Mastery
[66]: /w/Money_Making
[67]: /w/Shop
[68]: /w/Easter_Eggs
[69]: /w/Pets
[70]: /w/Golbin_Raid
[71]: /w/Full_Version
[72]: /w/Throne_of_the_Herald_Expansion
[73]: /w/Atlas_of_Discovery_Expansion
[74]: /w/Into_the_Abyss_Expansion
[75]: /w/Table_of_Items
[76]: /w/Equipment
[77]: /w/Experience_Table
[78]: /w/Upgrading_Items
[79]: /w/Combat_Areas
[80]: /w/Slayer_Areas
[81]: /w/Dungeons
[82]: /w/Strongholds
[83]: /w/The_Abyss
[84]: /w/Monsters
[85]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Migrating_from_Scripts_and_Extensions
&oldid=60177
[86]: /w/Main_Page
[87]: /w/Special:RecentChanges
[88]: /w/Special:Random
[89]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[90]: /w/Melvor_Idle:Contributing
[91]: /w/Melvor_Idle:Maintenance
[92]: /w/Special:SpecialPages
[93]: /w/Special:WhatLinksHere/Mod_Creation/Migrating_from_Scripts_and_Extensions
[94]: /w/Special:RecentChangesLinked/Mod_Creation/Migrating_from_Scripts_and_Extensions
[95]: javascript:print();
[96]: /index.php?title=Mod_Creation/Migrating_from_Scripts_and_Extensions&oldid=60177
[97]: /index.php?title=Mod_Creation/Migrating_from_Scripts_and_Extensions&action=info
[98]: /index.php?title=Special:Log&page=Mod+Creation%2FMigrating+from+Scripts+and+Extensions
[99]: https://www.mediawiki.org/
[100]: /w/Melvor_Idle:Privacy_policy
[101]: /w/Melvor_Idle:About
[102]: /w/Melvor_Idle:General_disclaimer
[103]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Migrating_from_Scripts_and_Extension
s&mobileaction=toggle_view_mobile
