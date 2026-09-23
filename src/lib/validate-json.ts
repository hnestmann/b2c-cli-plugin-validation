/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import {
  MetaDefinitionDetectionError,
  validateMetaDefinition,
  validateMetaDefinitionFile,
  type ContentSchemaType,
} from '@salesforce/b2c-tooling-sdk/operations/content';
import {listJsonDocumentTypes} from './infer-json.js';
import {ValidateUsageError, type FileResult, type Issue} from './types.js';

export function assertJsonType(type: string): void {
  if (!listJsonDocumentTypes().includes(type)) {
    throw new ValidateUsageError(`Unknown --type ${type}. See \`b2c validate schemas\`.`);
  }
}

export function validateJsonData(
  data: Record<string, unknown>,
  type: string,
): {valid: boolean; schemaType: string; errors: Issue[]} {
  const result = validateMetaDefinition(data, {type: type as ContentSchemaType});
  return {
    valid: result.valid,
    schemaType: result.schemaType,
    errors: result.errors.map((err) => ({path: err.path, message: err.message})),
  };
}

export function validateJsonFileSync(filePath: string, type?: string): FileResult {
  try {
    const result = validateMetaDefinitionFile(filePath, type ? {type: type as ContentSchemaType} : undefined);
    const errors = result.errors.map((err) => ({path: err.path, message: err.message}));
    return {
      filePath,
      kind: 'json',
      status: result.valid ? 'pass' : 'fail',
      valid: result.valid,
      schemaId: result.schemaType,
      schemaType: result.schemaType,
      errors,
      warnings: [],
    };
  } catch (error) {
    if (error instanceof MetaDefinitionDetectionError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      return {
        filePath,
        kind: 'json',
        status: 'fail',
        valid: false,
        errors: [{message: `Invalid JSON: ${error.message}`}],
        warnings: [],
      };
    }
    throw error;
  }
}

export function readJsonObject(filePath: string): Record<string, unknown> | {parseError: string} {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {parseError: 'JSON value must be an object'};
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    return {parseError: error instanceof Error ? error.message : String(error)};
  }
}
