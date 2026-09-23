# Implementation Plan — `b2c-plugin-validation`

**Spec:** [FUNCTIONAL-DESCRIPTION.md](./FUNCTIONAL-DESCRIPTION.md)  
**Packaging reference:** [b2c-plugin-data-migrations](https://github.com/sfcc-solutions-share/b2c-plugin-data-migrations) (command plugin), [Extending the CLI](https://salesforcecommercecloud.github.io/b2c-developer-tooling/guide/extending.html)

This plan describes how the plugin is implemented. It does not replace the functional spec.

---

## 1. Outcome

A GitHub-installable oclif plugin that adds:

```text
b2c validate PATH [PATH…]
b2c validate schemas
```

Local-only (`BaseCommand`). XML via `xmllint-wasm`. JSON via `@salesforce/b2c-tooling-sdk/operations/content`. No system `xmllint`. npm + `package-lock.json`.

---

## 2. Repository layout

```text
b2c-cli-plugin-validation/
├── LICENSE                          # already Apache-2.0
├── README.md
├── FUNCTIONAL-DESCRIPTION.md
├── IMPLEMENTATION-PLAN.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.build.json
├── .gitignore
├── skills/
│   └── b2c-validate/
│       └── SKILL.md
├── src/
│   ├── index.ts
│   ├── commands/
│   │   ├── validate.ts              # b2c validate
│   │   └── validate/
│   │       └── schemas.ts           # b2c validate schemas
│   └── lib/
│       ├── types.ts
│       ├── constants.ts             # unit markers, excludes, header window
│       ├── classify-path.ts         # file / archive / generic / glob
│       ├── discover-files.ts        # walk site-import units vs other directories
│       ├── schema-catalog.ts        # xmlns + root → schema id from XSDs
│       ├── infer-xml.ts             # bounded header read
│       ├── infer-json.ts            # thin wrapper around SDK detect*
│       ├── embedded-library-json.ts # <config>/<data> inside library.xml
│       ├── pd-type-index.ts         # --cartridges-dir → page/component type map
│       ├── validate-xml.ts          # xmllint-wasm
│       ├── validate-json.ts         # SDK validateMetaDefinitionFile
│       ├── prompt.ts                # in-memory remember + inquirer/ux
│       └── report.ts                # human + json summary, exit
├── test/
│   ├── fixtures/
│   │   ├── xml/
│   │   ├── json/
│   │   └── archives/
│   ├── lib/*.test.ts
│   └── commands/*.test.ts
└── dist/                            # tsc output, gitignored
```

Command files follow oclif’s nested-topic convention (`src/commands/validate.ts` + `src/commands/validate/schemas.ts`), same idea as `src/commands/migrations/run.ts` in data-migrations.

---

## 3. Package.json (target)

Aligned with password-store / data-migrations, not the monorepo catalogs.

- `"name": "b2c-plugin-validation"`
- `"type": "module"`
- `"engines": { "node": ">=22.0.0" }`
- `"oclif": { "commands": { "strategy": "pattern", "target": "./dist/commands" }, "topics": { "validate": { "description": "…" } } }`
- **dependencies:** `@salesforce/b2c-tooling-sdk` (`>=1.0.0` or current major that contains `docs` + `operations/content`), `xmllint-wasm`, `glob`
- **peerDependencies:** `@oclif/core` `^4`
- **devDependencies:** `@oclif/core`, TypeScript, `@types/node`, mocha, chai, tsx, (optional) sinon
- **scripts:** `build` (`tsc -p tsconfig.build.json`), `clean`, `prepare` (build), `test` (`mocha --import tsx 'test/**/*.test.ts'`), `test:agent`

`files`: `["dist", "skills"]` so the skill ships with the plugin.

Copyright header: match community plugins (short file comment). This repo’s LICENSE is Apache-2.0; we will not copy the Salesforce `eslint-plugin-header` block unless we add that eslint stack. Keep the plugin lean like data-migrations (no eslint monorepo config unless it is cheap). Format with Prettier if we add it; otherwise TypeScript + consistent style is enough for v1.

---

## 4. TypeScript compiler settings

The plugin is ESM (`"type": "module"`) and must run on Node 22. The tsconfig exists so `tsc` emits JavaScript that Node and oclif can load:

| Setting | Value | Why |
|---|---|---|
| `target` | `ES2022` | Matches Node 22 language level |
| `module` / `moduleResolution` | `NodeNext` | Required for Node ESM: relative imports keep `.js` specifiers in the emitted files |
| `strict` | `true` | Catch type errors at compile time |
| `outDir` / `rootDir` | `dist` / `src` | oclif loads `./dist/commands` |
| `tsconfig.build.json` | extends the base config, excludes tests | `npm run build` must not emit `test/` into `dist/` |

Relative TypeScript imports use `.js` extensions (`import {x} from './lib/types.js'`) because NodeNext leaves those specifiers unchanged in `dist/`.

---

## 5. Core modules

### 5.1 `schema-catalog.ts`

**Job:** Build `{ xmlns → SchemaCandidate[] }` from SDK XSDs once per process.

For each `listSchemas()` entry:

1. `readSchema(id)` → content + path
2. Parse `targetNamespace` with a regex (XSDs are small; no need to XSD-validate the XSD)
3. Collect top-level `<xsd:element name="…">` (not nested in `complexType`)
4. Record `schemaLocation` imports/includes (`xml.xsd`, `customer.xsd`, …)

API:

```ts
getCatalog(): SchemaCatalog
resolveXmlSchema(xmlns: string | undefined, rootLocalName: string | undefined): 
  { schemaId: string; path: string } | { ambiguous: SchemaCandidate[] } | null
```

`xml.xsd` is never a user-facing match (W3C xml namespace).

Ambiguous: same xmlns, multiple ids → require `rootLocalName` to match a candidate’s top-level elements (`customer-list` → `customerlist2`).

### 5.2 `infer-xml.ts`

**Job:** Infer schema **without** loading the whole file.

```ts
readXmlHeader(filePath: string, maxBytes = 64 * 1024): XmlHeader
// XmlHeader = { xmlns?: string, rootLocalName?: string, preview: string }
```

Implementation:

1. `fs.open` + read `maxBytes`
2. Strip UTF-8 BOM
3. Find the first tag that is not `<?…?>` or `<!-- … -->` (handle comments that span the window; if comment is unclosed, fail inference)
4. Regex/parse attributes on that start-tag for `xmlns="…"` (default ns) and the local name (`metadata`, `customer-list`, …)
5. Close the fd

Do not use a full XML parser on the file for this step.

Then `resolveXmlSchema(header.xmlns, header.rootLocalName)`.

### 5.3 `classify-path.ts` / `discover-files.ts`

**Classify** (immediate children only):

```ts
type PathKind = 'file' | 'archive' | 'generic'
```

Archive if any immediate child name is in `ARCHIVE_UNIT_DIRS` or `ARCHIVE_UNIT_FILES` (spec §6.1).

**Discover:**

- `archive`: glob only under unit dirs + root unit xml files. Exclude `**/library/static/**`, `ocapi-settings/**`, binaries, `.git`, `node_modules`.
- `generic`: glob `**/*.{xml,json}` with the same excludes, then filter JSON through `isPageDesignerJsonCandidate`.
- `file`: that file only.

Globs passed as PATH: `glob()` with `nodir: true`, then treat each match as a file (same as `b2c content validate`).

### 5.4 `validate-xml.ts`

Wrap `xmllint-wasm` `validateXML`.

```ts
validateXmlFile(filePath: string, options: {
  schemaId?: string;          // from inference or --schema
  wellFormedOnly?: boolean;
}): Promise<FileResult>
```

- Load instance XML as Buffer (full file — required for validation)
- Load schema XSD + preload siblings (`xml.xsd` always; other `schemaLocation`s from catalog). Cache schema strings in memory keyed by id.
- `maxMemoryPages`: scale from `stat.size` (e.g. 16 MiB default, up to 2 GiB cap) so large catalogs work
- Enable stream mode if the installed `xmllint-wasm` version exposes it
- Map `errors[]` to `{ path, message }`
- Well-formed-only: call without `schema` (or the package’s well-formed flag)

Never `spawn('xmllint')`.

### 5.5 `validate-json.ts`

Call `validateMetaDefinitionFile`. Catch `MetaDefinitionDetectionError` and convert to the same unknown-schema flow as XML (prompt / strict fail).

`--type` is passed through. If the SDK union is narrower than the document types we want (`componenttypeexclusion`, …), add a small local validate path that uses the same `jsonschema` Validator pattern **only** for extra document stems, still loading SDK `CONTENT_SCHEMAS_DIR`. Prefer SDK as-is if the type is already in `CONTENT_SCHEMA_TYPES`.

OCAPI JSON and `package.json`: never reach this function (discovery filter).

### 5.5a `embedded-library-json.ts`

After a `library` XML file is XSD-valid, scan for `<content>` entries with `<type>` plus `<config>` and/or `<data>`. Do not DOM-parse a catalog-sized file for this; library files are the only XML that need it.

- `page.*` → validate `<config>` as `contentassetpageconfig`
- `component.*` → validate `<config>` as `contentassetcomponentconfig`
- `<data>`: `JSON.parse` must succeed; optional `contentassetstructuredcontentdata` check
- Attach nested results on the parent file; invalid JSON is a failure even when XSD passed

### 5.5b `pd-type-index.ts`

Used only when `--cartridges-dir` is set.

- Detect single cartridge vs code-version folder (`cartridge/experience` vs `{name}/cartridge/experience`)
- Index `experience/pages/**/*.json` as `page.{dot.path}` and `experience/components/**/*.json` as `component.{dot.path}`
- Duplicate IDs: WARN, first file wins
- For each library `<content>` with a known type: unknown `<data>` keys FAIL; unknown type WARN; enum/primitive checks as in spec §8.2
- Optional: `content-link` `type` must match `page.{id}.{regionId}` on the page type

### 5.6 `prompt.ts`

Used only when inference failed and `flags.prompt` is true.

Inquirer list (or `@inquirer/prompts` / oclif `ux.prompt` — pick one; `@inquirer/select` is fine):

1. Pick a schema (searchable list from catalog)
2. Check well-formedness only (XML) / skip (JSON has no well-formed-only XSD analogue; option is skip or pick `--type`)
3. Skip this file

Memory map: `key = ${xmlns}::${root}::${basename}` → choice. Subsequent files with the same key reuse it.

No disk writes.

### 5.7 `commands/validate.ts`

Extends `BaseCommand` from `@salesforce/b2c-tooling-sdk/cli`.

- `static strict = false` (multiple PATH args)
- `enableJsonFlag = true`
- Flags as spec §10
- `run()`:
  1. If no PATH → `this.error` with help examples (not `.`)
  2. Discover files
  3. For each file, infer → validate (collect all unless `--fail-fast`)
  4. Print via `report.ts`
  5. `this.error('Validation failed', {exit: 1})` if any failure under strict rules

`--prompt` default: `process.stdout.isTTY && !flags['no-prompt']`. oclif `allowNo: true` on `prompt`.

`--schema` on mixed trees: apply to XML only; JSON still uses `--type` / detect.

`--cartridges-dir` is ignored unless a `library` XML file is in the run (warn once if set but unused).

### 5.8 `commands/validate/schemas.ts`

Print catalog: schema id, xmlns, root elements. Second section: JSON document types. `--json` dumps the catalog.

---

## 6. Skill

`skills/b2c-validate/SKILL.md`:

- YAML frontmatter `name: b2c-validate` and a description that triggers on import XML, site archives, Page Designer JSON, schema errors before `b2c job import`
- Examples: single file, archive, partial instance overlay, `--no-prompt` CI, `--schema` override
- Explicit: do not run `b2c validate` without PATH; do not use system `xmllint`; do not fail partial overlays on missing metadata
- Point at `b2c validate schemas` and `b2c docs schema` for listing XSDs
- README links to the skill

---

## 7. Tests

Mocha + chai + tsx. Fixtures are **tiny** (do not check in full production catalogs).

| File | Coverage |
|---|---|
| `schema-catalog.test.ts` | `metadata` xmlns maps; `customer-list` vs `customers` disambiguation; `xml` namespace ignored |
| `infer-xml.test.ts` | standard two-line header; xmlns on line 3+; comment before root; 64KiB window does not read past cap (truncate fixture) |
| `classify-path.test.ts` | folder with `meta/` + `sites/` → site import; `experience/` → other directory; folder of XML files only → other directory; root `services.xml` + `sites/` → site import; file → file |
| `discover-files.test.ts` | archive skips `library/static` and `ocapi-settings`; generic skips `package.json` |
| `validate-xml.test.ts` | valid metadata snippet PASS; broken element FAIL; well-formed-only on unmatched root |
| `validate-json.test.ts` | minimal `componenttype` JSON PASS; junk JSON FAIL |
| `embedded-library-json.test.ts` | `page.*` config → pageconfig; `component.*` config → componentconfig; broken JSON in `<config>` FAILs |
| `pd-type-index.test.ts` | single cartridge vs code-version detection; type ID from nested path; unknown key in `<data>` FAILs; missing type WARNs |
| `validate.command.test.ts` | missing PATH errors; `--json` shape; `--schema` override; `--no-prompt` unknown file exits 1 |

Stub `validateXML` only where we need speed; keep at least one real wasm call on a 20-line fixture so the engine is wired.

Optional later: a manual/integration script against a large real site-import tree (not default CI).

---

## 8. README (user-facing)

Replace the phase stub with:

- What it is
- Install (`b2c plugins install hnestmann/b2c-cli-plugin-validation`)
- Prerequisites (Node 22+, `b2c` CLI; no xmllint)
- Usage examples from the spec
- Link to skill
- Link to functional description for behavior details

Keep LICENSE as-is.

---

## 9. Implementation sequence

Do this in order so each step is testable:

1. **Scaffold** — `package.json`, tsconfigs, `.gitignore`, empty `src/index.ts`. `npm install`. Confirm `tsc` emits `dist/`.
2. **Schema catalog + header inference** — no CLI yet. Unit tests green.
3. **xmllint-wasm wrapper** — validate a metadata fixture. Confirm preload of `xml.xsd`.
4. **Path classify + discover** — fixtures for archive vs generic vs partial overlay.
5. **JSON wrapper** — SDK call + detection failure path + `library.xml` embedded `<config>`/`<data>` + optional `--cartridges-dir` type index.
6. **`b2c validate schemas`** — list command, easy to `plugins link` and see output.
7. **`b2c validate` command** — flags, collect-all, `--fail-fast`, `--strict` / `--no-strict`, `--no-prompt`.
8. **Interactive prompt** — last; keep it isolated so CI tests never hit TTY.
9. **Skill + README**.
10. **Manual pass** — `b2c plugins link .` then:
    - a metadata XML file (or a copied snippet)
    - a partial overlay directory (root `services.xml` / `preferences.xml`)
    - a full site-import tree (catalogs are large — wasm memory flags must be proven here)
    - an `experience/` JSON tree if available in a cartridge

Do not implement zip, disk-remembered schemas, or hard referential checks.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `xmllint-wasm` OOM on large `catalog.xml` | Scale `maxMemoryPages`; enable stream; test on a real navigation/product catalog |
| `customerlist2.xsd` `include`s `customer.xsd` | Preload includes; catalog records `schemaLocation` |
| SDK `CONTENT_SCHEMA_TYPES` misses a document stem | Wrapper validates extra stems against files in `content-schemas/` |
| `b2c validate` collides if core CLI adds the same topic later | Acceptable for a third-party plugin; document it |
| Linking plugin before build | `prepare` script builds; README says `npm run build` |
| Inference regex vs namespaced prefix (`ns:metadata`) | Strip prefix; match local name; still read default `xmlns` |
| Header window splits a long root tag | Fail inference (prompt/strict) rather than reading more than the cap |

---

## 11. Done when

Spec §16 success criteria hold, plus:

- `npm test` passes without a system `xmllint`
- `b2c plugins link` shows `b2c-plugin-validation` and `b2c validate --help` works
- Skill file exists and matches the command flags actually shipped
