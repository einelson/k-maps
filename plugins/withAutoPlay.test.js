// The real config-plugin helpers register mods that only run during prebuild; here they just run the callback
// on a stand-in for the file being edited, so the plugin's own logic can be checked.
jest.mock('expo/config-plugins', () => ({
  withProjectBuildGradle: (config, callback) => callback({ ...config, modResults: config.buildGradle }),
  withAndroidManifest: (config, callback) => callback({ ...config, modResults: config.manifestFile }),
}));

const withAutoPlay = require('./withAutoPlay');

const ROOT_BUILD_GRADLE = `buildscript {
  repositories { google() }
}

allprojects {
  repositories { google() }
}

apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"
`;

const configWith = ({ gradle = ROOT_BUILD_GRADLE, permissions = [] } = {}) => ({
  buildGradle: { language: 'groovy', contents: gradle },
  manifestFile: {
    manifest: { $: {}, 'uses-permission': permissions.map((name) => ({ $: { 'android:name': name } })) },
  },
});
const permissionEntries = (config) => config.manifestFile.manifest['uses-permission'];

describe('withAutoPlay', () => {
  it('selects the poi category by default: K-Maps has no turn-by-turn guidance', () => {
    const config = withAutoPlay(configWith());
    expect(config.buildGradle.contents).toContain('ext.androidAutoAppCategory = "poi"');
  });

  it('puts it in the root build.gradle before the root project plugin, which is what the library reads first', () => {
    const { contents } = withAutoPlay(configWith()).buildGradle;
    expect(contents.indexOf('ext.androidAutoAppCategory')).toBeGreaterThan(contents.indexOf('allprojects'));
    expect(contents.indexOf('ext.androidAutoAppCategory')).toBeLessThan(
      contents.indexOf('apply plugin: "expo-root-project"')
    );
  });

  it("does not use the gradle.properties line, which the library's own gradle.properties overrides", () => {
    expect(withAutoPlay(configWith()).buildGradle.contents).not.toContain('ReactNativeAutoPlay_');
  });

  it('takes another category from the plugin options', () => {
    const config = withAutoPlay(configWith(), { category: 'navigation' });
    expect(config.buildGradle.contents).toContain('ext.androidAutoAppCategory = "navigation"');
  });

  it('rejects a category the library would fail the build on, at prebuild instead', () => {
    expect(() => withAutoPlay(configWith(), { category: 'maps' })).toThrow(/unknown category "maps"/);
  });

  it('changes the category in place instead of adding a second line, so running prebuild twice is harmless', () => {
    const once = withAutoPlay(configWith(), { category: 'navigation' });
    const twice = withAutoPlay(configWith({ gradle: once.buildGradle.contents }));
    const lines = twice.buildGradle.contents.split('\n').filter((l) => l.startsWith('ext.androidAutoAppCategory'));
    expect(lines).toEqual(['ext.androidAutoAppCategory = "poi"']);
  });

  it('is unchanged by a second run with the same category', () => {
    const once = withAutoPlay(configWith());
    const twice = withAutoPlay(configWith({ gradle: once.buildGradle.contents }));
    expect(twice.buildGradle.contents).toBe(once.buildGradle.contents);
  });

  it('appends the line when the file has no plugin anchor to put it before', () => {
    const config = withAutoPlay(configWith({ gradle: 'allprojects {}\n' }));
    expect(config.buildGradle.contents).toBe('allprojects {}\n\next.androidAutoAppCategory = "poi"\n');
  });

  it("marks the microphone permission for removal, which the merger applies to the library's declaration", () => {
    const config = withAutoPlay(configWith({ permissions: ['android.permission.ACCESS_FINE_LOCATION'] }));
    const audio = permissionEntries(config).find((p) => p.$['android:name'] === 'android.permission.RECORD_AUDIO');
    expect(audio.$['tools:node']).toBe('remove');
    expect(config.manifestFile.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  it('leaves the other permissions alone', () => {
    const config = withAutoPlay(
      configWith({ permissions: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.INTERNET'] })
    );
    const untouched = permissionEntries(config).filter(
      (p) => p.$['android:name'] !== 'android.permission.RECORD_AUDIO'
    );
    expect(untouched.map((p) => p.$['android:name'])).toEqual([
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.INTERNET',
    ]);
    expect(untouched.every((p) => p.$['tools:node'] === undefined)).toBe(true);
  });

  it('marks an existing declaration for removal rather than duplicating it', () => {
    const config = withAutoPlay(configWith({ permissions: ['android.permission.RECORD_AUDIO'] }));
    const audio = permissionEntries(config).filter((p) => p.$['android:name'] === 'android.permission.RECORD_AUDIO');
    expect(audio).toHaveLength(1);
    expect(audio[0].$['tools:node']).toBe('remove');
  });

  it('works on a manifest with no permissions yet', () => {
    const config = configWith();
    delete config.manifestFile.manifest['uses-permission'];
    expect(permissionEntries(withAutoPlay(config))).toHaveLength(1);
  });
});
