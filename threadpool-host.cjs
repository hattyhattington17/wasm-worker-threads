// worker process that spawns the Wasm threadpool, executes tasks with the threadpool, and broadcasts heartbeats
// If a background thread panics, this worker will silently hang and stop sending heartbeats so the main process can kill it
const { parentPort, threadId } = require('worker_threads');

// store threadpool-host's threadId for shared memory initialization - see patch-env.js
// this must be set before loading the wasm module
process.env.threadPoolHostThreadId = threadId;


// Exit if not running as a worker
if (!parentPort) {
    console.log("worker exiting");
    process.exit(1);
}
console.log("ThreadPoolHost Worker launched, sending ready message");
parentPort.postMessage({ type: 'ready' });

// Send heartbeat every second
const heartbeatInterval = setInterval(() => {
    parentPort.postMessage({ type: 'heartbeat', timestamp: Date.now() });
}, 1000);

let workerPorts = [];
let numWorkers = 0;

// handle requests to execute tasks with the threadpool
parentPort.on('message', async (msg) => {
    console.log(`ThreadPoolHost Worker received message from ThreadpoolManager (main process): ${msg.type}`);

    const { withThreadPool, setWorkerPorts } = require('./node-backend.cjs');
    const wasmModule = require('./pkg/blog_demo.js');

    if (msg.type === 'workerChannels') {
        workerPorts = msg.ports;
        numWorkers = msg.numWorkers;
        console.log(`Received ${workerPorts.length} MessagePorts for worker threads`);
        setWorkerPorts(workerPorts);
    } else if (msg.type === 'execute') {
        const { requestId, functionName, args } = msg;
        try {
            await withThreadPool(async () => {
                // Get the function
                const fn = wasmModule[functionName];
                if (!fn) {
                    throw new Error(`Function '${functionName}' not found`);
                }

                // Execute the function 
                // note: if a panic occurs on a background thread, this will silently hang
                const result = fn(...args);

                // Send result back to ThreadpoolManager with requestId
                parentPort.postMessage({ 
                    type: 'result', 
                    requestId,
                    success: true, 
                    result: result 
                });
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
