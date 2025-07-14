// Manages lifecycle and communication with Wasm threadpool which is spawned by a separate worker (threadpool-host.cjs)
// provides an interface to execute Wasm functions on a Rayon thread pool
// we spawn the threadpool from a worker because if a Rust background thread panics, the thread that's running the threadpool will silently hang
// the manager will monitor the worker for heartbeats and terminate the worker and error if heartbeats are not received within a timeout period 

const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');
const os = require('os');
const wasm = require('./pkg/blog_demo.js');

/**
 * ThreadpoolManager manages the lifecycle of a Wasm threadpool and provides an interface to execute functions with the pool available
 * Monitors ThreadPoolHost worker for heartbeats and errors if worker fails to respond within a timeout period
 * Triggers shutdown of the threadpool when no more requests are pending
 */
class ThreadpoolManager {
    constructor(options = {}) {
        this.timeout = options.timeout || 5000;

        // Worker that hosts the threadpool
        this.threadPoolHostWorker = null;
        this.lastHeartbeat = null;
        this.heartbeatMonitor = null;

        // Worker postmessage communication channels - unique channel is required for each worker
        this.workerChannels = [];
        this.numWorkers = options.numWorkers || Math.max(1, (os.availableParallelism?.() ?? 1) - 1);

        // Wasm requests made to the threadpool
        this.pendingWasmRequests = new Map();
        this.nextRequestId = 1;

        // Pool lifecycle
        this.poolState = 'none'; // none | initializing | running | exiting
        this.initPromise = null;
        this.exitPromise = null;
        this.poolReadyResolve = null;

        // WASM proxy
        this.wasmProxy = null;
    }

    /**
    * Start the ThreadPoolHost worker and signal it to initialize the threadpool
    */
    async initThreadPool() {
        let sharedMemory = wasm.getMemory();
        this.threadPoolHostWorker = new Worker(path.join(__dirname, 'threadpool-host.cjs'),
            { workerData: { memory: sharedMemory } });

        // Set event listeners for the ThreadPoolHost
        this.threadPoolHostWorker.on('message', (msg) => this.handleWorkerMessage(msg));
        this.threadPoolHostWorker.on('error', (error) => this.handleWorkerFailure(error.message));
        this.threadPoolHostWorker.on('exit', (code) => {
            if (code !== 0 && this.poolState !== 'exiting') {
                this.handleWorkerFailure(`ThreadPoolHost Worker crashed with code ${code}`);
            }
        });

        // Create MessageChannels for each worker in the threadpool to communicate with the main process
        const port1Array = [];
        for (let i = 0; i < this.numWorkers; i++) {
            const channel = new MessageChannel();
            this.workerChannels.push(channel);
            port1Array.push(channel.port1);

            // Main thread listens on port2, workers send messages to port1
            channel.port2.on('message', (msg) => console.log(`[Main Thread] Received from Worker ${i}:`, msg));
        }

        // Send all port1 instances to ThreadPoolHost Worker to forward to each threadpool worker
        this.threadPoolHostWorker.postMessage({ type: 'initPool', ports: port1Array, numWorkers: this.numWorkers }, port1Array);

        // Wait for threadpool to be initialized 
        await new Promise((resolve, reject) => this.poolReadyResolve = resolve);

        // Create WASM proxy, used to forward Wasm calls to the threadpool host worker
        this.createWasmProxy();

        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();
    }

    /**
     * Creates a proxy object that forwards WASM calls to the threadpool host worker
     * This object is a drop-in replacement for the Wasm module
     * Each function call on the proxy will send a message to the threadpool host worker
     * and return a promise that resolves with the result of the WASM function call
     * 
     * Usage:
     *  wasm = wasmManager.wasmProxy;
     *  const result = await wasm.multithreadedSum(); // executed by the threadpool host worker
     */
    createWasmProxy() {
        this.wasmProxy = new Proxy({}, {
            // executed when a function is called on the proxy
            get: (target, functionName) => {
                return (...args) => {
                    const callId = this.nextRequestId++;
                    return new Promise((resolve, reject) => {
                        // store the request so we can resolve it when threadpool host worker sends a response
                        this.pendingWasmRequests.set(callId, { resolve, reject });
                        // forward the call to the threadpool host worker
                        this.threadPoolHostWorker.postMessage({ type: 'wasmCall', callId, functionName, args });
                    });
                };
            }
        });
    }


