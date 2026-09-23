import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import {MISSING_PATH_MESSAGE, collectPaths, runValidation} from '../../src/lib/run-validate.js';
import {ValidateUsageError} from '../../src/lib/types.js';
import {fixture} from '../helpers.js';

describe('validate command logic', () => {
  it('treats missing PATH as a usage error message', () => {
    expect(collectPaths(undefined, [])).to.deep.equal([]);
    expect(MISSING_PATH_MESSAGE).to.match(/Missing PATH/);
    expect(MISSING_PATH_MESSAGE).to.match(/b2c validate \.\/site-import/);
    expect(MISSING_PATH_MESSAGE).to.not.match(/does not imply|defaults to `\.'|imply `\.'/);
  });

  it('returns a json-shaped summary for a valid metadata file', async () => {
    const summary = await runValidation([fixture('xml', 'valid-metadata.xml')], {
      prompt: false,
      strict: true,
      failFast: false,
    });
    expect(summary.totalFiles).to.equal(1);
    expect(summary.validFiles).to.equal(1);
    expect(summary.results[0]).to.include({kind: 'xml', valid: true, schemaId: 'metadata'});
    expect(summary.results[0].errors).to.deep.equal([]);
  });

  it('honors --schema override', async () => {
    const summary = await runValidation([fixture('xml', 'valid-metadata.xml')], {
      schema: 'metadata',
      prompt: false,
      strict: true,
      failFast: false,
    });
    expect(summary.results[0].inferredFrom).to.equal('flag');
    expect(summary.results[0].schemaId).to.equal('metadata');
    expect(summary.results[0].valid).to.equal(true);
  });

  it('fails an unknown file under --no-prompt --strict', async () => {
    const summary = await runValidation([fixture('xml', 'unknown-root.xml')], {
      prompt: false,
      strict: true,
      failFast: false,
    });
    expect(summary.results[0].valid).to.equal(false);
    expect(summary.results[0].status).to.equal('fail');
    expect(summary.totalErrors).to.be.greaterThan(0);
  });

  it('errors on an unknown --schema id', async () => {
    try {
      await runValidation([fixture('xml', 'valid-metadata.xml')], {
        schema: 'definitely-not-a-schema',
        prompt: false,
        strict: true,
        failFast: false,
      });
      expect.fail('expected ValidateUsageError');
    } catch (error) {
      expect(error).to.be.instanceOf(ValidateUsageError);
    }
  });

  it('validates a partial overlay site-import directory', async () => {
    const summary = await runValidation([fixture('archives', 'overlay')], {
      prompt: false,
      strict: true,
      failFast: false,
    });
    expect(summary.totalFiles).to.equal(2);
    expect(summary.validFiles).to.equal(2);
    expect(summary.results.map((item) => item.schemaId).sort()).to.deep.equal(['preferences', 'services']);
  });

  it('fails embedded library config JSON after the XSD pass', async () => {
    const summary = await runValidation([fixture('xml', 'library-bad-config.xml')], {
      prompt: false,
      strict: true,
      failFast: false,
    });
    expect(summary.results[0].schemaId).to.equal('library');
    expect(summary.results[0].errors).to.have.length(0);
    expect(summary.results[0].embedded?.some((item) => !item.valid)).to.equal(true);
    expect(summary.validFiles).to.equal(0);
  });

  it('fails unknown attributes when --cartridges-dir resolves the type', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'b2c-validate-lib-'));
    const filePath = path.join(dir, 'library.xml');
    await fs.promises.writeFile(
      filePath,
      `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns="http://www.demandware.com/xml/impex/library/2006-10-31">
  <content content-id="hero-1">
    <type>component.hero.banner</type>
    <data xml:lang="x-default">{"heading":"Hi","nope":true}</data>
  </content>
</library>
`,
    );
    const summary = await runValidation([filePath], {
      prompt: false,
      strict: true,
      failFast: false,
      cartridgesDir: fixture('cartridges', 'app_custom'),
    });
    const data = summary.results[0].embedded?.find((item) => item.location === 'data');
    expect(data?.valid).to.equal(false);
    expect(data?.errors.some((item) => /Unknown attribute "nope"/.test(item.message))).to.equal(true);
  });
});
