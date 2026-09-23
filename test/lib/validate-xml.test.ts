import {expect} from 'chai';
import {getSchemaById} from '../../src/lib/schema-catalog.js';
import {validateXmlFile} from '../../src/lib/validate-xml.js';
import {fixture} from '../helpers.js';

describe('validate-xml', () => {
  it('passes a valid metadata snippet against the bundled XSD', async () => {
    const schema = getSchemaById('metadata');
    const result = await validateXmlFile(fixture('xml', 'valid-metadata.xml'), {schema});
    expect(result.valid, result.errors.map((err) => err.message).join('\n')).to.equal(true);
    expect(result.schemaId).to.equal('metadata');
  });

  it('fails a metadata file with an unknown child element', async () => {
    const schema = getSchemaById('metadata');
    const result = await validateXmlFile(fixture('xml', 'invalid-metadata.xml'), {schema});
    expect(result.valid).to.equal(false);
    expect(result.errors.length).to.be.greaterThan(0);
  });

  it('reports well-formedness-only for an unmatched root', async () => {
    const result = await validateXmlFile(fixture('xml', 'unknown-root.xml'), {wellFormedOnly: true});
    expect(result.valid, result.errors.map((err) => err.message).join('\n')).to.equal(true);
    expect(result.schemaId).to.equal('well-formed');
  });
});
