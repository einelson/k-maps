# iOS to-do

K-Maps has only ever been built and tested on Android (a Galaxy S21 and the GitHub APK betas). **Nothing here has run on
an iPhone**, and this machine can't build for iOS. This file tracks what iOS needs so it isn't rediscovered later.
Tick things off as they happen; add to it whenever an Android-only shortcut is taken.

Last reviewed: 2026-09-26.

## 1. Blockers: things only you can do

- [ ] **Apple Developer Program** membership. Needed to run on a real device, to use TestFlight, and to request the
      CarPlay entitlement.
- [ ] **A way to build**: a Mac with Xcode, or EAS Build (`eas build --platform ios`, paid). Look up which Xcode
      version Expo SDK 57 / React Native 0.86 requires before buying anything (CarPlay needs Xcode 27 on top, see §5).
- [ ] **An iPhone to test on.** Background GPS, the blue location pill and "Always" permission can't be judged in a
      simulator.
- [ ] **Decide how betas reach people.** There is no iOS version of "download the APK from GitHub": it's TestFlight
      (up to 10,000 external testers, the first build needs Beta App Review) or ad hoc installs (each device's UDID
      registered, 100 device limit).
- [ ] Register the bundle ID `com.ethannelson.kmaps` (from `app.json`) in the Apple developer portal.

## 2. Build and release pipeline

- [ ] First iOS build: `npx expo prebuild --platform ios`, then `npx expo run:ios --device` on a Mac (or an EAS
      development build). Expect to fix things: the last full check of iOS was reading a generated `Info.plist`.
- [ ] Create `eas.json` (none exists) if EAS is the route: development, preview and production profiles.
- [ ] iOS release workflow next to `.github/workflows/android-beta.yml`: macOS runner or EAS, signing certificate and
      provisioning profile as secrets, upload to TestFlight (`eas submit` or fastlane).
- [ ] Stamp the build number in CI the way Android's `versionCode` is (`ios.buildNumber` / `CFBundleVersion`, always
      rising). `app.json` has no `buildNumber` today.
- [ ] `supportsTablet` is `true` in `app.json`, so iPad layouts get used and need testing. Either test them or set it
      to `false`. Orientation is locked to portrait.
- [ ] Before TestFlight external / App Store: privacy policy URL, App Privacy answers (location, photos), a privacy
      manifest for required-reason APIs, `ITSAppUsesNonExemptEncryption` in `infoPlist`, and a written reason for
      background location for App Review.
- [x] App icon: `assets/icon.png` is 1024x1024 RGB with no alpha, which is what Apple requires.

## 3. Verify what already exists (built for iOS, never run)

Map and data
- [ ] MapLibre RN v11 renders on iOS (new architecture): USGS topo, satellite and hybrid, plus every live overlay
      (radar, NHD, wetlands, slope, land managers, BLM cross-check).
- [ ] Offline maps: `mbtiles://` path handling differs between iOS and Android in community reports (SPEC §12
      risk 4). `src/downloads/mbtiles.ts` notes the `file://` vs bare-path question was never cross-checked on a device.
- [ ] Region pack, hunting unit and pack downloads. iOS background downloads are unreliable: check foreground plus
      resume, screen kept awake, and the free-disk-space reading (`src/downloads/freeSpace.ts`).
- [ ] SQLite on iOS: the v5 schema migration, WAL, and the background location task's own connection writing while
      the app is open.
- [ ] Label glyphs (`src/map/glyphs.ts`) load from the file paths iOS gives.
- [ ] The SPEC spike item "load 10,000 pins with a filter toggle" on an iPhone.

Track recording (README "iOS recording is configured but has never run on an iPhone")
- [ ] Background recording with the screen locked; the blue status-bar pill; the "Always" permission offered after
      recording starts (`offerAlwaysPermission`).
- [ ] Force-quit behaviour: a swipe-away ends the recording on iOS. Confirm reopening restores the fixes and shows
      the gap note.
- [ ] `timeInterval` is Android-only, so iOS only records on 5 m or more of movement (no fixes while standing still).
      Check the moving-time and average-speed stats still look right with no stationary points.
- [ ] Per-mode spacing (Settings -> Track recording) actually changes what iOS delivers: `distanceInterval` is passed
      on both platforms but only checked on Android.
- [ ] Location permission strings read well in the system prompts (`app.json`: when-in-use, always-and-when-in-use).

Files and sharing
- [ ] **"Open in K-Maps" for GPX/KML/KMZ/GeoJSON from Files, Mail and other apps.** Android has intent filters; iOS
      needs `CFBundleDocumentTypes` (and probably imported type declarations for GPX/KML). `IncomingImportHandler`
      already listens to `Linking` URLs, so this may be config plus copying the file out of the inbox.
