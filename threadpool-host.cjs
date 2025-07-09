// worker process that spawns the Wasm threadpool, executes tasks with the threadpool, and broadcasts heartbeats
// If a background thread panics, this worker will silently hang and stop sending heartbeats so the main process can kill it
const { parentPort, threadId } = require('worker_threads');

// store threadpool-host's threadId for shared memory initialization - see patch-env.js
// this must be set before loading the wasm module
process.env.threadPoolHostThreadId = threadId;
const { withThreadPool, setWorkerPorts } = require('./node-backend.cjs');
const wasmModule = require('./pkg/blog_demo.js');
const { setNumberOfWorkers } = require('./threadpool-runner.cjs');

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

// handle requests to execute tasks with the threadpool
parentPort.on('message', async (msg) => {
    console.log(`ThreadPoolHost Worker received message from ThreadpoolManager (main process): ${JSON.stringify(msg)}`);
    if (msg.type === 'workerChannels') {
        setNumberOfWorkers(msg.numWorkers);
        // store the worker ports to be forwarded to the rayon workers
        setWorkerPorts(msg.ports);
    } else if (msg.type === 'execute') {
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
    } else if (msg.type === 'terminate') {
        clearInterval(heartbeatInterval);
        process.exit(0);
    }
}); 
