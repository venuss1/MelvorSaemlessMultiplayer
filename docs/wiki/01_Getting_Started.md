# Web Content from https://wiki.melvoridle.com/w/Mod_Creation/Getting_Started

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# Mod Creation/Getting Started

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

A mod in Melvor Idle, much like other games with mods, is a game modification created by the player
community. The modification to the game can range from a minor balance change to introducing new
skills and items, or a simple quality of life improvement to a full suite of automation tools. There
are various programming APIs within Melvor Idle to help you create mods, regardless of how simple or
complex it is.

## Contents
* [1 Prerequisites][9]
* [2 Quick Start][10]
  * [2.1 Project Setup][11]
  * [2.2 Making it Do Something][12]
  * [2.3 Using Player Input][13]
  * [2.4 Packaging and Adding Your Mod][14]
  * [2.5 Using Your Mod][15]
* [3 Next Steps][16]

## Prerequisites

Mods for Melvor Idle are created using JavaScript, and at least a beginner level understanding of
the language, or programming languages in general, is recommended before jumping into the guides.
You can utilize the [official Typing documentation][17], if you would rather write your code using
TypeScript.

In addition, you should install your preference of code editor for writing JavaScript code. Some
popular choices are [Visual Studio Code][18] or [Notepad++][19].

## Quick Start

Want to dive right into creating your first mod with a (mostly) blank canvas? Follow along to get
started.

### Project Setup

Start by creating a new empty folder for your mod. You'll want to create two files in this new
folder:
* `manifest.json`
* `setup.mjs`

The `manifest.json` file is used to define metadata for your mod, or important information for
Melvor Idle to know how to load your mod. Put the following code within `manifest.json`:

{
  "setup": "setup.mjs"
}

This tells Melvor Idle to look for a `setup.mjs` file and run its exported `setup` function. Next
we'll create that function within `setup.mjs`:

export function setup() {
  console.log('Hello From My Mod!');
}

The export word is important here as it will let the Mod Manager access the setup function to load
the mod.

### Making it Do Something

You'd already have a working "mod" at this point but it's not really modifying anything yet. Let's
let the `setup` function know we want to accept a context object (`ctx` for short) when `setup` is
executed, and then patch the `Skill` class to double all XP gains.

export function setup(ctx) {
  ctx.patch(Skill, 'addXP').before(function(amount, masteryAction) {
    return [amount * 2, masteryAction];
  });
}

The context object will be the bread-and-butter for your mod performing game modifications. Find
more information on the patch method and details on everything else possible with the context object
in the Essentials guide.

Feel free to skip ahead to the Packaging and Adding Your Mod section if you want to test your mod at
this point.

### Using Player Input

Doubling XP is okay, but the mod would be even more useful if the player could customize the amount
that the XP was being multiplied by. Luckily, that's easy with another part of the context object:
mod settings.

You can define a setting for the player to change using the settings object within the context
object, and modify the patch code from above to use this value instead of a value of 2:

export function setup(ctx) {
  ctx.settings.section('General').add({
    type: 'number',
    name: 'xp-multiplier',
    label: 'XP Multiplier',
    hint: 'Multiply all XP gains by this amount',
    default: 1
  });

  ctx.patch(Skill, 'addXP').before(function(amount, masteryAction) {
    const xpMultiplier = ctx.settings.section('General').get('xp-multiplier');
    return [amount * xpMultiplier, masteryAction];
  });
}

The player will then be able to open up your mod's settings from the sidebar and change the
multiplier to any number they'd like.

### Packaging and Adding Your Mod

Once you're ready to test your mod or make it available in the Mod Manager, you'll want to package
it and upload it to mod.io.

Packaging your mod is as simple as zipping the contents in their entirety. So for the above example,
you should have `.zip` file with a `manifest.json` and `setup.mjs` at its root.

