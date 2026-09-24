This is an Expo/React Native mobile application (K-Maps: offline outdoor maps). Prioritize mobile-first patterns, performance, and cross-platform compatibility.

**Read `docs/SPEC.md` before making architectural changes** — it's the full design spec (data sources, storage layout, offline downloader design, screens, roadmap) this project was scaffolded from. `README.md` tracks what's actually built versus that spec.

`@maplibre/maplibre-react-native` component names/props change across major versions (spec §12.8) — this project pins v11's `Map`/`Camera`/`RasterSource`/`Layer` API (not the older `MapView`/`RasterLayer` names). Check `node_modules/@maplibre/maplibre-react-native/src/index.ts` for the installed version's actual exports before assuming an API shape.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- This project uses **React Navigation** (`@react-navigation/native-stack`), not Expo Router —
  a deliberate choice from the design spec (`docs/SPEC.md` §3), not the Expo template default.
  Do not migrate to Expo Router without checking with the user first.
- The navigator and its `RootStackParamList` live in `src/navigation/RootNavigator.tsx`. Screens
  live in `src/screens/`, one file per screen from `docs/SPEC.md` §8.
- Import `useNavigation`, `useRoute` from `@react-navigation/native`; type them with
  `RootStackParamList` from `src/navigation/RootNavigator.tsx`.
- Docs: https://reactnavigation.org/docs/getting-started

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
