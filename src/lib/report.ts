/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import {ux} from '@oclif/core';
import type {EmbeddedResult, FileResult, ValidateSummary} from './types.js';

export function displayPath(filePath: string, cwd = process.cwd()): string {
  const rel = path.relative(cwd, filePath);
  if (!rel || rel.startsWith('..')) return filePath;
  return rel;
}

function schemaLabel(result: FileResult): string {
  const id = result.schemaId ?? result.schemaType;
  return id ? ` (${id})` : '';
}

function embeddedLabel(file: string, embedded: EmbeddedResult, cwd: string): string {
  const loc = embedded.location === 'data' && embedded.lang ? `data[@xml:lang='${embedded.lang}']` : embedded.location;
  const type = embedded.schemaType ? ` (${embedded.schemaType})` : '';
  return `${displayPath(file, cwd)} content[${embedded.contentId}]/${loc}${type}`;
}

function printIssues(result: Pick<FileResult, 'errors' | 'warnings'>, verbose: boolean): void {
  for (const warning of result.warnings) {
    const loc = warning.path && warning.path !== '/' ? ` at ${warning.path}` : '';
    ux.stdout(`  ${ux.colorize('yellow', 'WARN')}${loc}: ${warning.message}`);
  }
  for (const error of result.errors) {
    const loc = error.path && error.path !== '/' ? ` at ${error.path}` : '';
    ux.stdout(`  ${ux.colorize('red', 'ERROR')}${loc}: ${error.message}`);
  }
  if (verbose) {
    /* extra lines are printed by the caller */
  }
}

export function formatFileResult(result: FileResult, options: {cwd?: string; verbose?: boolean; quiet?: boolean} = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const quiet = options.quiet ?? false;
  const verbose = options.verbose ?? false;
  const shown = displayPath(result.filePath, cwd);

  if (result.status === 'skip') {
    if (!quiet) ux.stdout(`${ux.colorize('gray', 'SKIP')}: ${shown} (${result.skipReason ?? 'skipped'})`);
    return;
  }

  if (result.kind === 'json') {
    if (result.valid && result.warnings.length === 0) {
      if (!quiet) ux.stdout(`${ux.colorize('green', 'PASS')}: ${shown}${schemaLabel(result)}`);
    } else if (result.valid) {
      ux.stdout(`${ux.colorize('yellow', 'WARN')}: ${shown}${schemaLabel(result)}`);
      printIssues(result, verbose);
    } else {
      ux.stdout(`${ux.colorize('red', 'FAIL')}: ${shown}${schemaLabel(result)}`);
      printIssues(result, verbose);
    }
  } else {
    const xsdValid = result.errors.length === 0;
    if (xsdValid && result.warnings.length === 0) {
      if (!quiet) ux.stdout(`${ux.colorize('green', 'PASS')}: ${shown}${schemaLabel(result)}`);
    } else if (xsdValid) {
      ux.stdout(`${ux.colorize('yellow', 'WARN')}: ${shown}${schemaLabel(result)}`);
      printIssues(result, verbose);
    } else {
      ux.stdout(`${ux.colorize('red', 'FAIL')}: ${shown}${schemaLabel(result)}`);
      printIssues(result, verbose);
    }
  }

  if (verbose && result.schemaPath) {
    ux.stdout(`  schema: ${result.schemaPath}`);
  }
  if (verbose && result.inferredFrom) {
    ux.stdout(`  inferred from: ${result.inferredFrom}`);
  }

  for (const embedded of result.embedded ?? []) {
    const label = embeddedLabel(result.filePath, embedded, cwd);
    if (embedded.valid && embedded.warnings.length === 0) {
      if (!quiet) ux.stdout(`${ux.colorize('green', 'PASS')}: ${label}`);
    } else if (embedded.valid) {
      ux.stdout(`${ux.colorize('yellow', 'WARN')}: ${label}`);
      printIssues(embedded, verbose);
    } else {
      ux.stdout(`${ux.colorize('red', 'FAIL')}: ${label}`);
      printIssues(embedded, verbose);
    }
  }
}

export function formatSummary(summary: ValidateSummary): void {
  ux.stdout('');
  ux.stdout(
    `${summary.validFiles}/${summary.totalFiles} file(s) valid, ${summary.totalErrors} error(s), ${summary.skippedFiles} skipped, ${summary.totalWarnings} warning(s)`,
  );
}

export function toJsonSummary(summary: ValidateSummary): ValidateSummary {
  return summary;
}

export function fileHasFailures(result: FileResult): boolean {
  if (result.status === 'fail' || !result.valid) return true;
  return (result.embedded ?? []).some((item) => !item.valid);
}

export function summarize(results: FileResult[]): ValidateSummary {
  const totalErrors = results.reduce((sum, result) => {
    const embedded = (result.embedded ?? []).reduce((inner, item) => inner + item.errors.length, 0);
    return sum + result.errors.length + embedded;
  }, 0);
  const totalWarnings = results.reduce((sum, result) => {
    const embedded = (result.embedded ?? []).reduce((inner, item) => inner + item.warnings.length, 0);
    return sum + result.warnings.length + embedded;
  }, 0);
  const skippedFiles = results.filter((result) => result.status === 'skip').length;
  const validFiles = results.filter((result) => result.status !== 'skip' && !fileHasFailures(result)).length;
  return {
    results,
    totalFiles: results.length,
    validFiles,
    skippedFiles,
    totalErrors,
    totalWarnings,
  };
}
