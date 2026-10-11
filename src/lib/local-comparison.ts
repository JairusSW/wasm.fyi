/** Local snapshots retain independent identities instead of becoming a Wago release lane. */
export const isLocalComparison = (engine: string) => /^wago-(?:main-snapshot|arm64-branch|pr\d+)$/.test(engine);
