/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

export class ValidateUsageError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = 'ValidateUsageError';
  }
}

export type PathKind = 'file' | 'archive' | 'generic' | 'glob';

export type FileKind = 'xml' | 'json' | 'other';

export type ResultStatus = 'pass' | 'fail' | 'skip' | 'warn';

export type InferredFrom = 'xmlns' | 'root' | 'flag' | 'prompt' | 'path' | 'data' | 'well-formed';

export interface Issue {
  path?: string;
  message: string;
}

export interface EmbeddedResult {
  contentId: string;
  location: 'config' | 'data';
  lang?: string;
  schemaType?: string;
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export interface FileResult {
  filePath: string;
  kind: FileKind;
  status: ResultStatus;
  valid: boolean;
  schemaId?: string;
  schemaPath?: string;
  schemaType?: string;
  inferredFrom?: InferredFrom;
  errors: Issue[];
  warnings: Issue[];
  embedded?: EmbeddedResult[];
  skipReason?: string;
}

export interface ValidateSummary {
  results: FileResult[];
  totalFiles: number;
  validFiles: number;
  skippedFiles: number;
  totalErrors: number;
  totalWarnings: number;
}

export interface CatalogSchema {
  id: string;
  fileName: string;
  path: string;
  xmlns?: string;
  rootElements: string[];
  schemaLocations: string[];
}

export interface SchemaCatalog {
  schemas: CatalogSchema[];
  byId: Map<string, CatalogSchema>;
  byXmlns: Map<string, CatalogSchema[]>;
  xsdDir: string;
}

export interface XmlHeader {
  xmlns?: string;
  rootLocalName?: string;
  rootPrefix?: string;
  preview: string;
  truncated?: boolean;
}

export interface ClassifiedPath {
  kind: PathKind;
  path: string;
  absPath: string;
}

export interface DiscoveredFile {
  absPath: string;
  fromKind: PathKind;
}

export type PromptDecision =
  | {action: 'schema'; schemaId: string}
  | {action: 'type'; type: string}
  | {action: 'well-formed'}
  | {action: 'skip'};

export interface PromptContext {
  filePath: string;
  kind: 'xml' | 'json';
  xmlns?: string;
  rootLocalName?: string;
}

export type PromptFn = (ctx: PromptContext) => Promise<PromptDecision>;

export interface ValidateRunOptions {
  cwd?: string;
  schema?: string;
  type?: string;
  cartridgesDir?: string;
  prompt: boolean;
  strict: boolean;
  failFast: boolean;
  include?: string[];
  exclude?: string[];
  quiet?: boolean;
  verbose?: boolean;
  promptFn?: PromptFn;
  onResult?: (result: FileResult) => void;
}
