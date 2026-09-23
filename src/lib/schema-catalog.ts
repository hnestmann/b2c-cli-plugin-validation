/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {listSchemas, readSchema} from '@salesforce/b2c-tooling-sdk/docs';
import type {CatalogSchema, SchemaCatalog} from './types.js';

export type {CatalogSchema};

let cached: SchemaCatalog | undefined;

function parseXsdMeta(content: string): {
  targetNamespace?: string;
  rootElements: string[];
  schemaLocations: string[];
} {
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  const targetNamespace = /targetNamespace\s*=\s*"([^"]+)"/.exec(stripped)?.[1];
  const schemaLocations = [...stripped.matchAll(/schemaLocation\s*=\s*"([^"]+)"/g)].map((m) =>
    path.basename(m[1].replace(/\\/g, '/')),
  );

  const rootElements: string[] = [];
  let depth = 0;
  const tagRe = /<\/?((?:xs|xsd):[A-Za-z_][\w.-]*)\b[^>]*?(\/)?>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(stripped))) {
    const full = match[0];
    const qname = match[1];
    const selfClosing = Boolean(match[2]) || /\/>\s*$/.test(full);
    const isClose = full.startsWith('</');
    const local = qname.replace(/^(?:xs|xsd):/, '');
    const isTypeContainer =
      local === 'complexType' || local === 'simpleType' || local === 'group' || local === 'attributeGroup';

    if (!isClose && isTypeContainer) {
      if (!selfClosing) depth += 1;
      continue;
    }
    if (isClose && isTypeContainer) {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (!isClose && local === 'element' && depth === 0) {
      const nameAttr = /\bname\s*=\s*"([^"]+)"/.exec(full);
      if (nameAttr) rootElements.push(nameAttr[1]);
    }
  }

  return {targetNamespace, rootElements, schemaLocations};
}

function buildCatalog(): SchemaCatalog {
  const entries = listSchemas();
  const schemas: CatalogSchema[] = [];
  let xsdDir = '';

  for (const entry of entries) {
    const loaded = readSchema(entry.id);
    if (!loaded) continue;
    if (!xsdDir) xsdDir = path.dirname(loaded.path);
    const meta = parseXsdMeta(loaded.content);
    schemas.push({
      id: entry.id,
      fileName: path.basename(loaded.path),
      path: loaded.path,
      xmlns: meta.targetNamespace,
      rootElements: meta.rootElements,
      schemaLocations: meta.schemaLocations,
    });
  }

  if (!xsdDir) {
    throw new Error('Could not locate bundled XSD directory from @salesforce/b2c-tooling-sdk');
  }

  const byId = new Map<string, CatalogSchema>();
  const byXmlns = new Map<string, CatalogSchema[]>();
  for (const schema of schemas) {
    byId.set(schema.id, schema);
    if (!schema.xmlns) continue;
    const list = byXmlns.get(schema.xmlns) ?? [];
    list.push(schema);
    byXmlns.set(schema.xmlns, list);
  }

  return {schemas, byId, byXmlns, xsdDir};
}

export function getCatalog(): SchemaCatalog {
  cached ??= buildCatalog();
  return cached;
}

export type ResolveXmlResult =
  | {ok: true; schema: CatalogSchema; inferredFrom: 'xmlns' | 'root'}
  | {ok: false; reason: 'unknown'}
  | {ok: false; reason: 'ambiguous'; candidates: CatalogSchema[]};

export function resolveXmlSchema(xmlns: string | undefined, rootLocalName: string | undefined): ResolveXmlResult {
  if (!xmlns) return {ok: false, reason: 'unknown'};
  const catalog = getCatalog();
  const matches = (catalog.byXmlns.get(xmlns) ?? []).filter((schema) => schema.id !== 'xml');
  if (matches.length === 0) return {ok: false, reason: 'unknown'};
  if (matches.length === 1) return {ok: true, schema: matches[0], inferredFrom: 'xmlns'};
  if (!rootLocalName) return {ok: false, reason: 'ambiguous', candidates: matches};
  const byRoot = matches.filter((schema) => schema.rootElements.includes(rootLocalName));
  if (byRoot.length === 1) return {ok: true, schema: byRoot[0], inferredFrom: 'root'};
  if (byRoot.length > 1) return {ok: false, reason: 'ambiguous', candidates: byRoot};
  return {ok: false, reason: 'unknown'};
}

export function getSchemaById(id: string): CatalogSchema | undefined {
  return getCatalog().byId.get(id);
}

/** Exposed for unit tests. */
export function parseXsdMetaForTests(content: string) {
  return parseXsdMeta(content);
}
