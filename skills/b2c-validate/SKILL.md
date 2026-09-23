---
name: b2c-validate
description: Validate Salesforce B2C Commerce site-import XML and Page Designer / content JSON with the b2c CLI validation plugin. Use when checking import XML, site archives, library.xml embedded Page Designer JSON, metadefinition JSON, XSD schema errors, or before running b2c job import.
---

# B2C validate

Use `b2c validate` from the `b2c-plugin-validation` plugin. Prefer it over a system `xmllint`. Do not run `b2c validate` without a PATH (`.` is not implied).

```bash
b2c plugins install hnestmann/b2c-cli-plugin-validation
```

## Commands

```bash
b2c validate PATH [PATH…]     # file, directory, or glob
b2c validate schemas          # XML ids (xmlns + roots) and JSON document types
```

List bundled XSD files with `b2c docs schema --list` or `b2c validate schemas`.

## Examples

```bash
# Single XML file — schema inferred from xmlns + root
b2c validate meta/system-objecttype-extensions.xml

# Explicit schema
b2c validate system-objecttype-extensions.xml --schema metadata

# Site-import directory (full archive or partial overlay)
b2c validate ./site-import

# Bind library.xml <config>/<data> to cartridge Page Designer types
b2c validate ./site-import --cartridges-dir ./commerce-cloud-code

# Page Designer type definitions
b2c validate cartridge/experience/components/hero.json
b2c validate --type componenttype mycomponent.json

# CI
b2c validate ./site-import --no-prompt
b2c validate ./site-import --no-prompt --json
b2c validate ./site-import --fail-fast
```

Current directory is only validated when passed explicitly:

```bash
b2c validate .
```

## Behavior agents should follow

- Always pass PATH. Missing PATH is an error, not “validate `.`”.
- Do not use system `xmllint`. The plugin uses `xmllint-wasm`.
- Use `--no-prompt` in CI and non-interactive sessions.
- Pass a **site-import directory** (units such as `meta/`, `sites/`, `catalogs/`, root `services.xml`) when validating an archive. A nested `site-import/` folder is not auto-selected from a storefront repo root.
- Pass an `experience/` folder when validating Page Designer **type** JSON (`pagetype` / `componenttype`).
- Page Designer **instance** JSON usually lives in `library.xml` as `<config>` / `<data>` text, not only as files under `experience/`.
- Pass `--cartridges-dir` when those blobs should be checked against cartridge page/component type JSON. Unknown types warn; unknown attributes on a resolved type fail.
- Partial overlays may omit units that already exist on the instance. Missing cross-file references must not be treated as blockers.
- `--strict` is on by default. `--no-strict` skips files that are not B2C schema-matching documents.
- Collect-all is the default. `--fail-fast` stops at the first failing file.

## Flags

| Flag | Meaning |
|---|---|
| `--schema` / `-S` | XSD id or path to `.xsd` (XML only) |
| `--type` / `-t` | JSON document type |
| `--cartridges-dir` | Cartridge or code-version folder |
| `--prompt` / `--no-prompt` | Prompt when inference fails (default: TTY on) |
| `--strict` / `--no-strict` | Unknown files fail (default: on) |
| `--fail-fast` | Stop at first failure |
| `--include` / `--exclude` | Extra globs |
| `--json` | Structured result |
| `--quiet` / `--verbose` | Output detail |
