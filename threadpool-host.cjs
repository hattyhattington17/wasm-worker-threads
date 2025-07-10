// worker process that spawns the Wasm threadpool, executes tasks with the threadpool, and broadcasts heartbeats
// If a background thread panics, this worker will silently hang and stop sending heartbeats so the main process can kill it
const wasmModule = require('./pkg/blog_demo.js');
const { setNumberOfWorkers } = require('./threadpool-runner.cjs');
const { isMainThread, parentPort, workerData, Worker, threadId } = require('worker_threads');
const os = require('os');
const path = require('path');
const wasm = require('./pkg/blog_demo.js');
const { CreateThreadPoolRunner, workers } = require('./threadpool-runner.cjs');

// Exit if not running as a worker
if (!parentPort) {
    console.log("ThreadPoolHost Worker must be run as a worker thread by ThreadpoolManager");
    process.exit(1);
}

// Send heartbeat every second
const heartbeatInterval = setInterval(() => {
    parentPort.postMessage({ type: 'heartbeat', timestamp: Date.now() });
}, 1000);
parentPort.postMessage({ type: 'ready' });

// tracks state of worker readiness
let workersReadyResolve, workersReady;
/** @type {Worker[]} currently running worker instances */
let wasmWorkers = [];
let workerPorts = [];

// create a runner that can execute tasks with the threadpool available
// and tear down the threadpool when no longer needed
const withThreadPool = CreateThreadPoolRunner({
    /**
     * Initialize the Wasm thread pool
     */
    initThreadPool: async function initThreadPool() {
        workersReady = new Promise((resolve) => (workersReadyResolve = resolve));
        const threadCount = Math.max(1, (workers.numWorkers ?? (os.availableParallelism?.() ?? 1) - 1));
        await wasm.initThreadPool(threadCount);
        // wait until startWorkers signals readiness
        await workersReady;
        workersReady = undefined;
    },
    /**
     * tear down wasm thread pool
     * called by createThreadPoolRunner when pool is no longer needed
     */
    exitThreadPool: async function exitThreadPool() {
        await wasm.exitThreadPool();
    }
});

// handle requests to execute tasks with the threadpool
parentPort.on('message', async (msg) => {
    console.log(`ThreadPoolHost Worker received message from ThreadpoolManager (main process): ${JSON.stringify(msg)}`);
    switch (msg.type) {
        case 'workerChannels':
            setNumberOfWorkers(msg.numWorkers);
            // store the worker ports to be forwarded to the rayon workers
            workerPorts = msg.ports;
            break;
        case 'execute':
            const { requestId, functionName, args } = msg;
            try {
                await withThreadPool(async () => {
                    // Get the function 
                    // todo: this needs to support calling js functions
                    const fn = wasmModule[functionName];
                    if (!fn) {
                        throw new Error(`Function '${functionName}' not found`);
                    }

                    // Execute the function, if a panic occurs on a background thread, this will silently hang
                    const result = fn(...args);
                    // Send result back to ThreadpoolManager with requestId 
                    parentPort.postMessage({ type: 'result', requestId, success: true, result: result });
                });
            } catch (error) {
                parentPort.postMessage({
                    type: 'result',
                    requestId,
                    success: false,
                    error: error.toString()
                });
            }
            break;
        case 'terminate':
            clearInterval(heartbeatInterval);
            process.exit(0);
            break;
        default:
            console.warn(`ThreadPoolHost Worker received unknown message type: ${msg.type}`);
    }
});


// ---------- Called from Rust via wasm-bindgen -------------------------------

/**
 * Spawn worker threads, wait for each to be ready, and then start the WASM builder.
 * This function is called from Rust as part of the Rayon thread pool initialization
 * @param {string} src - path to the worker entry script
 * @param {WebAssembly.Memory} memory - shared memory instance
 * @param {{ numThreads(): number, receiver(): any, build(): void }} builder - builder object
 */
async function startWorkers(memory, builder) {
    const workerPath = path.resolve(__dirname, './rayon-worker.cjs');
    wasmWorkers = [];

    // Ensure we have enough ports for all workers
    if (workerPorts.length < builder.numThreads()) {
        throw new Error(`Not enough MessagePorts: have ${workerPorts.length}, need ${builder.numThreads()}`);
    }

    await Promise.all(
        Array.from({ length: builder.numThreads() }, (_, index) => {
            // Each worker gets its own dedicated MessagePort to communicate with the main thread
            const workerPort = workerPorts[index];
            const worker = new Worker(workerPath, {
                workerData: { memory, receiver: builder.receiver(), mainThreadPort: workerPort, workerId: index },
                transferList: [workerPort]
            });
            wasmWorkers.push(worker);

            // return a promise that resolves when this worker sends a ready message
            return new Promise((resolve) => {
                let done = false;
                worker.on('message', (data) => {
                    if (!done && data?.type === 'wasm_bindgen_worker_ready') {
                        done = true;
                        resolve(worker);
                    }
                });
            });
        })
    );

    // once all workers are ready, build the Rust threadpool
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
