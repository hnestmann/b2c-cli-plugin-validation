/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

export const HEADER_WINDOW_BYTES = 64 * 1024;

export const ARCHIVE_UNIT_DIRS = new Set([
  'meta',
  'sites',
  'catalogs',
  'pricebooks',
  'inventory-lists',
  'custom-objects',
  'customer-lists',
  'libraries',
  'library',
]);

export const ARCHIVE_UNIT_FILES = new Set([
  'services.xml',
  'jobs.xml',
  'preferences.xml',
  'sort.xml',
  'site.xml',
  'catalog.xml',
  'library.xml',
  'storefronts.xml',
]);

export const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/library/static/**',
  '**/ocapi-settings/**',
  '**/*.sample',
];

export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.wav',
  '.zip',
  '.gz',
  '.jar',
  '.class',
  '.exe',
  '.dll',
  '.bin',
  '.ds_store',
]);

export const JSON_SCHEMA_FRAGMENTS = new Set([
  'attributedefinition',
  'attributedefinitiongroup',
  'common',
  'databindingcontext',
  'editordefinition',
  'regiondefinition',
  'visibilityrule',
]);

export const MISSING_PATH_MESSAGE =
  'Missing PATH. See `b2c validate --help`.\n   Example: b2c validate ./site-import';
