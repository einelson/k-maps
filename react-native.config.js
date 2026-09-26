/**
 * The car library needs Xcode 27 (the iOS 27 SDK) just to compile, and CarPlay also needs an entitlement from Apple
 * that this app doesn't have yet — so it is linked into Android builds only. Remove this file's override, and the
 * Platform.OS checks in src/car/, when CarPlay is set up (see README, "Car screens").
 */
module.exports = {
  dependencies: {
    '@iternio/react-native-auto-play': { platforms: { ios: null } },
  },
};
