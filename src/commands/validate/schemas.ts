/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import {ux} from '@oclif/core';
import {BaseCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {getCatalog} from '../../lib/schema-catalog.js';
import {listJsonDocumentTypes} from '../../lib/infer-json.js';

export interface SchemasResponse {
  xml: Array<{id: string; xmlns?: string; rootElements: string[]; fileName: string}>;
  json: string[];
}

export default class ValidateSchemas extends BaseCommand<typeof ValidateSchemas> {
  static description = 'List XML and JSON schemas the plugin can use';

  static enableJsonFlag = true;

  static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --json'];

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<SchemasResponse> {
    const catalog = getCatalog();
    const xml = catalog.schemas.map((schema) => ({
      id: schema.id,
      xmlns: schema.xmlns,
      rootElements: schema.rootElements,
      fileName: schema.fileName,
    }));
    const json = listJsonDocumentTypes();
    const response: SchemasResponse = {xml, json};

    if (this.jsonEnabled()) return response;

    ux.stdout('XML schemas');
    ux.stdout(`${'ID'.padEnd(28)}${'ROOT ELEMENTS'.padEnd(36)}XMLNS`);
    for (const row of xml) {
      const roots = row.rootElements.slice(0, 4).join(', ');
      ux.stdout(`${row.id.padEnd(28)}${roots.padEnd(36)}${row.xmlns ?? ''}`);
    }
    ux.stdout('');
    ux.stdout('JSON document types');
    for (const type of json) {
      ux.stdout(`  ${type}`);
    }
    return response;
  }
}
