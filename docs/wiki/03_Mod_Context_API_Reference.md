# Web Content from https://wiki.melvoridle.com/w/Mod_Creation/Mod_Context_API_Reference

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# Mod Creation/Mod Context API Reference

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

## Contents
* [1 Accessing the Mod Context Object][9]
  * [1.1 From a Module][10]
  * [1.2 From a Script][11]
  * [1.3 From a Lifecycle Method][12]
  * [1.4 From the Dev Context][13]
* [2 Getter Properties][14]
  * [2.1 name: string][15]
  * [2.2 namespace: string | undefined][16]
  * [2.3 version: string][17]
* [3 Loading Resources][18]
  * [3.1 getResourceUrl(path: string): string][19]
  * [3.2 loadModule(path: string): Promise<any>][20]
  * [3.3 loadScript(path: string): Promise<void>][21]
  * [3.4 loadTemplates(path: string): Promise<void>][22]
  * [3.5 loadStylesheet(path: string): void][23]
  * [3.6 loadData(path: string): Promise<any>][24]
* [4 Sharing Resources][25]
  * [4.1 share(resourcePath: string): void][26]
* [5 Lifecycle Hooks][27]
  * [5.1 onModsLoaded(callback: (ctx: ModContext) => void | Promise<void>): void][28]
  * [5.2 onCharacterSelectionLoaded(callback: (ctx: ModContext) => void | Promise<void>): void][29]
  * [5.3 onInterfaceAvailable(callback: (ctx: ModContext) => void | Promise<void>): void][30]
  * [5.4 onCharacterLoaded(callback: (ctx: ModContext) => void | Promise<void>): void][31]
  * [5.5 onInterfaceReady(callback: (ctx: ModContext) => void | Promise<void>): void][32]
* [6 Game Object Registration][33]
  * [6.1 addPackage(data: string | GameDataPackage): Promise<void>][34]
  * [6.2 buildPackage(builder: (packageBuilder: GameDataPackageBuilder) => void):
    BuiltGameDataPackage][35]
    * [6.2.1 BuiltGameDataPackage.package: GameDataPackage][36]
    * [6.2.2 BuiltGameDataPackage.add(): void][37]
* [7 Mod Settings][38]
  * [7.1 section(name: string): Section][39]
    * [7.1.1 Section.add(config: SettingConfig | SettingConfig[]): void][40]
    * [7.1.2 Section.get(name: string): any][41]
    * [7.1.3 Section.set(name: string, value: any): void][42]
  * [7.2 type(name: string, config: SettingTypeConfig): void][43]
    * [7.2.1 SettingTypeConfig][44]
      * [7.2.1.1 render(name: string, onChange: () => void, config: SettingConfig): HTMLElement][45]
      * [7.2.1.2 get(root: HTMLElement): any][46]
      * [7.2.1.3 set(root: HTMLElement, value: any): void][47]
    * [7.2.2 Example][48]
  * [7.3 Built-In Types][49]
    * [7.3.1 Base Setting Configuration][50]
    * [7.3.2 Text][51]
    * [7.3.3 Number][52]
    * [7.3.4 Switch][53]
    * [7.3.5 Dropdown][54]
    * [7.3.6 Button][55]
    * [7.3.7 Checkbox Group][56]
    * [7.3.8 Radio Group][57]
    * [7.3.9 Label][58]
    * [7.3.10 Custom][59]
* [8 Character Data Storage][60]
  * [8.1 Limitations][61]
  * [8.2 setItem(key: string, data: any): void][62]
  * [8.3 getItem(key: string): any][63]
  * [8.4 removeItem(key: string): void][64]
  * [8.5 clear(): void][65]
* [9 Account Data Storage][66]
  * [9.1 Limitations][67]
  * [9.2 setItem(key: string, data: any): void][68]
  * [9.3 getItem(key: string): any][69]
  * [9.4 removeItem(key: string): void][70]
  * [9.5 clear(): void][71]
* [10 Game Object Patching/Hooking][72]
  * [10.1 A Quick Note on Function Syntax][73]
  * [10.2 patch(className: class, methodOrPropertyName: string): MethodPatch | PropertyPatch][74]
    * [10.2.1 MethodPatch.before(hook: (...args: any) => any[] | void): void][75]
    * [10.2.2 MethodPatch.after(hook: (returnValue: any, ...args: any) => any | void): void][76]
    * [10.2.3 MethodPatch.replace(replacement: (replacedMethod: (...args: any) => any, ...args: any)
      => any): void][77]
    * [10.2.4 PropertyPatch.get(getter: (o: () => any) => any): void][78]
    * [10.2.5 PropertyPatch.set(setter: (o: (value: any) => void, value: any) => void): void][79]
    * [10.2.6 PropertyPatch.replace(getter?: (o: () => any) => any, setter?: (o: (value: any) =>
      void, value: any) => void): void][80]
  * [10.3 isPatched(className: class, methodOrPropertyName: string): boolean][81]
* [11 Exposing Properties and Methods (Mod API)][82]
  * [11.1 api(endpoints?: object): object][83]

## Accessing the Mod Context Object

All examples in this guide will assume a mod context object ctx is in the current scope.

### From a Module

If the module is defined as the `"setup"` for your mod in `manifest.json`, the exported `setup`
function will receive the context object as a sole parameter:

export function setup(ctx) {
  // ...
}

Otherwise, use the global `mod.getContext` method, passing in your module's meta object:

