# Web Content from https://wiki.melvoridle.com/w/Mod_Creation/Essentials

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# Mod Creation/Essentials

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

First time writing a mod for Melvor Idle? Consider starting with the [Mod Creation/Getting
Started][9] guide.

## Contents
* [1 Creating a Mod][10]
  * [1.1 The Manifest][11]
    * [1.1.1 namespace?: string][12]
    * [1.1.2 icon?: string][13]
    * [1.1.3 setup?: string][14]
    * [1.1.4 load?: string | string[]][15]
  * [1.2 Structuring Your Code][16]
    * [1.2.1 Using Modules (Recommended)][17]
    * [1.2.2 Using Scripts][18]
* [2 The Context Object][19]
* [3 Accessing Your Mod's Resources][20]
  * [3.1 Load (Import) a Module][21]
  * [3.2 Load (Inject) a Script][22]
  * [3.3 Load (Inject) HTML Templates][23]
  * [3.4 Load (Inject) a Stylesheet][24]
  * [3.5 Load Data from JSON][25]
  * [3.6 Images, Sounds, and Anything Else][26]
* [4 Game Lifecycle Hooks][27]
* [5 Adding and Modifying Game Objects][28]
  * [5.1 Defining a Data Package][29]
  * [5.2 Building a Data Package at Runtime][30]
* [6 Mod Settings][31]
  * [6.1 Setting Types][32]
* [7 Customizing the Sidebar][33]
* [8 Creating Reusable HTML Components][34]
  * [8.1 Import HTML Templates][35]
  * [8.2 Defining a Component][36]
  * [8.3 Creating a Component Within the UI][37]
* [9 Storing Data][38]
  * [9.1 Limitations][39]
* [10 Game Object Patching/Hooking][40]
  * [10.1 A Quick Note on Function Syntax][41]
  * [10.2 Do Something Before][42]
  * [10.3 Do Something After][43]
  * [10.4 Replace the Method Entirely][44]
* [11 Creating and using Modifiers][45]
  * [11.1 Scoping][46]
  * [11.2 Apply bonuses in data][47]
  * [11.3 Define modifier in data][48]
    * [11.3.1 modifyValue][49]
      * [11.3.1.1 Expression placeholders][50]
    * [11.3.2 allowedScopes][51]
  * [11.4 Check modifier values in Code][52]
    * [11.4.1 Testing][53]
* [12 Exposing APIs][54]
* [13 The Dev Context][55]
* [14 Next Steps][56]

## Creating a Mod

A mod in Melvor Idle is simply composed of two parts: metadata and resources.

The **metadata** is defined in your mod's mod.io profile page (name, version, previews, etc.) and in
a `manifest.json` file that **must** be located at the root of your mod's directory (this holds
metadata that tells the Mod Manager how to load your mod).

**Resources** are really everything else. JavaScript modules and scripts, CSS stylesheets, images,
sounds, etc. are all considered resources that will be accessed through either the manifest or
dynamically through your JavaScript code. When referencing a resource from anywhere (manifest or
code), the path should **always** be relative to the root of your mod (where the `manifest.json`
file is located).

### The Manifest

Before you begin writing code, it's a good idea to start by defining some metadata in the
manifest.json file. A complete manifest.json might look like the following:

{
  "namespace": "helloWorld",
  "icon": "assets/icon.png",
  "setup": "src/setup.mjs",
  "load": ["assets/style.css"]
}

#### namespace?: string

A few important modding APIs (tools) available from JavaScript require a namespace to be defined.
This helps the game to keep your mod's data organized - think of this as an id for your mod that
will be used by other mods and the game itself to access stored data that you've defined. As such,
it's best to choose a namespace that easily identifies your mod in case another mod wants to
interact with it.

The namespace can only contain alphanumeric characters and underscores and cannot start with the
word "melvor".

─────────────────┬─────
Namespace        │Valid
─────────────────┼─────
`helloWorld`     │✔️   
─────────────────┼─────
`hello_world_123`│✔️   
─────────────────┼─────
`HelloWorld!`    │❌   
─────────────────┼─────
`melvorWorld`    │❌   
─────────────────┴─────

While this property is optional, it's good practice to include it to avoid future troubleshooting if
you end up using an API that requires a namespace.

#### icon?: string

An optional icon to be displayed alongside your mod in a number of places, like the My Mods list in
the Mod Manager. The value should be the path to the image file relative to the root of your mod
(where your manifest is located). Accepted file types for an icon are `.png` or `.svg`, and the icon
is typically displayed at a maximum of 38px in-game.

Alternatively, you can supply an absolute path to a web URL and that will be used instead.

#### setup?: string

This property is **required** only if the `"load"` property is not present in the manifest.

This value should be a file path pointing to a JavaScript module to act as the entry-point to your
mod; this concept will be covered more in the following section.

#### load?: string | string[]

This property is **required** only if the `"setup"` property is not present in the manifest.

This value accepts either a single path or an array of paths to resources to load. These resources
are loaded in the order of the array, after the `"setup"` resource has been run. Valid resources to
be loaded through this property are JavaScript script files (`.js`), JavaScript module files
(`.mjs`), CSS stylesheets (`.css`), JSON files containing game data packages (`.json`), and HTML
files containing templates (`.html`). However, unless your mod is very simple, the recommended
approach to loading JavaScript resources (`.js` or `.mjs`) is through code in your mod's entry-point
(`"setup"`).

It's also important to note that while `.js` is considered a valid extension for JavaScript module
files for the "setup" property, modules loaded through "load" must end with `.mjs` or they will be
treated as regular script files.

### Structuring Your Code

#### Using Modules (Recommended)

There are a number of ways to structure your code to be loaded, whether it's scripts or modules,
`"setup"` or `"load"`. Each might have a good use case but the recommended approach for most mods is
to write your code using [JavaScript modules][57] and to have a single entry-point (defined as
`"setup"` in `manifest.json`), while leaving the "load" property exclusively for loading your CSS.

Using this approach will keep your code clean and manageable, while [avoiding polluting the global
JavaScript scope][58], and as a result, avoiding conflicts with other mods. If you're unfamiliar
with JavaScript modules, you can check out resources like [JavaScript Modules on W3Schools][59] or
on [MDN][60] for a more detailed look. The general pattern you'll be using is exporting module
"features" (functions, variables, etc) and then import them into other modules for use. This is also
the approach this guide will use in all of its examples.

Let's start with what a module that's defined as your mod's `"setup"` entry-point should look like:

