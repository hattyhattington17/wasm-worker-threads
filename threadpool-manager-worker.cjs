/**
 * Worker process that spawns the Wasm threadpool
 * ThreadpoolManager (main process) will terminate this worker if heartbeats stop
 */

const { parentPort, threadId } = require('worker_threads');

// store threadId for memory initialization - see patch-env.js
// this must be set before loading the wasm module
process.env.workerManagerThread = threadId;


// Exit if not running as a worker
if (!parentPort) {
    console.log("worker exiting");
    process.exit(1);
}
console.log("ThreadpoolManagerWorker launched, sending ready message");
parentPort.postMessage({ type: 'ready' });

// Send heartbeat every second
const heartbeatInterval = setInterval(() => {
    parentPort.postMessage({ type: 'heartbeat', timestamp: Date.now() });
}, 1000);

let mainProcessChannel = null;

// handle requests to execute tasks with the threadpool
parentPort.on('message', async (msg) => {
    console.log(`ThreadpoolManagerWorker received message from ThreadpoolManager (main process): ${JSON.stringify(msg)}`);

    const { withThreadPool, setMainProcessChannel } = require('./node-backend.cjs');
    const wasmModule = require('./pkg/blog_demo.js');

    if (msg.type === 'mainProcessChannel') {
        mainProcessChannel = msg.mainProcessChannel;
        mainProcessChannel.postMessage("Received mainProcessChannel in ThreadpoolMaangerWorker");
        setMainProcessChannel(mainProcessChannel);
    } else if (msg.type === 'execute') {
        try {
            const { functionName, args } = msg;
            await withThreadPool(async () => {
                // Get the function
                const fn = wasmModule[functionName];
                if (!fn) {
                    throw new Error(`Function '${functionName}' not found`);
                }

                // Execute the function 
                // note: if a panic occurs on a background thread, this will silently hang
                const result = fn(...args);

                // Send result back to ThreadpoolManager
                parentPort.postMessage({ type: 'result', success: true, result: result });
            });
        } catch (error) {
            parentPort.postMessage({
                type: 'result',
                success: false,
                error: error.toString()
            });
        }
    } else if (msg.type === 'terminate') {
        clearInterval(heartbeatInterval);
        process.exit(0);
    }
}); 