const ctx = mod.getContext(import.meta);

### From a Script

The recommended approach for scripts is to use the global `mod.register` method. This only works in
scripts injected via the `"load"` property of `manifest.json` or the `loadScript` method of the
context object.

mod.register(ctx => {
  // ...
});

### From a Lifecycle Method

All game lifecycle method callbacks will also receive their respective mod's context object as a
sole parameter.

onCharacterLoaded(ctx => {
  // ...
});

### From the Dev Context

For easier prototyping, you can use the global `mod.getDevContext` method to get a special dev mod
context object. This should not be used in a mod, but only for development purposes (via the
console). Any APIs that require resources will not work as the dev "mod" does not contain any
resources.

const devCtx = mod.getDevContext();

## Getter Properties

### name: string

The name of the mod.

### namespace: string | undefined

The defined namespace of the mod, if provided.

### version: string

The currently loaded version of the mod.

## Loading Resources

🚨 **All resource file paths must be relative to the root of your mod** 🚨

### getResourceUrl(path: string): string

Retrieves a usable URL for any resource packaged in your mod.

**Parameters**

`path: string` The relative path to the resource to generate a URL for

**Returns**

`string` The URL to the requested resource

**Example**

const url = ctx.getResourceUrl('sea-shanty-2.ogg');
const song = new Audio(url);
song.loop = true;
song.play();

### loadModule(path: string): Promise<any>

Dynamically imports a JavaScript module.

**Parameters**

`path: string` The relative path to the module resource

**Returns**

`Promise<any>` A promise that resolves to an object containing all exported features from the module

**Example**

// my-module.mjs
export function greet(name) {
  console.log(`Hello, ${name}!`);
}

const myModule = await ctx.loadModule('my-module.mjs');
myModule.greet('Melvor'); // Hello, Melvor!

### loadScript(path: string): Promise<void>

Injects a JavaScript file into the page.

**Parameters**

`path: string` The relative path to the script resource

**Returns**

`Promise<void>` A promise that resolves when the injected script has finished running

**Example**

// Await call if wanting the script to run before continuing
await ctx.loadScript('my-script.js');
// my-script.js has run

// Don't await if no dependency on script
ctx.loadScript('my-independednt-script.js');
// my-independent-script.js has NOT run yet

### loadTemplates(path: string): Promise<void>

Inject all <template> elements contained in a given HTML file into the document body.

**Parameters**

`path: string` The relative path to the HTML resource

**Returns**

`Promise<void>` A promise that is resolved once all templates have been injected into the document
body.

**Example**

ctx.loadTemplates('my-templates.html');

### loadStylesheet(path: string): void

Injects a CSS stylesheet into the page.

**Parameters**

`path: string` The relative path to the stylesheet resource

**Example**

ctx.loadStylesheet('my-styles.css');

### loadData(path: string): Promise<any>

Loads data from a JSON resource.

**Parameters**

`path: string` The relative path to the JSON resource

**Returns**

`Promise<any>` A promise that resolves to the parsed JSON object

**Example**

// my-data.json
{
  "coolThings": [
    "rocks"
  ]
}

Comments in JSON are purely illustrative and not valid markup

// in JavaScript
const myData = await ctx.loadData('my-data.json');
console.log(myData.coolThings); // ['rocks']

## Sharing Resources

### share(resourcePath: string): void

Shares a packed mod resource for other mods to use.

**Parameters**

`resourcePath: string` The resource path to be shared.

**Example**

// manifest.json
{
  "namespace": "helloMelvor"
}

Comments in JSON are purely illustrative and not valid markup

// in JavaScript
ctx.share('my_cool_image.png');
ctx.share('Greeter.mjs');

Then another mod can use the resource anywhere that accepts a mod resource path.

ctx.getResourceUrl('helloMelvor:my_cool_image.png');
const { Greeter } = await loadModule('helloMelvor:Greeter.mjs');
const greeter = new Greeter();

## Lifecycle Hooks

### onModsLoaded(callback: (ctx: ModContext) => void | Promise<void>): void

Execute code after all mods have been loaded (character select screen).

**Parameters**

`callback: (ctx: ModContext) => void | Promise<void>` A callback function that receives the mod's
context object as a parameter. Can be synchronous or asynchronous.

**Example**

ctx.onModsLoaded(async (ctx) => {
  // ...
});

### onCharacterSelectionLoaded(callback: (ctx: ModContext) => void | Promise<void>): void

Execute code after the character selection screen has fully loaded.

**Parameters**

`callback: (ctx: ModContext) => void | Promise<void>` A callback function that receives the mod's
context object as a parameter. Can be synchronous or asynchronous.

**Example**

ctx.onCharacterSelectionLoaded(async (ctx) => {
  // ...
});

### onInterfaceAvailable(callback: (ctx: ModContext) => void | Promise<void>): void

Execute code before the character is loaded but after the game interface is initially injected into
the page (but not initialized). Mostly useful for adding interface elements for custom skills that
need to be present before `onCharacterLoaded`.

**Parameters**

`callback: (ctx: ModContext) => void | Promise<void>` A callback function that receives the mod's
context object as a parameter. Can be synchronous or asynchronous.

**Example**

ctx.onInterfaceAvailable(async (ctx) => {
  // ...
});

### onCharacterLoaded(callback: (ctx: ModContext) => void | Promise<void>): void

