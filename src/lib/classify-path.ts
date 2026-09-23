/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {ARCHIVE_UNIT_DIRS, ARCHIVE_UNIT_FILES} from './constants.js';
import {ValidateUsageError, type ClassifiedPath} from './types.js';

export function looksLikeGlob(input: string): boolean {
  return /[*?[]/.test(input);
}

export function classifyPath(input: string, cwd = process.cwd()): ClassifiedPath {
  const absPath = path.resolve(cwd, input);
  if (looksLikeGlob(input) && !fs.existsSync(absPath)) {
    return {kind: 'glob', path: input, absPath};
  }
  if (!fs.existsSync(absPath)) {
    throw new ValidateUsageError(`PATH not found: ${input}`);
  }
  const stat = fs.statSync(absPath);
  if (stat.isFile()) {
    return {kind: 'file', path: input, absPath};
  }
  if (!stat.isDirectory()) {
    throw new ValidateUsageError(`PATH is not a file or directory: ${input}`);
  }
  const names = fs.readdirSync(absPath);
  const isArchive = names.some((name) => ARCHIVE_UNIT_DIRS.has(name) || ARCHIVE_UNIT_FILES.has(name));
  return {kind: isArchive ? 'archive' : 'generic', path: input, absPath};
}
