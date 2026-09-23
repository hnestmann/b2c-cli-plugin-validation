/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import {HEADER_WINDOW_BYTES} from './constants.js';
import type {XmlHeader} from './types.js';

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function findTagEnd(text: string, start: number): number {
  let quote: string | undefined;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

function parseStartTag(tag: string): Pick<XmlHeader, 'xmlns' | 'rootLocalName' | 'rootPrefix'> {
  const nameMatch = /^<\/?(([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)\b/.exec(tag);
  if (!nameMatch) return {};
  const prefix = nameMatch[2];
  const localName = nameMatch[3];
  const defaultNs = /\bxmlns\s*=\s*"([^"]+)"/.exec(tag)?.[1] ?? /\bxmlns\s*=\s*'([^']+)'/.exec(tag)?.[1];
  const prefixedNs = prefix
    ? (new RegExp(`\\bxmlns:${prefix}\\s*=\\s*"([^"]+)"`).exec(tag)?.[1] ??
      new RegExp(`\\bxmlns:${prefix}\\s*=\\s*'([^']+)'`).exec(tag)?.[1])
    : undefined;
  return {
    rootPrefix: prefix,
    rootLocalName: localName,
    xmlns: prefixedNs ?? defaultNs,
  };
}

export function parseXmlHeader(preview: string): XmlHeader {
  let index = 0;
  if (preview.charCodeAt(0) === 0xfeff) index = 1;

  while (index < preview.length) {
    index = skipWhitespace(preview, index);
    if (index >= preview.length) break;

    if (preview.startsWith('<!--', index)) {
      const end = preview.indexOf('-->', index + 4);
      if (end === -1) return {preview, truncated: true};
      index = end + 3;
      continue;
    }

    if (preview.startsWith('<?', index)) {
      const end = preview.indexOf('?>', index + 2);
      if (end === -1) return {preview, truncated: true};
      index = end + 2;
      continue;
    }

    if (preview.startsWith('<!', index)) {
      const end = preview.indexOf('>', index + 2);
      if (end === -1) return {preview, truncated: true};
      index = end + 1;
      continue;
    }

    if (preview[index] === '<') {
      const end = findTagEnd(preview, index);
      if (end === -1) return {preview, truncated: true};
      const tag = preview.slice(index, end + 1);
      if (tag.startsWith('</')) {
        index = end + 1;
        continue;
      }
      return {preview, ...parseStartTag(tag)};
    }

    index += 1;
  }

  return {preview};
}

export async function readXmlHeader(filePath: string, maxBytes = HEADER_WINDOW_BYTES): Promise<XmlHeader> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const {bytesRead} = await handle.read(buffer, 0, maxBytes, 0);
    const preview = buffer.subarray(0, bytesRead).toString('utf8');
    const header = parseXmlHeader(preview);
    const hitCap = bytesRead === maxBytes;
    if (hitCap && (header.truncated || !header.rootLocalName)) {
      return {...header, truncated: true};
    }
    return header;
  } finally {
    await handle.close();
  }
}