- [ ] Import (document picker) and export/backup (share sheet via `expo-sharing`) on iOS.
- [ ] Photos: library and camera prompts, and photo paths in the backup zip.

UI
- [ ] Notch, Dynamic Island and home-indicator insets (the layout fixes so far were done for Android edge-to-edge).
- [ ] Keyboard handling: `useKeyboardOverlap` has an iOS branch that has never run.
- [ ] Dark mode, dynamic type, and the bottom sheets and modals.
- [ ] Directions opens Apple Maps (`src/features/directions.ts`).

## 4. Doable now from Linux (prep, no Mac needed)

- [ ] iOS `activityType` for track recording is `Fitness` for every mode. Set it per mode (vehicle and ATV
      automotive, boat and other something neutral). It's a small code change; only the effect needs a device.
- [ ] Add `CFBundleDocumentTypes` for the GPX/KML/KMZ/GeoJSON types via `app.json` / a config plugin, and inspect it
      with `expo prebuild --platform ios --no-install` in a scratch copy (prebuild runs on Linux).
- [ ] Audit `AppState` use. It is in `RecordingSync`, `LiveRasterLayers` (radar refresh) and `useWildfireRefresh`,
      and it stops working properly once CarPlay's multiple scenes are on (see §5).
- [ ] Write the CarPlay config plugin (§5) with a switch that is off by default, and check its output from a
      scratch prebuild. Off by default, so iOS builds don't change until the entitlement exists.
- [ ] Add `ios.buildNumber` and the `ITSAppUsesNonExemptEncryption` key to `app.json`.
- [ ] Skim every `Platform.OS` branch and Android-only assumption in `src/` for an iOS counterpart.

## 5. CarPlay

Status: **not set up.** The car screens (`src/car/`) are cross-platform templates and are shared. The Android side is
built and unit-tested but has not been run on a head unit either. The iOS side is off because the library is
switched off for iOS in `react-native.config.js` and gated in `src/car/installCarTimers.ts` and
`src/car/registerCar.ts`.

Blockers
- [ ] **Request the CarPlay entitlement from Apple.** Apple picks the category. "Navigation" wants turn-by-turn
      directions, which K-Maps doesn't have; "driving task" looks like the closest fit for recording a track, but
      approval isn't guaranteed. Once granted, add it to the App ID and regenerate provisioning profiles. (Apple's
      request form and current category list should be re-read when applying; they couldn't be fetched here.)
- [ ] **A Mac with Xcode 27 (the iOS 27 SDK).** `@iternio/react-native-auto-play` references iOS 27 types and won't
      compile without it, even though we use none of its iOS 27 features.

Then
- [ ] Remove `platforms: { ios: null }` from `react-native.config.js` and the `Platform.OS === 'android'` gates in
      `src/car/installCarTimers.ts` and `src/car/registerCar.ts`. Update the README's known gaps.
- [ ] Config plugin for the native setup (nothing under `ios/` is hand-edited, it's generated): the
      `com.apple.developer.carplay-*` entitlement, a `UIApplicationSceneManifest` with `UIApplicationSupportsMultipleScenes`
      and a CarPlay head-unit scene, and the phone window scene. The dashboard and cluster scenes are optional; skip them.
- [ ] The library's README asks for an `AppDelegate.swift` hook (`getRootViewForAutoplay`) but only for
      `MapTemplate`, which renders React content on the car screen. K-Maps uses list and message templates only, so it
      may not be needed. Confirm before writing a plugin for it.
- [ ] Replace `AppState` with the library's `HybridAutoPlay.addListenerRenderState`, or guard it. Per the library,
      stock `AppState` doesn't work with scenes on iOS, which would break restore-on-foreground for recordings.
- [ ] `expo-splash-screen` gets stuck under scenes; the library ships a `patch-package` patch. Apply it and hide the
      splash per scene.
- [ ] Test in Xcode's CarPlay Simulator (I/O -> External Displays -> CarPlay), then in a real car.
- [ ] Check how the list and message templates look on CarPlay: back button is automatic, `MessageTemplate` becomes a
      `CPAlertTemplate` (the "OK" action is set for iOS already), and the light/dark header bug the library notes for
      `CPListTemplate`.
- [ ] Recording started from CarPlay while the phone is locked: does iOS allow starting location updates then? Same
      question as Android's foreground-service one, just with different rules.
- [ ] Read Apple's CarPlay App Programming Guide for the granted category: which templates it allows and the driver
      distraction rules.
