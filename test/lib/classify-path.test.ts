import {expect} from 'chai';
import {classifyPath} from '../../src/lib/classify-path.js';
import {fixture} from '../helpers.js';

describe('classify-path', () => {
  it('classifies a folder with meta/ and sites/ as a site import', () => {
    const result = classifyPath(fixture('archives', 'site-import'));
    expect(result.kind).to.equal('archive');
  });

  it('classifies an overlay with services.xml + sites/ as a site import', () => {
    const result = classifyPath(fixture('archives', 'overlay'));
    expect(result.kind).to.equal('archive');
  });

  it('classifies an experience/ tree as a generic directory', () => {
    const result = classifyPath(fixture('archives', 'generic'));
    expect(result.kind).to.equal('generic');
  });

  it('classifies a folder of XML files without unit markers as generic', () => {
    const result = classifyPath(fixture('archives', 'xml-only'));
    expect(result.kind).to.equal('generic');
  });

  it('classifies a file as a file', () => {
    const result = classifyPath(fixture('xml', 'valid-metadata.xml'));
    expect(result.kind).to.equal('file');
  });

  it('classifies a glob string as a glob', () => {
    const result = classifyPath('meta/**/*.xml');
    expect(result.kind).to.equal('glob');
  });
});
