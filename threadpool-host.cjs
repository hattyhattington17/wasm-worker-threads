// worker thread that spawns the Wasm threadpool, executes Wasm functions with the threadpool, and broadcasts heartbeats
// If a background thread panics, this worker will silently hang and stop sending heartbeats so the main process can kill it
const { parentPort, Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const wasm = require('./pkg/blog_demo.js');

// Exit if not running as a worker
if (!parentPort) {
    console.log("ThreadPoolHost Worker must be run as a worker thread by ThreadpoolManager");
    process.exit(1);
}

// Add global error handlers
process.on('uncaughtException', (error) => {
    console.error('[ThreadPoolHost] Uncaught Exception:', error, error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[ThreadPoolHost] Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Send heartbeat every second
setInterval(() => {
    parentPort.postMessage({ type: 'heartbeat', timestamp: Date.now() });
}, 1000);

// tracks state of worker readiness
let workersReadyResolve;
let wasmWorkers = [], workerPorts = [];
let numWorkers = 0;

// handle requests to execute tasks with the threadpool
parentPort.on('message', async (msg) => {
    console.log(`[ThreadPoolHost] Received message from ThreadpoolManager: ${JSON.stringify(msg)}`);
    switch (msg.type) {
        case 'initPool':
            numWorkers = msg.numWorkers;
            // store the worker ports to be forwarded to the rayon workers
            workerPorts = msg.ports;
            let workersReady = new Promise((resolve) => (workersReadyResolve = resolve));
            await wasm.initThreadPool(Math.max(1, (numWorkers ?? (os.availableParallelism?.() ?? 1) - 1)));
            // wait until startWorkers (called by Rust FFI) signals pool readiness
            await workersReady;
            parentPort.postMessage({ type: 'poolReady' });
            break;
        case 'wasmCall':
            const { callId, functionName, args } = msg;
            console.log(`[ThreadPoolHost] Executing WASM call - callId: ${callId}, function: ${functionName}`);
            try {
                // Execute the WASM function
                const result = await wasm[functionName](...args);
                console.log(`[ThreadPoolHost] WASM function ${functionName} completed successfully, result: ${result}`);

                // Send result back to ThreadpoolManager
                parentPort.postMessage({ type: 'wasmResult', callId, success: true, result: result });
            } catch (error) {
                console.error(`[ThreadPoolHost] Error executing WASM function ${functionName}:`, error, error.stack);
                parentPort.postMessage({ type: 'wasmResult', callId, success: false, error: error.toString() });
            }
            break;
        case 'terminate':
            await wasm.exitThreadPool();
            process.exit(0);
            break;
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
    const workerPath = path.resolve(__dirname, './threadpool-worker.cjs');
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
    return Promise.all(wasmWorkers.map((w) => w.terminate()))
        .then(() =>   wasmWorkers = undefined);
}

// globals - callable by Wasm
global.startWorkers = startWorkers;
global.terminateWorkers = terminateWorkers;
