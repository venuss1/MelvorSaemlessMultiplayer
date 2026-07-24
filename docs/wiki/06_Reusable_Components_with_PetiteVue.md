# Web Content from https://wiki.melvoridle.com/w/Mod_Creation/Reusable_Components_with_PetiteVue

## Anonymous

### Not logged in
* [Create account][1]
* [Log in][2]

### Search

# Mod Creation/Reusable Components with PetiteVue

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

Melvor Idle ships with [PetiteVue][9] for mods to use to create reusable HTML components. The
documentation from the [official GitHub page][10] in addition to the [full Vue.js documentation][11]
(for clarity on definitions and what the PetiteVue directives do - there are many full Vue.js
features that are unavailable) may assist in using the PetiteVue library. However, there are also
helper functions for making it easier for mods to interact with PetiteVue.

## Contents
* [1 Helper Functions][12]
  * [1.1 ui.create(props: ComponentProps, host: HTMLElement): HTMLElement][13]
  * [1.2 ui.createStore(props: Record<string, unknown>): ComponentStore][14]
  * [1.3 ui.createStatic(template: string, host: HTMLElement): HTMLElement][15]
    * [1.3.1 Nesting Static Components][16]
* [2 Useful Patterns][17]
  * [2.1 Nesting Components][18]
  * [2.2 Programmatically Manipulating Components][19]
* [3 PetiteVue Quick Reference][20]
  * [3.1 Text Bindings][21]
  * [3.2 Attribute Binding][22]
  * [3.3 Event Binding/Handling][23]
  * [3.4 Input Value Binding][24]
  * [3.5 Conditional Rendering][25]

## Helper Functions

These are the functions provided by Melvor Idle to interact with PetiteVue. For the sake of avoiding
edge cases and oddities surrounding how mods are loaded, you should use these instead of interacting
with the `PetiteVue` global object directly.

### ui.create(props: ComponentProps, host: HTMLElement): HTMLElement

Creates an instance of a component and mounts it within the HTML.

**Parameters**

`props: ComponentProps` The PetiteVue component function that you want to instantiate.

`host: HTMLElement` The element that the component should be appended to.

**Returns**

`HTMLElement` The host element.

**Example**

<!-- templates.html -->
<template id="counter-component">
  <span class="text-light">{{ count }}</span>
  <button class="btn btn-secondary" @click="inc">+</button>
</template>

// manifest.json
{
  "load": ["templates.html"]
}

Comments in JSON are purely illustrative and not valid markup

// setup.mjs
function Counter(props) {
  return {
    $template: '#counter-component',
    count: props.count,
    inc() {
      this.count++;
    }
  };
}

export function setup({ onInterfaceReady }) {
  onInterfaceReady(() => {
    // Create and append a Counter component to the bottom of the Woodcutting page
    ui.create(Counter({ count: 0 }), document.getElementById('woodcutting-container'));
  });
}

### ui.createStore(props: Record<string, unknown>): ComponentStore

Creates a PetiteVue store for sharing state amongst components.

**Parameters**

`props: Record<string, unknown>` The props that the store should contain.

**Returns**

`ComponentStore` The PetiteVue store that can be shared between components.

**Example**

In the above example for `ui.create`, if you created a second `Counter` component, it would contain
its own state and clicking the incrementing button on one would have no effect on the other. By
using a store, you can share state in the following way:

<!-- templates.html -->
<template id="counter-component-using-store">
  <span class="text-light">{{ store.count }}</span>
  <button class="btn btn-secondary" @click="store.inc">+</button>
</template>

// manifest.json
{
  "load": ["templates.html"]
}

Comments in JSON are purely illustrative and not valid markup

// setup.mjs
function CounterUsingStore({ store }) {
  return {
    $template: '#counter-component-using-store',
    store
  };
}