Execute code after the player's chosen character has loaded and all game objects are created, but
before offline progress calculations.

**Parameters**

`callback: (ctx: ModContext) => void | Promise<void>` A callback function that receives the mod's
context object as a parameter. Can be synchronous or asynchronous.

**Example**

ctx.onCharacterLoaded(async (ctx) => {
  // ...
});

### onInterfaceReady(callback: (ctx: ModContext) => void | Promise<void>): void

Execute code after offline progress has been calculated and all in-game user interface elements have
been created.

**Parameters**

`callback: (ctx: ModContext) => void | Promise<void>` A callback function that receives the mod's
context object as a parameter. Can be synchronous or asynchronous.

**Example**

ctx.onInterfaceReady(async (ctx) => {
  // ...
});

## Game Object Registration

The game object registration API can be accessed through the `gameData` property on the root context
object.

### addPackage(data: string | GameDataPackage): Promise<void>

Registers a game data package.

**Parameters**

`data: string | GameDataPackage` The resource path to your game data package `.json` file or a valid
JavaScript GameDataPackage object.

**Example**

// data.json
{
  "$schema": "https://melvoridle.com/assets/schema/gameData.json",
  "data": {
    // data objects here
  }
}

Comments in JSON are purely illustrative and not valid markup

await ctx.gameData.addPackage('data.json');

### buildPackage(builder: (packageBuilder: GameDataPackageBuilder) => void): BuiltGameDataPackage

Builds a GameDataPackage object using the `GameDataPackageBuilder` API.

**Parameters**

`builder: (packageBuilder: GameDataPackageBuilder) => void` The builder to be used to add individual
game objects to the data package.

**Returns**

`BuiltGameDataPackage` A wrapper for the game data package. See information below.

**Example**

ctx.gameData.buildPackage((p) => {
  // data registration here
});

#### BuiltGameDataPackage.package: GameDataPackage

(Property) The actual built `GameDataPackage` object.

#### BuiltGameDataPackage.add(): void

Registers the built game data package.

**Example**

const pkg = ctx.gameData.buildPackage((p) => { /* ... */ });
pkg.add();

## Mod Settings

When loading your mod as a Local Mod via the Creator Toolkit, the mod must be linked to mod.io and
you must have subscribed to and installed the mod via mod.io in order for this data to persist.

The mod settings API can be accessed through the `settings` property on the root context object.

### section(name: string): Section

Gets or creates a settings section. The order that sections are created are the order they will
display in a mod's settings window.

**Parameters**

`name: string` The name of the section. This will be displayed as a header of the section in the
settings window.

**Returns**

`Section` The section's object, used to perform add, set, or get settings.

**Example**

ctx.settings.section('General');
ctx.settings.section('Other');
// Sections will be displayed in the settings window in this order
// 1. General
// 2. Other

#### Section.add(config: SettingConfig | SettingConfig[]): void

Adds a setting to the section. The order that settings are added to a section are the order they
will display in a mod's settings window.

**Parameters**

`config: SettingConfig | SettingConfig[]` The setting's configuration object or an array of
configuration objects to add multiple settings at once. See Settings Types section below for setting
configuration options.

**Example**

ctx.settings.section('General').add({
  type: 'switch',
  name: 'awesomeness-detection',
  label: 'Awesomeness Detection',
  hint: 'Determines if you are awesome or not.',
  default: false
});

ctx.settings.section('Other').add([{
    type: 'label',
    label: 'I am just a label though my story seldom told...'
  }, {
    type: 'number',
    name: 'pick-a-number',
    label: 'Pick a Number',
    hint: '1 through 10'
}]);

#### Section.get(name: string): any

Gets the current value of a setting by its name property.

**Parameters**

`name: string` The name of the setting to get the value of

**Returns**

`any` The current value of the setting

**Example**

// Assuming the player has typed "1" into the setting
ctx.settings.section('Other').get('pick-a-number'); // 1

#### Section.set(name: string, value: any): void

Programmatically sets the value of a setting by its name property.

**Parameters**

`name: string` The name of the setting to set the value of

`value: any` The value to set the setting to

**Example**

ctx.settings.section('Other').set('pick-a-number', 5);

### type(name: string, config: SettingTypeConfig): void

Registers a setting type that can then be used by by any mod when adding a setting.

**Parameters**

`name: string` The name of the setting type. This is what should be used for the type property of a
setting configuration when adding a new setting. Other mods have to prepend the name with your mod's
namespace.

`config: SettingTypeConfig` An object defining the setting type's behavior. See definition below.

**Example**

// manifest.json
{
  "namespace": "my_mod",
  // ...
}

Comments in JSON are purely illustrative and not valid markup

ctx.settings.type('customText', {
  // See example config in SettingTypeConfig section below
});

ctx.settings.section('General').add({
  type: 'customText',
  // ...
});

Other mods will have to add your namespace to use your custom type:

ctx.settings.section('Other').add({
  type: 'my_mod:customText',
  // ...
});

#### SettingTypeConfig

All functions are required.

##### render(name: string, onChange: () => void, config: SettingConfig): HTMLElement

The render function is responsible for using any properties passed into the config to render HTML
for the setting.

The `name` parameter should be used as a form of id in the setting's HTML, if needed. The common use
case for this is setting an `<input>`'s `name` and `id` attributes to this value, and then setting a
`<label>`'s `for` attribute to this value as well.

The `onChange` parameter should be called when this setting's value is changed. The common use case
for this is adding this as an event listener to an `<input>` element's `change` event.

