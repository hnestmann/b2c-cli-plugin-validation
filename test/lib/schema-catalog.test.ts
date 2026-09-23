import {expect} from 'chai';
import {getCatalog, resolveXmlSchema} from '../../src/lib/schema-catalog.js';

describe('schema-catalog', () => {
  it('maps the metadata xmlns to the metadata schema', () => {
    const result = resolveXmlSchema('http://www.demandware.com/xml/impex/metadata/2006-10-31', 'metadata');
    expect(result.ok).to.equal(true);
    if (result.ok) expect(result.schema.id).to.equal('metadata');
  });

  it('disambiguates customer-list vs customers on the shared customer xmlns', () => {
    const xmlns = 'http://www.demandware.com/xml/impex/customer/2006-10-31';
    const list = resolveXmlSchema(xmlns, 'customer-list');
    const customers = resolveXmlSchema(xmlns, 'customers');
    expect(list.ok).to.equal(true);
    expect(customers.ok).to.equal(true);
    if (list.ok) expect(list.schema.id).to.equal('customerlist2');
    if (customers.ok) expect(customers.schema.id).to.equal('customer');
  });

  it('ignores the W3C xml namespace as a user-facing match', () => {
    const result = resolveXmlSchema('http://www.w3.org/XML/1998/namespace', 'lang');
    expect(result.ok).to.equal(false);
  });

  it('does not guess a schema without xmlns', () => {
    const result = resolveXmlSchema(undefined, 'metadata');
    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.reason).to.equal('unknown');
  });

  it('lists bundled schemas including metadata and library', () => {
    const catalog = getCatalog();
    expect(catalog.byId.has('metadata')).to.equal(true);
    expect(catalog.byId.has('library')).to.equal(true);
    expect(catalog.byId.has('xml')).to.equal(true);
  });
});
