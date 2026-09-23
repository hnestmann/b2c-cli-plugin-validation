/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {detectTypeFromData, detectTypeFromPath, type ContentSchemaType} from '@salesforce/b2c-tooling-sdk/operations/content';
import {JSON_SCHEMA_FRAGMENTS} from './constants.js';

const require = createRequire(import.meta.url);
const sdkRoot = path.dirname(require.resolve('@salesforce/b2c-tooling-sdk/package.json'));
const CONTENT_SCHEMAS_DIR = path.join(sdkRoot, 'data/content-schemas');

let cachedDocumentTypes: string[] | undefined;

export function listJsonDocumentTypes(): string[] {
  if (cachedDocumentTypes) return cachedDocumentTypes;
  cachedDocumentTypes = fs
    .readdirSync(CONTENT_SCHEMAS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/u, ''))
    .filter((id) => !JSON_SCHEMA_FRAGMENTS.has(id))
    .sort();
  return cachedDocumentTypes;
}

export function inferJsonType(
  filePath: string,
  data?: Record<string, unknown>,
): {type: ContentSchemaType | string; inferredFrom: 'path' | 'data'} | null {
  const fromPath = detectTypeFromPath(filePath);
  if (fromPath) return {type: fromPath, inferredFrom: 'path'};
  if (data) {
    const fromData = detectTypeFromData(data);
    if (fromData) return {type: fromData, inferredFrom: 'data'};
  }
  return null;
}

export function isPageDesignerJsonCandidate(filePath: string, forceType = false): boolean {
  if (forceType) return true;
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (base === 'package.json' || base === 'package-lock.json' || base.endsWith('.sample')) return false;
  if (normalized.includes('/ocapi-settings/')) return false;
  if (/\/experience\/(?:pages|components)\//.test(normalized)) return true;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return detectTypeFromData(parsed as Record<string, unknown>) !== null;
  } catch {
    return false;
  }
}