    /**
     * Execute a JS function on the main thread while the threadpool is active
     * Forwards any Wasm calls made by the function to the threadpool host worker
     * @param {Function} fn - The function to execute
     * @param {Array} args - Arguments to pass to the function
     */
    async execute(fn) {
        // initialize the threadpool if it is not already running
        switch (this.poolState) {
            case 'none':
                // Initialize pool on first request
                this.poolState = 'initializing';
                this.initPromise = this.initThreadPool().then(() => {
                    this.poolState = 'running';
                }).catch(err => {
                    // todo: is more recovery required here?
                    this.poolState = 'none';
                    throw err;
                });
                await this.initPromise;
                break;
            case 'initializing':
                // Wait for ongoing initialization
                await this.initPromise;
                break;
            case 'running':
                break;
            case 'exiting':
                // Wait for exit to complete, then reinitialize
                await this.exitPromise;
                this.poolState = 'initializing';
                this.initPromise = this.initThreadPool().then(() => {
                    this.poolState = 'running';
                }).catch(err => {
                    // todo: is more recovery required here?
                    this.poolState = 'none';
                    throw err;
                });
                await this.initPromise;
                break;
        }

        try {
            // Set global proxy reference for Wasm wrapper functions to use - see patch-env.js
            global.__wasmProxy = this.wasmProxy;
            return await fn();
        } finally {
            // Clear global proxy reference - wasm wrapper will fall back to using the original Wasm module
            global.__wasmProxy = null;
            // Send threadpool shutdown signal if no more pending requests
            if (this.pendingWasmRequests.size === 0) {
                this.poolState = 'exiting';
                this.exitPromise = this.shutdown();
            }
        }
    }

    /**
     * Handle messages from worker
     */
    handleWorkerMessage(msg) {
        switch (msg.type) {
            case 'poolReady':
                this.poolReadyResolve()
                break;
            case 'wasmResult':
                // resolve the result from a pending Wasm call
                const wasmRequest = this.pendingWasmRequests.get(msg.callId);
                msg.success ? wasmRequest.resolve(msg.result) : wasmRequest.reject(new Error(msg.error));
                this.pendingWasmRequests.delete(msg.callId);
                break;
            case 'heartbeat':
                this.lastHeartbeat = msg.timestamp;
                break;
        }
    }

    /**
     * Handle worker failure
     * rejects all pending requests with an error and then shuts down the threadpool
     */
    handleWorkerFailure(error) {
        console.error('ThreadPoolHost Errored, shutting down pool:', error);

        // Reject all pending requests
        for (const [requestId, request] of this.pendingWasmRequests) {
            request.reject(new Error(`Worker failed: ${error}`));
        }
        this.pendingWasmRequests.clear();
        this.shutdown();
    }

    /**
     * Poll every second for heartbeats from the ThreadPoolHost worker
     */
    startHeartbeatMonitoring() {
        this.lastHeartbeat = Date.now();
        this.heartbeatMonitor = setInterval(() => {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
            if (timeSinceLastHeartbeat > this.timeout) {
                this.handleWorkerFailure('Heartbeat timeout failure');
            }
        }, 1000);
    }

    /**
     * Shutdown the workers and stop listening for heartbeats 
     * Called when no more requests are pending
     */
    async shutdown() {
        if (this.heartbeatMonitor) {
            clearInterval(this.heartbeatMonitor);
            this.heartbeatMonitor = null;
        }
        for (const channel of this.workerChannels) {
            channel.port2.close();
        }
        this.workerChannels = [];
        if (this.threadPoolHostWorker) {
            console.log('Terminating ThreadPoolHost Worker...');
            this.threadPoolHostWorker.postMessage({ type: 'terminate' });
            await new Promise((resolve) => {
                this.threadPoolHostWorker.once('exit', (code) => {
                    console.log(`ThreadPoolHost Worker exited gracefully with code ${code}`);
                    this.threadPoolHostWorker = null;
                    resolve();
                });
            });
        }
        this.poolState = 'none';
    }
}

module.exports = { ThreadpoolManager };
