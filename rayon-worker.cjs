const { parentPort, workerData, threadId } = require('worker_threads');
const wasm = require('./pkg/blog_demo.js');

// Get the dedicated MessagePort for this worker
const mainThreadPort = workerData.mainThreadPort;
const workerId = workerData.workerId;

if (!mainThreadPort) {
  throw Error("Main thread port not supplied");
}

// global function exposed to wasm - sends messages through this worker's channel to the main thread
globalThis.postMessageToMainThread = (msg) => {
  console.log(`Worker ${workerId} (thread ${threadId}) forwarding postMessage to main thread: ${msg}`);
  mainThreadPort.postMessage(msg);
};

// notify parent (node-backend) that this worker is ready
parentPort.postMessage({ type: 'wasm_bindgen_worker_ready' });

try {
  // Calling `wbg_rayon_start_worker()` hands control to Rayon’s scheduler
  // `receiver` is a raw pointer to a `rayon::ThreadBuilder`.
  wasm.wbg_rayon_start_worker(workerData.receiver);
} catch (e) {
  console.log(`Worker ${workerId} (thread ${threadId}) panicked`);
  // Notify main thread about the panic - we must notify the main thread, ThreadPoolHost will be frozen 
  mainThreadPort.postMessage({ type: 'worker_panic', workerId: workerId, error: e.stack, });
}
// in the success case, this never runs. The worker is closed by Rayon
console.log(`Worker ${workerId} (thread ${threadId}) is exiting unexpectedly`);



