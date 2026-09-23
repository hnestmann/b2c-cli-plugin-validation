# B2C CLI Validation Plugin — Functional Description

Plugin name: `b2c-plugin-validation`  
Host CLI: [B2C Developer Tooling](https://salesforcecommercecloud.github.io/b2c-developer-tooling/guide/third-party-plugins.html)

This document describes the plugin’s behavior. How it is built is in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

---

## 1. Problem

Salesforce B2C Commerce site imports fail late and noisily: you `b2c job import` a directory, wait for the instance job, then scrape logs for XSD errors. The same happens with Page Designer metadefinition JSON that Business Manager or deployment then rejects.

The core CLI already exposes the pieces, but not a one-shot validator:

| Existing command | What it does | Gap |
|---|---|---|
| `b2c docs schema <name> --path` | Prints the bundled XSD path | You still have to run a validator yourself and know which schema name to use |
| `b2c docs schema --list` | Lists bundled XSDs | Does not map a file to a schema |
| `b2c content validate` | Validates Page Designer JSON against bundled JSON schemas | Does not validate import XML or a whole site archive |

The XML workflow this plugin replaces is:

```bash
xmllint --schema "$(b2c docs schema metadata --path)" system-objecttype-extensions.xml --noout
```

Validation runs **inside the plugin** via the npm package `xmllint-wasm` (libxml2 compiled to WebAssembly). Users do not install a system `xmllint`. Behavior is the same on every OS after `npm install`.

---

## 2. Goals

1. **Validate a single B2C import XML file** against the matching bundled XSD, equivalent to `xmllint --schema … --noout`.
2. **Validate a site-import directory**, including a full archive and a partial overlay that only contains some units (for example instance-specific `preferences.xml` and `services.xml`). Zip archives are out of scope for v1. Public reference layout: [SalesforceCommerceCloud/storefrontdata `demo_data_sfra`](https://github.com/SalesforceCommerceCloud/storefrontdata/tree/master/demo_data_sfra).
3. **Validate B2C Commerce Content / Page Designer JSON** using the schemas documented with the CLI/SDK (`aspecttype.json`, `pagetype.json`, `componenttype.json`, and the rest of `content-schemas/`).
4. **Infer the schema from file content** (XML namespace + root element). `--schema` / `--type` always override. If inference still fails, **prompt** on a TTY or **fail** in CI (`--strict` is the default; `--no-prompt` when not a TTY).
5. Be **local-only**: no instance, OAuth, or WebDAV. Suitable for pre-commit and CI **before** `b2c job import`.
6. Install as a **standard oclif plugin** (`b2c plugins install` from GitHub), following the same packaging as other third-party B2C CLI plugins and the [Extending the CLI](https://salesforcecommercecloud.github.io/b2c-developer-tooling/guide/extending.html) guide.
7. Ship an **agent skill** so coding agents know to use `b2c validate` when building or checking import XML / Page Designer JSON.

---

## 3. Non-goals (v1)

- Auto-fixing invalid XML/JSON
- Talking to a sandbox (import, remote schema download, live BM validation)
- Validating OCAPI/SCAPI request bodies, `dw.json`, pipeline XML, or zip archives
- Replacing `b2c content validate` or `b2c docs schema`
- Bundling a copy of the XSDs (use `@salesforce/b2c-tooling-sdk`)
- Validating static assets (`library/static/**`, images, fonts, binaries)
- Guessing a schema from the **file path** when the document itself does not match a bundled B2C schema
- Publishing to npm (GitHub install only)
- Writing remembered schema choices to disk (use `package.json` scripts for project-specific flags)

Cross-file referential checks (for example “this `preference-id` exists in metadata”) are **warnings only**, and only when PATH is a site-import directory. A partial overlay may reference data imported earlier on the instance; missing references must not fail the run. The exception is optional `--cartridges-dir`, which binds `library.xml` instance data to Page Designer type definitions on disk ([§8.2](#82-optional---cartridges-dir)).

---

## 4. Users and jobs-to-be-done

| User | Job |
|---|---|
| Developer editing `meta/system-objecttype-extensions.xml` | Catch XSD errors before import |
| Developer with a large site-archive tree | Validate hundreds of XML files in one command |
| Page Designer author | Validate `experience/components/*.json` / `experience/pages/*.json` |
| CI pipeline | Fail the build if any import file is schema-invalid |
| Agent / human who does not know schema names | Infer schema; only ask when it cannot |

---

## 5. Product shape

### 5.1 Plugin identity

| Field | Value |
|---|---|
| npm / oclif name | `b2c-plugin-validation` |
| Topic / command | `b2c validate` |
| Install | `b2c plugins install <github-owner>/b2c-cli-plugin-validation` or `b2c plugins link .` |
| Publish | GitHub only |
| Node | `>=22` |
| License | Apache-2.0 |
| Package manager | npm + `package-lock.json` |
| Runtime deps | `@salesforce/b2c-tooling-sdk`, `xmllint-wasm` |
| Peer | `@oclif/core` `^4` |
| System `xmllint` | not used |

### 5.2 Commands

```text
b2c validate PATH [PATH…]     Validate files or a site-import tree
b2c validate schemas          List schemas the plugin can use
```

`PATH` is required. Running `b2c validate` with no arguments prints an error that points at `--help`. It does **not** imply `.`. To validate the current folder the user must pass it explicitly:

```bash
b2c validate .
```

`PATH` may be repeated and may be a file, directory, or glob. Zip is out of scope for v1.

```bash
# Single XML file — schema inferred from xmlns + root element
b2c validate meta/system-objecttype-extensions.xml

# Explicit schema
b2c validate system-objecttype-extensions.xml --schema metadata

# Site import + bind library content to cartridge Page Designer types
b2c validate ./site-import --cartridges-dir ./commerce-cloud-code

# Page Designer JSON
b2c validate cartridge/experience/components/hero.json
b2c validate --type componenttype mycomponent.json

# CI
b2c validate ./site-import --no-prompt --json
b2c validate ./site-import --fail-fast
```

Project-specific defaults belong in `package.json` scripts, not a hidden config file:

```json
{
  "scripts": {
    "validate:data": "b2c validate ./site-import --no-prompt --cartridges-dir ./commerce-cloud-code",
    "validate:pd": "b2c validate ./cartridges/app_custom/cartridge/experience"
  }
}
```

---

## 6. Input kinds

Each `PATH` is classified independently, then files are discovered. A file PATH is never classified as a folder. Globs skip folder classification and validate each matched file as XML or JSON.

### 6.1 Site-import directory

A directory is a **site import** when at least one **immediate child** of PATH is an archive unit. Classification does not look at parent folders and does not look at nested descendants.

**Unit directories** (exact names):

`meta`, `sites`, `catalogs`, `pricebooks`, `inventory-lists`, `custom-objects`, `customer-lists`, `libraries`, `library`

**Unit files** (exact names at PATH root):

`services.xml`, `jobs.xml`, `preferences.xml`, `sort.xml`, `site.xml`, `catalog.xml`, `library.xml`, `storefronts.xml`

Why those names: they are the conventional top-level units of a B2C site archive (the layout `b2c job import` accepts). Presence of any one of them at PATH root is enough. A partial overlay that only contains some units is still a site import.

| PATH looks like | Why it is (or is not) a site import |
|---|---|
| `./preferences.xml` at the folder root | **Yes** — `preferences.xml` is a unit file (organization or instance preferences). |
| `./services.xml` at the folder root | **Yes** — `services.xml` is a unit file. |
| `./sites/` as a child directory | **Yes** — `sites` is a unit directory (one folder per site ID). |
| `./meta/` as a child directory | **Yes** — `meta` is a unit directory (object type definitions and extensions). |
| `./site.xml` at the folder root | **Yes** — `site.xml` is a unit file (a single site unit, for example `sites/RefArch` passed directly). |
| `./library/` as a child directory | **Yes** — `library` is a unit directory (shared library at archive root). |
| Only `system-objecttype-extensions.xml` in the folder (no child named `meta/`) | **No** — there is no unit directory or unit file at this PATH. Treated as [another directory](#64-other-directories). |
| `pages/` and `components/` only (`experience/`) | **No** — Page Designer metadefinitions, not a site archive. Treated as [another directory](#64-other-directories). |
| Storefront repo root with `cartridges/` and `package.json` | **No** — unit markers are not immediate children. A nested `site-import/` folder is **not** auto-selected; pass that path explicitly. |

If PATH has both unit markers and unrelated siblings (for example `sites/` next to `cartridges/`), it is still a site import. Discovery **only walks archive units**, so cartridges are not pulled in.

Typical units under a site-import PATH:

```text
site-archive/
├── services.xml, jobs.xml, preferences.xml, sort.xml, …
├── meta/*.xml
├── sites/{SiteID}/*.xml
├── sites/{SiteID}/library/library.xml
├── catalogs/{CatalogID}/catalog.xml          # or catalogs/*.xml
├── pricebooks/**/*.xml
├── inventory-lists/**/*.xml
├── custom-objects/*.xml
├── customer-lists/*.xml
└── libraries/{LibraryID}/library.xml
```

**Include:** `*.xml` in those units, plus Page Designer-looking `*.json` if any appear there. After a `library.xml` passes XSD validation, also validate **embedded** Page Designer JSON in that file ([§8.1](#81-embedded-json-in-libraryxml)).  
**Skip (not errors):** `**/library/static/**`, media/binaries, `node_modules/**`, `.git/**`, `ocapi-settings/**` (OCAPI JSON is not a Page Designer metadefinition), `*.sample`.

Do not recurse into sibling folders that are not units (`cartridges/`, `javascript/`, `ocapi-settings/`).

Optional **warnings** (never fail the run): referential hints that only make sense for a full archive. Copy should note that a partial overlay may be incomplete on purpose. v1 can start with a small set (or none) and add warnings without changing exit codes.

### 6.2 Single XML file

Validate that one file. Schema inference as in [§7](#7-schema-inference-xml).

### 6.3 Single JSON file

Validate against B2C Commerce Content / Page Designer JSON schemas ([§8](#8-json-b2c-commerce-content--page-designer)).

### 6.4 Other directories

Used when PATH is a directory that is **not** a site import: a `meta/` folder passed on its own, a cartridge `experience/` tree, and similar.

- Recurse for `*.xml` and Page Designer-looking `*.json`
- Always exclude `node_modules/**`, `.git/**`, `dist/**`, `**/library/static/**`, binaries
- Do **not** treat every JSON as a metadefinition (`package.json`, OCAPI config, etc. are skipped unless `--type` is set)
- JSON is in scope if `--type` is set, the path matches `experience/pages/` or `experience/components/`, or the object matches SDK detection
- No cross-file referential warnings
- XML that does not match a bundled B2C schema is **invalid** under default `--strict` (not guessed from the folder name)

### 6.5 Globs

`b2c validate 'meta/**/*.xml'` and multiple args, same pattern as `b2c content validate`.

---

## 7. Schema inference (XML)

### 7.1 Precedence

1. **`--schema <id>`** — always wins. `id` is a bundled schema name (`metadata`, `catalog`, …) or a path to an `.xsd` file. On a directory, this forces that schema on every XML file.
2. **Document header** — XML declaration (if any), default `xmlns`, and the **root element name**.
3. **Ambiguous namespace** — if several XSDs share the same `targetNamespace`, pick using the root element ([§7.4](#74-ambiguous-namespaces)).
4. **Prompt or fail** — there is no path/filename fallback. If the document does not match a bundled B2C schema, it is not treated as one.

### 7.2 Header read (bounded, not a full parse)

Typical file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">
```

The plugin:

1. Opens the file as a stream and reads a **header window** (default 64 KiB, enough for comments / pretty-printed root attributes; not the rest of a multi-hundred-megabyte catalog).
2. Ignores BOM, XML declaration, comments, and processing instructions.
3. Takes the first start-tag: local name + `xmlns` / `xmlns:` default namespace.
4. Stops. It does not build a DOM of the document for inference.

If the root start-tag is not fully inside the window (pathological formatting), inference fails and the prompt/fail path applies. Validation of the full file is a separate step and uses the streaming-capable wasm engine; that step may read the whole file because XSD validation requires the document.

### 7.3 Namespace → schema map

Built at runtime from bundled XSDs (`targetNamespace` + top-level `xsd:element name`), not a hard-coded date table, so SDK schema drops keep working.

| File / root | `xmlns` | Schema id |
|---|---|---|
| `system-objecttype-extensions.xml`, `custom-objecttype-definitions.xml` | `…/impex/metadata/2006-10-31` | `metadata` |
| `catalog.xml` | `…/impex/catalog/2006-10-31` | `catalog` |
| pricebooks | `…/impex/pricebook/2006-10-31` | `pricebook` |
| inventory | `…/impex/inventory/2007-05-31` | `inventory` |
| `library.xml` | `…/impex/library/2006-10-31` | `library` |
| `preferences.xml` | `…/impex/preferences/2007-03-31` | `preferences` |
| `site.xml` | `…/impex/site/2007-04-30` | `site` |
| `services.xml` | `…/impex/services/2014-09-26` | `services` |
| `jobs.xml` | `…/impex/jobs/2015-07-01` | `jobs` |
| `promotions.xml` | `…/impex/promotion/2008-01-31` | `promotion` |
| `coupons.xml` | `…/impex/coupon/2008-06-17` | `coupon` |
| `feeds.xml` | `…/impex/feed/2009-01-01` | `feed` |
| `customer-groups.xml` | `…/impex/customergroup/2007-06-30` | `customergroup` |
| custom object instances | `…/impex/customobject/2006-10-31` | `customobject` |
| `search.xml` | `…/impex/search/2007-02-28` | `search` |
| `url-rules.xml` | `…/impex/urlrules/2012-12-01` | `urlrules` |
| `payment-methods.xml` | `…/impex/paymentsettings/2009-09-15` | `paymentmethod` |
| `slots.xml` | `…/impex/slot/2008-09-08` | `slot` |
| … | (remaining bundled XSDs) | matching id |

### 7.4 Ambiguous namespaces

When several XSDs share a `targetNamespace`, use the **root element**.

| Namespace | Root element | Schema |
|---|---|---|
| `…/impex/customer/2006-10-31` | `customer-list` | `customerlist2` |
| `…/impex/customer/2006-10-31` | `customers` or `customer` | `customer` |

`customerlist.xsd` uses a **different** namespace (`…/impex/customerlist/2010-06-30`) with root `customer-lists` / `customer-list`. xmlns is enough there.

If xmlns is unique, the root element is not required. If xmlns is shared and the root is not in the candidate XSD’s top-level elements, treat as unknown (prompt / fail). `--schema` skips this.

### 7.5 No path-based schema guess

A file sitting in `meta/` with no matching xmlns is **not** assumed to be `metadata`. It is not a B2C schema-matching file: invalid under `--strict` (default), skipped with `--no-strict`, or handled by the prompt.

### 7.6 When inference fails

**Interactive (TTY, `--prompt` default on):**

```text
Cannot infer a B2C schema for ./weird-export.xml
  xmlns: (none)
  root: foo

? What next?
  > Pick a schema…
    Check well-formedness only (no XSD) — reports whether the XML parses
    Skip this file
```

The prompt must say **what happens next** for each choice. Well-formedness-only: PASS if the document parses as XML, FAIL if it does not; it is not schema-valid. Skip: warning; does not fail the run by itself.

Remember the choice **in memory for this process only**, keyed by (xmlns, root, basename pattern), so a large archive does not ask once per file. Do not write a project config file. Repeatable CI/project behavior belongs in `package.json` scripts (`--schema`, `--exclude`, `--no-prompt`).

**Non-interactive (`--no-prompt`, CI, non-TTY):**

```text
ERROR: ./weird-export.xml: not a B2C schema-matching file (no xmlns/root match).
  Use --schema <id> (see `b2c validate schemas`)
  or run interactively to pick a schema or check well-formedness only.
```

Default `--strict`: this is a failed file. `--no-strict`: skip with a warning.

---

## 8. JSON (B2C Commerce Content / Page Designer)

Reuse `@salesforce/b2c-tooling-sdk/operations/content` (`validateMetaDefinitionFile` and the bundled `data/content-schemas/` tree). Do not reimplement JSON Schema validation.

The documented schema set (all files are loaded so `$ref` works):

| File | Role |
|---|---|
| `aspecttype.json` | Document |
| `pagetype.json` | Document |
| `componenttype.json` | Document |
| `cmsrecord.json` | Document |
| `customeditortype.json` | Document |
| `contentassetcomponentconfig.json` | Document |
| `contentassetpageconfig.json` | Document |
| `contentassetstructuredcontentdata.json` | Document |
| `image.json` | Document |
| `componentconstructor.json` | Document (if present as a file) |
| `componenttypeexclusion.json` | Document (if present as a file) |
| `componenttypeinclusion.json` | Document (if present as a file) |
| `attributedefinition.json` | `$ref` fragment |
| `attributedefinitiongroup.json` | `$ref` fragment |
| `common.json` | `$ref` fragment |
| `databindingcontext.json` | `$ref` fragment |
| `editordefinition.json` | `$ref` fragment |
| `regiondefinition.json` | `$ref` fragment |
| `visibilityrule.json` | `$ref` fragment |

`--type` accepts the **document** stems (same idea as `b2c content validate`, plus the extra document files above if the SDK type union needs a thin wrapper). Fragments are not auto-detected as standalone inputs.

Detection order:

1. `--type`
2. Path: `experience/pages/` → `pagetype`, `experience/components/` → `componenttype`
3. Top-level JSON keys (SDK `detectTypeFromData`)
4. Prompt / fail (same policy as XML)

JSON inside a site archive as **standalone `.json` files** is uncommon. Page Designer instance data usually lives **inside** `library.xml` text nodes; that path is [§8.1](#81-embedded-json-in-libraryxml). `ocapi-settings/*.json` is skipped. Random `package.json` is skipped.

### 8.1 Embedded JSON in `library.xml`

XSD validation of a library file only checks that `<config>` and `<data>` are text. The payloads are JSON, and broken JSON is a common import failure that `library.xsd` will not catch.

After a file is classified as `library` and the XML is schema-valid, the plugin extracts each `<content>` that has a `<type>` and a `<config>` and/or `<data>` child and validates those blobs separately.

Example shape:

```xml
<content content-id="hero-1">
  <type>component.storefront.heroBanner</type>
  <config>{
    "visibility" : [ ]
  }</config>
  <data xml:lang="x-default">{
    "heading" : "…"
  }</data>
</content>
```

| Blob | How the schema is chosen | Validator |
|---|---|---|
| `<config>` | Sibling `<type>` starts with `page.` → `contentassetpageconfig`; starts with `component.` → `contentassetcomponentconfig` | Same SDK JSON schemas as `b2c content validate` |
| `<data>` | Must parse as JSON. Without `--cartridges-dir`, optionally checked as `contentassetstructuredcontentdata` (an object). With `--cartridges-dir`, also checked against the matching page/component type definition ([§8.2](#82-optional---cartridges-dir)). | Parse error is a failure |

A library file can be large. This extra pass must not build an unbounded in-memory tree of the whole library for inference; it runs **after** XSD validation and should stream or scan for `<content>` / `<type>` / `<config>` / `<data>` only.

Report each blob as a nested result on the library file, for example:

```text
PASS: sites/RefArch/library/library.xml (library)
FAIL: sites/RefArch/library/library.xml (library) content[hero-1]/config (contentassetcomponentconfig)
  ERROR: Invalid JSON: …
```

If the XML itself fails XSD, skip the embedded-JSON pass for that file (the document may not be extractable).

This applies whenever a `library` XML file is validated: a site-import walk, a generic folder that contains `library.xml`, or `b2c validate path/to/library.xml`.

### 8.2 Optional `--cartridges-dir`

Site archives do not contain Page Designer **type** definitions. Those live in cartridges:

```text
my_cartridge/cartridge/experience/pages/contentPage.json      →  page.contentPage
my_cartridge/cartridge/experience/components/hero/banner.json →  component.hero.banner
```

The type ID is `page.` / `component.` plus the path under `experience/pages` or `experience/components`, with `/` replaced by `.` (no `.json`). That is what `<type>` in `library.xml` stores.

`--cartridges-dir <path>` points at either:

| Path | How it is recognized |
|---|---|
| A **single cartridge** | `{path}/cartridge/experience` exists, or `{path}/experience` exists (already inside `cartridge/`) |
| A **code version** (folder of cartridges) | Immediate children include one or more `{name}/cartridge/experience` trees |

```bash
# One cartridge
b2c validate ./site-import --cartridges-dir ./cartridges/app_custom

# Whole code version (every cartridge under the folder)
b2c validate ./site-import --cartridges-dir ./commerce-cloud-code
```

If the path is neither shape, the command errors (bad flag), it does not silently skip.

**Index:** load every `**/{pages,components}/**/*.json` under those `experience/` trees, validate each file as `pagetype` / `componenttype` (same engine as standalone JSON), and key them by type ID. If the same ID appears in more than one cartridge, print a `WARN` and keep the first file found (this plugin does not know the instance cartridge path). Pass a single cartridge to disambiguate.

**When a library `<content>` has `<type>`:**

1. Look up the type ID in the index.
2. **Unknown type** → `WARN` (the type may live in a cartridge that is not in this directory, or only on the instance). Does not fail the run.
3. **Known type** → check `<data>` (and, for pages, composition) against that metadefinition:
   - Object keys in `<data>` must be attribute ids from `attribute_definition_groups` (unknown key → `FAIL`).
   - `null` is allowed (unset in Business Manager), including for `required` attributes (`WARN` only).
   - Enum attributes: non-null values must be in `values` (`FAIL`).
   - Primitive mismatch (boolean attribute got a string, etc.) → `FAIL`.
   - Deep validity of CMS records, images, and product references is out of scope (needs instance data).
4. **`<content-link type="page.{pageType}.{regionId}">`** (optional extra when the page type is known): `regionId` must be a `region_definitions[].id` on that page type (`FAIL` if not). Whether the linked `content-id` exists in the same library is a `WARN` only (partial overlays may omit components).

Without `--cartridges-dir`, behavior is unchanged from §8.1 (JSON parse + config schema only).

`--cartridges-dir` does not imply walking the code version as a second `PATH`. To also schema-validate the metadefinition JSON files themselves, pass that folder as its own PATH (`b2c validate ./commerce-cloud-code/app_custom/cartridge/experience`) in addition to the flag.

---

## 9. XML validation mechanics

No system `xmllint`. Dependency: [`xmllint-wasm`](https://www.npmjs.com/package/xmllint-wasm) (libxml2 via WebAssembly, installed with the plugin).

For each XML file with a resolved schema, the plugin calls the wasm API with the same meaning as:

```text
xmllint --schema <bundled.xsd> <file.xml> --noout
```

Schema bytes come from `readSchema()` / `readSchemaByQuery()` in `@salesforce/b2c-tooling-sdk` (`data/xsd/`).

`xsd:import` / `xsd:include` must be preloaded (wasm has no filesystem). v1 preloads `xml.xsd` always, `customer.xsd` when validating `customerlist2`, and any other `schemaLocation` in the chosen XSD. Simplest correct approach: preload the whole small `data/xsd/` directory.

Large catalogs: enable wasm streaming / raised `maxMemoryPages` from file size so a big catalog does not die at the default 16 MiB wasm cap. Inference still uses only the header window.

Well-formedness-only: parse/validate without a schema.

**Warnings vs errors:** libxml2 can emit warnings (for example unresolved `xsi:schemaLocation`) as well as validity errors. Print warnings as `WARN` lines. They do **not** change the exit code. Validity errors remain `FAIL`. If the document declares `xsi:schemaLocation` and it disagrees with the schema the plugin selected, print a `WARN` and still validate against the inferred / `--schema` XSD.

Collect all results by default. `--fail-fast` stops after the first failed file.

---

## 10. Flags and arguments

`b2c validate PATH [PATH…]`

| Flag | Short | Description | Default |
|---|---|---|---|
| `--schema` | `-S` | XSD id (`metadata`) or path to `.xsd` | inferred |
| `--type` | `-t` | Page Designer / content JSON document type | inferred |
| `--cartridges-dir` | | Cartridge or code-version folder; bind `library.xml` embedded content to Page Designer type definitions ([§8.2](#82-optional---cartridges-dir)) | |
| `--prompt` | | Prompt when schema cannot be inferred. `--no-prompt` disables. | on if TTY, off otherwise |
| `--strict` | | Unknown / non-matching files are failures. `--no-strict` skips them. | **on** |
| `--fail-fast` | | Stop at first failing file | off (collect all) |
| `--include` | | Extra glob(s) | |
| `--exclude` | `-x` | Glob(s) to skip (repeatable) | static/binaries as in §6 |
| `--json` | | Structured result | off |
| `--quiet` | `-q` | Failures + summary only | off |
| `--verbose` | | Print inferred schema and engine details | off |

`b2c validate schemas` lists XML schema ids (with xmlns + root elements) and JSON document types. `--json` supported.

No `--server` / OAuth flags.

---

## 11. Output and exit codes

```text
PASS: meta/system-objecttype-extensions.xml (metadata)
PASS: catalogs/navigation-catalog/catalog.xml (catalog)
WARN: sites/RefArch/library/library.xml (library)
  failed to load "http://www.demandware.com/xml/impex/library/2006-10-31": No such file or directory
FAIL: sites/RefArch/library/library.xml (library) content[hero-1]/config (contentassetcomponentconfig)
  ERROR: Invalid JSON: Unexpected token
FAIL: sites/RefArch/preferences.xml (preferences)
  ERROR: element default-value: Schemas validity error : ...
SKIP: sites/RefArch/library/static/default/logo.svg (not an import document)
PASS: experience/components/hero.json (componenttype)

412/413 file(s) valid, 1 error(s), 1 skipped, 1 warning(s)
```

`--verbose` adds schema path and `inferred from: xmlns … / root …`.

`--json`:

```json
{
  "results": [
    {
      "filePath": "/abs/path/system-objecttype-extensions.xml",
      "kind": "xml",
      "schemaId": "metadata",
      "schemaPath": "/abs/path/metadata.xsd",
      "inferredFrom": "xmlns",
      "valid": true,
      "errors": [],
      "warnings": [],
      "embedded": [
        {
          "contentId": "hero-1",
          "location": "config",
          "schemaType": "contentassetcomponentconfig",
          "valid": true,
          "errors": []
        }
      ]
    }
  ],
  "totalFiles": 413,
  "validFiles": 412,
  "skippedFiles": 1,
  "totalErrors": 1,
  "totalWarnings": 0
}
```

| Situation | Exit |
|---|---|
| All validated files pass; skips are only explicit skips / `--no-strict` | `0` |
| Any schema failure, wasm error, well-formedness failure, or `--strict` unknown file | `1` |
| Usage error (missing PATH, unknown `--schema` id) | oclif non-zero (typically `2`) |

CI:

```bash
b2c validate ./site-import --no-prompt
```

(`--strict` is already default.)

---

## 12. Example sessions

```bash
$ b2c validate
 › Error: Missing PATH. See `b2c validate --help`.
    Example: b2c validate ./site-import

$ b2c validate meta/system-objecttype-extensions.xml
PASS: meta/system-objecttype-extensions.xml (metadata)
1/1 file(s) valid, 0 error(s)

$ b2c validate mystery.xml
Cannot infer a B2C schema for mystery.xml
  xmlns: (none)
  root: foo

? What next? Check well-formedness only (no XSD)
PASS: mystery.xml (well-formed)

$ b2c validate ./site-import
# walks archive units (meta, catalogs, sites, …); skips library/static

$ b2c validate ./catalogs/electronics-catalog/catalog.xml --schema catalog
```

---

## 13. Installation and development

```bash
b2c plugins install <github-owner>/b2c-cli-plugin-validation

npm install && npm run build
b2c plugins link .

b2c plugins
b2c validate --help
```

Prerequisites: Node 22+, B2C CLI. No system libxml / `xmllint`.

---

## 14. Relationship to core CLI

| Capability | Core CLI | This plugin |
|---|---|---|
| List / print XSD | `b2c docs schema` | Uses SDK; `b2c validate schemas` adds xmlns / root hints |
| Validate PD JSON | `b2c content validate` | Same SDK; one entry point for mixed trees |
| Validate import XML | manual `xmllint` | **new**, via `xmllint-wasm` |
| Walk site archive | `b2c job import` (upload only) | **new** |

---

## 15. Agent skill

Ship `skills/b2c-validate/SKILL.md` with the plugin so agents:

- Prefer `b2c validate` over raw `xmllint` when checking import XML or Page Designer JSON
- Pass an explicit PATH (never assume `.`)
- Use `--no-prompt` in CI / non-interactive sessions
- Pass a site-import directory when validating an archive, and an `experience/` folder when validating Page Designer type definitions
- Expect Page Designer **instance** JSON in `library.xml` (`<config>` / `<data>`), not only as files under `experience/`
- Pass `--cartridges-dir` when the user wants those blobs checked against cartridge page/component type JSON
- Do not treat missing cross-file references in a partial overlay as blockers

---

## 16. Success criteria

1. `b2c validate meta/system-objecttype-extensions.xml` infers `metadata` and agrees with `xmllint --schema "$(b2c docs schema metadata --path)" … --noout` on a machine that has both (development check; users only need the plugin).
2. `b2c validate ./site-import` walks archive units, skips static assets, and returns a per-file report.
3. A partial overlay (for example only `services.xml` and `sites/*/preferences.xml`) is still classified as a site import, validates the files that are present, and does not fail because other units live in a different archive.
4. `--schema` overrides inference.
5. No PATH → help error. `b2c validate .` validates the current folder.
6. Unknown schema + TTY → prompt (schema / well-formedness / skip). `--no-prompt` → fail, no hang.
7. Page Designer JSON validates in the same command, including `<config>` / `<data>` blobs inside `library.xml`. With `--cartridges-dir`, those blobs are checked against cartridge type definitions; unknown types warn, unknown attributes on a resolved type fail.
8. Works without a system `xmllint`.
9. `b2c plugins install` / `link` works.
10. Skill is present and describes the command.
11. Collect-all default; `--fail-fast` optional.