The `config` parameter holds all values passed in the config object when this setting is being
added. For example, the `label`, `hint`, `default`, etc. properties.

Individual settings can opt to return validation errors in their `onChange` method. You can give a
place to display this validation error in an element with a class of `validation-message`.

// The render function for a simple text box
function render(name, onChange, config) {
  const input = document.createElement('input');
  input.id = name;
  input.type = 'text';
  input.name = name;
  input.addEventListener('change', () => onChange());

  const label = document.createElement('label');
  label.for = name;
  label.textContent = config.label;

  if (config.hint) {
    const hint = document.createElement('small');
    hint.textContent = config.hint;
    label.appendChild(hint);
  }

  const validation = document.createElement('small');
  validation.classList.add('text-danger', 'validation-message');

  const root = document.createElement('div');
  root.appendChild(input);
  root.appendChild(label);
  root.appendChild(validation);

  return root;
}

##### get(root: HTMLElement): any

The `get` function is responsible for retrieving the current value of the setting. It receives just
one parameter, the root HTML element returned from the render function, which can be useful for
getting the current value.

// get function for simple text input defined by above render
function get(root) {
  return root.querySelector('input').value;
}

##### set(root: HTMLElement, value: any): void

The `set` function is responsible to keeping the HTML up-to-date with the current value (if updated
programmatically). It receives the root HTML element from the render function and the value being
set as the two parameters.

// set function for simple text setting defined above
function set(root, value) {
  root.querySelector('input').value = value;
}

#### Example

// Use functions defined in above examples as reference
ctx.settings.type('simpleText', {
  render: render,
  get: get,
  set: set
});

### Built-In Types

#### Base Setting Configuration

All individual settings inherit this base setting config object.

interface SettingConfig {
  type: string; // Type of the setting
  name: string; // Name of the setting
  label: string | HTMLElement; // Display label for the setting
  hint: string | HTMLElement; // Small help text to display alongside the setting
  default: any; // Default value for the setting
  onChange(value: any, previousValue: any): void | boolean | string // See notes
}

The `onChange` option is a callback function that receives the new value being set and the previous
value of the setting. This function can optionally return a value to serve as a validator:
* No return value / `undefined` / `true` / truth-y (non-string) value: Validates successfully and
  allows the value to be changed
* `false` / false-y value: Validation fails and setting value is restored to previous
* `string` value: Validation fails, setting value is restored to previous, and the string contents
  are displayed in a `.validation-message` element, if available (see custom render above)

#### Text

A simple textbox that accepts any character by default. Value is of type `string`.

interface TextConfig implements SettingConfig {
  type: 'text';
  maxLength: number; // Max length attribute for the textbox
}

#### Number

A simple textbox that only accepts numbers. Value is of type `number`.

interface NumberConfig implements SettingConfig {
  type: 'number';
  min: number; // Minimum value to be entered
  max: number; // Maximum value to be entered
}

#### Switch

An on/off toggle switch. Value is of type `boolean`.

interface SwitchConfig implements SettingConfig {
  type: 'switch'
}

#### Dropdown

A dropdown button. Example: "Default Page on Load" game setting. Value is of type `any`.

DropdownConfig implements SettingConfig {
  type: 'dropdown';
  color: string; // see Button config
  options: DropdownOption[]; // see note
}

The `options` option defines the dropdown options available to be selected. Dropdown option schema
is:

interface DropdownOption {
  value: any; // value that is used by the setting
  display: string | HTMLElement; // display text or element on the option
}

#### Button

A button. Value is `undefined`.

interface ButtonConfig implements SettingConfig {
  type: 'button';
  display: string | HTMLElement; // displayed text or element inside the button
  color: string; // see note
  onClick(): void; // triggered on click of the button
}

The `color` option is appended to a CSS class starting with `btn-` and defaults to `primary`
(`btn-primary`) if not defined. Default colors available:
* primary: blue
* secondary: grey
* success: green
* info: light blue
* warning: yellow
* danger: red
* dark: dark grey

#### Checkbox Group

A group of checkboxes. Value is of type `any[]`.

interface CheckboxGroupConfig implements SettingConfig {
  type: 'checkbox-group';
  options: CheckboxOption[]; // see note
}

The `options` option defines the checkboxes that are available to be selected. Checkbox option
schema is:

interface CheckboxOption {
  value: any; // value to be added to array that is set as setting value
  label: string | HTMLElement;
  hint: string | HTMLElement;
}

#### Radio Group

A group of radio buttons. Value is of type `any`.

interface RadioGroupConfig implements SettingConfig {
  type: 'radio-group';
  options: CheckboxOption[]; // see checkbox group's options schema
}

#### Label

A simple label. Value is `undefined`.

interface LabelConfig implements SettingConfig {
  type: 'label';
}

#### Custom

A custom-rendered setting. See [SettingTypeConfig][84] section above. This is different from
registering a custom setting type as this is a one-off and will not register the type for reuse.
Value is of type `any`.

interface CustomConfig implements SettingConfig, SettingTypeConfig {
  type: 'custom';
}

## Character Data Storage

When loading your mod as a Local Mod via the Creator Toolkit, the mod must be linked to mod.io and
you must have subscribed to and installed the mod via mod.io in order for this data to persist.

The character storage API can be accessed through the `characterStorage` property on the root
context object.

### Limitations

