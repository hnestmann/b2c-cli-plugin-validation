import fs from 'node:fs';
import {expect} from 'chai';
import {extractLibraryContents, validateLibraryEmbeddedJson} from '../../src/lib/embedded-library-json.js';
import {fixture} from '../helpers.js';

describe('embedded-library-json', () => {
  it('routes page.* config to contentassetpageconfig and component.* to contentassetcomponentconfig', () => {
    const xml = fs.readFileSync(fixture('xml', 'library-embedded.xml'), 'utf8');
    const extracted = extractLibraryContents(xml);
    expect(extracted.map((item) => item.type)).to.include('component.hero.banner');
    expect(extracted.map((item) => item.type)).to.include('page.contentPage');

    const results = validateLibraryEmbeddedJson(xml);
    const configs = results.filter((item) => item.location === 'config');
    expect(configs.find((item) => item.contentId === 'hero-1')?.schemaType).to.equal('contentassetcomponentconfig');
    expect(configs.find((item) => item.contentId === 'home')?.schemaType).to.equal('contentassetpageconfig');
    expect(configs.every((item) => item.valid)).to.equal(true);
  });

  it('fails broken JSON in <config> even when the XML is extractable', () => {
    const xml = fs.readFileSync(fixture('xml', 'library-bad-config.xml'), 'utf8');
    const results = validateLibraryEmbeddedJson(xml);
    const config = results.find((item) => item.location === 'config');
    expect(config?.valid).to.equal(false);
    expect(config?.errors[0]?.message).to.match(/Invalid JSON/i);
  });
});
