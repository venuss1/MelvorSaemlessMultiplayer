# Web Content from https://wiki.melvoridle.com/w/Mod_Creation/Enabling_DevTools_for_the_Steam_Client

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# Mod Creation/Enabling DevTools for the Steam and Epic Clients

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

< [Mod Creation][8](Redirected from [Mod Creation/Enabling DevTools for the Steam Client][9])

For mod developers, it may be beneficial to enable DevTools within the Steam or Epic client. This
can be achieved by following the process detailed below. This is a one off operation and does not
need to be repeated, that is unless the Steam or Epic client is uninstalled or reinstalled, or when
the game client updates.

### Enabling DevTools for Steam & Epic
1. Ensure Melvor Idle is closed - modifying game files while the game is running may result in
   unexpected behaviour
2. Download Melvor Idle on Steam or Epic, and find the installation folder. e.g.
   `[...]/steamapps/common/Melvor Idle`
   Not sure where it's installed? It is possible to locate the installation folder through the Steam
   & Epic clients:
3. Open the `package.nw` folder then `package.json`. Inside `package.json`, find `"chromium-args":`
   and then remove `--disable-devtools` and save the changes.
4. Verify DevTools have been successfully enabled by opening Melvor Idle, then pressing the F12 key
   once loaded. If successful, the DevTools window should appear

**IMPORTANT**: When running commands through the console, you must switch from 'Top' to 'game' in
the top left corner or else any commands will not function properly. This must be done every time
the console is opened.

[[DevToolsSteamEpic.png]][10]

────────────────────────────────────────────────────────────────────────────────────────────────────
Modding Guides                                                                                      
────────┬────────┬─────────────────┬──────┬────────────┬──────────┬────────────────┬────────────────
[Getting│[Creator│[Migrating from  │[Essen│[Mod Context│[Sidebar  │[Reusable       │Enabling        
Started]│Toolkit]│Scripts and      │tials]│API         │API       │Components with │DevTools for the
[11]    │[12]    │Extensions][13]  │[14]  │Reference][1│Reference]│PetiteVue][17]  │Steam and Epic  
        │        │                 │      │5]          │[16]      │                │Clients         
────────┴────────┴─────────────────┴──────┴────────────┴──────────┴────────────────┴────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
[Melvor Idle][18] version [v1.3.1][19] (Released: 30th October 2024)                                
────────────────────────────────────────────────────────────────────────────────────────────────────
** [Combat][20]:** [Attack][21] • [Strength][22] • [Defence][23] • [Hitpoints][24] • [Ranged][25] • 
[Magic][26] • [Prayer][27] • [Slayer][28] • [Corruption][29]                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Skills:** [Farming][30] • [Township][31] • [Woodcutting][32] • [Fishing][33] • [Firemaking][34] • 
[Cooking][35] • [Mining][36] • [Smithing][37] • [Thieving][38] • [Fletching][39] • [Crafting][40] • 
[Runecrafting][41] • [Herblore][42] • [Agility][43] • [Summoning][44] • [Astrology][45] •           
[Alternative Magic][46] • [Cartography][47] • [Archaeology][48] • [Harvesting][49]                  
────────────────────────────────────────────────────────────────────────────────────────────────────
**Other**: [Beginners Guide][50] • [Guides][51] • [Bank][52] • [Combat][53] • [Mastery][54] • [Money
Making][55] • [Shop][56] • [Easter Eggs][57] • [Pets][58] • [Golbin Raid][59] • [Full Version][60] •
[Throne of the Herald][61] • [Atlas of Discovery][62] • [Into the Abyss][63]                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Reference Tables:** [Items][64], [Equipment][65], [Experience Table][66], [Upgrading Items][67],  
[Combat Areas][68], [Slayer Areas][69], [Dungeons][70], [Strongholds][71], [The Abyss][72],         
[Monsters][73]                                                                                      
────────────────────────────────────────────────────────────────────────────────────────────────────
Retrieved from
"[https://wiki.melvoridle.com/index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_
Clients&oldid=67581][74]"

## Navigation

### Navigation
* [Main page][75]
* [Recent changes][76]
* [Random page][77]
* [Help about MediaWiki][78]

### Contributing
* [Contribute to this wiki][79]
* [Maintenance][80]

## Wiki tools

### Wiki tools
* [Special pages][81]

