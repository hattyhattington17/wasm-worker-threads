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

        // Map of requests made to the threadpool to their resolvers: requestId -> {resolve, reject}
        this.pendingRequests = new Map();
        this.nextRequestId = 1;

        // Heartbeat monitoring
        this.lastHeartbeat = null;
        this.heartbeatChecker = null;

        // Worker postmessage communication channels - unique channel is required for each worker
        this.workerChannels = [];
        this.numWorkers = options.numWorkers || Math.max(1, (os.availableParallelism?.() ?? 1) - 1);

        // Pool lifecycle state
        this.poolState = 'none'; // none | initializing | running | exiting
        this.initPromise = null;
        this.exitPromise = null;
    }

    /**
    * Start the ThreadPoolHost worker which is responsible for spawning the threadpool
    */
    async initThreadPool() {
        console.log('Starting ThreadPoolHost worker...');
        try {
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
            if (code !== 0 && this.poolState !== 'exiting') {
                this.handleWorkerFailure(`ThreadPoolHost Worker crashed with code ${code}`);
            }
        });

        // Create MessageChannels for each rayon thread worker to communicate with the main process
        // for each channel, ThreadPoolManager listens on port2 and sends port1 for ThreadPoolHost to forward to each worker
        const port1Array = [];
        for (let i = 0; i < this.numWorkers; i++) {
            const channel = new MessageChannel();
            this.workerChannels.push(channel);
            port1Array.push(channel.port1);

            // set listeners for each rayon thread worker
            channel.port2.on('message', (msg) => console.log(`[Main Thread] Received from Worker ${i}:`, msg));
        }

        // Send all port1 instances to ThreadPoolHost Worker to forward to each rayon thread worker
        this.threadPoolHostWorker.postMessage({ type: 'workerChannels', ports: port1Array, numWorkers: this.numWorkers }, port1Array);

        // Wait for pool to be initialized
        await this.awaitPoolReady();

        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();
    }

    /**
     * Execute a WASM function with timeout monitoring
     * functionName and args must be cloneable so they can be sent to the worker
     */
    async execute(functionName, args = []) {
        // Handle different pool states
        switch (this.poolState) {
            case 'none':
                // Initialize pool on first request
                this.poolState = 'initializing';
                this.initPromise = this.initThreadPool().then(() => {
                    this.poolState = 'running';
                }).catch(err => {
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
                // Pool is ready, continue
                break;
            
            case 'exiting':
                // Wait for exit to complete, then reinitialize
                await this.exitPromise;
                this.poolState = 'initializing';
                this.initPromise = this.initThreadPool().then(() => {
                    this.poolState = 'running';
                }).catch(err => {
                    this.poolState = 'none';
                    throw err;
                });
                await this.initPromise;
                break;
        }

        const requestId = this.nextRequestId++;
        try {
            // Create promise for this request
            const resultPromise = new Promise((resolve, reject) => this.pendingRequests.set(requestId, { resolve, reject }));
            this.threadPoolHostWorker.postMessage({ type: 'execute', requestId, functionName, args });
            return await resultPromise;
        } finally {
            this.pendingRequests.delete(requestId);
            
            // Shut down immediately if no more pending requests
            if (this.pendingRequests.size === 0 && this.poolState === 'running') {
                console.log('No active requests, shutting down ThreadPool...');
                this.poolState = 'exiting';
                this.exitPromise = this.shutdown().then(() => {
                    this.poolState = 'none';
                }).catch(err => {
                    console.error('Error during shutdown:', err);
                    this.poolState = 'none';
                });
            }
        }
    }

    /**
     * Handle messages from worker
     */
    handleWorkerMessage(msg) {
        console.log(`ThreadPoolHost Worker sent message: ${JSON.stringify(msg)}`)
        switch (msg.type) {
            case 'poolReady':
                // Pool is now initialized and ready to use
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
        this.shutdown();
    }


    /**
     * Wait for pool to be initialized and ready
     */
    awaitPoolReady() {
        console.log("Waiting for ThreadPool to be ready...");
        return new Promise((resolve, reject) => {
            // Error if the pool still hasn't been initialized after 10 seconds
            const timeout = setTimeout(() => {
                this.threadPoolHostWorker.off('message', poolReadyHandler);
                reject(new Error('Pool failed to initialize'));
            }, 10000);
            
            const poolReadyHandler = (msg) => {
                if (msg.type === 'poolReady') {
                    clearTimeout(timeout);
                    this.threadPoolHostWorker.off('message', poolReadyHandler);
                    resolve();
                }
            };
            
            this.threadPoolHostWorker.on('message', poolReadyHandler);
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
     * Shutdown the worker channels, stop listening for heartbeats, and terminate the ThreadPoolHost worker
     */
    async shutdown() {
        if (this.heartbeatChecker) {
            clearInterval(this.heartbeatChecker);
            this.heartbeatChecker = null;
        }
        for (const channel of this.workerChannels) {
            channel.port2.close();
        }
        this.workerChannels = [];
        if (this.threadPoolHostWorker) {
            // Send graceful shutdown message first
            this.threadPoolHostWorker.postMessage({ type: 'terminate' });

            // Wait for graceful shutdown with timeout
            const shutdownPromise = new Promise((resolve) => {
                const exitHandler = (code) => {
                    console.log(`ThreadPoolHost Worker exited gracefully with code ${code}`);
                    this.threadPoolHostWorker = null;
                    resolve();
                };
                this.threadPoolHostWorker.once('exit', exitHandler);
            });

            const timeoutPromise = new Promise((resolve) => {
                setTimeout(async () => {
                    if (this.threadPoolHostWorker) {
                        console.log('ThreadPoolHost Worker did not exit gracefully, force terminating...');
                        await this.threadPoolHostWorker.terminate();
                        this.threadPoolHostWorker = null;
                    }
                    resolve();
                }, 2000);
            });

            await Promise.race([shutdownPromise, timeoutPromise]);
        }
    }
}

module.exports = { ThreadpoolManager };
