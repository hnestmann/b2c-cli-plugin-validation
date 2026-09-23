/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {glob} from 'glob';
import {validateMetaDefinitionFile} from '@salesforce/b2c-tooling-sdk/operations/content';
import {ValidateUsageError, type Issue} from './types.js';
import type {ExtractedLibraryContent} from './embedded-library-json.js';

export interface PdAttribute {
  id: string;
  type: string;
  required?: boolean;
  values?: unknown[];
}

export interface PdTypeDef {
  typeId: string;
  kind: 'page' | 'component';
  filePath: string;
  attributes: Map<string, PdAttribute>;
  regionIds: Set<string>;
}

export interface PdTypeIndex {
  kind: 'cartridge' | 'code-version';
  types: Map<string, PdTypeDef>;
  warnings: Issue[];
}

function experienceDirForCartridge(root: string): string | undefined {
  const nested = path.join(root, 'cartridge', 'experience');
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) return nested;
  const direct = path.join(root, 'experience');
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct;
  return undefined;
}

export function detectCartridgesLayout(dir: string): 'cartridge' | 'code-version' {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new ValidateUsageError(`--cartridges-dir is not a directory: ${dir}`);
  }
  if (experienceDirForCartridge(abs)) return 'cartridge';
  const children = fs.readdirSync(abs, {withFileTypes: true});
  if (children.some((child) => child.isDirectory() && experienceDirForCartridge(path.join(abs, child.name)))) {
    return 'code-version';
  }
  throw new ValidateUsageError(
    `--cartridges-dir is neither a cartridge nor a code-version folder: ${dir}\n` +
      '  Expected {path}/cartridge/experience, {path}/experience, or {path}/{name}/cartridge/experience.',
  );
}

