const { parentPort, workerData, threadId } = require('worker_threads');
const wasm = require('./pkg/blog_demo.js');

// Get the dedicated MessagePort for this worker
const mainThreadPort = workerData.mainThreadPort;
const workerId = workerData.workerId;

if (!mainThreadPort) {
  throw Error("Main thread port not supplied");
}

// global function exposed to wasm - sends messages through this worker's channel to the main thread
globalThis.postMessageToMainThread = (msg) => mainThreadPort.postMessage(msg);

parentPort.postMessage({ type: 'wasm_bindgen_worker_ready' });

try {
  // Calling `wbg_rayon_start_worker()` hands control to Rayon’s scheduler
  wasm.wbg_rayon_start_worker(workerData.receiver);
} catch (e) {
  // stdout pipes to the blocked host worker and does not display
  // todo: either find a way to pipe stdout to the main thread or write a custom panic hook that posts messages to the main thread
  console.log(`Worker ${workerId} (thread ${threadId}) panicked`); 
  // Notify main thread about the panic
  mainThreadPort.postMessage({ type: 'worker_panic', workerId: workerId, error: e.stack, });
}
// in the success case, this never runs. The worker is closed by Rayon
console.log(`Worker ${workerId} (thread ${threadId}) is exiting unexpectedly`);