// setup.mjs
export function setup(ctx) {
  console.log('Hello World!');
}

We export a function named `setup` here because that is what the Mod Manager looks for when loading
a `"setup"` module. Without one, an error would be thrown when loading this mod. This `setup`
function is called and receives the mod's context object as soon as the mod is loaded, which happens
just before the character select screen is visible. Therefore, this mod would write 'Hello World!'
to the console at that time.

To take advantage of the modular approach to JavaScript, however, we cannot use a static import at
the top of the file like we would prefer to in a regular JavaScript environment. Due to the nature
of how modding resources are stored, we have to dynamically import modules using a special
`loadModule` function, contained within the context object. This acts identical to a [dynamic
import][61] but allows you to use a resource path relative to the root of your mod.

If we define a helper module helper.mjs:

// helper.mjs
export function greet(name) {
  console.log(`Hello, ${name}!`);
}

We can then use code we export in our setup function:

// setup.mjs
export async function setup({ loadModule }) {
  const { greet } = await loadModule('helper.mjs');
  greet('Melvor'); // > Hello, Melvor!
}

If you need to access the context object from your helper module, there are two approaches:

1. Pass the context object from the setup function to the loaded module:

// configService.mjs
export function init(ctx) {
  // Perform actions using the context object here...
}

// setup.mjs
export async function setup(ctx) {
  const configService = await ctx.loadModule('configService.mjs');
  configService.init(ctx);
}

2. Use the `getContext` method on the global `mod` object:

// configService.mjs
const ctx = mod.getContext(import.meta);

export function init() {
  // Perform actions using the context object here...
}

You must pass `import.meta` - a special JavaScript object available in all modules - to the
`mod.getContext` method to receive your mod's context object.

#### Using Scripts

If you choose to include plain scripts in your mod, whether it's out of familiarity or a special use
case, you can load (inject) scripts into the game either through the context object (perhaps
received from a `"setup"` module) or the `"load"` property of the manifest.

Loading a script through the context object is very similar to loading a module but you will not
receive back a value.

export async function setup({ loadScript }) {
  // Make sure you await the call to loadScript if your code beyond relies on it
  await loadScript('hello-melvor-script.js');
  // hello-melvor-script.js has executed

  // But don't bother awaiting it if it's not time-sensitive
  loadScript('some-independent-script.js');
}

From inside your script, you can still access the context object:

mod.register(ctx => {
  // Use the context object here
});

Note that the mod.register method will only work on scripts injected through either loadScript or
the "load" property of the manifest.

## The Context Object

Your mod's context object is the central point used for setting up your mod and making modifications
to the game. The majority of the other sections in this guide will cover the concepts enabled
through the APIs available on the object. For a more in-depth look at the documentation for the
context object, refer to the [Mod Creation/Mod Context API Reference][62] guide.

## Accessing Your Mod's Resources

View this topic's relevant API reference here [Mod Creation/Mod Context API Reference#Loading
Resources][63].

Chances are you will package some resources in your mod that aren't covered by the loading options
defined in the manifest and instead need to rely on loading these resources through your code. Your
mod's context object provides methods for retrieving these resources. Keep in mind that all file
path references to your resources should be relative to the root of your mod. Some common scenarios
are below.

### Load (Import) a Module

Use `ctx.loadModule` to import a JavaScript module's exported features.

// my-module.mjs
export function greet(name) {
  console.log(`Hello, ${name}!`);
}

export const importantData = ['e', 'r', 'e', 'h', 't', ' ', 'o', 'l', 'l', 'e', 'h'];

// setup.mjs
export async function setup({ loadModule }) {
  const myModule = await loadModule('my-module.mjs');
  myModule.greet('Melvor'); // Hello, Melvor!
  console.log(myModule.importantData.reverse().join('')); // hello there
}

### Load (Inject) a Script

Use `ctx.loadScript` to inject a JavaScript file into the page.

// setup.mjs
export await function setup({ loadScript }) {
  // Wait for script to run
  await loadScript('my-script.js');
  // Or not
  loadScript('my-independent-script.js');
}

### Load (Inject) HTML Templates

Use `ctx.loadTemplates` to inject all `<template>` elements into the document body.

// setup.mjs
export function setup({ loadTemplates }) {
  loadTemplates('my-templates.html');
}

### Load (Inject) a Stylesheet

Use `ctx.loadStylesheet` to inject a CSS file into the page.

// setup.mjs
export function setup({ loadStylesheet }) {
  loadStylesheet('my-styles.css');
}

### Load Data from JSON

Use `ctx.loadData` to read and automatically parse a JSON resource.

// my-data.json
{
  "coolThings": [
    "rocks"
  ]
}

Comments in JSON are purely illustrative and not valid markup

// setup.mjs
export async function setup({ loadData }) {
  const data = await loadData('my-data.json');
  console.log(data.coolThings[0]); // ['rocks'] 
}

### Images, Sounds, and Anything Else

Nearly any resource can be accessed and used in some way with `ctx.getResourceUrl` - the helper
methods above all use this behind the scenes. With the resource's URL, you can use built-in
JavaScript methods to consume the resource.

// setup.mjs
export function setup({ getResourceUrl }) {
  const url = getResourceUrl('sea-shanty-2.ogg');
  const song = new Audio(url);
  song.loop = true;
  song.play();
}

## Game Lifecycle Hooks

View this topic's relevant API reference here [Mod Creation/Mod Context API Reference#Lifecycle
Hooks][64].

Utilizing the game's lifecycle hooks will allow your mod to perform actions at specific times, which
may be useful for waiting for certain game objects to be available. The game lifecycle hooks are as
follows:
* `onModsLoaded`: Occurs after all enabled mods have completed their initial load
* `onCharacterSelectionLoaded`: Occurs after the character selection screen is completely loaded.
* `onCharacterLoaded`: Occurs after a character has been selected and all game objects have been
  constructed, but before offline progress has been calculated.
* `onInterfaceReady`: Occurs after offline progress has been calculated and the in-game interface
  can be reliably modified. Also useful for any long-running, or non-vital processes that might
  negatively impact the player experience by increased character load times.

All of the game's lifecycle hooks are available through your mod's context object and accept a
callback function as a sole parameter. This callback function can be synchronous or asynchronous and
will be executed at the specified time and receive your mod's context object as a parameter.

