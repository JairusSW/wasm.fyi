// C AOT compilers/translators are separate processes and exit before a batch boundary.
export function memoryObserver(runtime, metric) {
  if (/^(wasm2c|w2c2)(-|$)/.test(runtime) && metric === 'rssCurrentCompile') return 'process_tree.rss.mean';
  return metric.startsWith('rssCurrent') ? 'process.rss' : 'process.peak_rss';
}
