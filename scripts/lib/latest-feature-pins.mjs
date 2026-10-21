// Feature coverage is latest-only per engine family. Release calendars do not
// line up, so a global anchor date can silently omit an engine whose newest
// eligible release or source snapshot is a few days older.
export function latestFeaturePins(pins) {
  const newest=new Map();
  for(const pin of pins) {
    if(!['planned','reused'].includes(pin.status))continue;
    const prior=newest.get(pin.engine);
    if(!prior||Date.parse(pin.targetWeek)>Date.parse(prior.targetWeek))newest.set(pin.engine,pin);
  }
  return [...newest.values()];
}
