// Manages Wasm threadpool which is spawned by a separate worker (threadpool-host.cjs)
// provides an interface to execute Wasm functions on a Rayon thread pool
// we spawn the threadpool from a worker because if a Rust background thread panics, the thread that's running the threadpool will silently hang
// the manager will monitor the worker for heartbeats and terminate the worker and error if heartbeats are not received within a timeout period 

const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');
const os = require('os');
const wasm = require('./pkg/blog_demo.js');


class ThreadpoolManager {
    constructor(options = {}) {
        this.timeout = options.timeout || 5000;

        // worker that runs the threadpool
        this.threadPoolHostWorker = null;
        this.isThreadPoolHostReady = false;

        // Map of requests made to the threadpool to their resolvers: requestId -> {resolve, reject}
        this.pendingRequests = new Map();
        this.nextRequestId = 1;

        // Heartbeat monitoring
        this.lastHeartbeat = null;
        this.heartbeatChecker = null;

        // Worker postmessage communication channels - unique channel is required for each worker
        this.workerChannels = [];
        this.numWorkers = options.numWorkers || Math.max(1, (os.availableParallelism?.() ?? 1) - 1);
    }

    /**
    * Start the ThreadPoolHost worker which is responsible for spawning the threadpool
    */
    async initWorker() {
        console.log('Starting ThreadPoolHost worker...');
        try {
            // todo: pass shared memory to the worker
            let sharedMemory = wasm.getMemory();
            this.threadPoolHostWorker = new Worker(path.join(__dirname, 'threadpool-host.cjs'),
                { workerData: { memory: sharedMemory } });
        } catch (error) {
            console.error('Failed to create ThreadPoolHost worker:', error);
            throw error;
        }

        // Listen for events from the ThreadPoolHost
        this.threadPoolHostWorker.on('message', (msg) => this.handleWorkerMessage(msg));
        this.threadPoolHostWorker.on('error', (error) => this.handleWorkerFailure(error.message));
        this.threadPoolHostWorker.on('exit', (code) => {
            console.log(`ThreadPoolHost Worker exited with code ${code}`);
            if (code !== 0) {
                this.handleWorkerFailure(`ThreadPoolHost Worker crashed with code ${code}`);
            }
        });

        // Wait for worker to be ready
        await this.awaitThreadPoolHostReady();

        // Create MessageChannels for each rayon thread worker to communicate with the main process
        // for each channel, ThreadPoolManager listens on port2 and sends port1 for ThreadPoolHost to forward to each worker
        const port1Array = [];
        for (let i = 0; i < this.numWorkers; i++) {
            const channel = new MessageChannel();
            this.workerChannels.push(channel);
            port1Array.push(channel.port1);

            // set listeners for each rayon thread worker
            channel.port2.on('message', (msg) => console.log(`[Main Thread] Received from Worker ${i}:`, msg));
            channel.port2.on('error', (error) => console.error(`[Main Thread] Received worker ${i} channel error:`, error));
        }

        // Send all port1 instances to ThreadPoolHost Worker to forward to each rayon thread worker
        this.threadPoolHostWorker.postMessage({ type: 'workerChannels', ports: port1Array, numWorkers: this.numWorkers }, port1Array);

        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();
    }

    /**
     * Execute a WASM function with timeout monitoring
     * functionName and args must be cloneable so they can be sent to the worker
     */
    async execute(functionName, args = []) {
        // verify that the threadpool is ready
        if (!this.isThreadPoolHostReady) {
            throw new Error('ThreadPool not ready');
        }
        // store the request with a unique ID so that we can map the correct responses to concurrent requests
        const requestId = this.nextRequestId++;
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, {
                resolve: (result) => {
                    this.pendingRequests.delete(requestId);
                    resolve(result);
                },
                reject: (error) => {
                    this.pendingRequests.delete(requestId);
                    reject(error);
                }
            });

            // Send request to ThreadPoolHost Worker with unique ID
            this.threadPoolHostWorker.postMessage({ type: 'execute', requestId, functionName, args });
        });
    }

    /**
     * Handle messages from worker
     */
    handleWorkerMessage(msg) {
        console.log(`ThreadPoolHost Worker sent message: ${JSON.stringify(msg)}`)
        switch (msg.type) {
            case 'ready':
                this.isThreadPoolHostReady = true;
                break;
            case 'result':
                // resolve the result from a task executed in the threadpool to its corresponding request
                const request = this.pendingRequests.get(msg.requestId);
                msg.success ? request.resolve(msg.result) : request.reject(new Error(msg.error));
                break;
            case 'heartbeat':
                this.lastHeartbeat = msg.timestamp;
                break;
        }
    }

    /**
     * Handle worker failure
     * todo: determine when this will happen
     */
    handleWorkerFailure(error) {
        console.error('ThreadPoolHost Worker error:', error);

        // Reject all pending requests
        for (const [requestId, request] of this.pendingRequests) {
            request.reject(new Error(`Worker failed: ${error}`));
        }
        this.pendingRequests.clear();
        this.isThreadPoolHostReady = false;
        this.shutdown();
    }

    /**
     * Wait for worker to signal readiness
     */
    awaitThreadPoolHostReady() {
        console.log("Waiting for ThreadPoolHost Worker ready message");
        return new Promise((resolve, reject) => {
            // Error if the worker still hasn't signaled readiness after 5 seconds
            const timeout = setTimeout(() => reject(new Error('Worker failed to initialize')), 5000);
            // Poll for readiness every 100ms
            const workerReadyPoll = setInterval(() => {
                if (this.isThreadPoolHostReady) {
                    clearTimeout(timeout);
                    clearInterval(workerReadyPoll);
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * Poll every second for heartbeats from the ThreadPoolHost worker
     */
    startHeartbeatMonitoring() {
        this.lastHeartbeat = Date.now();
        this.heartbeatChecker = setInterval(() => {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
            if (timeSinceLastHeartbeat > this.timeout) {
                this.handleWorkerFailure('Heartbeat timeout failure');
            }
        }, 1000);
    }

    /**
     * Stop heartbeat monitoring
     */
    stopHeartbeatMonitoring() {
        if (this.heartbeatChecker) {
            clearInterval(this.heartbeatChecker);
            this.heartbeatChecker = null;
        }
    }

    /**
     * Shutdown the worker channels, stop listening for heartbeats, and terminate the ThreadPoolHost worker
     */
    async shutdown() {
        this.stopHeartbeatMonitoring();
        for (const channel of this.workerChannels) {
            channel.port2.close();
        }
        this.workerChannels = [];
        if (this.threadPoolHostWorker) {
            await this.threadPoolHostWorker.terminate();
            this.threadPoolHostWorker = null;
        }
    }
}

module.exports = { ThreadpoolManager };
