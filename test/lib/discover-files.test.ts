import path from 'node:path';
import {expect} from 'chai';
import {discoverFiles} from '../../src/lib/discover-files.js';
import {classifyPath} from '../../src/lib/classify-path.js';
import {fixture} from '../helpers.js';

function names(files: Array<{absPath: string}>): string[] {
  return files.map((file) => path.basename(file.absPath)).sort();
}

describe('discover-files', () => {
  it('walks archive units and skips library/static and ocapi-settings', async () => {
    const classified = classifyPath(fixture('archives', 'site-import'));
    const files = await discoverFiles(classified);
    const rel = files.map((file) => path.relative(classified.absPath, file.absPath).replace(/\\/g, '/'));
    expect(rel).to.include('meta/system-objecttype-extensions.xml');
    expect(rel).to.include('sites/RefArch/preferences.xml');
    expect(rel).to.include('catalogs/nav/catalog.xml');
    expect(rel.some((item) => item.includes('library/static'))).to.equal(false);
    expect(rel.some((item) => item.includes('ocapi-settings'))).to.equal(false);
    expect(rel.some((item) => item.includes('javascript'))).to.equal(false);
  });

  it('skips package.json in a generic directory', async () => {
    const classified = classifyPath(fixture('archives', 'generic'));
    const files = await discoverFiles(classified);
    expect(names(files)).to.not.include('package.json');
    expect(names(files)).to.include('hero.json');
    expect(names(files)).to.include('random.xml');
  });
});
