// worker process that spawns the Wasm threadpool, executes tasks with the threadpool, and broadcasts heartbeats
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
const heartbeatInterval = setInterval(() => {
    parentPort.postMessage({ type: 'heartbeat', timestamp: Date.now() });
}, 1000); 

// tracks state of worker readiness
let workersReadyResolve, workersReady;
let wasmWorkers = [];
let workerPorts = [];
let numWorkers = 0;
let poolInitialized = false;

async function initializePool() {
    if (poolInitialized) {
        console.log('[ThreadPoolHost] Pool already initialized, skipping');
        return;
    }

    try {
        console.log('[ThreadPoolHost] Starting pool initialization...');

        workersReady = new Promise((resolve) => (workersReadyResolve = resolve));
        await wasm.initThreadPool(Math.max(1, (numWorkers ?? (os.availableParallelism?.() ?? 1) - 1)));
        // wait until startWorkers signals readiness
        await workersReady;

        workersReady = undefined;
        poolInitialized = true;
        console.log('[ThreadPoolHost] Pool initialization completed successfully');
    } catch (error) {
        console.error('[ThreadPoolHost] Pool initialization failed:', error, error.stack);
        throw error;
    }
}

async function teardownPool() {
    if (!poolInitialized) {
        console.log('[ThreadPoolHost] Pool not initialized, skipping teardown');
        return;
    }

    try {
        console.log('[ThreadPoolHost] Starting pool teardown...');
        await wasm.exitThreadPool();
        poolInitialized = false;
        console.log('[ThreadPoolHost] Pool teardown completed');
    } catch (error) {
        console.error('[ThreadPoolHost] Pool teardown failed:', error, error.stack);
        throw error;
    }
}

// handle requests to execute tasks with the threadpool
parentPort.on('message', async (msg) => {
    try {
        console.log(`[ThreadPoolHost] Received message from ThreadpoolManager: ${JSON.stringify(msg)}`);
        switch (msg.type) {
            case 'workerChannels':
                console.log(`[ThreadPoolHost] Setting up worker channels for ${msg.numWorkers} workers`);
                numWorkers = msg.numWorkers;
                // store the worker ports to be forwarded to the rayon workers
                workerPorts = msg.ports;
                // Initialize the pool once when we get the worker channels
                // todo - shouldn't there be a separate init message?
                await initializePool();
                parentPort.postMessage({ type: 'poolReady' });
                break;
            case 'execute':
                const { requestId, functionName, args } = msg;
                console.log(`[ThreadPoolHost] Starting execution - requestId: ${requestId}, function: ${functionName}`);
                try {
                    // Get the function 
                    // todo: this needs to support calling js functions
                    const fn = wasm[functionName];
                    if (!fn) {
                        const error = `Function '${functionName}' not found`;
                        console.error(`[ThreadPoolHost] Error: ${error}`);
                        throw new Error(error);
                    }
                    console.log(`[ThreadPoolHost] Executing function ${functionName} with args:`, args);
                    // Execute the function, if a panic occurs on a background thread, this will silently hang
                    const result = fn(...args);
                    console.log(`[ThreadPoolHost] Function ${functionName} completed successfully, result: ${result}`);

                    // Send result back to ThreadpoolManager with requestId 
                    parentPort.postMessage({ type: 'result', requestId, success: true, result: result });
                } catch (error) {
                    console.error(`[ThreadPoolHost] Error executing ${functionName}:`, error, error.stack);
                    parentPort.postMessage({ type: 'result', requestId, success: false, error: error.toString() });
                }
                break;
            case 'terminate':
                console.log('[ThreadPoolHost] Received terminate message');
                // todo: do we need to stop sending heartbeats on teardown?
                clearInterval(heartbeatInterval);
                await teardownPool();
                console.log('[ThreadPoolHost] Exiting...');
                process.exit(0);
                break;
            default:
                console.warn(`[ThreadPoolHost] Unknown message type: ${msg.type}`);
        }
    } catch (error) {
        console.error('[ThreadPoolHost] Error handling message:', error, error.stack);
        // Try to send error back to main thread if this was an execute request
        if (msg.type === 'execute' && msg.requestId) {
            parentPort.postMessage({ type: 'result', requestId: msg.requestId, success: false, error: `ThreadPoolHost error: ${error.toString()}` });
        }
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
