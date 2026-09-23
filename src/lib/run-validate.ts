/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {MetaDefinitionDetectionError} from '@salesforce/b2c-tooling-sdk/operations/content';
import {MISSING_PATH_MESSAGE} from './constants.js';
import {discoverFromPaths} from './discover-files.js';
import {validateLibraryEmbeddedJson} from './embedded-library-json.js';
import {readXmlHeader} from './infer-xml.js';
import {inferJsonType} from './infer-json.js';
import {buildPdTypeIndex, type PdTypeIndex} from './pd-type-index.js';
import {defaultPrompt} from './prompt.js';
import {fileHasFailures, summarize} from './report.js';
import {getSchemaById, resolveXmlSchema} from './schema-catalog.js';
import {
  ValidateUsageError,
  type FileResult,
  type PromptDecision,
  type ValidateRunOptions,
  type ValidateSummary,
} from './types.js';
import {assertJsonType, readJsonObject, validateJsonFileSync} from './validate-json.js';
import {resolveSchemaOverride, validateXmlFile} from './validate-xml.js';

export {MISSING_PATH_MESSAGE};

export function collectPaths(argsPath: string | undefined, argv: unknown[]): string[] {
  return [argsPath, ...(argv as string[])].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function unknownXmlResult(filePath: string, header: {xmlns?: string; rootLocalName?: string}, strict: boolean): FileResult {
  const detail =
    `${filePath}: not a B2C schema-matching file (no xmlns/root match).\n` +
    `  Use --schema <id> (see \`b2c validate schemas\`)\n` +
    `  or run interactively to pick a schema or check well-formedness only.`;
  if (strict) {
    return {
      filePath,
      kind: 'xml',
      status: 'fail',
      valid: false,
      errors: [{message: detail}],
      warnings: [],
    };
  }
  return {
    filePath,
    kind: 'xml',
    status: 'skip',
    valid: true,
    errors: [],
    warnings: [{message: detail}],
    skipReason: 'not a B2C schema-matching file',
  };
}

function unknownJsonResult(filePath: string, strict: boolean): FileResult {
  const detail =
    `${filePath}: unable to detect Page Designer / content JSON type.\n` +
    `  Use --type <id> (see \`b2c validate schemas\`) or run interactively.`;
  if (strict) {
    return {
      filePath,
      kind: 'json',
      status: 'fail',
      valid: false,
      errors: [{message: detail}],
      warnings: [],
    };
  }
  return {
    filePath,
    kind: 'json',
    status: 'skip',
    valid: true,
    errors: [],
    warnings: [{message: detail}],
    skipReason: 'not a Page Designer JSON document',
  };
}

async function applyPrompt(
  decision: PromptDecision,
  filePath: string,
  cwd: string,
  kind: 'xml' | 'json',
): Promise<FileResult> {
  if (decision.action === 'skip') {
    return {
      filePath,
      kind,
      status: 'skip',
      valid: true,
      errors: [],
      warnings: [],
      skipReason: 'skipped by prompt',
    };
  }
  if (decision.action === 'well-formed') {
    const result = await validateXmlFile(filePath, {wellFormedOnly: true});
    result.inferredFrom = 'well-formed';
    return result;
  }
  if (decision.action === 'schema') {
    const schema = resolveSchemaOverride(decision.schemaId, cwd);
    const result = await validateXmlFile(filePath, {schema});
    result.inferredFrom = 'prompt';
    return result;
  }
  const result = validateJsonFileSync(filePath, decision.type);
  result.inferredFrom = 'prompt';
  return result;
}

async function validateOneXml(
  filePath: string,
  options: ValidateRunOptions,
  pdIndex: PdTypeIndex | undefined,
): Promise<FileResult> {
  const cwd = options.cwd ?? process.cwd();
  let schema = options.schema ? resolveSchemaOverride(options.schema, cwd) : undefined;
  let inferredFrom: FileResult['inferredFrom'] = options.schema ? 'flag' : undefined;
  const header = await readXmlHeader(filePath);

  if (!schema) {
    const resolved = resolveXmlSchema(header.xmlns, header.rootLocalName);
    if (resolved.ok) {
      schema = resolved.schema;
      inferredFrom = resolved.inferredFrom;
    } else if (options.prompt) {
      const promptFn = options.promptFn ?? defaultPrompt;
      const decision = await promptFn({
        filePath,
        kind: 'xml',
        xmlns: header.xmlns,
        rootLocalName: header.rootLocalName,
      });
      const prompted = await applyPrompt(decision, filePath, cwd, 'xml');
      if (prompted.schemaId === 'library' && prompted.valid) {
        await attachEmbedded(prompted, pdIndex);
      }
      return prompted;
    } else {
      return unknownXmlResult(filePath, header, options.strict);
    }
  }

  const result = await validateXmlFile(filePath, {schema});
  result.inferredFrom = inferredFrom;
  if (schema.id === 'library' && result.errors.length === 0) {
    await attachEmbedded(result, pdIndex);
  }
  return result;
}

async function attachEmbedded(result: FileResult, pdIndex: PdTypeIndex | undefined): Promise<void> {
  const xml = await fs.promises.readFile(result.filePath, 'utf8');
  result.embedded = validateLibraryEmbeddedJson(xml, {pdIndex});
  if ((result.embedded ?? []).some((item) => !item.valid)) {
    result.valid = false;
    result.status = 'fail';
  } else if ((result.embedded ?? []).some((item) => item.warnings.length > 0) && result.status === 'pass') {
    result.status = 'warn';
  }
}

async function validateOneJson(filePath: string, options: ValidateRunOptions): Promise<FileResult> {
  if (options.type) {
    const result = validateJsonFileSync(filePath, options.type);
    result.inferredFrom = 'flag';
    return result;
  }
  const parsed = readJsonObject(filePath);
  if ('parseError' in parsed) {
    return {
      filePath,
      kind: 'json',
      status: 'fail',
      valid: false,
      errors: [{message: `Invalid JSON: ${parsed.parseError}`}],
      warnings: [],
    };
  }
  const inferred = inferJsonType(filePath, parsed);
  try {
    const result = validateJsonFileSync(filePath, inferred?.type);
    result.inferredFrom = inferred?.inferredFrom;
    return result;
  } catch (error) {
    if (!(error instanceof MetaDefinitionDetectionError)) throw error;
    if (options.prompt) {
      const promptFn = options.promptFn ?? defaultPrompt;
      return applyPrompt(await promptFn({filePath, kind: 'json'}), filePath, options.cwd ?? process.cwd(), 'json');
    }
    return unknownJsonResult(filePath, options.strict);
  }
}

function skipOther(filePath: string): FileResult {
  return {
    filePath,
    kind: 'other',
    status: 'skip',
    valid: true,
    errors: [],
    warnings: [],
    skipReason: 'not an import document',
  };
}

export async function runValidation(paths: string[], options: ValidateRunOptions): Promise<ValidateSummary> {
  if (paths.length === 0) {
    throw new ValidateUsageError(MISSING_PATH_MESSAGE);
  }
  const cwd = options.cwd ?? process.cwd();
  if (options.schema) resolveSchemaOverride(options.schema, cwd);
  if (options.type) assertJsonType(options.type);

  const discovered = await discoverFromPaths(paths, {
    cwd,
    forceJsonType: Boolean(options.type),
    include: options.include,
    exclude: options.exclude,
  });

  let pdIndex: PdTypeIndex | undefined;
  const hasLibraryXml = discovered.some((file) => path.basename(file.absPath) === 'library.xml');
  if (options.cartridgesDir) {
    pdIndex = await buildPdTypeIndex(options.cartridgesDir);
  }

  const results: FileResult[] = [];
  let cartridgesDirUsed = false;
  let attachedIndexWarnings = false;

  for (const file of discovered) {
    const ext = path.extname(file.absPath).toLowerCase();
    let result: FileResult;
    if (ext === '.xml') {
      result = await validateOneXml(file.absPath, options, pdIndex);
      if (result.schemaId === 'library') cartridgesDirUsed = true;
    } else if (ext === '.json') {
      result = await validateOneJson(file.absPath, options);
    } else {
      result = skipOther(file.absPath);
    }

    if (pdIndex && result.schemaId === 'library' && !attachedIndexWarnings) {
      result.warnings.push(...pdIndex.warnings);
      attachedIndexWarnings = true;
    }

    results.push(result);
    options.onResult?.(result);
    if (options.failFast && fileHasFailures(result)) break;
  }

  if (options.cartridgesDir && !cartridgesDirUsed && !hasLibraryXml) {
    results.push({
      filePath: options.cartridgesDir,
      kind: 'other',
      status: 'skip',
      valid: true,
      errors: [],
      warnings: [{message: '--cartridges-dir was set but no library XML file was validated in this run'}],
      skipReason: '--cartridges-dir unused',
    });
  }

  return summarize(results);
}

export {getSchemaById};
