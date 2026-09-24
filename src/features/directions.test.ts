import { Linking, Platform } from 'react-native';

import { openDirections } from './directions';

let canOpenURL: jest.SpyInstance;
let openURL: jest.SpyInstance;

function setPlatform(os: 'ios' | 'android') {
  jest.replaceProperty(Platform, 'OS', os);
}

beforeEach(() => {
  // react-native's jest setup already installs jest.fn()s on Linking, so spyOn hands back the
  // shared mock: reset it explicitly or calls (and return values) leak between tests.
  canOpenURL = jest.spyOn(Linking, 'canOpenURL');
  openURL = jest.spyOn(Linking, 'openURL');
  canOpenURL.mockReset();
  openURL.mockReset();
  canOpenURL.mockResolvedValue(true);
  openURL.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const GOOGLE_FALLBACK = (lat: number, lon: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

describe('openDirections on iOS', () => {
  beforeEach(() => setPlatform('ios'));

  it('opens Apple Maps with the destination as lat,lon', async () => {
    await openDirections(43.615, -116.2023);
    expect(openURL).toHaveBeenCalledWith('maps://?daddr=43.615,-116.2023');
  });

  it('adds the label as an encoded q parameter', async () => {
    await openDirections(43.6, -116.2, 'Camp & Fire #1');
    expect(openURL).toHaveBeenCalledWith('maps://?daddr=43.6,-116.2&q=Camp%20%26%20Fire%20%231');
  });

});

describe('openDirections on Android', () => {
  beforeEach(() => setPlatform('android'));

  it('uses a geo: URI so the OS can offer its default maps app or a chooser', async () => {
    await openDirections(43.615, -116.2023);
    expect(openURL).toHaveBeenCalledWith('geo:43.615,-116.2023?q=43.615,-116.2023');
  });

  it('puts the encoded label in parentheses after the coordinates', async () => {
    await openDirections(43.6, -116.2, 'Boat ramp & dock');
    expect(openURL).toHaveBeenCalledWith('geo:43.6,-116.2?q=43.6,-116.2(Boat%20ramp%20%26%20dock)');
  });

  it('keeps negative coordinates as-is (no double signs or rounding)', async () => {
    await openDirections(-33.8568, 151.2153);
    expect(openURL).toHaveBeenCalledWith('geo:-33.8568,151.2153?q=-33.8568,151.2153');
  });
});

describe('openDirections label handling (both platforms)', () => {
  it.each(['ios', 'android'] as const)('omits the label for null, undefined and empty strings on %s', async (os) => {
    setPlatform(os);
    await openDirections(1, 2, null);
    await openDirections(1, 2, undefined);
    await openDirections(1, 2, '');
    for (const [url] of openURL.mock.calls) {
      expect(url).not.toContain('(');
      expect(url).not.toContain('&q=');
    }
    expect(openURL).toHaveBeenCalledTimes(3);
  });

  it('percent-encodes unicode labels', async () => {
    setPlatform('ios');
    await openDirections(1, 2, 'Café ⛺');
    expect(openURL).toHaveBeenCalledWith(`maps://?daddr=1,2&q=${encodeURIComponent('Café ⛺')}`);
  });
});

describe('openDirections fallback', () => {
  it.each(['ios', 'android'] as const)(
    'opens Google Maps on the web when the native URL cannot be opened (%s)',
    async (os) => {
      setPlatform(os);
      openURL.mockRejectedValueOnce(new Error('no handler'));
      await openDirections(43.6, -116.2, 'Camp');
      expect(openURL).toHaveBeenCalledTimes(2);
      expect(openURL).toHaveBeenLastCalledWith(GOOGLE_FALLBACK(43.6, -116.2));
    }
  );

  it('does not gate on canOpenURL (it is false for geo: on Android 11+ without a <queries> entry)', async () => {
    setPlatform('android');
    canOpenURL.mockResolvedValue(false);
    await openDirections(1, 2);
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('geo:1,2?q=1,2');
  });

  it('the web fallback ignores the label (destination coordinates only)', async () => {
    setPlatform('ios');
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await openDirections(1, 2, 'Some label');
    expect(openURL).toHaveBeenLastCalledWith(GOOGLE_FALLBACK(1, 2));
  });

  it('lets a failure of the web fallback propagate so the caller can show an error', async () => {
    setPlatform('ios');
    openURL.mockRejectedValue(new Error('no handler'));
    await expect(openDirections(1, 2)).rejects.toThrow('no handler');
  });
});
