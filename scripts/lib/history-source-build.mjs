const sourceSDKFamilies = new Set(['wasmer', 'wazy', 'endive', 'chasm', 'wizard', 'graalwasm', 'zwasm']);

// These SDK integrations bind a source checkout for releases as well as snapshots.
// The public source descriptor still keeps its original release tag and kind.
export function needsHistoricalSourceBuild(pin) {
  if (sourceSDKFamilies.has(pin.engine)) {
    if (!/^[0-9a-f]{40}$/i.test(pin.revision || '')) {
      throw Error(`Pinned ${pin.engine} SDK source requires a full commit hash`);
    }
    return true;
  }
  return pin.targetType === 'main' || pin.dateBasis === 'git-tag-commit';
}
