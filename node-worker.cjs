const { isMainThread, parentPort, workerData, Worker, threadId } = require('worker_threads');
const os = require('os');
const path = require('path');
const wasm = require('./pkg/blog_demo.js');
const { WithThreadPool, workers } = require('./threadpool-runner.cjs');


console.log(`Worker ${threadId} is starting`);
// enable postmessages from wasm
globalThis.postMessage = (msg) => {
  parentPort.postMessage({
    type: 'wasm_bindgen_worker_debug',
    message: `threadId ${threadId} posted: ${msg}`,
  });
};

// if this file is being run from a worker
// notify main thread that this worker is ready
parentPort.postMessage({ type: 'wasm_bindgen_worker_ready' });


// hook into Rayon’s pool: receive the ThreadBuilder pointer and invoke its run() method
// this starts a run loop that will process tasks from the WASM thread pool
// the thread is taken over from wasm after this, no more JS runs
try {
  // receiver is a raw pointer to a Rayon ThreadBuilder in Wasm memory
  wasm.wbg_rayon_start_worker(workerData.receiver);
} catch (e) {
  console.log(`Worker thread ${threadId} panicked`);
}
console.log(`Worker ${threadId} is exiting`);



