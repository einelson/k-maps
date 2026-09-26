/**
 * Config plugin for @iternio/react-native-auto-play (Android Auto), so `expo prebuild` regenerates the same native
 * setup every time and nothing under android/ is edited by hand.
 *
 *  - Category: the library's default is "navigation", which Google reviews as a turn-by-turn app (criterion NF-1 of
 *    the car app quality guidelines) — K-Maps has no route guidance. "poi" is the honest category for an app about
 *    places, and it selects the library's lean manifest (no map surface, no navigation-only permissions). Change it
 *    here if that ever stops being true; the values are navigation, poi, parking, charging, iot, messaging, calling
 *    and weather.
 *
 *    It is set as `ext.androidAutoAppCategory` in the root build.gradle, NOT as the `ReactNativeAutoPlay_...` line in
 *    gradle.properties the library's README describes: the library ships its own gradle.properties saying
 *    "navigation", and Gradle gives a project's own file precedence over the app's, so that line is silently
 *    ignored (checked against the merged manifest). The library reads `rootProject.ext` before any property.
 *  - RECORD_AUDIO: the lean manifest still declares it, for the library's voice-input feature, which K-Maps doesn't
 *    use. Removing it keeps the app from listing a microphone permission it never asks for.
 */
const { withAndroidManifest, withProjectBuildGradle } = require('expo/config-plugins');

const REMOVED_PERMISSIONS = ['android.permission.RECORD_AUDIO'];
const CATEGORIES = ['navigation', 'poi', 'parking', 'charging', 'iot', 'messaging', 'calling', 'weather'];
const CATEGORY_LINE = /^ext\.androidAutoAppCategory = ".*"$/m;
/** Where the line goes: the root build.gradle applies this plugin after `buildscript`, and the library reads the value later. */
const ANCHOR = 'apply plugin: "expo-root-project"';

/** The build.gradle text with `ext.androidAutoAppCategory` set to `category` (once, however often this runs). */
function withCategoryLine(contents, category) {
  const line = `ext.androidAutoAppCategory = "${category}"`;
  if (CATEGORY_LINE.test(contents)) return contents.replace(CATEGORY_LINE, line);
  const at = contents.indexOf(ANCHOR);
  if (at === -1) return `${contents.trimEnd()}\n\n${line}\n`;
  return `${contents.slice(0, at)}${line}\n${contents.slice(at)}`;
}

function withCategory(config, category) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`withAutoPlay: unknown category "${category}". Use one of: ${CATEGORIES.join(', ')}.`);
  }
  return withProjectBuildGradle(config, (c) => {
    c.modResults.contents = withCategoryLine(c.modResults.contents, category);
    return c;
  });
}

function withoutPermissions(config, permissions) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    const declared = manifest['uses-permission'] ?? [];
    // tools:node="remove" tells the manifest merger to drop the permission a library declares.
    for (const name of permissions) {
      const entry = declared.find((p) => p.$['android:name'] === name);
      if (entry) entry.$['tools:node'] = 'remove';
      else declared.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    manifest['uses-permission'] = declared;
    return c;
  });
}

module.exports = function withAutoPlay(config, { category = 'poi' } = {}) {
  config = withCategory(config, category);
  return withoutPermissions(config, REMOVED_PERMISSIONS);
};

module.exports.withCategoryLine = withCategoryLine;
module.exports.CATEGORIES = CATEGORIES;
module.exports.REMOVED_PERMISSIONS = REMOVED_PERMISSIONS;