The character storage can only be used once a character has been loaded (after lifecycle hook
`onCharacterLoaded`).

Each character can store up to 8,192 bytes (8kb) of data per mod, including keys. Only
JSON-serializable data can be stored. This includes primitive types (`string`, `number`, `boolean`)
and objects and arrays that contain only primitive types or other objects or arrays that fit this
description. This serialization/deserialization is handled automatically.

### setItem(key: string, data: any): void

Sets a key/value pair in character storage.

**Parameters**

`key: string` The key to identify the data being stored. Used in calls to `getItem` and
`removeItem`.

`data: any` The data to be stored. See limitations above.

**Example**

ctx.characterStorage.setItem('coolThings', ['rocks']);

### getItem(key: string): any

Gets a value by its key from character storage.

**Parameters**

key: string The key of the data to retrieve

**Returns**

`any` The data retrieved. Returns `undefined` if no such key is stored.

**Example**

ctx.characterStorage.getItem('coolThings'); // returns ['rocks']

### removeItem(key: string): void

Removes a key/value pair by key from character storage.

**Parameters**

`key: string` The key of the key/value pair to remove

**Example**

ctx.characterStorage.removeItem('coolThings');
ctx.characterStorage.getItem('coolThings'); // returns undefined

### clear(): void

Removes all key/value pairs from character storage.

**Example**

ctx.characterStorage.clear();

## Account Data Storage

When loading your mod as a Local Mod via the Creator Toolkit, the mod must be linked to mod.io and
you must have subscribed to and installed the mod via mod.io in order for this data to persist.

The account storage API can be accessed through the `accountStorage` property on the root context
object.

### Limitations

Due to the cloud-based nature of how account data is stored and potential network issues the player
may experience, data integrity is not 100% guaranteed in the account storage. Account storage is
advised to be used sparingly.

An account can store up to 8,192 bytes (8kb) of data per mod, including keys. Only JSON-serializable
data can be stored. This includes primitive types (`string`, `number`, `boolean`) and objects and
arrays that contain only primitive types or other objects or arrays that fit this description. This
serialization/deserialization is handled automatically.

### setItem(key: string, data: any): void

Sets a key/value pair in account storage.

**Parameters**

`key: string` The key to identify the data being stored. Used in calls to `getItem` and
`removeItem`.

`data: any` The data to be stored. See limitations above.

**Example**

ctx.accountStorage.setItem('coolThings', ['rocks']);

### getItem(key: string): any

Gets a value by its key from account storage.

**Parameters**

`key: string` The key of the data to retrieve

**Returns**

`any` The data retrieved. Returns `undefined` if no such key is stored.

**Example**

ctx.accountStorage.getItem('coolThings'); // returns ['rocks']

### removeItem(key: string): void

Removes a key/value pair by key from account storage.

**Parameters**

`key: string` The key of the key/value pair to remove

**Example**

ctx.accountStorage.removeItem('coolThings');
ctx.accountStorage.getItem('coolThings'); // returns undefined

### clear(): void

Removes all key/value pairs from account storage.

**Example**

ctx.accountStorage.clear();

## Game Object Patching/Hooking

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

### patch(className: class, methodOrPropertyName: string): MethodPatch | PropertyPatch

This is the entry-point to the method and getter/setter patching API. Depending on if the second
parameter is a method or getter/setter property, a `MethodPatch` or `PropertyPatch` object will be
returned, respectively. The MethodPatch/PropertyPatch object should then be used to perform further
actions with the specified class and method/property.

**Parameters**

`className: class` Class containing the method or getter/setter you want to patch. Should be the
actual class reference, not a string, e.g. `Skill`, not `'Skill'`.

`methodOrPropertyName: string` Name of the method or getter/setter property to patch.

**Returns**

`MethodPatch | PropertyPatcch` A patch object for the specified class and method or getter/setter
property. See below for usage.

**Example**

ctx.patch(Skill, 'addXP'); // Returns a MethodPatch
ctx.patch(Skill, 'level'); // Returns a PropertyPatch

#### MethodPatch.before(hook: (...args: any) => any[] | void): void

Execute a callback function immediately before the method body is called. The callback function's
parameters are the arguments being passed into the method call. Optionally the callback function can
return an array of values to override the arguments being passed to the method body. If no return
value is specified (returns `undefined`), the arguments are left as-is.

**Parameters**

`hook: (...args: any) => any[] | void` The callback hook to be executed.

**Example**

// Double all XP gains
ctx.patch(Skill, 'addXP').before(function (amount, masteryAction) {
  return [amount * 2, masteryAction];
});

#### MethodPatch.after(hook: (returnValue: any, ...args: any) => any | void): void

Execute a callback function immediate after the method body is finished executing. The callback
function's first parameter is the value returned from the method body. The rest of the parameters
are the arguments that were passed into the method body. Optionally the callback function can return
a new value to override the method's return value. If no return value is specified (returns
`undefined`), the return value is left as-is.

**Parameters**

`hook: (returnValue: any, ...args: any) => any | void` The callback hook to be executed.

**Example**

// The player never misses an attack
// Patching: rollToHit(target: Character, attack: SpecialAttack): boolean;
ctx.patch(Player, 'rollToHit').after(function(willHit, target, attack) {
  if (!willHit) {
    console.log(`A miss? With ${attack.name}? Against ${target.noun.plain}? I think not!`);
  }
  return true;
})

