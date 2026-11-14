/**
 * Stand-in for @pmndrs/uikit-lucide (4.1 MB of icons, 60% of the app's
 * download). IWSDK's UI kit loads the whole icon set, but Agent Wall draws
 * its own canvas UI and uses no icons. The Horizon kit needs only these two.
 * Wired up in vite.config.ts (exact-match alias, so these subpaths still work).
 */
export * from '@pmndrs/uikit-lucide/dist/Check.js';
export * from '@pmndrs/uikit-lucide/dist/ChevronDown.js';
