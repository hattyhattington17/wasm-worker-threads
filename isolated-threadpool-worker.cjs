/**
 * Worker process that runs WASM with threads
 * This can be terminated if any thread panics
 */

const { parentPort, threadId } = require('worker_threads');
process.env.workerManagerThread = threadId;
// Exit if not running as a worker
if (!parentPort) {
    console.log("worker exiting");
    process.exit(1);
}
console.log("ThreadpoolManager Worker launched, sending ready message");
parentPort.postMessage({ type: 'ready' });

try {
    // Send heartbeat every second to show we're alive
    const heartbeatInterval = setInterval(() => {
        parentPort.postMessage({ type: 'heartbeat', timestamp: Date.now() });
    }, 1000);

    // Handle shutdown
    function shutdown() {
        console.log("ThreadpoolManager Worker shutdown called");
        clearInterval(heartbeatInterval);
        process.exit(0);
    }

    // Handle execution requests
    parentPort.on('message', async (msg) => {

        console.log(`ThreadpoolManager Worker received message from ThreadpoolManager on main process: ${msg}`);
        if (msg.type === 'execute') {
            try {
                const { functionName, args } = msg;

                // Lazy load to avoid initialization issues
                const { withThreadPool } = require('./node-backend.cjs');
                const wasmModule = require('./pkg/blog_demo.js');

                await withThreadPool(async () => {
                    // Get the function
                    const fn = wasmModule[functionName];
                    if (!fn) {
                        throw new Error(`Function '${functionName}' not found`);
                    }

                    // Execute the function (this is where hangs can occur)
                    const result = fn(...args);

                    // Send result back
                    parentPort.postMessage({
                        type: 'result',
                        success: true,
                        result: result
                    });
                });

            } catch (error) {
                parentPort.postMessage({
                    type: 'result',
                    success: false,
                    error: error.toString()
                });
            }
        } else if (msg.type === 'terminate') {
            shutdown();
        }
    });
} catch (error) {
    console.error('Worker initialization error:', error);
    process.exit(1);
}
