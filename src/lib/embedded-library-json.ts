/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import {validateJsonData} from './validate-json.js';
import type {EmbeddedResult, Issue} from './types.js';
import type {PdTypeIndex} from './pd-type-index.js';
import {validateInstanceAgainstType} from './pd-type-index.js';

export interface LibraryContentLink {
  type?: string;
  contentId?: string;
}

export interface ExtractedLibraryContent {
  contentId: string;
  type?: string;
  config?: string;
  data: Array<{text: string; lang?: string}>;
  contentLinks: LibraryContentLink[];
}

function findMatchingClose(xml: string, openEnd: number, tagName: string): number {
  const openRe = new RegExp(`<${tagName}(\\s[^>]*)?>`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let cursor = openEnd;
  while (cursor < xml.length && depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(xml);
    const nextClose = closeRe.exec(xml);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      const tag = nextOpen[0];
      if (!/\/>\s*$/.test(tag)) depth += 1;
      cursor = nextOpen.index + tag.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose.index;
    cursor = nextClose.index + nextClose[0].length;
  }
  return -1;
}

function attr(source: string, name: string): string | undefined {
  return (
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(source)?.[1] ??
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`).exec(source)?.[1]
  );
}

function innerTags(body: string, tag: string): Array<{attrs: string; text: string}> {
  const results: Array<{attrs: string; text: string}> = [];
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    results.push({attrs: match[1] ?? '', text: match[2].trim()});
  }
  return results;
}

export function extractLibraryContents(xml: string): ExtractedLibraryContent[] {
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, '');
  const contents: ExtractedLibraryContent[] = [];
  const openRe = /<content(\s[^>]*)?>/gi;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(stripped))) {
    const openTag = match[0];
    if (/\/>\s*$/.test(openTag)) continue;
    const closeStart = findMatchingClose(stripped, match.index + openTag.length, 'content');
    if (closeStart === -1) continue;
    const body = stripped.slice(match.index + openTag.length, closeStart);
    const contentId = attr(openTag, 'content-id');
    if (!contentId) continue;
    const type = innerTags(body, 'type')[0]?.text;
    const config = innerTags(body, 'config')[0]?.text;
    const data = innerTags(body, 'data').map((item) => ({
      text: item.text,
      lang: attr(item.attrs, 'xml:lang'),
    }));
    const contentLinks: LibraryContentLink[] = [];
    const linkRe = /<content-link(\s[^>]*)?\/?>/gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRe.exec(body))) {
      contentLinks.push({
        type: attr(linkMatch[1] ?? '', 'type'),
        contentId: attr(linkMatch[1] ?? '', 'content-id'),
      });
    }
    contents.push({contentId, type, config, data, contentLinks});
    openRe.lastIndex = closeStart;
  }
  return contents;
}

function parseJsonBlob(text: string): {ok: true; value: unknown} | {ok: false; message: string} {
  try {
    return {ok: true, value: JSON.parse(text)};
  } catch (error) {
    return {ok: false, message: error instanceof Error ? error.message : String(error)};
  }
}

function configSchemaForType(type: string | undefined): 'contentassetpageconfig' | 'contentassetcomponentconfig' | undefined {
  if (!type) return undefined;
  if (type.startsWith('page.')) return 'contentassetpageconfig';
  if (type.startsWith('component.')) return 'contentassetcomponentconfig';
  return undefined;
}

export function validateLibraryEmbeddedJson(
  xml: string,
  options: {pdIndex?: PdTypeIndex} = {},
): EmbeddedResult[] {
  const contents = extractLibraryContents(xml);
  const allIds = new Set(contents.map((item) => item.contentId));
  const results: EmbeddedResult[] = [];

  for (const content of contents) {
    if (content.config !== undefined) {
      const parsed = parseJsonBlob(content.config);
      const schemaType = configSchemaForType(content.type);
      if (!parsed.ok) {
        results.push({
          contentId: content.contentId,
          location: 'config',
          schemaType,
          valid: false,
          errors: [{message: `Invalid JSON: ${parsed.message}`}],
          warnings: [],
        });
      } else if (schemaType) {
        if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
          results.push({
            contentId: content.contentId,
            location: 'config',
            schemaType,
            valid: false,
            errors: [{message: 'config JSON must be an object'}],
            warnings: [],
          });
        } else {
          const checked = validateJsonData(parsed.value as Record<string, unknown>, schemaType);
          results.push({
            contentId: content.contentId,
            location: 'config',
            schemaType: checked.schemaType,
            valid: checked.valid,
            errors: checked.errors,
            warnings: [],
          });
        }
      }
    }

    for (const blob of content.data) {
      const parsed = parseJsonBlob(blob.text);
      if (!parsed.ok) {
        results.push({
          contentId: content.contentId,
          location: 'data',
          lang: blob.lang,
          schemaType: 'contentassetstructuredcontentdata',
          valid: false,
          errors: [{message: `Invalid JSON: ${parsed.message}`}],
          warnings: [],
        });
        continue;
      }
      const errors: Issue[] = [];
      const warnings: Issue[] = [];
      if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
        errors.push({message: 'data JSON must be an object'});
      } else if (options.pdIndex) {
        const extra = validateInstanceAgainstType(
          content,
          parsed.value as Record<string, unknown>,
          options.pdIndex,
          allIds,
        );
        errors.push(...extra.errors);
        warnings.push(...extra.warnings);
      }
      results.push({
        contentId: content.contentId,
        location: 'data',
        lang: blob.lang,
        schemaType: options.pdIndex ? content.type : 'contentassetstructuredcontentdata',
        valid: errors.length === 0,
        errors,
        warnings,
      });
    }

    if (options.pdIndex && content.data.length === 0 && content.type) {
      const extra = validateInstanceAgainstType(content, {}, options.pdIndex, allIds);
      if (extra.errors.length > 0 || extra.warnings.length > 0) {
        results.push({
          contentId: content.contentId,
          location: 'data',
          schemaType: content.type,
          valid: extra.errors.length === 0,
          errors: extra.errors,
          warnings: extra.warnings,
        });
      }
    }
  }

  return results;
}
