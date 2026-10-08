// Keep corpus reports independent, but combine a backlog into one site refresh.
export function publicationQueue(consume, onError) {
  const pending = [];
  let running = false, current = Promise.resolve(), error;
  function push(item) {
    if (error) return;
    pending.push(item);
    if (running) return;
    running = true;
    current = (async () => {
      try {
        while (pending.length) await consume(pending.splice(0));
      } catch (e) {
        error = e;
        onError(e);
      } finally {
        running = false;
      }
    })();
  }
  return { push, async drain() { await current; if (error) throw error; } };
}
