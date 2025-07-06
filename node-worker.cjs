const { parentPort, workerData, threadId } = require('worker_threads');
const wasm = require('./pkg/blog_demo.js');

// Get the dedicated MessagePort for this worker
const mainThreadPort = workerData.mainThreadPort;
const workerId = workerData.workerId;

if (!mainThreadPort) {
  throw Error("Main thread port not supplied");
}
// Override global postMessage to send messages through the MessagePort to main thread
globalThis.postMessage = (msg) => {
  console.log(`Worker ${workerId} (thread ${threadId}) forwarding postMessage to main thread: ${msg}`);
  
  // Send directly to main thread through the dedicated MessagePort
  mainThreadPort.postMessage(msg);
};

// notify parent (node-backend) that this worker is ready
parentPort.postMessage({ type: 'wasm_bindgen_worker_ready' });

try {
  // `receiver` is a raw pointer to a `rayon::ThreadBuilder`.
  // Calling `wbg_rayon_start_worker()` hands control to Rayon’s scheduler
  wasm.wbg_rayon_start_worker(workerData.receiver);
} catch (e) {
  console.log(`Worker ${workerId} (thread ${threadId}) panicked`);
  // Notify main thread about the panic
  mainThreadPort.postMessage({
    type: 'worker_panic',
    workerId: workerId,
    error: e.stack,
  });
}
// in the success case, this never runs. The worker is closed by Rayon
console.log(`Worker ${workerId} (thread ${threadId}) is exiting`);