export function setup({ onInterfaceReady }) {
  onInterfaceReady(() => {
    const store = ui.createStore({
      count: 0,
      inc() {
        this.count++;
      }
    });

    // Create and append a CounterUsingStore component to the bottom of the Woodcutting page
    ui.create(CounterUsingStore({ store }), document.getElementById('woodcutting-container'));
    // Create and append another CounterUsingStore component to the bottom of the Firemaking page
    ui.create(CounterUsingStore({ store }), document.getElementById('firemaking-container'));
  });
}

Now in this example, both the counter on the Woodcutting page and the Firemaking page should stay in
sync with the current count.

### ui.createStatic(template: string, host: HTMLElement): HTMLElement

Creates an instance of a static component (no PetiteVue bindings) and mounts it within the HTML.
This helper function doesn't use PetiteVue but should be preferred if you only need to create a
reusable static piece of HTML.

**Parameters**

`template: string` The selector string for the template you want to clone. For example, to target
`<template id="static-component"><!-- --></template>`, you would use `'#static-component'`.

`host: HTMLElement` The element that the component should be appended to.

**Returns**

`HTMLElement` The host element.

**Example**

<!-- static-templates.html -->
<template id="my-static-component">
  <h3>Hello, this is static HTML</h3>
</template>

// manifest.json
{
  "load": ["static-templates.html"]
}

Comments in JSON are purely illustrative and not valid markup

// setup.mjs
export function setup({ onInterfaceReady }) {
  onInterfaceReady(() => {
    // Create the static component and place it at the bottom of the Woodcutting page
    ui.createStatic('#my-static-component', document.getElementById('woodcutting-container'));
  });
}

#### Nesting Static Components

In order to nest static components, child component templates need to be referenced by using a
`s-template` attribute on the host element.

For example, given the following templates:

<!-- static-templates.html -->
<template id="static-parent">
  <h3>Hello, this is static HTML from the parent</h3>
  <div s-template="#static-child"></div>
</template>

<template id="static-child">
  <p>And this HTML is from a static child.</p>
</template>

You could create the parent component using the following:

// setup.mjs
export function setup({ onInterfaceReady }) {
  onInterfaceReady(() => {
    ui.createStatic('#static-parent', document.getElementById('woodcutting-container'));
  });
}

Which results in the following HTML being appended to the bottom of the Woodcutting page:

<h3>Hello, this is static HTML from the parent</h3>
<div>
  <p>And this HTML is from a static child.</p>
</div>

## Useful Patterns

### Nesting Components

PetiteVue components may be nested to create larger reusable components. This pattern, likely
combined with a PetiteVue store, can be followed all the way to creating the entire UI for your mod
in a single parent component (which would be preferred, rather than calling `ui.create` many times).

Consider the following templates:

<!-- templates.html -->
<template id="block-component">
  <div class="block">
    <div class="block-header" v-scope="BlockHeader(headerProps)"></div>
    <div class="block-content" v-scope="BlockContent(contentProps)"></div>
  </div>
</template>

<template id="block-header">
  <h3 class="block-title">{{ title }}</h3>
</template>

<template id="block-content">
  <p v-for="line in lines">{{ line }}</p>
</template>

And defined components:

function Block(props) {
  return {
    $template: '#block-component',
    BlockHeader,
    BlockContent,
    headerProps: props.header,
    contentProps: props.content
  };
}

function BlockHeader(props) {
  return {
    $template: '#block-header',
    title: props.title
  };
}

function BlockContent(props) {
  return {
    $template: '#block-content',
    lines: props.lines
  };
}

A complete block component can be created with the following:

ui.create(Block({
  header: { title: 'My Block Component' },
  content: { lines: ['My first paragraph.', 'My second paragraph.'] }
}), document.getElementById('woodcutting-container'));

### Programmatically Manipulating Components

If you need to programmatically manipulate a component's (or store's) state, save the reference to
the `props` object being passed into `ui.create`. The state should only be manipulated through
methods on the object, not directly setting properties.

For example, using our `Counter` from above:

<!-- templates.html -->
<template id="counter-component">
  <span class="text-light">{{ count }}</span>
  <button class="btn btn-secondary" @click="inc">+</button>