// setup.mjs
export function setup({ onModsLoaded, onCharacterLoaded, onInterfaceReady }) {
  onModsLoaded(ctx => {
    // Utilize other mod APIs at character select
  });

  onCharacterSelectionLoaded(ctx => {
    // Build or modify character selection UI elements
  });

  onCharacterLoaded(ctx => {
    // Modify or hook into game objects to influence offline calculations
  });

  onInterfaceReady(ctx => {
    // Build or modify in-game UI elements
  });
}

## Adding and Modifying Game Objects

View this topic's relevant API reference here [Mod Creation/Mod Context API Reference#Game Object
Registration][65].

Mods can now register or modify game objects (items, skills, pages, etc.) in a streamlined way. The
entry point for doing so is either the `"load"` property of your `manifest.json`, or the `gameData`
endpoint within the mod context API. There is massive variety on what data is needed between
different game object types but the general concept is the same. You will need to either define a
data package using JSON and load that into the game, or you can dynamically build one via code
(certain dynamic objects like skills requires the latter).

### Defining a Data Package

The first, simpler option for building game object data is defining all (or as much as possible)
data in a `.json` file that is then read into the game to register your game objects.

**Pros**
* Simpler
* More easily separate data from your mod's logic
* Your text editor can provide typing by defining the `$schema` property in your JSON file

**Cons**
* Does not support all game object types, such as skills

To begin with this approach, your JSON files should all be constructed with:

{
  "$schema": "https://melvoridle.com/assets/schema/gameData.json",
  "data": {

  }
}

If you're using a text editor that supports it, you should now get autocomplete and type checking on
the fields you create.

Here is an example of defining an item:

{
  "$schema": "https://melvoridle.com/assets/schema/gameData.json",
  "data": {
    "items": [{
      "id": "Wooden_Dagger",
      "name": "Wooden Dagger",
      "category": "Combat",
      "type": "Weapon",
      "media": "wooden-dagger.png",
      "ignoreCompletion": false,
      "obtainFromItemLog": false,
      "golbinRaidExclusive": false,
      "sellsFor": 0,
      "tier": "wooden",
      "validSlots": ["Weapon"],
      "occupiesSlots": [],
      "equipRequirements": [
        {
          "type": "SkillLevel",
          "skillID": "melvorD:Attack",
          "level": 1
        }
      ],
      "equipmentStats": [
        { "key": "attackSpeed", "value": 2200 },
        { "key": "stabAttackBonus", "value": 4 },
        { "key": "slashAttackBonus", "value": 1 },
        { "key": "blockAttackBonus", "value": 4 },
        { "key": "meleeStrengthBonus", "value": 1 }
      ],
      "itemType": "Weapon",
      "attackType": "melee"
    }]
  }
}

You would then register your game data using one of the following methods:

// manifest.json
{
  "namespace": "helloWorld",
  "load": ["path-to-your-data.json"]
}

Comments in JSON are purely illustrative and not valid markup

or

// setup.mjs
export async function setup({ gameData }) {
  await gameData.addPackage('path-to-your-data.json');
}

### Building a Data Package at Runtime

The other option for building game object data is doing so dynamically through the mod context API.

**Pros**
* Can be used to register any type of game object
* Enables the ability to dynamically build game objects

**Cons**
* Messier and more complex
* No type support at the moment

The entry-point for using this approach looks like this:

// setup.mjs
export function setup({ gameData }) {
  gameData.buildPackage((p) => {
    // use the `p` object to add game objects
  }).add();
}

Following the same example above of adding an item:

// setup.mjs
export function setup({ gameData }) {
  gameData.buildPackage((p) => {
    p.items.add({
      id: 'Wooden_Dagger',
      name: 'Wooden Dagger',
      category: 'Combat',
      type: 'Weapon',
      media: 'wooden-dagger.png',
      ignoreCompletion: false,
      obtainFromItemLog: false,
      golbinRaidExclusive: false,
      sellsFor: 0,
      tier: 'wooden',
      validSlots: ['Weapon'],
      occupiesSlots: [],
      equipRequirements: [{
        type: 'SkillLevel',
        skillID: 'melvorD:Attack',
        level: 1
      }],
      equipmentStats: [
        { key: 'attackSpeed', value: 2200 },
        { key: 'stabAttackBonus', value: 4 },
        { key: 'slashAttackBonus', value: 1 },
        { key: 'blockAttackBonus', value: 4 },
        { key: 'meleeStrengthBonus', value: 1 }
      ],
      itemType: 'Weapon',
      attackType: 'melee'
    });
  }).add();
}

Your game data should already be registered from the `.add()` method being called on your built
package.

## Mod Settings

View this topic's relevant API reference here [Mod Creation/Mod Context API Reference#Mod
Settings][66].

When loading your mod as a Local Mod via the Creator Toolkit, the mod must be linked to mod.io and
you must have subscribed to and installed the mod via mod.io in order for this data to persist.

Your mod can define settings for the player to interact with and visually configure your mod
in-game. This feature is accessible through a `settings` property on the context object. If your mod
has any settings defined, your mod will appear in the sidebar under Mod Settings. Clicking this will
open up a window with all of your defined settings.

Settings' values are persisted on a per-character basis and will be saved within the character's
save file.

Settings are divided (in code and visually) into sections. Get or create a section using the
`section(name)` method on the `settings` object. The value passed in for the `name` parameter is
used as a header for the section, so this should be human-readable. These sections are displayed in
the order that they are created.

// setup.mjs
export function setup({ settings }) {
  // Creates a section labeled "General"
  settings.section('General');

  
// Future calls to that section will not create a new "General" section, but instead return the alre
ady existing one
  settings.section('General');
}

The object returned from using `section()` can then be used for adding settings to that section.
Refer to the next section for settings configurations.

// setup.mjs
export function setup({ settings }) {
  const generalSettings = settings.section('General');
  // You can add settings one-by-one
  generalSettings.add({
    type: 'switch',
    name: 'awesomeness-detection',
    label: 'Awesomeness Detection',
    hint: 'Determines if you are awesome or not.',
    default: false
  });

  // Or multiple at a time by passing in an array
  generalSettings.add([{
    type: 'label',
    display: 'I am just a label though my story seldom told...'
  }, {
    type: 'number',
    name: 'pick-a-number',
    label: 'Pick a Number',
    hint: '1 through 10'
  }]);
}

You can then `get` or `set` the value of any defined setting by its `name` property.

// elsewhere.mjs
const { settings } = mod.getContext(import.meta);

const generalSettings = settings.section('General');
generalSettings.set('pick-a-number', 1);
console.log(generalSettings.get('pick-a-number')); // 1

