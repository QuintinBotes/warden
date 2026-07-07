import { describe, expect, it } from 'vitest';
import { BrowserError } from '@warden/core';
import { expandMatrix } from './matrix';

describe('expandMatrix', () => {
  it('returns the browser names when no devices are given', () => {
    expect(expandMatrix({ browsers: ['chromium', 'firefox', 'webkit'] })).toEqual([
      'chromium',
      'firefox',
      'webkit',
    ]);
  });

  it('crosses each browser with each device', () => {
    expect(
      expandMatrix({ browsers: ['chromium', 'webkit'], devices: ['desktop', 'mobile'] }),
    ).toEqual(['chromium-desktop', 'chromium-mobile', 'webkit-desktop', 'webkit-mobile']);
  });

  it('de-duplicates repeated browsers while preserving order', () => {
    expect(expandMatrix({ browsers: ['chromium', 'chromium', 'firefox'] })).toEqual([
      'chromium',
      'firefox',
    ]);
  });

  it('throws a BrowserError on an empty browser list', () => {
    expect(() => expandMatrix({ browsers: [] })).toThrow(BrowserError);
  });

  it('throws a BrowserError on an unknown browser', () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard with an invalid browser
      expandMatrix({ browsers: ['chromium', 'safari'] }),
    ).toThrow(BrowserError);
  });
});