</template>

// setup.mjs
function Counter(props) {
  return {
    $template: '#counter-component',
    count: props.count,
    inc() {
      this.count++;
    }
  };
}

export function setup({ onInterfaceReady }) {
  onInterfaceReady(() => {
    // Save a reference here
    const counter = Counter({ count: 0 });
    ui.create(counter, document.getElementById('woodcutting-container'));

    // Manipulate here to reflect changes in the UI
    // BAD: counter.count++;
    // GOOD:
    counter.inc();
  });
}

## PetiteVue Quick Reference

This is not an exhaustive rundown of PetiteVue features, but these are likely the most common to be
used and examples of each.

### Text Bindings

Render text within HTML using the double-curly braces notation `{{ }}`.

**Example**

<template id="binding-example"><h1>{{ text }}</h1></template>

function BindingExample(props) {
  return {
    $template: '#binding-example',
    text: props.text
  };
}

ui.create(BindingExample({ text: 'Hello, Melvor!' }), host);
// -> <h1>Hello, Melvor!</h1>

### Attribute Binding

Bind an attribute to props using `v-bind` directive, or `:` for short.

**Example**

<template id="attr-binding-example">
  <span v-bind:class="`text-${(warning ? 'warning' : 'info')}`">
    This message could be a warning or informational.
  </span>
</template>

This notation accomplishes the same:

<template id="attr-binding-example">
  <span :class="`text-${(warning ? 'warning' : 'info')}`">
    This message could be a warning or informational.
  </span>
</template>

### Event Binding/Handling

Bind event handlers using the `v-on` directive, or `@` for short.

**Example**

<template id="event-binding-example">
  <button v-on:click="onClick">Click Me!</button>
</template>

This notation accomplishes the same:

<template id="event-binding-example">
  <button @click="onClick">Click Me!</button>
</template>

And would be used in the component like:

function EventBindingExample() {
  return {
    $template: '#event-binding-template',
    onClick() {
      alert('You clicked me!');
    }
  };
}

### Input Value Binding

Input values can be bound using the `v-model` directive.

**Example**

<template id="input-binding-example">
  <input v-model="value" />
</template>

function InputBindingExample(props) {
  return {
    value: props.initialValue,
    setValue(val) {
      this.input = val;
    }
  };
}

const input = InputBindingExample({ initialValue: 'this is the initial value' });
ui.create(input, host);
// -> <input value="this is the initial value" />
input.setValue('now this value');
// -> <input value="now this value" />

// Assume the player changes the input in the UI to "new value"
console.log(input.value); // -> "new value"

### Conditional Rendering

You can conditionally render elements using the `v-if`, `v-else`, and `v-else-if` directives.

**Example**

<template id="conditional-example">
  <span v-if="value % 15 === 0">FizzBuzz</span>
  <span v-else-if="value % 3 === 0">Fizz</span>
  <span v-else-if="value % 5 === 0">Buzz</span>
  <span v-else>{{ value }}</span>
</template>

function ConditionalExample(props) {
  return {
    $template: 'conditional-example',
    value: props.value
  };
}

ui.create(ConditionalExample({ value: 6 }), host);
// -> <span>Fizz</span>

────────────────────────────────────────────────────────────────────────────────────────────────────
Modding Guides                                                                                      
────────┬────────┬─────────────────┬──────┬────────────┬──────────┬──────────────┬──────────────────
[Getting│[Creator│[Migrating from  │[Essen│[Mod Context│[Sidebar  │Reusable      │[Enabling DevTools
Started]│Toolkit]│Scripts and      │tials]│API         │API       │Components    │for the Steam and 
[26]    │[27]    │Extensions][28]  │[29]  │Reference][3│Reference]│with PetiteVue│Epic Clients][32] 
        │        │                 │      │0]          │[31]      │              │                  