### Setting Types

There are currently eight predefined setting types that will automatically create a usable input:
* Text
* Number
* Switch
* Dropdown
* Button
* Checkbox Group
* Radio Group
* Label

In addition, you add a custom setting by configuring additional properties. For more information on
the configuration options available for each of these, refer to the relevant section of the [Mod
Creation/Mod Context API Reference#Mod Settings][67] guide.

## Customizing the Sidebar

View this topic's relevant API reference here [Mod Creation/Sidebar API Reference][68].

If you want to add or modify the in-game sidebar (the menu with the bank, skills, etc.) there is an
globally-scoped in-game API, `sidebar`, for doing so. The sidebar is organized into four levels:
* Sidebar
  * Categories
    * Items
      * Subitems

An example of a category is Combat and Attack would be an item within that category. Subitems are
what's used for the Completion Log's sections.

Each of the customizable (categories, items, subitems) pieces are generally interacted with the same
way.

const combat = sidebar.catetory('Combat'); // Get the Combat category, or create one if it doesn't e
xist
const attack = sidebar.category('Combat').item('Attack'); // Get the Attack item within Combat or cr
eate one if it doesn't exist
attack.subitem('Wut'); // Get the Wut subitem within Attack or create one if it doesn't exist

In addition, these can be called with a configuration object as a second parameter to create or
update the existing piece with the new configuration.

sidebar.category('Combat').item('Slayer', {
  before: 'Attack', // Move the Slayer item above Attack
  ignoreToggle: true // Keep Slayer visible when its category has been hidden
});

The full definition of each sidebar piece's configuration object can be found in the [Mod
Creation/Sidebar API Reference][69] guide.

If you need to retrieve all existing categories, items, or subitems, use their respective methods:

sidebar.categories(); // returns an array of all categories
sidebar.category('Combat').items(); // returns an array of all Combat items
sidebar.category('General').item('Completion Log').subitems(); // returns an array of all Completion
 Log subitems

Removing categories, items, and subitems is also possible:

sidebar.category('Non-Combat').remove(); // Remove the entire Non-Combat category
sidebar.removeCategory('Combat'); // Alternative (this avoids creating a Combat category if it didn'
t already exist)
sidebar.removeAllCategories(); // Remove all categories, but why?

// Same kind of structure for items and subitems:
sidebar.category('Modding').item('Mod Manager').remove();
sidebar.category('General').item('Completion Log').removeAllSubitems();

## Creating Reusable HTML Components

This topic is covered in greater detail in [Mod Creation/Reusable Components with PetiteVue][70].

Melvor Idle ships with [PetiteVue][71] for mods to use to create reusable HTML components. You can
use documentation from the [official GitHub page][72] to assist in using the PetiteVue library.
However, there are some helper functions for making it easier for mods to interact with.

### Import HTML Templates

Using either the `manifest.json`'s `"load"` property or the context API's `loadTemplates` method,
you can import all `<template>` elements from an HTML file into the document body. These will then
be available for use when creating a component.

If you have the following HTML file:

<!-- templates.html -->
<template id="counter-component">
  <span class="text-light">{{ count }}</span>
  <button class="btn btn-secondary" @click="inc">+</button>
</template>

You would import the template in one of the following two ways:

// manifest.json
{
  "load": "templates.html"
}

Comments in JSON are purely illustrative and not valid markup

or

// setup.mjs
export function setup({ loadTemplates }) {
  loadTemplates('templates.html');
}

### Defining a Component

Using the [PetiteVue documentation on components][73], you should define each component as a
function. This component should define its template selector using the `$template` property, and
then any additional properties or methods that the rendered component will use. For example:

function Counter(props) {
  return {
    $template: '#counter-component',
    count: props.count,
    inc() {
      this.count++;
    }
  };
}

### Creating a Component Within the UI

Now that your template is loaded and you have a component defined, you can use the helper function
`ui.create` to create an instance of the component within the UI.

// Create a counter component at the bottom of the Woodcutting page
ui.create(Counter({ count: 0 }), document.getElementById('woodcutting-container'));

## Storing Data

View the character storage's relevant API reference here [Mod Creation/Mod Context API
Reference#Character Data Storage][74].

View the account storage's relevant API reference here [Mod Creation/Mod Context API
Reference#Account Data Storage][75].

When loading your mod as a Local Mod via the Creator Toolkit, the mod must be linked to mod.io and
you must have subscribed to and installed the mod via mod.io in order for this data to persist.

There are two options for storing data for your mod that isn't already saved as part of the game or
settings: data saved with a character or data saved to the player's account. For most cases,
however, character storage should be the preferred location and account storage used sparingly. Both
of these stores are available through your mod's context object, as `characterStorage` and
`accountStorage`, respectively. Aside from where the data is ultimately saved, character and account
storage have identical methods and behaviors. Character storage is not available until after a
character has been loaded (`onCharacterLoaded` lifecycle hook).

// setup.mjs
export function setup({ characterStorage }) {
  
// This would all function identically with accountStorage, but also be available across characters
  characterStorage.setItem('my-favorite-pet', 7);

  console.log(PETS[characterStorage.getItem('my-favorite-pet')].name); // Larry, the Lonely Lizard

  characterStorage.removeItem('my-favorite-pet');

  characterStorage.clear(); // Removes all currently stored items
}

### Limitations

Currently, a mod's character storage and account storage are each (separately) limited to 8,192
bytes (8kb) of total data. This means each character can store up to 8kb per mod, but only 8kb total
can be stored to an account.

In addition, only JSON-serializable data can be stored. This includes any JavaScript primitive value
(strings, numbers, and booleans) or an object or array containing only primitive values (or an
object or array containing only primitive values, etc.). You do not have to serialize/deserialize
the data yourself.

Finally, due to the nature of account data being persisted to the cloud, data integrity cannot be
100% guaranteed due to possible network issues the player might experience.

## Game Object Patching/Hooking

View this topic's relevant API reference here [Mod Creation/Mod Context API Reference#Game Object
Patching/Hooking][76].

A common modding scenario is to want to override/modify an in-game method or perform an action
before or after it has completed. Your mod's context object contains a patch property that can be
used for this these cases. Patches can only be applied to methods that exist on a JavaScript class
(`Player`, `Enemy`, `CombatManager`, `Woodcutting`, etc.). To start, define the class and method
that you want to patch:

// setup.mjs
export function setup({ patch }) {
  const xpPatch = patch(Skill, 'addXP');
}

