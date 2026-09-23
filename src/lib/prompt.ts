/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import search from '@inquirer/search';
import select from '@inquirer/select';
import {getCatalog} from './schema-catalog.js';
import {listJsonDocumentTypes} from './infer-json.js';
import type {PromptContext, PromptDecision, PromptFn} from './types.js';

const memory = new Map<string, PromptDecision>();

export function promptMemoryKey(ctx: PromptContext): string {
  if (ctx.kind === 'xml') {
    return `xml::${ctx.xmlns ?? ''}::${ctx.rootLocalName ?? ''}::${path.basename(ctx.filePath)}`;
  }
  return `json::${path.basename(ctx.filePath)}`;
}

export function recallPrompt(key: string): PromptDecision | undefined {
  return memory.get(key);
}

export function rememberPrompt(key: string, decision: PromptDecision): void {
  memory.set(key, decision);
}

export function clearPromptMemory(): void {
  memory.clear();
}

async function promptXmlSchema(): Promise<string> {
  const schemas = getCatalog().schemas.filter((schema) => schema.id !== 'xml');
  return search({
    message: 'Schema',
    source: async (term) => {
      const q = (term ?? '').toLowerCase();
      return schemas
        .filter((schema) => !q || schema.id.includes(q) || schema.rootElements.some((root) => root.includes(q)))
        .map((schema) => ({
          name: `${schema.id}  (${schema.rootElements.slice(0, 3).join(', ') || 'no roots'})`,
          value: schema.id,
        }));
    },
  });
}

async function promptJsonType(): Promise<string> {
  const types = listJsonDocumentTypes();
  return search({
    message: 'Document type',
    source: async (term) => {
      const q = (term ?? '').toLowerCase();
      return types
        .filter((type) => !q || type.includes(q))
        .map((type) => ({name: type, value: type}));
    },
  });
}

export const defaultPrompt: PromptFn = async (ctx) => {
  const key = promptMemoryKey(ctx);
  const remembered = recallPrompt(key);
  if (remembered) return remembered;

  if (ctx.kind === 'xml') {
    process.stderr.write(`\nCannot infer a B2C schema for ${ctx.filePath}\n`);
    process.stderr.write(`  xmlns: ${ctx.xmlns ?? '(none)'}\n`);
    process.stderr.write(`  root: ${ctx.rootLocalName ?? '(none)'}\n\n`);
    const next = await select({
      message: 'What next?',
      choices: [
        {name: 'Pick a schema…', value: 'pick'},
        {
          name: 'Check well-formedness only (no XSD) — reports whether the XML parses',
          value: 'well-formed',
        },
        {name: 'Skip this file — warning only; does not fail the run by itself', value: 'skip'},
      ],
    });
    let decision: PromptDecision;
    if (next === 'pick') decision = {action: 'schema', schemaId: await promptXmlSchema()};
    else if (next === 'well-formed') decision = {action: 'well-formed'};
    else decision = {action: 'skip'};
    rememberPrompt(key, decision);
    return decision;
  }

  process.stderr.write(`\nCannot infer a Page Designer / content JSON type for ${ctx.filePath}\n\n`);
  const next = await select({
    message: 'What next?',
    choices: [
      {name: 'Pick a document type…', value: 'pick'},
      {name: 'Skip this file — warning only; does not fail the run by itself', value: 'skip'},
    ],
  });
  const decision: PromptDecision =
    next === 'pick' ? {action: 'type', type: await promptJsonType()} : {action: 'skip'};
  rememberPrompt(key, decision);
  return decision;
};
