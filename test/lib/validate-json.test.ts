import {expect} from 'chai';
import {validateJsonFileSync} from '../../src/lib/validate-json.js';
import {fixture} from '../helpers.js';

describe('validate-json', () => {
  it('passes a minimal componenttype JSON file', () => {
    const result = validateJsonFileSync(fixture('json', 'componenttype.json'), 'componenttype');
    expect(result.valid, result.errors.map((err) => err.message).join('\n')).to.equal(true);
    expect(result.schemaType).to.equal('componenttype');
  });

  it('fails junk JSON', () => {
    const result = validateJsonFileSync(fixture('json', 'invalid.json'));
    expect(result.valid).to.equal(false);
    expect(result.errors[0]?.message).to.match(/Invalid JSON/i);
  });
});