From there you can use that patch to perform any of the following actions.

### A Quick Note on Function Syntax

When patching methods, for most scenarios you'll want to use a traditional function expression,
rather than the arrow expression syntax. This will ensure `this` is bound to the class instance that
is calling the method, rather than the context where the patch was defined.

For example,

export function setup({ patch }) {
  const methodPatch = patch(Class, 'method');
  // Do this
  methodPatch.before(function () { });

  // Or this
  function beforePatch () { }
  methodPatch.before(beforePatch);

  // Not this, unless you understand the implications of doing so
  methodPatch.before(() => { });
}

### Do Something Before

Use the `before` method on the patch object to execute code immediately before the patched method.
In addition, the callback hook will receive the arguments that were used to call the patched method
as parameters, and can optionally modify them by returning the new arguments as an array.

// setup.mjs
export function setup({ patch }) {
  patch(Skill, 'addXP').before(function (amount, masteryAction) {
    console.log(`Doubling XP from ${amount} to ${amount * 2}!`);
    return [amount * 2, masteryAction]; // Double all XP gains
  });
}

### Do Something After

Use the `after` method on the patch object to execute code immediately after the patched method. In
addition, the callback hook will receive the value returned from the patched method along with the
arguments used to call it as parameters. Optionally, an after hook can choose to override the
returned value by returning a value itself. **Only** a return value of `undefined` will be ignored.

// setup.mjs
export function setup({ patch }) {
  patch(Player, 'rollToHit').after(function (willHit) {
    if (!willHit) console.log('A miss? I think not!');
    return true;
  });
}

### Replace the Method Entirely

The `replace` method on the patch object will override the patched method's body, but before and
after hooks will still be executed. The replacement method will receive the current method
implementation (the one being replaced) along with the arguments used to call it as parameters. The
return value of the replacement method will be the return value of the method call, subject to any
changes made in an after hook.

// setup.mjs
export function setup({ patch }) {
  patch(Skill, 'addXP').replace(function(o, amount, masteryAction) {
    // Prevent any woodcutting XP  
    if (this.id === 'melvorD:Woodcutting') return;

    // Double any mining XP
    if (this.id === 'melvorD:Mining') return o(amount * 2, masteryAction);

    // Grant all other XP as normal
    return o(amount, masteryAction);
  });
}

It's important to note that the using the replace method replaces the **current** method
implementation. This means that multiple replacements on the same patched method will be executed in
reverse order than they were declared:

// setup.mjs
export function setup({ patch, onInterfaceReady }) {
  const xpPatch = patch(Skill, 'addXP');

  xpPatch.replace(xpA);
  xpPatch.replace(xpB);

  onInterfaceReady(() => {
    game.woodcutting.addXP(100);
    // Logs:
    // XP replace B
    // XP replace A
  });
}

function xpA(o, amount, masteryAction) {
  console.log('XP replace A');
  return o(amount, masteryAction);
}

function xpB(o, amount, masteryAction) {
  console.log('XP replace B');
  return o(amount, masteryAction);
}

## Creating and using Modifiers

