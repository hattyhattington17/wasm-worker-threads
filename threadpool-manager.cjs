// Manages Wasm threadpool which is spawned by a separate worker (threadpool-host.cjs)
// provides an interface to execute Wasm functions on a Rayon thread pool
// we spawn the threadpool from a worker because if a Rust background thread panics, the thread that's running the threadpool will silently hang
// the manager will monitor the worker for heartbeats and terminate the worker and error if heartbeats are not received within a timeout period 

const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');
const os = require('os');

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
     * Execute a WASM function with timeout monitoring
     */
    async execute(functionName, args = []) {
        if (!this.isThreadPoolHostReady) {
            throw new Error('Worker not ready');
        }

        const requestId = this.nextRequestId++;

        return new Promise((resolve, reject) => {
            // Store request promise with unique ID
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

            // Send request to worker with unique ID
            this.threadPoolHostWorker.postMessage({
                type: 'execute',
                requestId,
                functionName,
                args
            });
        });
    }

    /**
     * Start the ThreadpoolManagerWorker which is responsible for spawning the threadpool
     */
    async initWorker() {
        console.log('Starting ThreadpoolManagerWorker...');
        try {
            this.threadPoolHostWorker = new Worker(path.join(__dirname, 'threadpool-host.cjs'));
        } catch (error) {
            console.error('Failed to create worker:', error);
            throw error;
        }

        // Listen for events from the ThreadpoolManagerWorker
        this.threadPoolHostWorker.on('message', (msg) => {
            this.handleWorkerMessage(msg);
        });

        this.threadPoolHostWorker.on('error', (error) => {
            console.error('ThreadpoolManagerWorker error:', error);
            this.handleWorkerFailure(error.message);
        });

        this.threadPoolHostWorker.on('exit', (code) => {
            console.error(`ThreadpoolManagerWorker exited with code ${code}`);
            if (code !== 0) {
                this.handleWorkerFailure(`ThreadpoolManagerWorker crashed with code ${code}`);
            }
        });

        // Wait for worker to be ready
        await this.waitForWorkerReady();

        // Create MessageChannels for each worker thread
        console.log(`Creating ${this.numWorkers} MessageChannels for worker threads`);
        const port1Array = [];

        for (let i = 0; i < this.numWorkers; i++) {
            const channel = new MessageChannel();
            this.workerChannels.push(channel);
            port1Array.push(channel.port1);

            // Set up message handling for this worker
            channel.port2.on('message', (msg) => {
                console.log(`[Main Thread] Received from Worker ${i}:`, msg);
                // Log all messages from Rust postMessage calls
                if (typeof msg === 'string') {
                    console.log(`[Worker ${i} Rust Message]:`, msg);
                }
            });

            channel.port2.on('error', (error) => {
                console.error(`[Main Thread] Worker ${i} channel error:`, error);
            });
        }

        // Send all port1 instances to ThreadpoolManagerWorker
        this.threadPoolHostWorker.postMessage({
            type: 'workerChannels',
            ports: port1Array,
            numWorkers: this.numWorkers
        }, port1Array);

        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();

        console.log('Worker ready, monitoring for heartbeats');
    }

    /**
     * Handle messages from worker
     */
    handleWorkerMessage(msg) {
        console.log(`ThreadpoolManagerWorker sent message: ${JSON.stringify(msg)}`)
        switch (msg.type) {
            case 'ready':
                this.isThreadPoolHostReady = true;
                break;

            case 'result':
                // Handle concurrent tasks using requestId
                const request = this.pendingRequests.get(msg.requestId);
                if (request) {
                    if (msg.success) {
                        request.resolve(msg.result);
                    } else {
                        request.reject(new Error(msg.error));
                    }
                } else {
                    console.warn(`Received result for unknown requestId: ${msg.requestId}`);
                }
                break;
            case 'heartbeat':
                this.lastHeartbeat = msg.timestamp;
                break;
        }
    }

    /**
     * Handle worker failure
     */
    handleWorkerFailure(error) {
        // Reject all pending requests
        for (const [requestId, request] of this.pendingRequests) {
            request.reject(new Error(`Worker failed: ${error}`));
        }
        this.pendingRequests.clear();

        // todo: implement recovery
        this.isThreadPoolHostReady = false;
        this.stopHeartbeatMonitoring();
    }

    /**
     * Wait for worker to signal readiness
     */
    waitForWorkerReady() {
        console.log("Waiting for ThreadpoolManagerWorker ready message");
        return new Promise((resolve, reject) => {
            // Error if the worker still hasn't signaled readiness after 5 seconds
            const timeout = setTimeout(() => reject(new Error('Worker failed to initialize')), 5000);
            const checkReady = () => {
                if (this.isThreadPoolHostReady) {
                    clearTimeout(timeout);
                    clearInterval(workerReadyPoll);
                    resolve();
                }
            };
            let workerReadyPoll = setInterval(checkReady, 100);
        });
    }

    /**
     * Start heartbeat monitoring
     */
    startHeartbeatMonitoring() {
        this.lastHeartbeat = Date.now();

        this.heartbeatChecker = setInterval(() => {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
            if (timeSinceLastHeartbeat > this.timeout) {
                console.error(`ThreadpoolManager detected heartbeat timeout`);
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
     * Shutdown the manager
     */
    async shutdown() {
        this.stopHeartbeatMonitoring();

        // Close all worker channels
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