────────┴────────┴─────────────────┴──────┴────────────┴──────────┴──────────────┴──────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
[Melvor Idle][33] version [v1.3.1][34] (Released: 30th October 2024)                                
────────────────────────────────────────────────────────────────────────────────────────────────────
** [Combat][35]:** [Attack][36] • [Strength][37] • [Defence][38] • [Hitpoints][39] • [Ranged][40] • 
[Magic][41] • [Prayer][42] • [Slayer][43] • [Corruption][44]                                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Skills:** [Farming][45] • [Township][46] • [Woodcutting][47] • [Fishing][48] • [Firemaking][49] • 
[Cooking][50] • [Mining][51] • [Smithing][52] • [Thieving][53] • [Fletching][54] • [Crafting][55] • 
[Runecrafting][56] • [Herblore][57] • [Agility][58] • [Summoning][59] • [Astrology][60] •           
[Alternative Magic][61] • [Cartography][62] • [Archaeology][63] • [Harvesting][64]                  
────────────────────────────────────────────────────────────────────────────────────────────────────
**Other**: [Beginners Guide][65] • [Guides][66] • [Bank][67] • [Combat][68] • [Mastery][69] • [Money
Making][70] • [Shop][71] • [Easter Eggs][72] • [Pets][73] • [Golbin Raid][74] • [Full Version][75] •
[Throne of the Herald][76] • [Atlas of Discovery][77] • [Into the Abyss][78]                        
────────────────────────────────────────────────────────────────────────────────────────────────────
**Reference Tables:** [Items][79], [Equipment][80], [Experience Table][81], [Upgrading Items][82],  
[Combat Areas][83], [Slayer Areas][84], [Dungeons][85], [Strongholds][86], [The Abyss][87],         
[Monsters][88]                                                                                      
────────────────────────────────────────────────────────────────────────────────────────────────────
Retrieved from
"[https://wiki.melvoridle.com/index.php?title=Mod_Creation/Reusable_Components_with_PetiteVue&oldid=
83734][89]"

## Navigation

### Navigation
* [Main page][90]
* [Recent changes][91]
* [Random page][92]
* [Help about MediaWiki][93]

### Contributing
* [Contribute to this wiki][94]
* [Maintenance][95]

## Wiki tools

### Wiki tools
* [Special pages][96]

## Page tools

### Page tools

### User page tools

### More
* [What links here][97]
* [Related changes][98]
* [Printable version][99]
* [Permanent link][100]
* [Page information][101]
* [Page logs][102]
* [[Powered by MediaWiki]][103]
* This page was last edited on 1 November 2024, at 20:17.
* This page has been accessed 13,816 times.
* [Privacy policy][104]
* [About Melvor Idle][105]
* [Disclaimers][106]
* [Mobile view][107]

