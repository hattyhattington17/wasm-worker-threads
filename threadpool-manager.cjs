const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');
const os = require('os');

// todo: implement postmessage handling

class ThreadpoolManager {
    constructor(options = {}) {
        this.timeout = options.timeout || 5000;
        // todo: store addresses of rayon workers, then listen for postmessages
        this.worker = null;
        this.workerReady = false;
        this.pendingRequests = new Map(); // Map of requestId -> {resolve, reject}
        this.nextRequestId = 1;
        this.lastHeartbeat = null;
        this.heartbeatChecker = null;
        // Worker communication channels
        this.workerChannels = [];
        this.workerPorts = [];
        this.numWorkers = options.numWorkers || Math.max(1, (os.availableParallelism?.() ?? 1) - 1);
    }

    /**
     * Execute a WASM function with timeout monitoring
     */
    async execute(functionName, args = []) {
        if (!this.workerReady) {
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
            this.worker.postMessage({ 
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
            this.worker = new Worker(path.join(__dirname, 'threadpool-manager-worker.cjs'));
        } catch (error) {
            console.error('Failed to create worker:', error);
            throw error;
        }

        // Listen for events from the ThreadpoolManagerWorker
        this.worker.on('message', (msg) => {
             this.handleWorkerMessage(msg);
        });

        this.worker.on('error', (error) => {
            console.error('ThreadpoolManagerWorker error:', error);
            this.handleWorkerFailure(error.message);
        });

        this.worker.on('exit', (code) => {
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
            this.workerPorts.push(channel.port2);
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
        this.worker.postMessage({ 
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
                this.workerReady = true;
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
        this.workerReady = false;
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
                if (this.workerReady) {
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
        for (const port of this.workerPorts) {
            port.close();
        }
        this.workerChannels = [];
        this.workerPorts = [];

        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

module.exports = { ThreadpoolManager };
