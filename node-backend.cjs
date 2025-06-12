const { isMainThread, parentPort, workerData, Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const wasm = require('./pkg/blog_demo.js');
const { WithThreadPool, workers } = require('./workers.cjs');

// tracks state of worker readiness
let workersReadyResolve, workersReady;

if (!isMainThread) {
  // if this file is being run from a worker
  // notify main thread that this worker is ready
  parentPort.postMessage({ type: 'wasm_bindgen_worker_ready' });
  // hook into Rayon’s pool: receive the ThreadBuilder pointer and invoke its run() method
  wasm.wbg_rayon_start_worker(workerData.receiver);
}

// init the wasm powered thread pool
async function initThreadPool() {
  // only init the thread pool on the main thread
  if (!isMainThread) return;

  // create a promise that resolves when workers are ready
  workersReady = new Promise((resolve) => (workersReadyResolve = resolve));

  // determine how many threads to spawn (leave one for the main thread)
  const threadCount = Math.max(1, (workers.numWorkers ?? (os.availableParallelism?.() ?? 1) - 1));

  // call into WASM to set up the pool, passing this file's name so workers can re-import it
  // this will eventually call startWorkers to spawn the worker threads
  await wasm.initThreadPool(threadCount, __filename);

  // wait until startWorkers signals readiness
  await workersReady;
  workersReady = undefined;
}

/**
 * Tear down the WASM thread pool. Only on the main thread.
 */
async function exitThreadPool() {
  if (!isMainThread) return;
  await wasm.exitThreadPool();
}

/** @type {Worker[]} currently running worker instances */
let wasmWorkers = [];

/**
 * Spawn worker threads, wait for each to be ready, and then start the WASM builder.
 * @param {string} src - path to the worker entry script
 * @param {WebAssembly.Memory} memory - shared memory instance
 * @param {{ numThreads(): number, receiver(): any, build(): void }} builder - builder object
 */
async function startWorkers(src, memory, builder) {
  wasmWorkers = [];

  // launch the requested number of workers
  await Promise.all(
    Array.from({ length: builder.numThreads() }, () => {
      const worker = new Worker(src, {
        workerData: { memory, receiver: builder.receiver() },
      });
      wasmWorkers.push(worker);

      // return a promise that resolves when this worker is ready
      return new Promise((resolve) => {
        let done = false;
        worker.on('message', (data) => {
          // listen for worker to send ready signal
          if (!done && data?.type === 'wasm_bindgen_worker_ready') {
            done = true;
            resolve(worker);
          }
        });
      });
    })
  );

  // once all workers are ready, build the threadpool
  builder.build();

  // notify initThreadPool that workers are up
  workersReadyResolve();
}

// kill the worker threads
async function terminateWorkers() {
  return Promise.all(
    wasmWorkers.map((w) => w.terminate())
  ).then(() => {
    wasmWorkers = undefined;
  });
}


// create withThreadPool wrapper by passing our threadpool init and exit code into the threadpool manager 
exports.withThreadPool = WithThreadPool({ initThreadPool, exitThreadPool });
exports.wasm = wasm;

// make these functions globally available to the WASM threads
global.startWorkers = startWorkers;
global.terminateWorkers = terminateWorkers;
