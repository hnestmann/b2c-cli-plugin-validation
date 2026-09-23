import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import {HEADER_WINDOW_BYTES} from '../../src/lib/constants.js';
import {parseXmlHeader, readXmlHeader} from '../../src/lib/infer-xml.js';
import {fixture} from '../helpers.js';

describe('infer-xml', () => {
  it('reads a standard two-line header', async () => {
    const header = await readXmlHeader(fixture('xml', 'valid-metadata.xml'));
    expect(header.rootLocalName).to.equal('metadata');
    expect(header.xmlns).to.equal('http://www.demandware.com/xml/impex/metadata/2006-10-31');
  });

  it('skips comments before the root element', async () => {
    const header = await readXmlHeader(fixture('xml', 'comment-before-root.xml'));
    expect(header.rootLocalName).to.equal('metadata');
    expect(header.xmlns).to.include('impex/metadata');
  });

  it('parses xmlns when it is not on the first two lines', () => {
    const preview = `<?xml version="1.0"?>\n<!-- a -->\n<!-- b -->\n<metadata\n  xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">`;
    const header = parseXmlHeader(preview);
    expect(header.rootLocalName).to.equal('metadata');
    expect(header.xmlns).to.include('impex/metadata');
  });

  it('does not read past the 64KiB header window', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'b2c-validate-'));
    const filePath = path.join(dir, 'padded.xml');
    const padding = `<!-- ${'x'.repeat(HEADER_WINDOW_BYTES)} -->\n`;
    const body = `${padding}<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31"></metadata>\n`;
    await fs.promises.writeFile(filePath, body);
    const header = await readXmlHeader(filePath);
    expect(header.truncated).to.equal(true);
    expect(header.rootLocalName).to.equal(undefined);
  });

  it('reads a prefixed root and xmlns:prefix', () => {
    const header = parseXmlHeader(
      '<ns:metadata xmlns:ns="http://www.demandware.com/xml/impex/metadata/2006-10-31"></ns:metadata>',
    );
    expect(header.rootLocalName).to.equal('metadata');
    expect(header.xmlns).to.include('impex/metadata');
  });
});
