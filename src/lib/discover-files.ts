/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {glob} from 'glob';
import {ARCHIVE_UNIT_DIRS, ARCHIVE_UNIT_FILES, BINARY_EXTENSIONS, DEFAULT_IGNORE_GLOBS} from './constants.js';
import {classifyPath} from './classify-path.js';
import {isPageDesignerJsonCandidate} from './infer-json.js';
import type {ClassifiedPath, DiscoveredFile} from './types.js';

export interface DiscoverOptions {
  cwd?: string;
  forceJsonType?: boolean;
  include?: string[];
  exclude?: string[];
}

function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function globFiles(pattern: string, cwd: string): Promise<string[]> {
  return glob(pattern, {
    cwd,
    nodir: true,
    absolute: true,
    dot: false,
    ignore: DEFAULT_IGNORE_GLOBS,
  });
}

async function discoverArchive(root: string): Promise<string[]> {
  const names = await fs.promises.readdir(root);
  const files: string[] = [];
  for (const name of names) {
    const abs = path.join(root, name);
    const stat = await fs.promises.stat(abs);
    if (stat.isDirectory() && ARCHIVE_UNIT_DIRS.has(name)) {
      files.push(...(await globFiles('**/*.{xml,json}', abs)));
    } else if (stat.isFile() && ARCHIVE_UNIT_FILES.has(name)) {
      files.push(abs);
    }
  }
  return files;
}

async function discoverGeneric(root: string): Promise<string[]> {
  return globFiles('**/*.{xml,json}', root);
}

function keepFile(filePath: string, forceJsonType: boolean): boolean {
  if (isBinaryPath(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xml') return true;
  if (ext === '.json') return isPageDesignerJsonCandidate(filePath, forceJsonType);
  return false;
}

export async function discoverFiles(classified: ClassifiedPath, options: DiscoverOptions = {}): Promise<DiscoveredFile[]> {
  const forceJsonType = options.forceJsonType ?? false;
  let absPaths: string[] = [];

  if (classified.kind === 'file') {
    absPaths = [classified.absPath];
  } else if (classified.kind === 'glob') {
    absPaths = await glob(classified.path, {
      cwd: options.cwd ?? process.cwd(),
      nodir: true,
      absolute: true,
      ignore: DEFAULT_IGNORE_GLOBS,
    });
  } else if (classified.kind === 'archive') {
    absPaths = await discoverArchive(classified.absPath);
  } else {
    absPaths = await discoverGeneric(classified.absPath);
  }

  const fromKind = classified.kind;
  const files: DiscoveredFile[] = [];
  for (const absPath of absPaths) {
    if (classified.kind === 'file') {
      files.push({absPath, fromKind});
      continue;
    }
    if (keepFile(absPath, forceJsonType)) {
      files.push({absPath, fromKind});
    }
  }
  return files;
}

export async function discoverFromPaths(paths: string[], options: DiscoverOptions = {}): Promise<DiscoveredFile[]> {
  const cwd = options.cwd ?? process.cwd();
  const collected: DiscoveredFile[] = [];
  const seen = new Set<string>();

  for (const input of paths) {
    const classified = classifyPath(input, cwd);
    const files = await discoverFiles(classified, {...options, cwd});
    for (const file of files) {
      if (seen.has(file.absPath)) continue;
      seen.add(file.absPath);
      collected.push(file);
    }
  }

  if (options.include) {
    for (const pattern of options.include) {
      const extra = await glob(pattern, {cwd, nodir: true, absolute: true, ignore: DEFAULT_IGNORE_GLOBS});
      for (const absPath of extra) {
        if (seen.has(absPath) || !keepFile(absPath, options.forceJsonType ?? false)) continue;
        seen.add(absPath);
        collected.push({absPath, fromKind: 'glob'});
      }
    }
  }

  if (options.exclude?.length) {
    const excluded = new Set<string>();
    for (const pattern of options.exclude) {
      const matches = await glob(pattern, {cwd, nodir: true, absolute: true});
      for (const match of matches) excluded.add(match);
    }
    return collected.filter((file) => !excluded.has(file.absPath));
  }

  return collected;
}
