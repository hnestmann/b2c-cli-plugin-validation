import {expect} from 'chai';
import {buildPdTypeIndex, detectCartridgesLayout, validateInstanceAgainstType} from '../../src/lib/pd-type-index.js';
import type {ExtractedLibraryContent} from '../../src/lib/embedded-library-json.js';
import {ValidateUsageError} from '../../src/lib/types.js';
import {fixture} from '../helpers.js';

describe('pd-type-index', () => {
  it('detects a single cartridge vs a code-version folder', () => {
    expect(detectCartridgesLayout(fixture('cartridges', 'app_custom'))).to.equal('cartridge');
    expect(detectCartridgesLayout(fixture('cartridges', 'code-version'))).to.equal('code-version');
  });

  it('errors when the path is neither shape', () => {
    expect(() => detectCartridgesLayout(fixture('xml'))).to.throw(ValidateUsageError);
  });

  it('indexes type ids from nested experience paths', async () => {
    const index = await buildPdTypeIndex(fixture('cartridges', 'app_custom'));
    expect(index.types.has('page.contentPage')).to.equal(true);
    expect(index.types.has('component.hero.banner')).to.equal(true);
  });

  it('warns on duplicate type ids and keeps the first file', async () => {
    const index = await buildPdTypeIndex(fixture('cartridges', 'code-version'));
    expect(index.types.has('page.home')).to.equal(true);
    expect(index.warnings.some((item) => /Duplicate Page Designer type id/.test(item.message))).to.equal(true);
  });

  it('fails unknown keys in <data> for a known type and warns on unknown types', () => {
    const content: ExtractedLibraryContent = {
      contentId: 'hero-1',
      type: 'component.hero.banner',
      data: [],
      contentLinks: [],
    };
    const unknownType: ExtractedLibraryContent = {
      contentId: 'other',
      type: 'component.missing.from.cartridges',
      data: [],
      contentLinks: [],
    };

    return buildPdTypeIndex(fixture('cartridges', 'app_custom')).then((index) => {
      const unknownKey = validateInstanceAgainstType(content, {heading: 'Hi', extra: true}, index, new Set(['hero-1']));
      expect(unknownKey.errors.some((item) => /Unknown attribute "extra"/.test(item.message))).to.equal(true);

      const unknown = validateInstanceAgainstType(unknownType, {foo: 1}, index, new Set(['other']));
      expect(unknown.errors).to.have.length(0);
      expect(unknown.warnings.some((item) => /Unknown Page Designer type/.test(item.message))).to.equal(true);
    });
  });
});