Modifiers are one of the core systems by which "stats" (both positive and negative) can be applied
to the player. This part of the documentation will focus on how to define, provide and check those
modifiers. Other core systems (such as Combat's usage of "Equipment stats" and "Combat Effects") as
well as how the game actually knows from where to even get all the bonuses, will not be delved into.

### Scoping

You can skip this part, if your modifier is very specific. That being said, Scoping is vital in
order to be able to combine various use cases into a single modifier. Such as a "Skill XP change"
modifier, where scoping can be used to limit the XP bonus to a specific skill, rather than having to
create a different modifier for each skill.

You may have seen descriptions such as `+10% Max Damage when using Normal Damage` or `+5% Skill XP
in Agility`. And then something as simple as `+5% Skill XP`. As can be expected with those
descriptions, some of these buffs have limitations (aka scoping) applied to them. The latter two
actually use the same modifier (`melvorD:skillXP`), but the former one used the `skill` scope
`Agility`, in order to limit the bonus to that skill.

Supported scopes are:

interface IModifierScope {
    skill?: AnySkill;
    damageType?: DamageType;
    realm?: Realm;
    currency?: Currency;
    category?: NamedObject;
    action?: NamedObject;
    subcategory?: NamedObject;
    item?: Item;
    effectGroup?: CombatEffectGroup;
}

**"Action", "Category" and "Subcategory" require a "scope source" to be set (more on that later).
The ID in the data is then interpreted based on the scope source. For example, a "Category" in
Cooking is not the same as a "Category" in Thieving.**

How these scopes can be defined for modifiers, set as limitations on bonuses and checked in code,
will be delved into in the following sections.

### Apply bonuses in data

Let's start at the latter, less complicated, part of the data package - when a modifier has already
been integrated into the game's logic and now you want to apply that modifier as a bonus to
something (e.g. an Item). There are two ways in which you can write the bonus(es), depending on
whether they should be scoped or not. Either way, **it is important that you include the Namespace
of the modifier**, as otherwise the game will assume that the modifier is defined by the namespace
`melvorD`!

If not scoping the bonus, you can just provide the number directly.

{
  "modifiers": {
    "melvorD:skillXP": 5
  }
}

If scoping the bonus, then the bonus must actually be provided as an **array of objects**, where
each object not only defines the value, but also the scoping (notice how data packages actually
expect the scope name parameters to be suffixed with `ID`).

{
  "modifiers": {
    "melvorD:skillXP": [
      {
        "skillID": "melvorD:Slayer",
        "realmID": "melvorD:Melvor",
        "value": 5
      }
    ]
  }
}

### Define modifier in data

Before being able to actually work with modifiers in code, they will first have to be defined via a
data package.

{
  "$schema": "https://melvoridle.com/assets/schema/gameData.json",
  "namespace": "myNamespace",
  "data": {
    "modifiers": [
      {
        "id": "flatSkillInterval",
        "inverted": true,
        "modifyValue": "value/1000",
        "allowedScopes": [
          {
            "scopes": {},
            "descriptions": [
              {
                "text": "${value}s Global Non-Combat Skill Interval",
                "lang": "MODIFIER_DATA_flatSkillInterval"
              }
            ]
          }
        ]
      }
    ]
  }
}

While the above may serve as an initial helpful visualization, lets jump into the actual
type-definition and go a little deeper.

interface ModifierData extends IDData {
    
/** Whether the the interpretation (positive/negative) should be inverted (a negative value actually
 having a positive impact and vice versa). Defaults to false */
    inverted?: boolean;
    /** If this modifier is allowed to have positive values. Defaults to true. */
    allowPositive?: boolean;
    /** If this modifier is allowed to have negative values. Defaults to true. */
    allowNegative?: boolean;
    /** If this modifier causes a change in combat stats when changed. Defaults to false. */
    isCombat?: boolean;
    /** If this modifier can be applied to enemies in combat. Defaults to false. */
    allowEnemy?: boolean;
    /** An expression that is applied to the modifier's value before it is described */
    modifyValue?: string;
    /** Determines which scopes this modifier can belong to */
    allowedScopes: ModifierScopingData[];
}

While most of the properties should be self-explanatory, there are some which are worth going into
more detail about:

#### modifyValue

Let's say the current technical value of a boost from a modifier is `50`. Using this property, you
can modify how this value is printed in the description. For example, most - if not all - flat
interval changes are defined in milliseconds - if you want to change the description to display the
value in seconds instead, you can set the `modifyValue` property to the expression `value/1000`.

You can even utilize some functions in those expressions. For example, you can use `floor(value)` in
order to avoid decimal output all-together.

##### Expression placeholders

These placeholders have been identified by a player. No guarantee can be given about correctness and
completeness of the following lists. It is worth highlighting that the values listed here are
specific to modifiers. Combat Effects actually have a bigger list of available value placeholders.
* Values
  * `value` - the value of the boost
  * `hpMultiplier` - the multiplier to hitpoints as defined by the game mode
* Functions
  * `floor`
  * `round`
  * `ceil`
  * `abs`
  * `min`
  * `max`
  * `clamp`
  * `rand`
  * `roll`

#### allowedScopes

This property can be changed via data modifications. This includes adding entirely new scope
combinations. However, if you want to add new scope combinations, there are two important points you
need to be aware of:
1. For a given data package, ALL modifications are registered after ALL data has been registered. In
   other words, if you want to add data using your new scope combination, you will have to split
   data and modifications into two separate data packages, and first load the one containing the
   modiciations.
2. The code needs to actually provide the scoping-data in question when retrieving the the applied
   bonuses. For example, bonuses scoped to a certain category can only be met, if the game tries to
   determine a category in the first place.

This property is an array of allowed scope-data-combinations (such as "No Scope", "Skill specified",
"Skill and Category specified", etc.), to one of which the actual application of bonuses must adhere
to. What does an entry of this array look like?

interface ModifierScopingData {
    /** The specific scopes allowed by this modifier */
    scopes: TrueFlags<IModifierScope>;
    /** Determines the source for action and category scopes for this scoping */
    scopeSource?: string;
    /** The descriptions to use for the modifier in this scope */
    descriptions: ModifierDescriptionData[];
    
/** Aliases for positive values in this scope. Used for backwards compatability with old data format
 */
    posAliases?: ModifierAliasData[];
    
/** Aliases for negative values in this scope. Used for backwards compatability with old data format
 */
    negAliases?: ModifierAliasData[];
}
1. When you define a bonus to something, the game will use the `scopes` property in order to
   identify which entry of the `allowedScopes` array it should use in order to handle the bonus. For
   example, if you remember the previous example specifying a skill and a realm, then the game would
   search the array for an entry where `scopes` is set to `{ skill: true, realm: true }`
2. The game **may** then determine the `scopeSource`, if required by at least one of the scopes
   specified (e.g. `category`). If the scope-combination does not require a scope source to be
   specified, then the property can be omitted. Alternatively, if a `skill` scope is expected to be
   provided, then the game will automatically use the skill as the scope source.
3. From there, a specific entry of the `descriptions` array will be picked, based on its inner
   conditions, to describe the bonus.

As for `posAliases` and `negAliases`, as they already mention, they are used for backwars
compatibility. For example, two former modifiers `increaseSkillXP` and `decreaseSkillXP` were
replaced by the new modifier `skillXP`. But thanks to those aliases, the game will still be able to
pick up, if older data packages use the old names as reference, merging the bonuses together under
the new `skillXP` modifier.

### Check modifier values in Code

The game itself may use short-form getters for modifiers without scoping. These getters are
explicitly defined by the game for its base-included modifiers. If you are interested in using
short-form getters yourself, you must add them yourself. If doing so, ensure you use unqiue names in
order to avoid potentially overriding short-form getters of other mods!

Now that a modifier has been defined and sources for bonuses set up, how can you find out the
currently applied bonuses in your code? Let's assume the stats of the player are up-to-date, so we
can skip over the structure of so-called `StatProviders` for now. In that case, it is as simple as
calling `game.modifiers.getValue(MODIFIER_ID, MODIFIER_QUERY)`.

If there is no scoping-support for your modifier, then you can use the global constant
`ModifierQuery.EMPTY`.

game.modifiers.getValue('myNamespace:myLocalId', ModifierQuery.EMPTY)

If you do want to support scoping, then it is slightly more complicated. If you remember the
previously mentioned structure of a modifier scope, you will first have to build up an object, where
those scope values are set (for example `{ skill: game.agility }`). You then have to provide those
parameters to a `ModifierQuery`.

// === Example without modifier query being cached ===

// Logic for getting food healing bonus in combat
const value = this.modifiers.getValue("melvorD:foodHealingValue", new ModifierQuery({
  damageType: this.damageType,
  skill: this.game.cooking,
  action: this.game.cooking.getActionForFood(item),
}, false));

// === Example with modifier query being cached ===

// Skill base logic for getting uncapped cost reduction
getUncappedCostReduction(action, item) {
    
return this.game.modifiers.getValue("melvorD:skillCostReduction", this.getActionModifierQuery(action
));
}

// Skill base logic for creating a query scoped for the given action
getActionModifierQuery(action) {
    
// First, a query cache is looked for, as the query may still be cached, not having to be re-created
    const cached = this.actionQueryCache.get(action);
    if (cached !== undefined)
        return cached;

    
// Otherwise, the query has to be created. First creating the params object and then feeding those t
o the query.
    
const query = new ModifierQuery(this.getActionModifierQueryParams(action) /* e.g. { skill: this, act
ion: action } */ );
    this.actionQueryCache.set(action, query);
    return query;
}

#### Testing

If you want to test whether your code checking a modifier works correctly, and do not want to deal
with setting up bonus sources beforehand (like creating a test item), you can use the console and
quickly apply a modifier bonus to yourself directly.

// Find the modifier-defining object
const modifier = game.modifierRegistry.getObjectByID('melvorD:skillXP');

// Create proper value/bonus objects
const globalSkillXPBonus = new ModifierValue(modifier, 10); // +10% Global skill xp
const agilitySkillXPBonus = new ModifierValue(modifier, 5, { skill: game.agility }); // +5% Agility 
xp

// Create a "Stat object" and set them up as a "Stat provider"
const statObject = {
  modifiers: [globalSkillXPBonus, agilitySkillXPBonus]
};
const statProvider = new StatProvider();
statProvider.addStatObject({ name: 'Example stat object' }, statObject);

// Register the new stat provider somewhere the game already knows. For example, just add it to the 
combat manager, even though the bonus examples here wouldn't actually fit it thematically.
game.combat.registerStatProvider(statProvider);

// Ensure the player's stats are re-calculated
game.combat.computeAllStats();

## Exposing APIs

View this topic's relevant API reference here [Mod Creation/Mod Context API Reference#Exposing
Properties and Methods (Mod API)][77].

