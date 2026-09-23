# b2c-plugin-validation

B2C CLI plugin that validates Salesforce B2C Commerce **site-import XML** and **Page Designer / content JSON** against the schemas bundled with [`@salesforce/b2c-tooling-sdk`](https://www.npmjs.com/package/@salesforce/b2c-tooling-sdk).

XML is checked with [`xmllint-wasm`](https://www.npmjs.com/package/xmllint-wasm) (libxml2 in WebAssembly). You do not need a system `xmllint`.

Behavior details: [FUNCTIONAL-DESCRIPTION.md](./FUNCTIONAL-DESCRIPTION.md).  
Agent skill: [skills/b2c-validate/SKILL.md](./skills/b2c-validate/SKILL.md).

## Prerequisites

- Node.js 22+
- [B2C CLI](https://salesforcecommercecloud.github.io/b2c-developer-tooling/) (`b2c`)

## Install

```bash
b2c plugins install hnestmann/b2c-cli-plugin-validation
```

From a clone:

```bash
npm install && npm run build
b2c plugins link .
```

Confirm:

```bash
b2c plugins
b2c validate --help
```

See the [third-party plugins guide](https://salesforcecommercecloud.github.io/b2c-developer-tooling/guide/third-party-plugins.html).

## Usage

```bash
# Single XML file — schema inferred from xmlns + root element
b2c validate meta/system-objecttype-extensions.xml

# Explicit schema
b2c validate system-objecttype-extensions.xml --schema metadata

# Site-import directory (full archive or a partial overlay)
b2c validate ./site-import

# Bind library.xml embedded Page Designer JSON to cartridge type definitions
b2c validate ./site-import --cartridges-dir ./commerce-cloud-code

# Page Designer metadefinition JSON
b2c validate cartridge/experience/components/hero.json
b2c validate --type componenttype mycomponent.json

# CI
b2c validate ./site-import --no-prompt
b2c validate ./site-import --no-prompt --json
b2c validate ./site-import --fail-fast

# List schemas the plugin can use
b2c validate schemas
```

`PATH` is required. `b2c validate` with no arguments is an error; it does not imply `.`. To validate the current folder:

```bash
b2c validate .
```

Project defaults belong in `package.json` scripts:

```json
{
  "scripts": {
    "validate:data": "b2c validate ./site-import --no-prompt --cartridges-dir ./commerce-cloud-code",
    "validate:pd": "b2c validate ./cartridges/app_custom/cartridge/experience"
  }
}
```

## Commands

| Command | Purpose |
|---|---|
| `b2c validate PATH [PATH…]` | Validate files, globs, or a site-import tree |
| `b2c validate schemas` | List XML schema ids (xmlns + roots) and JSON document types |

The plugin is local-only. It does not talk to a B2C instance.

## License

Apache-2.0. See [LICENSE](./LICENSE).
