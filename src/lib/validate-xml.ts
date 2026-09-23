/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {validateXML} from 'xmllint-wasm';
import {getCatalog, getSchemaById, type CatalogSchema} from './schema-catalog.js';
import {ValidateUsageError, type FileResult, type Issue} from './types.js';

const PAGES_PER_GIB = 16384;
const MIN_PAGES = 256;
const MAX_PAGES = 2 * PAGES_PER_GIB;

let preloadCache: {fileName: string; contents: string}[] | undefined;
let schemaContentCache: Map<string, string> | undefined;

function getPreloads(): {fileName: string; contents: string}[] {
  if (preloadCache) return preloadCache;
  const {xsdDir} = getCatalog();
  preloadCache = fs
    .readdirSync(xsdDir)
    .filter((file) => file.endsWith('.xsd'))
    .map((file) => ({
      fileName: file,
      contents: fs.readFileSync(path.join(xsdDir, file), 'utf8'),
    }));
  return preloadCache;
}

function schemaContent(schema: CatalogSchema): string {
  schemaContentCache ??= new Map();
  const cached = schemaContentCache.get(schema.path);
  if (cached) return cached;
  const content = fs.readFileSync(schema.path, 'utf8');
  schemaContentCache.set(schema.path, content);
  return content;
}

export function pagesForFileSize(bytes: number): number {
  const pageBytes = 64 * 1024;
  const estimated = Math.ceil((bytes * 6) / pageBytes) + MIN_PAGES;
  return Math.min(MAX_PAGES, Math.max(MIN_PAGES, estimated));
}

export function resolveSchemaOverride(schema: string, cwd = process.cwd()): CatalogSchema {
  const asPath = path.resolve(cwd, schema);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
    return {
      id: path.basename(asPath, '.xsd'),
      fileName: path.basename(asPath),
      path: asPath,
      rootElements: [],
      schemaLocations: [],
    };
  }
  const bundled = getSchemaById(schema);
  if (!bundled) {
    throw new ValidateUsageError(`Unknown --schema ${schema}. See \`b2c validate schemas\`.`);
  }
  return bundled;
}

const WARNING_RE =
  /warning:|failed to load|no such file or directory|schemas parser warning|unloaded schema|xsi:schemalocation/i;
const ERROR_RE = /validity error|parser error|schemas validity error|not well-formed|failed to parse/i;

function classifyMessage(message: string): 'error' | 'warning' {
  if (ERROR_RE.test(message)) return 'error';
  if (WARNING_RE.test(message)) return 'warning';
  return 'error';
}

function mapMessages(
  raw: ReadonlyArray<{message?: string; rawMessage?: string}>,
): {errors: Issue[]; warnings: Issue[]} {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  for (const item of raw) {
    const message = (item.message ?? item.rawMessage ?? String(item)).trim();
    if (!message) continue;
    if (classifyMessage(message) === 'warning') warnings.push({message});
    else errors.push({message});
  }
  return {errors, warnings};
}

function xsiSchemaLocationWarning(xml: string, schema: CatalogSchema | undefined): Issue | undefined {
  const match = /xsi:schemaLocation\s*=\s*"([^"]+)"/.exec(xml) ?? /xsi:schemaLocation\s*=\s*'([^']+)'/.exec(xml);
  if (!match || !schema?.xmlns) return undefined;
  const tokens = match[1].trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i += 2) {
    const ns = tokens[i];
    if (ns && ns !== schema.xmlns) {
      return {
        message: `xsi:schemaLocation namespace "${ns}" differs from selected schema xmlns "${schema.xmlns}"; validating against ${schema.id}`,
      };
    }
  }
  return undefined;
}

export interface ValidateXmlOptions {
  schema?: CatalogSchema;
  wellFormedOnly?: boolean;
}

export async function validateXmlFile(filePath: string, options: ValidateXmlOptions = {}): Promise<FileResult> {
  const stat = await fs.promises.stat(filePath);
  const xml = await fs.promises.readFile(filePath, 'utf8');
  const maxMemoryPages = pagesForFileSize(stat.size);
  const stream = stat.size > 512 * 1024;
  const preloads = getPreloads().filter((file) => file.fileName !== options.schema?.fileName);

  try {
    const result = options.wellFormedOnly
      ? await validateXML({
          xml: [{fileName: path.basename(filePath), contents: xml}],
          schema: [],
          maxMemoryPages,
          stream,
        } as unknown as Parameters<typeof validateXML>[0])
      : await validateXML({
          xml: [{fileName: path.basename(filePath), contents: xml}],
          schema: [
            {
              fileName: options.schema?.fileName ?? 'schema.xsd',
              contents: options.schema ? schemaContent(options.schema) : '',
            },
          ],
          preload: preloads,
          maxMemoryPages,
          stream,
        } as unknown as Parameters<typeof validateXML>[0]);

    const {errors, warnings} = mapMessages(result.errors ?? []);
    const locationWarning = xsiSchemaLocationWarning(xml, options.schema);
    if (locationWarning) warnings.push(locationWarning);

    const hasErrors = errors.length > 0;
    const valid = result.valid && !hasErrors;
    const status = !valid ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';

    return {
      filePath,
      kind: 'xml',
      status,
      valid,
      schemaId: options.wellFormedOnly ? 'well-formed' : options.schema?.id,
      schemaPath: options.wellFormedOnly ? undefined : options.schema?.path,
      inferredFrom: options.wellFormedOnly ? 'well-formed' : undefined,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      filePath,
      kind: 'xml',
      status: 'fail',
      valid: false,
      schemaId: options.wellFormedOnly ? 'well-formed' : options.schema?.id,
      schemaPath: options.schema?.path,
      errors: [{message: error instanceof Error ? error.message : String(error)}],
      warnings: [],
    };
  }
}
