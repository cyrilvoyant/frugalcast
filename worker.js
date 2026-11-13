/* The page starts one coordinator. That worker can run at most four independent
   model workers. Serial fallback uses exactly the same engine and result schema. */
importScripts('kalpha.js', 'engine.js');

function run(job) {
  let last = 0;
  try {
    const out = PredEngine.run(job, {
      progress: (f, text) => {
        const now = Date.now();
        if (now - last > 120 || f >= 1) {
          last = now;
          self.postMessage({ type: 'progress', f, text });
        }
      },
    });
    self.postMessage({ type: 'done', out });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
}

function merge(results) {
  const out = results[0];
  out.skipped = results.flatMap(result => result.skipped);
  for (const [i, horizon] of out.horizons.entries()) {
    horizon.models = Object.assign({}, ...results.map(result => result.horizons[i].models));
  }
  return out;
}

function parallel(job, limit) {
  const tasks = job.models;
  const slots = [], progress = new Float64Array(tasks.length), results = new Array(tasks.length);
  let next = 0, finished = 0, closed = false;
  const close = () => {
    closed = true;
    for (const worker of slots) worker.terminate();
  };
  const fail = message => {
    if (closed) return;
    close();
    self.postMessage({ type: 'error', message });
  };
  const launch = worker => {
    const index = next++;
    worker.onerror = event => fail(event.message || 'A model worker stopped unexpectedly.');
    worker.onmessage = ({ data }) => {
      if (closed) return;
      if (data.type === 'error') return fail(data.message);
      if (data.type === 'progress') {
        progress[index] = data.f;
        const f = progress.reduce((sum, value) => sum + value, 0) / tasks.length;
        self.postMessage({ type: 'progress', f, text: data.text });
        return;
      }
      if (data.type !== 'done') return;
      progress[index] = 1;
      results[index] = data.out;
      if (++finished === tasks.length) {
        close();
        self.postMessage({ type: 'done', out: merge(results) });
      } else if (next < tasks.length) {
        launch(worker);
      }
    };
    worker.postMessage({ singleModel: true, job: { ...job, models: [tasks[index]] } });
  };
  try {
    for (let i = 0; i < limit; i++) slots.push(new Worker('worker.js'));
  } catch (_) {
    close();
    run(job);
    return;
  }
  for (const worker of slots) launch(worker);
}

self.onmessage = ({ data }) => {
  if (data.singleModel) return run(data.job);
  const limit = Math.min(4, data.models.length, self.navigator.hardwareConcurrency || 1);
  // Keep the experimental coordinator opt-in until numerical review is complete.
  if (data.cfg.parallelWorkers === true && limit > 1 && typeof Worker === 'function') return parallel(data, limit);
  run(data);
};