function typeIdFromFile(filePath: string, experienceRoot: string): {typeId: string; kind: 'page' | 'component'} | undefined {
  const rel = path.relative(experienceRoot, filePath).replace(/\\/g, '/');
  if (rel.startsWith('pages/') && rel.endsWith('.json')) {
    return {kind: 'page', typeId: `page.${rel.slice('pages/'.length).replace(/\.json$/u, '').replace(/\//g, '.')}`};
  }
  if (rel.startsWith('components/') && rel.endsWith('.json')) {
    return {
      kind: 'component',
      typeId: `component.${rel.slice('components/'.length).replace(/\.json$/u, '').replace(/\//g, '.')}`,
    };
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function indexMetadefinition(filePath: string, typeId: string, kind: 'page' | 'component'): PdTypeDef {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  const data = asObject(raw) ?? {};
  const attributes = new Map<string, PdAttribute>();
  const groups = Array.isArray(data.attribute_definition_groups) ? data.attribute_definition_groups : [];
  for (const group of groups) {
    const groupObj = asObject(group);
    const defs = Array.isArray(groupObj?.attribute_definitions) ? groupObj.attribute_definitions : [];
    for (const def of defs) {
      const attr = asObject(def);
      if (!attr) continue;
      const id = typeof attr.id === 'string' ? attr.id : undefined;
      const type = typeof attr.type === 'string' ? attr.type : undefined;
      if (!id || !type) continue;
      attributes.set(id, {
        id,
        type,
        required: typeof attr.required === 'boolean' ? attr.required : undefined,
        values: Array.isArray(attr.values) ? attr.values : undefined,
      });
    }
  }
  const regionIds = new Set<string>();
  const regions = Array.isArray(data.region_definitions) ? data.region_definitions : [];
  for (const region of regions) {
    const regionObj = asObject(region);
    if (typeof regionObj?.id === 'string') regionIds.add(regionObj.id);
  }
  return {typeId, kind, filePath, attributes, regionIds};
}

async function addExperienceTree(
  experienceRoot: string,
  types: Map<string, PdTypeDef>,
  warnings: Issue[],
): Promise<void> {
  const files = await glob('**/{pages,components}/**/*.json', {
    cwd: experienceRoot,
    nodir: true,
    absolute: true,
  });
  for (const filePath of files) {
    const mapped = typeIdFromFile(filePath, experienceRoot);
    if (!mapped) continue;
    try {
      const result = validateMetaDefinitionFile(filePath, {
        type: mapped.kind === 'page' ? 'pagetype' : 'componenttype',
      });
      if (!result.valid) {
        warnings.push({
          path: filePath,
          message: `Page Designer type ${mapped.typeId} is not schema-valid; still indexing attributes`,
        });
      }
    } catch {
      warnings.push({path: filePath, message: `Could not schema-validate ${mapped.typeId}`});
    }
    if (types.has(mapped.typeId)) {
      warnings.push({
        path: filePath,
        message: `Duplicate Page Designer type id ${mapped.typeId}; keeping ${types.get(mapped.typeId)?.filePath}`,
      });
      continue;
    }
    try {
      types.set(mapped.typeId, indexMetadefinition(filePath, mapped.typeId, mapped.kind));
    } catch (error) {
      warnings.push({
        path: filePath,
        message: `Failed to index ${mapped.typeId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

export async function buildPdTypeIndex(cartridgesDir: string): Promise<PdTypeIndex> {
  const kind = detectCartridgesLayout(cartridgesDir);
  const abs = path.resolve(cartridgesDir);
  const types = new Map<string, PdTypeDef>();
  const warnings: Issue[] = [];

  if (kind === 'cartridge') {
    const experienceRoot = experienceDirForCartridge(abs);
    if (experienceRoot) await addExperienceTree(experienceRoot, types, warnings);
  } else {
    for (const child of fs.readdirSync(abs, {withFileTypes: true})) {
      if (!child.isDirectory()) continue;
      const experienceRoot = experienceDirForCartridge(path.join(abs, child.name));
      if (experienceRoot) await addExperienceTree(experienceRoot, types, warnings);
    }
  }

  return {kind, types, warnings};
}

function primitiveMismatch(attr: PdAttribute, value: unknown): string | undefined {
  if (value === null) return undefined;
  switch (attr.type) {
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `attribute "${attr.id}" expected boolean`;
    case 'integer':
      return Number.isInteger(value) ? undefined : `attribute "${attr.id}" expected integer`;
    case 'enum': {
      if (!attr.values) return undefined;
      const allowed = new Set(attr.values.map((item) => String(item)));
      return allowed.has(String(value)) ? undefined : `attribute "${attr.id}" value is not in enum`;
    }
    case 'string':
    case 'text':
    case 'markup':
    case 'url':
    case 'product':
    case 'category':
    case 'file':
    case 'page':
      return typeof value === 'string' ? undefined : `attribute "${attr.id}" expected string`;
    default:
      return undefined;
  }
}

export function validateInstanceAgainstType(
  content: ExtractedLibraryContent,
  data: Record<string, unknown>,
  index: PdTypeIndex,
  allContentIds: Set<string>,
): {errors: Issue[]; warnings: Issue[]} {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!content.type) return {errors, warnings};

  const def = index.types.get(content.type);
  if (!def) {
    warnings.push({
      message: `Unknown Page Designer type "${content.type}" (not found in --cartridges-dir)`,
    });
    return {errors, warnings};
  }

  for (const [key, value] of Object.entries(data)) {
    const attr = def.attributes.get(key);
    if (!attr) {
      errors.push({path: `/${key}`, message: `Unknown attribute "${key}" on type ${content.type}`});
      continue;
    }
    if (value === null) {
      if (attr.required) {
        warnings.push({path: `/${key}`, message: `required attribute "${key}" is null (unset)`});
      }
      continue;
    }
    const mismatch = primitiveMismatch(attr, value);
    if (mismatch) errors.push({path: `/${key}`, message: mismatch});
  }

  if (def.kind === 'page') {
    const prefix = `${content.type}.`;
    for (const link of content.contentLinks) {
      if (link.type) {
        if (!link.type.startsWith(prefix)) {
          errors.push({
            message: `content-link type "${link.type}" does not match page type ${content.type}`,
          });
        } else {
          const regionId = link.type.slice(prefix.length);
          if (regionId && !def.regionIds.has(regionId)) {
            errors.push({
              message: `Unknown region "${regionId}" on page type ${content.type}`,
            });
          }
        }
      }
      if (link.contentId && !allContentIds.has(link.contentId)) {
        warnings.push({
          message: `content-link content-id "${link.contentId}" was not found in this library (partial overlay?)`,
        });
      }
    }
  }

  return {errors, warnings};
}

export {typeIdFromFile as typeIdFromExperienceFile};