[1]: /index.php?title=Special:CreateAccount&returnto=Mod+Creation%2FReusable+Components+with+PetiteV
ue
[2]: /index.php?title=Special:UserLogin&returnto=Mod+Creation%2FReusable+Components+with+PetiteVue
[3]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[4]: /index.php?title=Talk:Mod_Creation/Reusable_Components_with_PetiteVue&action=edit&redlink=1
[5]: /w/Mod_Creation/Reusable_Components_with_PetiteVue
[6]: /index.php?title=Mod_Creation/Reusable_Components_with_PetiteVue&action=edit
[7]: /index.php?title=Mod_Creation/Reusable_Components_with_PetiteVue&action=history
[8]: /w/Mod_Creation
[9]: https://github.com/vuejs/petite-vue
[10]: https://github.com/vuejs/petite-vue
[11]: https://vuejs.org/guide/introduction.html
[12]: #Helper_Functions
[13]: #ui.create(props:_ComponentProps,_host:_HTMLElement):_HTMLElement
[14]: #ui.createStore(props:_Record<string,_unknown>):_ComponentStore
[15]: #ui.createStatic(template:_string,_host:_HTMLElement):_HTMLElement
[16]: #Nesting_Static_Components
[17]: #Useful_Patterns
[18]: #Nesting_Components
[19]: #Programmatically_Manipulating_Components
[20]: #PetiteVue_Quick_Reference
[21]: #Text_Bindings
[22]: #Attribute_Binding
[23]: #Event_Binding/Handling
[24]: #Input_Value_Binding
[25]: #Conditional_Rendering
[26]: /w/Mod_Creation/Getting_Started
[27]: /w/Mod_Creation/Creator_Toolkit
[28]: /w/Mod_Creation/Migrating_from_Scripts_and_Extensions
[29]: /w/Mod_Creation/Essentials
[30]: /w/Mod_Creation/Mod_Context_API_Reference
[31]: /w/Mod_Creation/Sidebar_API_Reference
[32]: /w/Mod_Creation/Enabling_DevTools_for_the_Steam_and_Epic_Clients
[33]: /w/Main_Page
[34]: /w/V1.3.1
[35]: /w/Combat
[36]: /w/Attack
[37]: /w/Strength
[38]: /w/Defence
[39]: /w/Hitpoints
[40]: /w/Ranged
[41]: /w/Magic
[42]: /w/Prayer
[43]: /w/Slayer
[44]: /w/Corruption
[45]: /w/Farming
[46]: /w/Township
[47]: /w/Woodcutting
[48]: /w/Fishing
[49]: /w/Firemaking
[50]: /w/Cooking
[51]: /w/Mining
[52]: /w/Smithing
[53]: /w/Thieving
[54]: /w/Fletching
[55]: /w/Crafting
[56]: /w/Runecrafting
[57]: /w/Herblore
[58]: /w/Agility
[59]: /w/Summoning
[60]: /w/Astrology
[61]: /w/Alternative_Magic
[62]: /w/Cartography
[63]: /w/Archaeology
[64]: /w/Harvesting
[65]: /w/Beginners_Guide
[66]: /w/Guides
[67]: /w/Bank
[68]: /w/Combat
[69]: /w/Mastery
[70]: /w/Money_Making
[71]: /w/Shop
[72]: /w/Easter_Eggs
[73]: /w/Pets
[74]: /w/Golbin_Raid
[75]: /w/Full_Version
[76]: /w/Throne_of_the_Herald_Expansion
[77]: /w/Atlas_of_Discovery_Expansion
[78]: /w/Into_the_Abyss_Expansion
[79]: /w/Table_of_Items
[80]: /w/Equipment
[81]: /w/Experience_Table
[82]: /w/Upgrading_Items
[83]: /w/Combat_Areas
[84]: /w/Slayer_Areas
[85]: /w/Dungeons
[86]: /w/Strongholds
[87]: /w/The_Abyss
[88]: /w/Monsters
[89]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Reusable_Components_with_PetiteVue&ol
did=83734
[90]: /w/Main_Page
[91]: /w/Special:RecentChanges
[92]: /w/Special:Random
[93]: https://www.mediawiki.org/wiki/Special:MyLanguage/Help:Contents
[94]: /w/Melvor_Idle:Contributing
[95]: /w/Melvor_Idle:Maintenance
[96]: /w/Special:SpecialPages
[97]: /w/Special:WhatLinksHere/Mod_Creation/Reusable_Components_with_PetiteVue
[98]: /w/Special:RecentChangesLinked/Mod_Creation/Reusable_Components_with_PetiteVue
[99]: javascript:print();
[100]: /index.php?title=Mod_Creation/Reusable_Components_with_PetiteVue&oldid=83734
[101]: /index.php?title=Mod_Creation/Reusable_Components_with_PetiteVue&action=info
[102]: /index.php?title=Special:Log&page=Mod+Creation%2FReusable+Components+with+PetiteVue
[103]: https://www.mediawiki.org/
[104]: /w/Melvor_Idle:Privacy_policy
[105]: /w/Melvor_Idle:About
[106]: /w/Melvor_Idle:General_disclaimer
[107]: https://wiki.melvoridle.com/index.php?title=Mod_Creation/Reusable_Components_with_PetiteVue&m
obileaction=toggle_view_mobile
