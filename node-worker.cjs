const { parentPort, workerData, threadId } = require('worker_threads');
const wasm = require('./pkg/blog_demo.js');

// enable postmessages from wasm
globalThis.postMessage = (msg) => {
  console.log(`JS worker thread ${threadId} sending postmessage: ${msg}`)

  parentPort.postMessage({
    type: 'wasm_bindgen_worker_debug',
    message: `${threadId}: ${msg}`,
  });
};

// notify main thread that this worker is ready
parentPort.postMessage({ type: 'wasm_bindgen_worker_ready' });

try {
  // `receiver` is a raw pointer to a `rayon::ThreadBuilder`.
  // Calling `wbg_rayon_start_worker()` hands control to Rayon’s scheduler
   wasm.wbg_rayon_start_worker(workerData.receiver);
 } catch (e) {
  console.log(`Worker thread ${threadId} panicked`);
}
// in the success case, this never runs. The worker is closed by
console.log(`Worker ${threadId} is exiting`);



