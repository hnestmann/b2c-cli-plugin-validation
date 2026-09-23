/*
 * Copyright (c) 2026, the b2c-plugin-validation authors.
 * SPDX-License-Identifier: Apache-2.0
 */

import {Args, Flags} from '@oclif/core';
import {BaseCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {MISSING_PATH_MESSAGE, collectPaths, runValidation} from '../../lib/run-validate.js';
import {formatFileResult, formatSummary} from '../../lib/report.js';
import {ValidateUsageError, type ValidateSummary} from '../../lib/types.js';

export default class Validate extends BaseCommand<typeof Validate> {
  static args = {
    path: Args.string({
      description: 'File, directory, or glob to validate (repeatable). Required.',
      required: false,
    }),
  };

  static description = 'Validate B2C Commerce site-import XML and Page Designer JSON';

  static enableJsonFlag = true;

  static examples = [
    '<%= config.bin %> <%= command.id %> meta/system-objecttype-extensions.xml',
    '<%= config.bin %> <%= command.id %> ./site-import',
    '<%= config.bin %> <%= command.id %> ./site-import --cartridges-dir ./commerce-cloud-code',
    '<%= config.bin %> <%= command.id %> cartridge/experience/components/hero.json',
    '<%= config.bin %> <%= command.id %> ./site-import --no-prompt --json',
    '<%= config.bin %> <%= command.id %> system-objecttype-extensions.xml --schema metadata',
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    schema: Flags.string({
      char: 'S',
      description: 'XSD id (metadata, catalog, …) or path to an .xsd file',
    }),
    type: Flags.string({
      char: 't',
      description: 'Page Designer / content JSON document type',
    }),
    'cartridges-dir': Flags.string({
      description:
        'Cartridge or code-version folder; bind library.xml embedded content to Page Designer type definitions',
    }),
    prompt: Flags.boolean({
      allowNo: true,
      description: 'Prompt when a schema cannot be inferred. --no-prompt disables.',
    }),
    strict: Flags.boolean({
      allowNo: true,
      default: true,
      description: 'Unknown / non-matching files are failures. --no-strict skips them.',
    }),
    'fail-fast': Flags.boolean({
      default: false,
      description: 'Stop at the first failing file',
    }),
    include: Flags.string({
      multiple: true,
      description: 'Extra glob(s) to include',
    }),
    exclude: Flags.string({
      char: 'x',
      multiple: true,
      description: 'Glob(s) to skip',
    }),
    quiet: Flags.boolean({
      char: 'q',
      default: false,
      description: 'Print failures and summary only',
    }),
    verbose: Flags.boolean({
      default: false,
      description: 'Print inferred schema and engine details',
    }),
  };

  static strict = false;

  async run(): Promise<ValidateSummary> {
    const {args, argv, flags} = await this.parse(Validate);
    const paths = collectPaths(args.path, argv);
    if (paths.length === 0) {
      this.error(MISSING_PATH_MESSAGE);
    }

    const jsonMode = this.jsonEnabled();
    const shouldPrompt = jsonMode ? false : (flags.prompt ?? Boolean(process.stdout.isTTY));

    try {
      const summary = await runValidation(paths, {
        schema: flags.schema,
        type: flags.type,
        cartridgesDir: flags['cartridges-dir'],
        prompt: shouldPrompt,
        strict: flags.strict,
        failFast: flags['fail-fast'],
        include: flags.include,
        exclude: flags.exclude,
        quiet: flags.quiet,
        verbose: flags.verbose,
        onResult: jsonMode
          ? undefined
          : (result) =>
              formatFileResult(result, {
                quiet: flags.quiet,
                verbose: flags.verbose,
              }),
      });

      if (jsonMode) return summary;

      formatSummary(summary);
      if (summary.results.some((result) => result.status === 'fail' || !result.valid)) {
        this.error('Validation failed', {exit: 1});
      }
      return summary;
    } catch (error) {
      if (error instanceof ValidateUsageError) {
        this.error(error.message, {exit: error.exitCode});
      }
      throw error;
    }
  }
}