If your mod serves as a tool for other mods to integrate with, exposing APIs through the context
object using `ctx.api` is the recommended approach. This is especially useful when paired with a mod
developed using modules. The `api` method accepts an object and will expose any properties on that
object to the global `mod` object within the `api['your-mods-namespace']` property. You can call the
`api` method multiple times to append more APIs.

// manifest.json
{
  "namespace": "helloWorld",
  "setup": "setup.mjs"
}

Comments in JSON are purely illustrative and not valid markup

// setup.mjs
export function setup({ api }) {
  api({
    greet: name => console.log(`Hello, ${name!}`);
  });
}

Other mods would then be able to interact with your API:

// some other mod
mod.api.helloWorld.greet('Melvor'); // Hello, Melvor!

## The Dev Context

To make it easier to test code before committing to uploading a mod, there is a 'dev' mod context
that you can access to try out any of the context object's methods that don't require additional
resources, i.e. you can't use `loadModule`. To access this context, you can use the following in
your browser console:

const devCtx = mod.getDevContext();

This method/context **should not** be used from within a mod.

## Next Steps

Hopefully this guide covers most common modding scenarios and will be a useful reference during your
mod development time. For more in-depth looks at specific concepts, consider checking out the
following guides:
* [Mod Creation/Mod Context API Reference][78]
* [Mod Creation/Sidebar API Reference][79]

────────────────────────────────────────────────────────────────────────────────────────────────────
Modding Guides                                                                                      
────────┬────────┬─────────────────┬────┬────────────┬──────────┬────────────────┬──────────────────
[Getting│[Creator│[Migrating from  │Esse│[Mod Context│[Sidebar  │[Reusable       │[Enabling DevTools
Started]│Toolkit]│Scripts and      │ntia│API         │API       │Components with │for the Steam and 
[80]    │[81]    │Extensions][82]  │ls  │Reference][8│Reference]│PetiteVue][85]  │Epic Clients][86] 
        │        │                 │    │3]          │[84]      │                │                  
────────┴────────┴─────────────────┴────┴────────────┴──────────┴────────────────┴──────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
[Melvor Idle][87] version [v1.3.1][88] (Released: 30th October 2024)                                
────────────────────────────────────────────────────────────────────────────────────────────────────
** [Combat][89]:** [Attack][90] • [Strength][91] • [Defence][92] • [Hitpoints][93] • [Ranged][94] • 
[Magic][95] • [Prayer][96] • [Slayer][97] • [Corruption][98]                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Skills:** [Farming][99] • [Township][100] • [Woodcutting][101] • [Fishing][102] •                 
[Firemaking][103] • [Cooking][104] • [Mining][105] • [Smithing][106] • [Thieving][107] •            
[Fletching][108] • [Crafting][109] • [Runecrafting][110] • [Herblore][111] • [Agility][112] •       
[Summoning][113] • [Astrology][114] • [Alternative Magic][115] • [Cartography][116] •               
[Archaeology][117] • [Harvesting][118]                                                              
────────────────────────────────────────────────────────────────────────────────────────────────────
**Other**: [Beginners Guide][119] • [Guides][120] • [Bank][121] • [Combat][122] • [Mastery][123] •  
[Money Making][124] • [Shop][125] • [Easter Eggs][126] • [Pets][127] • [Golbin Raid][128] • [Full   
Version][129] • [Throne of the Herald][130] • [Atlas of Discovery][131] • [Into the Abyss][132]     
────────────────────────────────────────────────────────────────────────────────────────────────────
**Reference Tables:** [Items][133], [Equipment][134], [Experience Table][135], [Upgrading           
Items][136], [Combat Areas][137], [Slayer Areas][138], [Dungeons][139], [Strongholds][140], [The    
Abyss][141], [Monsters][142]                                                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
Retrieved from
"[https://wiki.melvoridle.com/index.php?title=Mod_Creation/Essentials&oldid=87055][143]"

## Navigation

### Navigation
* [Main page][144]
* [Recent changes][145]
* [Random page][146]
* [Help about MediaWiki][147]

### Contributing
* [Contribute to this wiki][148]
* [Maintenance][149]

## Wiki tools

### Wiki tools
* [Special pages][150]

## Page tools

### Page tools

### User page tools

### More
* [What links here][151]
* [Related changes][152]
* [Printable version][153]
* [Permanent link][154]
* [Page information][155]
* [Page logs][156]
* [[Powered by MediaWiki]][157]
* This page was last edited on 5 June 2026, at 21:23.
* This page has been accessed 47,272 times.
* [Privacy policy][158]
* [About Melvor Idle][159]
* [Disclaimers][160]
* [Mobile view][161]