#### MethodPatch.replace(replacement: (replacedMethod: (...args: any) => any, ...args: any) => any):
#### void

Execute a callback function instead of the method's current body. The callback function's first
parameter is the replaced method body. The rest of the parameters are the arguments that were to be
passed to the method. The callback function's return value is the return value for the method. The
replacement function is still subject to argument/return value modifications made in `before` and
`after` hooks, respectively.

**Parameters**

`replacement: (replacedMethod: (...args: any) => any, ...args: any) => any` The callback function to
replace the method body.

**Example**

ctx.patch(Skill, 'addXP').replace(function (o, amount, masteryAction) {
  // Prevent any woodcutting XP
  if (this.id === 'melvorD:Woodcutting') return;

  // Double any mining XP
  if (this.id === 'melvorD:Mining') return o(amount * 2, masteryAction);

  // Grant all other XP as normal
  return o(amount, masteryAction);
});

It's important to note that using the `replace` method replaces the current method body, meaning
multiple calls of the `replace` method get executed in the reverse order that they were declared:

const xpPatch = ctx.patch(Skill, 'addXP');

xpPatch.replace(function (o, amount, masteryAction) {
  console.log('Replacement #1');
  return o(amount, masteryAction);
});

xpPatch.replace(function (o, amount, masteryAction) {
  console.log('Replacement #2');
  return o(amount, masteryAction);
});

game.woodcutting.addXP(100);
// Logs:
// Replacement #2
// Replacement #1

#### PropertyPatch.get(getter: (o: () => any) => any): void

Execute the provided function and return the return value when a getter property is accessed.

**Parameters**

`getter: (o: () => any) => any` The getter function to be executed. The parameter `o` is a reference
to the getter method being replaced, which is either a previous getter patch or the original getter
method.

**Example**

// Effectively double available Township resources
ctx.patch(TownshipResource, 'amount').get(function (o) {
  return o() * 2;
});
// Or more practically, make resources unlimited
ctx.patch(TownshipResource, 'amount').get(function () {
  return 999999;
});

#### PropertyPatch.set(setter: (o: (value: any) => void, value: any) => void): void

Execute the provided function when a setter property is accessed.

**Parameters**

`setter: (o: (value: any) => void, value: any) => void` The setter function to be executed. The
first parameter, `o`, is a reference to the setter method being replaced, which is either a previous
setter patch or the original setter method. The second parameter, `value`, contains the value being
set.

**Example**

// Sorry, there aren't many setters in the game to use for a practical example
// Doubles whatever resource amount is being set
ctx.patch(TownshipResource, 'amount').set(function (o, amount) {
  return o(amount * 2);
});
// While in-game
game.township.resources.getObjectByID('melvorF:Wood').amount = 1000;
game.township.renderQueue.resourceAmounts = true;
// 2000 wood is available

#### PropertyPatch.replace(getter?: (o: () => any) => any, setter?: (o: (value: any) => void, value:
#### any) => void): void

Alias for calling `get` and `set` at the same time.

**Parameters**

`getter: (o: () => any) => any` See above Parameters for `get`.

`setter: (o: (value: any) => void, value: any) => void` See above Parameters for `set`.

**Example**

See above examples for `get` and `set`.

### isPatched(className: class, methodOrPropertyName: string): boolean

Checks whether or not a method or getter/setter property has been patched.

**Parameters**

`className: class` Class containing the method or property to check for having been patched. Should
be the actual class reference, not a string, e.g. `Skill`, not `'Skill'`.

`methodOrPropertyName: string` Name of the method or property to check.

**Returns**

`boolean` Whether or not the given class method or property is patched.

**Example**

ctx.isPatched(Skill, 'addXP'); // false
ctx.patch(Skill, 'addXP');
ctx.isPatched(Skill, 'addXP'); // true

## Exposing Properties and Methods (Mod API)

You may want to allow other mods to be able to interact or integrate with your mod through an API
you define. To do so, the recommended approach is through the `api` method on the context object.
After defining an API using the method below, other mods can access it through the global
`mod.api['your_mods_namespace']` object.

### api(endpoints?: object): object

Specify properties and methods to expose on the global `mod.api['your_mods_namespace']` object. Can
be called multiple times to append more endpoints.

**Parameters**

`endpoint: object` An object containing any properties or methods you want to expose. Can be omitted
to just retrieve your mod's current API object.

**Returns**

`object` The mod's API object

**Example**

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

────────────────────────────────────────────────────────────────────────────────────────────────────
Modding Guides                                                                                      
────────┬────────┬─────────────────┬──────┬──────────┬──────────┬────────────────┬──────────────────
[Getting│[Creator│[Migrating from  │[Essen│Mod       │[Sidebar  │[Reusable       │[Enabling DevTools
Started]│Toolkit]│Scripts and      │tials]│Context   │API       │Components with │for the Steam and 
[85]    │[86]    │Extensions][87]  │[88]  │API       │Reference]│PetiteVue][90]  │Epic Clients][91] 
        │        │                 │      │Reference │[89]      │                │                  
