const { isMainThread, parentPort, workerData, Worker, threadId } = require('worker_threads');
const os = require('os');
const path = require('path');
const wasm = require('./pkg/blog_demo.js');
const { CreateThreadPoolRunner, workers } = require('./threadpool-runner.cjs');

let workerPorts = [];
function setWorkerPorts(ports) {
  console.log(`Setting worker ports: ${ports.length} ports`);
  workerPorts = ports;
}
/**
 * 
 * @param {string} msg - message posted from the worker
 * @param {number} workerId - ID of the worker
 */
function logWorkerDebug(msg, workerId) {
  console.debug(`[Received from worker ${workerId}]`, msg);
}

// tracks state of worker readiness
let workersReadyResolve, workersReady;
/** @type {Worker[]} currently running worker instances */
let wasmWorkers = [];

/**
 * Initialize the Wasm thread pool
 */
async function initThreadPool() {
  workersReady = new Promise((resolve) => (workersReadyResolve = resolve));
  // todo: investigate behavior with different numbers of threads
  const threadCount = Math.max(1, (workers.numWorkers ?? (os.availableParallelism?.() ?? 1) - 1));
  await wasm.initThreadPool(threadCount);
  // wait until startWorkers signals readiness
  await workersReady;
  workersReady = undefined;
}


/**
 * tear down wasm thread pool
 * called by createThreadPoolRunner when pool is no longer needed
 */
async function exitThreadPool() {
  await wasm.exitThreadPool();
}

// ---------- called from Rust via wasm-bindgen -------------------------------

/**
 * Spawn worker threads, wait for each to be ready, and then start the WASM builder.
 * This function is called from Rust as part of the Rayon thread pool initialization
 * @param {string} src - path to the worker entry script
 * @param {WebAssembly.Memory} memory - shared memory instance
 * @param {{ numThreads(): number, receiver(): any, build(): void }} builder - builder object
 */
async function startWorkers(memory, builder) {
  const workerPath = path.resolve(__dirname, './node-worker.cjs');
  wasmWorkers = [];

  // Ensure we have enough ports for all workers
  if (workerPorts.length < builder.numThreads()) {
    throw new Error(`Not enough MessagePorts: have ${workerPorts.length}, need ${builder.numThreads()}`);
  }

  await Promise.all(
    Array.from({ length: builder.numThreads() }, (_, index) => {
      // Each worker gets its own dedicated MessagePort
      const workerPort = workerPorts[index];

      const worker = new Worker(workerPath, {
        workerData: {
          memory,
          receiver: builder.receiver(),
          mainThreadPort: workerPort,
          workerId: index
        },
        transferList: [workerPort]
      });
      wasmWorkers.push(worker);

      // return a promise that resolves when this worker is ready
      return new Promise((resolve) => {
        let done = false;
        worker.on('message', (data) => {
          // Note: These messages are from the worker thread initialization,
          // not from postMessage calls which go through the MessagePort

          // listen for debug messages sent from the worker
          if (data.type === 'wasm_bindgen_worker_debug') {
            logWorkerDebug(data.message, index);
          }

          // listen for worker to send ready signal
          if (!done && data?.type === 'wasm_bindgen_worker_ready') {
            done = true;
            console.log(`Worker ${index} is ready`);
            resolve(worker);
          }
        });
      });
    })
  );

  // once all workers are ready, build the threadpool
  builder.numThreads
  builder.build();

  // notify initThreadPool that workers are ready
  workersReadyResolve();
}

// kill the worker threads
async function terminateWorkers() {
  console.log("Terminating workers");
  return Promise.all(
    wasmWorkers.map((w) => w.terminate())
  ).then(() => {
    wasmWorkers = undefined;
  });
}
// globals - callable by Wasm
global.startWorkers = startWorkers;
global.terminateWorkers = terminateWorkers;

// expose thread pool runner for application
exports.withThreadPool = CreateThreadPoolRunner({ initThreadPool, exitThreadPool });
// todo: instead of exposing this, combine node-backend and threadpool-host
exports.setWorkerPorts = setWorkerPorts;
