/**
 * Simple manager that runs WASM in a monitored worker process
 */

const { Worker } = require('worker_threads');
const path = require('path');

class ThreadpoolManager {
    constructor(options = {}) {
        this.timeout = options.timeout || 10000;
        this.heartbeatTimeout = options.heartbeatTimeout || 5000;

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
            let timeoutHandle;

            // Set up timeout
            timeoutHandle = setTimeout(() => {
                reject(new Error(`Function '${functionName}' timed out - worker may have panicked`));
            }, this.timeout);

            // Store request handler
            this.pendingRequest = {
                resolve: (result) => {
                    clearTimeout(timeoutHandle);
                    this.pendingRequest = null;
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutHandle);
                    this.pendingRequest = null;
                    reject(error);
                }
            };

            // Send request to worker
            this.worker.postMessage({
                type: 'execute',
                functionName,
                args
            });
        });
    }

    /**
     * Start the ThreadpoolManager worker which is responsible for spawning the threadpool
     */
    async initWorker() {
        console.log('Starting ThreadpoolManager worker...');
        try {
            this.worker = new Worker(path.join(__dirname, 'isolated-threadpool-worker.cjs'));
            console.log(`created worker at ${path.join(__dirname, 'isolated-threadpool-worker.cjs')}`);
        } catch (error) {
            console.error('Failed to create worker:', error);
            throw error;
        }

        // Listen for events from the ThreadpoolManager Worker
        this.worker.on('message', (msg) => {
            console.log('ThreadpoolManager Worker message :', msg.type);
            this.handleWorkerMessage(msg);
        });

        this.worker.on('error', (error) => {
            console.error('ThreadpoolManager Worker error:', error);
            this.handleWorkerFailure(error.message);
        });

        this.worker.on('exit', (code) => {
            console.error(`ThreadpoolManager Worker exited with code ${code}`);
            if (code !== 0) {
                this.handleWorkerFailure(`ThreadpoolManager Worker crashed with code ${code}`);
            }
        });

        // Wait for worker to be ready
        await this.waitForWorkerReady();

        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();

        console.log('Worker ready');
    }

    /**
     * Handle messages from worker
     */
    handleWorkerMessage(msg) {
        switch (msg.type) {
            case 'ready':
                console.log('Worker signaled ready');
                this.workerReady = true;
                break;

            case 'result':
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
        this.workerReady = false;

        // Reject pending request
        if (this.pendingRequest) {
            this.pendingRequest.reject(new Error(`Worker failed: ${error}`));
            this.pendingRequest = null;
        }

        // Stop heartbeat monitoring
        this.stopHeartbeatMonitoring();
    }

    /**
     * Wait for worker to signal readiness
     */
    waitForWorkerReady() {
        console.log("Waiting for ThreadpoolManager Worker ready message");
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Worker failed to initialize'));
            }, 50000);

            const checkReady = () => {
                if (this.workerReady) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    }

    /**
     * Start heartbeat monitoring
     */
    startHeartbeatMonitoring() {
        this.lastHeartbeat = Date.now();

        this.heartbeatChecker = setInterval(() => {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;

            if (timeSinceLastHeartbeat > this.heartbeatTimeout) {
                console.error(`Heartbeat timeout - worker is hung`);
                this.handleWorkerFailure('Heartbeat timeout');
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