────────┴────────┴─────────────────┴──────┴──────────┴──────────┴────────────────┴──────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
[Melvor Idle][92] version [v1.3.1][93] (Released: 30th October 2024)                                
────────────────────────────────────────────────────────────────────────────────────────────────────
** [Combat][94]:** [Attack][95] • [Strength][96] • [Defence][97] • [Hitpoints][98] • [Ranged][99] • 
[Magic][100] • [Prayer][101] • [Slayer][102] • [Corruption][103]                                    
────────────────────────────────────────────────────────────────────────────────────────────────────
**Skills:** [Farming][104] • [Township][105] • [Woodcutting][106] • [Fishing][107] •                
[Firemaking][108] • [Cooking][109] • [Mining][110] • [Smithing][111] • [Thieving][112] •            
[Fletching][113] • [Crafting][114] • [Runecrafting][115] • [Herblore][116] • [Agility][117] •       
[Summoning][118] • [Astrology][119] • [Alternative Magic][120] • [Cartography][121] •               
[Archaeology][122] • [Harvesting][123]                                                              
────────────────────────────────────────────────────────────────────────────────────────────────────
**Other**: [Beginners Guide][124] • [Guides][125] • [Bank][126] • [Combat][127] • [Mastery][128] •  
[Money Making][129] • [Shop][130] • [Easter Eggs][131] • [Pets][132] • [Golbin Raid][133] • [Full   
Version][134] • [Throne of the Herald][135] • [Atlas of Discovery][136] • [Into the Abyss][137]     
────────────────────────────────────────────────────────────────────────────────────────────────────
**Reference Tables:** [Items][138], [Equipment][139], [Experience Table][140], [Upgrading           
Items][141], [Combat Areas][142], [Slayer Areas][143], [Dungeons][144], [Strongholds][145], [The    
Abyss][146], [Monsters][147]                                                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
Retrieved from
"[https://wiki.melvoridle.com/index.php?title=Mod_Creation/Mod_Context_API_Reference&oldid=70141][14
8]"

## Navigation

### Navigation
* [Main page][149]
* [Recent changes][150]
* [Random page][151]
* [Help about MediaWiki][152]

### Contributing
* [Contribute to this wiki][153]
* [Maintenance][154]

## Wiki tools

### Wiki tools
* [Special pages][155]

## Page tools

### Page tools

### User page tools

### More
* [What links here][156]
* [Related changes][157]
* [Printable version][158]
* [Permanent link][159]
* [Page information][160]
* [Page logs][161]
* [[Powered by MediaWiki]][162]
* This page was last edited on 10 June 2024, at 18:36.
* This page has been accessed 46,708 times.
* [Privacy policy][163]
* [About Melvor Idle][164]
* [Disclaimers][165]
* [Mobile view][166]

