import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Doc Studio — Capacitor 6 config.
 *
 * The Capacitor shell hosts the built PWA (`dist/`) inside a native
 * WebView on Android and iOS. All web features work unchanged; the
 * only platform-specific concern is that the `/__proxy` endpoint isn't
 * available in the app shell, so the SPA falls back to direct fetches
 * (which mobile WebViews allow since there's no strict CORS enforcement
 * for WebView origin `file://` when `allowNavigation` is configured).
 *
 * To generate native projects (run once):
 *   npm run build
 *   npx cap add android
 *   npx cap add ios
 * To sync web changes into the native shells:
 *   npm run build && npx cap sync
 * To open in Android Studio / Xcode:
 *   npx cap open android
 *   npx cap open ios
 */
const config: CapacitorConfig = {
  appId: 'com.docstudio.app',
  appName: 'Doc Studio',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // `androidScheme: 'https'` prevents mixed-content blocks when the
    // SPA fetches HTTPS APIs from a `http://localhost` origin.
    androidScheme: 'https',
    iosScheme: 'app',
    // Allow the SPA to hit any HTTPS API. Tighten for production.
    allowNavigation: ['*'],
  },
  android: {
    // Debug builds use HTTPS by default; permit cleartext for
    // developer intranets. Turn off for release.
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
