const { Worker } = require('worker_threads');
const path = require('path');

// todo: implement postmessage handling

class ThreadpoolManager {
    constructor(options = {}) {
        this.timeout = options.timeout || 5000;
        // todo: store addresses of rayon workers, then listen for postmessages
        this.worker = null;
        this.workerReady = false;
        this.pendingRequest = null;
        this.lastHeartbeat = null;
        this.heartbeatChecker = null;
    }

    /**
     * Execute a WASM function with timeout monitoring
     */
    async execute(functionName, args = []) {
        if (!this.workerReady) {
            throw new Error('Worker not ready');
        }

        return new Promise((resolve, reject) => {
            // Store request promise, later it will resolve with the result of the task
            this.pendingRequest = {
                resolve: (result) => {
                    this.pendingRequest = null;
                    resolve(result);
                },
                reject: (error) => {
                    this.pendingRequest = null;
                    reject(error);
                }
            };

            // Send request to worker
            this.worker.postMessage({ type: 'execute', functionName, args });
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
            console.log('ThreadpoolManagerWorker message :', msg.type);
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
                // todo: this needs to handle concurrent tasks
                if (this.pendingRequest) {
                    if (msg.success) {
                        this.pendingRequest.resolve(msg.result);
                    } else {
                        this.pendingRequest.reject(new Error(msg.error));
                    }
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
        // Reject pending request
        if (this.pendingRequest) {
            this.pendingRequest.reject(new Error(`Worker failed: ${error}`));
            this.pendingRequest = null;
        }
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

        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

module.exports = { ThreadpoolManager };