Next you should navigate to the [Mods][20] page for Melvor Idle on mod.io and click "Add mod" next
to the game's name. You'll need to enter some basic information for your mod, such as a name and
summary (this is what is displayed in-game in the Mod Manager's when a mod is selected). Be sure to
add relevant tags, paying special attention to the Platforms (the mod will only be downloaded and
installed on the checked platforms) and Supported Game Version tags.

If you're just trying to test out your mod and don't want it available to everyone, you should
uncheck "Public" under the Visibility section. This will prevent the mod from appearing in the
Browse tab of the Mod Manager in-game but you can still subscribe to the mod through the mod.io
website and it will still be downloaded in-game.

When using the mod.io website, you will have to use the same method for signing into the site as you
used for mod.io when you first signed up for it through Melvor. The login method/email needs to
match what is saved in your in-game Melvor mod section with what you use to log in to the site.

Once you've saved the current details you'll be able to add media (images, video) for the mod and,
more importantly, the actual mod files themselves. In the File Manager section, click "Select zip
file" and upload your packaged mod. Give it a version number in the field below, and click "Upload".

### Using Your Mod

You'll now be able to subscribe, download, install, and use your mod. If you've made the mod public
try searching for it in the in-game Mod Manager and subscribing to it there. Once installed, you'll
need to restart the game for the mod to take effect.

If you've kept the mod private you can either go to the mod's profile URL that's on the edit page
for the mod, or if you click on your profile icon on mod.io (top-right of the page) and click on "My
library" you'll be able to find your mod under My Mods. Once on the mod's page click the "Subscribe"
button and next time you load the game it'll be downloaded and installed.

Once installed and reloaded, you should be able to select a character and see your mod in action!

## Next Steps

From here the [Mod Creation/Essentials][21] guide is strongly recommended to learn about the
different modding concepts and APIs available to you.

────────────────────────────────────────────────────────────────────────────────────────────────────
Modding Guides                                                                                      
──────┬────────┬─────────────────┬──────┬────────────┬──────────┬────────────────┬──────────────────
Gettin│[Creator│[Migrating from  │[Essen│[Mod Context│[Sidebar  │[Reusable       │[Enabling DevTools
g     │Toolkit]│Scripts and      │tials]│API         │API       │Components with │for the Steam and 
Starte│[22]    │Extensions][23]  │[24]  │Reference][2│Reference]│PetiteVue][27]  │Epic Clients][28] 
d     │        │                 │      │5]          │[26]      │                │                  
──────┴────────┴─────────────────┴──────┴────────────┴──────────┴────────────────┴──────────────────

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
"[https://wiki.melvoridle.com/index.php?title=Mod_Creation/Getting_Started&oldid=86860][85]"

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
* This page was last edited on 31 October 2025, at 13:27.
* This page has been accessed 44,562 times.
* [Privacy policy][100]
* [About Melvor Idle][101]
* [Disclaimers][102]
* [Mobile view][103]

[1]: /index.php?title=Special:CreateAccount&returnto=Mod+Creation%2FGetting+Started
[2]: /index.php?title=Special:UserLogin&returnto=Mod+Creation%2FGetting+Started
[3]: /w/Mod_Creation/Getting_Started
[4]: /index.php?title=Talk:Mod_Creation/Getting_Started&action=edit&redlink=1
[5]: /w/Mod_Creation/Getting_Started
[6]: /index.php?title=Mod_Creation/Getting_Started&action=edit
[7]: /index.php?title=Mod_Creation/Getting_Started&action=history
[8]: /w/Mod_Creation
[9]: #Prerequisites
[10]: #Quick_Start
[11]: #Project_Setup
[12]: #Making_it_Do_Something
[13]: #Using_Player_Input
[14]: #Packaging_and_Adding_Your_Mod
[15]: #Using_Your_Mod
[16]: #Next_Steps
[17]: https://github.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/
[18]: https://code.visualstudio.com/
[19]: https://notepad-plus-plus.org/
[20]: https://mod.io/g/melvoridle
[21]: /w/Mod_Creation/Essentials
[22]: /w/Mod_Creation/Creator_Toolkit
[23]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
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
[85]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Getting_Started&oldid=86860
[86]: /w/Main_Page
[87]: /w/Special:RecentChanges
[88]: /w/Special:Random
[89]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[90]: /w/Melvor_Idle:Contributing
[91]: /w/Melvor_Idle:Maintenance
[92]: /w/Special:SpecialPages
[93]: /w/Special:WhatLinksHere/Mod_Creation/Getting_Started
[94]: /w/Special:RecentChangesLinked/Mod_Creation/Getting_Started
[95]: javascript:print();
[96]: /index.php?title=Mod_Creation/Getting_Started&oldid=86860
[97]: /index.php?title=Mod_Creation/Getting_Started&action=info
[98]: /index.php?title=Special:Log&page=Mod+Creation%2FGetting+Started
[99]: https://www.mediawiki.org/
[100]: /w/Melvor_Idle:Privacy_policy
[101]: /w/Melvor_Idle:About
[102]: /w/Melvor_Idle:General_disclaimer
[103]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Getting_Started&mobileaction=toggle_
view_mobile