[1]: /index.php?title=Special:CreateAccount&returnto=Mod+Creation%2FMod+Context+API+Reference
[2]: /index.php?title=Special:UserLogin&returnto=Mod+Creation%2FMod+Context+API+Reference
[3]: /w/Mod_Creation/Mod_Context_API_Reference
[4]: /index.php?title=Talk:Mod_Creation/Mod_Context_API_Reference&action=edit&redlink=1
[5]: /w/Mod_Creation/Mod_Context_API_Reference
[6]: /index.php?title=Mod_Creation/Mod_Context_API_Reference&action=edit
[7]: /index.php?title=Mod_Creation/Mod_Context_API_Reference&action=history
[8]: /w/Mod_Creation
[9]: #Accessing_the_Mod_Context_Object
[10]: #From_a_Module
[11]: #From_a_Script
[12]: #From_a_Lifecycle_Method
[13]: #From_the_Dev_Context
[14]: #Getter_Properties
[15]: #name:_string
[16]: #namespace:_string_|_undefined
[17]: #version:_string
[18]: #Loading_Resources
[19]: #getResourceUrl(path:_string):_string
[20]: #loadModule(path:_string):_Promise<any>
[21]: #loadScript(path:_string):_Promise<void>
[22]: #loadTemplates(path:_string):_Promise<void>
[23]: #loadStylesheet(path:_string):_void
[24]: #loadData(path:_string):_Promise<any>
[25]: #Sharing_Resources
[26]: #share(resourcePath:_string):_void
[27]: #Lifecycle_Hooks
[28]: #onModsLoaded(callback:_(ctx:_ModContext)_=>_void_|_Promise<void>):_void
[29]: #onCharacterSelectionLoaded(callback:_(ctx:_ModContext)_=>_void_|_Promise<void>):_void
[30]: #onInterfaceAvailable(callback:_(ctx:_ModContext)_=>_void_|_Promise<void>):_void
[31]: #onCharacterLoaded(callback:_(ctx:_ModContext)_=>_void_|_Promise<void>):_void
[32]: #onInterfaceReady(callback:_(ctx:_ModContext)_=>_void_|_Promise<void>):_void
[33]: #Game_Object_Registration
[34]: #addPackage(data:_string_|_GameDataPackage):_Promise<void>
[35]: #buildPackage(builder:_(packageBuilder:_GameDataPackageBuilder)_=>_void):_BuiltGameDataPackage
[36]: #BuiltGameDataPackage.package:_GameDataPackage
[37]: #BuiltGameDataPackage.add():_void
[38]: #Mod_Settings
[39]: #section(name:_string):_Section
[40]: #Section.add(config:_SettingConfig_|_SettingConfig[]):_void
[41]: #Section.get(name:_string):_any
[42]: #Section.set(name:_string,_value:_any):_void
[43]: #type(name:_string,_config:_SettingTypeConfig):_void
[44]: #SettingTypeConfig
[45]: #render(name:_string,_onChange:_()_=>_void,_config:_SettingConfig):_HTMLElement
[46]: #get(root:_HTMLElement):_any
[47]: #set(root:_HTMLElement,_value:_any):_void
[48]: #Example
[49]: #Built-In_Types
[50]: #Base_Setting_Configuration
[51]: #Text
[52]: #Number
[53]: #Switch
[54]: #Dropdown
[55]: #Button
[56]: #Checkbox_Group
[57]: #Radio_Group
[58]: #Label
[59]: #Custom
[60]: #Character_Data_Storage
[61]: #Limitations
[62]: #setItem(key:_string,_data:_any):_void
[63]: #getItem(key:_string):_any
[64]: #removeItem(key:_string):_void
[65]: #clear():_void
[66]: #Account_Data_Storage
[67]: #Limitations_2
[68]: #setItem(key:_string,_data:_any):_void_2
[69]: #getItem(key:_string):_any_2
[70]: #removeItem(key:_string):_void_2
[71]: #clear():_void_2
[72]: #Game_Object_Patching/Hooking
[73]: #A_Quick_Note_on_Function_Syntax
[74]: #patch(className:_class,_methodOrPropertyName:_string):_MethodPatch_|_PropertyPatch
[75]: #MethodPatch.before(hook:_(...args:_any)_=>_any[]_|_void):_void
[76]: #MethodPatch.after(hook:_(returnValue:_any,_...args:_any)_=>_any_|_void):_void
[77]: #MethodPatch.replace(replacement:_(replacedMethod:_(...args:_any)_=>_any,_...args:_any)_=>_any
):_void
[78]: #PropertyPatch.get(getter:_(o:_()_=>_any)_=>_any):_void
[79]: #PropertyPatch.set(setter:_(o:_(value:_any)_=>_void,_value:_any)_=>_void):_void
[80]: #PropertyPatch.replace(getter?:_(o:_()_=>_any)_=>_any,_setter?:_(o:_(value:_any)_=>_void,_valu
e:_any)_=>_void):_void
[81]: #isPatched(className:_class,_methodOrPropertyName:_string):_boolean
[82]: #Exposing_Properties_and_Methods_(Mod_API)
[83]: #api(endpoints?:_object):_object
[84]: #SettingTypeConfig
[85]: /w/Mod_Creation/Getting_Started
[86]: /w/Mod_Creation/Creator_Toolkit
[87]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
[88]: /w/Mod_Creation/Essentials
[89]: /w/Mod_Creation/Sidebar_API_Reference
[90]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[91]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[92]: /w/Main_Page
[93]: /w/V1.3.1
[94]: /w/Combat
[95]: /w/Attack
[96]: /w/Strength
[97]: /w/Defence
[98]: /w/Hitpoints
[99]: /w/Ranged
[100]: /w/Magic
[101]: /w/Prayer
[102]: /w/Slayer
[103]: /w/Corruption
[104]: /w/Farming
[105]: /w/Township
[106]: /w/Woodcutting
[107]: /w/Fishing
[108]: /w/Firemaking
[109]: /w/Cooking
[110]: /w/Mining
[111]: /w/Smithing
[112]: /w/Thieving
[113]: /w/Fletching
[114]: /w/Crafting
[115]: /w/Runecrafting
[116]: /w/Herblore
[117]: /w/Agility
[118]: /w/Summoning
[119]: /w/Astrology
[120]: /w/Alternative_Magic
[121]: /w/Cartography
[122]: /w/Archaeology
[123]: /w/Harvesting
[124]: /w/Beginners_Guide
[125]: /w/Guides
[126]: /w/Bank
[127]: /w/Combat
[128]: /w/Mastery
[129]: /w/Money_Making
[130]: /w/Shop
[131]: /w/Easter_Eggs
[132]: /w/Pets
[133]: /w/Golbin_Raid
[134]: /w/Full_Version
[135]: /w/Throne_of_the_Herald_Expansion
[136]: /w/Atlas_of_Discovery_Expansion
[137]: /w/Into_the_Abyss_Expansion
[138]: /w/Table_of_Items
[139]: /w/Equipment
[140]: /w/Experience_Table
[141]: /w/Upgrading_Items
[142]: /w/Combat_Areas
[143]: /w/Slayer_Areas
[144]: /w/Dungeons
[145]: /w/Strongholds
[146]: /w/The_Abyss
[147]: /w/Monsters
[148]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Mod_Context_API_Reference&oldid=7014
1
[149]: /w/Main_Page
[150]: /w/Special:RecentChanges
[151]: /w/Special:Random
[152]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[153]: /w/Melvor_Idle:Contributing
[154]: /w/Melvor_Idle:Maintenance
[155]: /w/Special:SpecialPages
[156]: /w/Special:WhatLinksHere/Mod_Creation/Mod_Context_API_Reference
[157]: /w/Special:RecentChangesLinked/Mod_Creation/Mod_Context_API_Reference
[158]: javascript:print();
[159]: /index.php?title=Mod_Creation/Mod_Context_API_Reference&oldid=70141
[160]: /index.php?title=Mod_Creation/Mod_Context_API_Reference&action=info
[161]: /index.php?title=Special:Log&page=Mod+Creation%2FMod+Context+API+Reference
[162]: https://www.mediawiki.org/
[163]: /w/Melvor_Idle:Privacy_policy
[164]: /w/Melvor_Idle:About
[165]: /w/Melvor_Idle:General_disclaimer
[166]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Mod_Context_API_Reference&mobileacti
on=toggle_view_mobile