## Page tools

### Page tools

### User page tools

### More
* [What links here][82]
* [Related changes][83]
* [Printable version][84]
* [Permanent link][85]
* [Page information][86]
* [Page logs][87]
* [[Powered by MediaWiki]][88]
* This page was last edited on 24 April 2024, at 17:15.
* This page has been accessed 70,269 times.
* [Privacy policy][89]
* [About Melvor Idle][90]
* [Disclaimers][91]
* [Mobile view][92]

[1]: /index.php?title=Special:CreateAccount&returnto=Mod+Creation%2FEnabling+DevTools+for+the+Steam+
and+Epic+Clients
[2]: /index.php?title=Special:UserLogin&returnto=Mod+Creation%2FEnabling+DevTools+for+the+Steam+and+
Epic+Clients
[3]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[4]: /index.php?title=Talk:Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients&action=edit
&redlink=1
[5]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[6]: /index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients&action=edit
[7]: /index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients&action=history
[8]: /w/Mod_Creation
[9]: /index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_Client&redirect=no
[10]: /w/File:DevToolsSteamEpic.png
[11]: /w/Mod_Creation/Getting_Started
[12]: /w/Mod_Creation/Creator_Toolkit
[13]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
[14]: /w/Mod_Creation/Essentials
[15]: /w/Mod_Creation/Mod_Context_API_Reference
[16]: /w/Mod_Creation/Sidebar_API_Reference
[17]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[18]: /w/Main_Page
[19]: /w/V1.3.1
[20]: /w/Combat
[21]: /w/Attack
[22]: /w/Strength
[23]: /w/Defence
[24]: /w/Hitpoints
[25]: /w/Ranged
[26]: /w/Magic
[27]: /w/Prayer
[28]: /w/Slayer
[29]: /w/Corruption
[30]: /w/Farming
[31]: /w/Township
[32]: /w/Woodcutting
[33]: /w/Fishing
[34]: /w/Firemaking
[35]: /w/Cooking
[36]: /w/Mining
[37]: /w/Smithing
[38]: /w/Thieving
[39]: /w/Fletching
[40]: /w/Crafting
[41]: /w/Runecrafting
[42]: /w/Herblore
[43]: /w/Agility
[44]: /w/Summoning
[45]: /w/Astrology
[46]: /w/Alternative_Magic
[47]: /w/Cartography
[48]: /w/Archaeology
[49]: /w/Harvesting
[50]: /w/Beginners_Guide
[51]: /w/Guides
[52]: /w/Bank
[53]: /w/Combat
[54]: /w/Mastery
[55]: /w/Money_Making
[56]: /w/Shop
[57]: /w/Easter_Eggs
[58]: /w/Pets
[59]: /w/Golbin_Raid
[60]: /w/Full_Version
[61]: /w/Throne_of_the_Herald_Expansion
[62]: /w/Atlas_of_Discovery_Expansion
[63]: /w/Into_the_Abyss_Expansion
[64]: /w/Table_of_Items
[65]: /w/Equipment
[66]: /w/Experience_Table
[67]: /w/Upgrading_Items
[68]: /w/Combat_Areas
[69]: /w/Slayer_Areas
[70]: /w/Dungeons
[71]: /w/Strongholds
[72]: /w/The_Abyss
[73]: /w/Monsters
[74]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_and_E
pic_Clients&oldid=67581
[75]: /w/Main_Page
[76]: /w/Special:RecentChanges
[77]: /w/Special:Random
[78]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[79]: /w/Melvor_Idle:Contributing
[80]: /w/Melvor_Idle:Maintenance
[81]: /w/Special:SpecialPages
[82]: /w/Special:WhatLinksHere/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[83]: /w/Special:RecentChangesLinked/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[84]: javascript:print();
[85]: /index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients&oldid=67581
[86]: /index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients&action=info
[87]: /index.php?title=Special:Log&page=Mod+Creation%2FEnabling+DevTools+for+the+Steam+and+Epic+Clie
nts
[88]: https://www.mediawiki.org/
[89]: /w/Melvor_Idle:Privacy_policy
[90]: /w/Melvor_Idle:About
[91]: /w/Melvor_Idle:General_disclaimer
[92]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Enabling_DevTools_for_the_Steam_and_E
pic_Clients&mobileaction=toggle_view_mobile
