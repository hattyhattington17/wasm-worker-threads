const { parentPort, workerData, threadId } = require('worker_threads');
const wasm = require('./pkg/blog_demo.js');

// enable postmessages from wasm
globalThis.postMessage = (msg) => {
  parentPort.postMessage({
    type: 'wasm_bindgen_worker_debug',
    message: `threadId ${threadId} posted: ${msg}`,
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
console.log(`Worker ${threadId} is exiting`);