[1]: /index.php?title=Special:CreateAccount&returnto=Mod+Creation%2FEssentials
[2]: /index.php?title=Special:UserLogin&returnto=Mod+Creation%2FEssentials
[3]: /w/Mod_Creation/Essentials
[4]: /index.php?title=Talk:Mod_Creation/Essentials&action=edit&redlink=1
[5]: /w/Mod_Creation/Essentials
[6]: /index.php?title=Mod_Creation/Essentials&action=edit
[7]: /index.php?title=Mod_Creation/Essentials&action=history
[8]: /w/Mod_Creation
[9]: /w/Mod_Creation/Getting_Started
[10]: #Creating_a_Mod
[11]: #The_Manifest
[12]: #namespace?:_string
[13]: #icon?:_string
[14]: #setup?:_string
[15]: #load?:_string_|_string[]
[16]: #Structuring_Your_Code
[17]: #Using_Modules_(Recommended)
[18]: #Using_Scripts
[19]: #The_Context_Object
[20]: #Accessing_Your_Mod's_Resources
[21]: #Load_(Import)_a_Module
[22]: #Load_(Inject)_a_Script
[23]: #Load_(Inject)_HTML_Templates
[24]: #Load_(Inject)_a_Stylesheet
[25]: #Load_Data_from_JSON
[26]: #Images,_Sounds,_and_Anything_Else
[27]: #Game_Lifecycle_Hooks
[28]: #Adding_and_Modifying_Game_Objects
[29]: #Defining_a_Data_Package
[30]: #Building_a_Data_Package_at_Runtime
[31]: #Mod_Settings
[32]: #Setting_Types
[33]: #Customizing_the_Sidebar
[34]: #Creating_Reusable_HTML_Components
[35]: #Import_HTML_Templates
[36]: #Defining_a_Component
[37]: #Creating_a_Component_Within_the_UI
[38]: #Storing_Data
[39]: #Limitations
[40]: #Game_Object_Patching/Hooking
[41]: #A_Quick_Note_on_Function_Syntax
[42]: #Do_Something_Before
[43]: #Do_Something_After
[44]: #Replace_the_Method_Entirely
[45]: #Creating_and_using_Modifiers
[46]: #Scoping
[47]: #Apply_bonuses_in_data
[48]: #Define_modifier_in_data
[49]: #modifyValue
[50]: #Expression_placeholders
[51]: #allowedScopes
[52]: #Check_modifier_values_in_Code
[53]: #Testing
[54]: #Exposing_APIs
[55]: #The_Dev_Context
[56]: #Next_Steps
[57]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
[58]: https://www.tutorialspoint.com/what-is-global-namespace-pollution-in-javascript
[59]: https://www.w3schools.com/js/js_modules.asp
[60]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
[61]: https://www.w3docs.com/learn-javascript/dynamic-imports.html
[62]: /w/Mod_Creation/Mod_Context_API_Reference
[63]: /w/Mod_Creation/Mod_Context_API_Reference#Loading_Resources
[64]: /w/Mod_Creation/Mod_Context_API_Reference#Lifecycle_Hooks
[65]: /w/Mod_Creation/Mod_Context_API_Reference#Game_Object_Registration
[66]: /w/Mod_Creation/Mod_Context_API_Reference#Mod_Settings
[67]: /w/Mod_Creation/Mod_Context_API_Reference#Mod_Settings
[68]: /w/Mod_Creation/Sidebar_API_Reference
[69]: /w/Mod_Creation/Sidebar_API_Reference
[70]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[71]: https://github.com/vuejs/petite-vue
[72]: https://github.com/vuejs/petite-vue
[73]: https://github.com/vuejs/petite-vue#components
[74]: /w/Mod_Creation/Mod_Context_API_Reference#Character_Data_Storage
[75]: /w/Mod_Creation/Mod_Context_API_Reference#Account_Data_Storage
[76]: /w/Mod_Creation/Mod_Context_API_Reference#Game_Object_Patching/Hooking
[77]: /w/Mod_Creation/Mod_Context_API_Reference#Exposing_Properties_and_Methods_(Mod_API)
[78]: /w/Mod_Creation/Mod_Context_API_Reference
[79]: /w/Mod_Creation/Sidebar_API_Reference
[80]: /w/Mod_Creation/Getting_Started
[81]: /w/Mod_Creation/Creator_Toolkit
[82]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
[83]: /w/Mod_Creation/Mod_Context_API_Reference
[84]: /w/Mod_Creation/Sidebar_API_Reference
[85]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[86]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[87]: /w/Main_Page
[88]: /w/V1.3.1
[89]: /w/Combat
[90]: /w/Attack
[91]: /w/Strength
[92]: /w/Defence
[93]: /w/Hitpoints
[94]: /w/Ranged
[95]: /w/Magic
[96]: /w/Prayer
[97]: /w/Slayer
[98]: /w/Corruption
[99]: /w/Farming
[100]: /w/Township
[101]: /w/Woodcutting
[102]: /w/Fishing
[103]: /w/Firemaking
[104]: /w/Cooking
[105]: /w/Mining
[106]: /w/Smithing
[107]: /w/Thieving
[108]: /w/Fletching
[109]: /w/Crafting
[110]: /w/Runecrafting
[111]: /w/Herblore
[112]: /w/Agility
[113]: /w/Summoning
[114]: /w/Astrology
[115]: /w/Alternative_Magic
[116]: /w/Cartography
[117]: /w/Archaeology
[118]: /w/Harvesting
[119]: /w/Beginners_Guide
[120]: /w/Guides
[121]: /w/Bank
[122]: /w/Combat
[123]: /w/Mastery
[124]: /w/Money_Making
[125]: /w/Shop
[126]: /w/Easter_Eggs
[127]: /w/Pets
[128]: /w/Golbin_Raid
[129]: /w/Full_Version
[130]: /w/Throne_of_the_Herald_Expansion
[131]: /w/Atlas_of_Discovery_Expansion
[132]: /w/Into_the_Abyss_Expansion
[133]: /w/Table_of_Items
[134]: /w/Equipment
[135]: /w/Experience_Table
[136]: /w/Upgrading_Items
[137]: /w/Combat_Areas
[138]: /w/Slayer_Areas
[139]: /w/Dungeons
[140]: /w/Strongholds
[141]: /w/The_Abyss
[142]: /w/Monsters
[143]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Essentials&oldid=87055
[144]: /w/Main_Page
[145]: /w/Special:RecentChanges
[146]: /w/Special:Random
[147]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[148]: /w/Melvor_Idle:Contributing
[149]: /w/Melvor_Idle:Maintenance
[150]: /w/Special:SpecialPages
[151]: /w/Special:WhatLinksHere/Mod_Creation/Essentials
[152]: /w/Special:RecentChangesLinked/Mod_Creation/Essentials
[153]: javascript:print();
[154]: /index.php?title=Mod_Creation/Essentials&oldid=87055
[155]: /index.php?title=Mod_Creation/Essentials&action=info
[156]: /index.php?title=Special:Log&page=Mod+Creation%2FEssentials
[157]: https://www.mediawiki.org/
[158]: /w/Melvor_Idle:Privacy_policy
[159]: /w/Melvor_Idle:About
[160]: /w/Melvor_Idle:General_disclaimer
[161]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Essentials&mobileaction=toggle_view_
mobile
