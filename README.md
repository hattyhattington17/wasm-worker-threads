# Multithreaded WASM Node

## Problem
Executing multithreaded code with Rayon compiled to Wasm in a nodejs environment provides insufficient logging to the end user if one of the Rayon worker threads panics. Normally, rayon-core blocks until execution of its tasks in the pool complete and any panics on worker threads are propagated https://github.com/rayon-rs/rayon/blob/ae07384e3e0b238cea89f0c14891f351c65a5cee/rayon-core/src/registry.rs#L495 to the main process. The Wasm Rust target must be compiled with `panic=abort` which prevents propagation of the panic and causes the main thread to block indefinitely. The user doesn't see any error.

## Goal
- User should see an error when a background thread panics
- Rayon threadpool should be launched from a worker thread (ThreadPoolHost), so that panics on worker threads only block the ThreadPoolHost and not the main process
- Main process will monitor heartbeats from ThreadPoolHost and exit if none are detected for a configurable timeout period
- Worker threads can log via PostMessage to the main thread. A message channel is created for each worker, passed from ThreadPoolManager (main process) -> ThreadPoolHost -> Rayon worker thread during threadpool initialization
- Arbitrary JS functions must be executable with the threadpool available. Wasm calls made by the JS functions are proxied into the ThreadPoolHost and tracked by ID via the `wasmProxy` in ThreadPoolManager, then later paired with responses posted by ThreadPoolHost 

# Usage
```shell
npm run node
```
- Uncomment `panic` in lib.rs to see error
- Uncomment log in lib.rs to verify parallel processing

# Components

### ThreadpoolManager 
- Manages the lifecycle of the threadpool and worker threads
- Creates a single reusable WASM proxy that forwards function calls to the ThreadPoolHost
- During `execute()`, temporarily sets `global.__wasmProxy` to enable WASM function routing
- Tracks pending WASM requests with unique callIds for correlation with worker responses
- Automatically shuts down the threadpool when no requests are active

### ThreadPoolHost  
- Worker thread that initializes and hosts the WASM threadpool
- Receives WASM function calls via PostMessage and executes them with threadpool access
- Sends periodic heartbeats to detect worker failures
- Manages Rayon worker threads and shared memory coordination

### ThreadPoolWorker 
- Receives Wasm shared memory, an SPMC receiver, and a unique message channel as `workerData`
- Sends postmessages to the main thread via a the message channel created
- Calls `wasm.wbg_rayon_start_worker(workerData.receiver);` to subscribe to Rayon's task queue, handing control flow to Rayon

### Patch Script (patch-env.js)
- Modifies the wasm-bindgen generated JS file to support proxying calls to the Wasm module through ThreadPoolHost
    - Replaces the `wasm` variable with a dynamic proxy that checks `global.__wasmProxy`
    - falls back to regular Wasm module calls if `global.__wasmProxy` is undefined


# Control Flow
### Build Time
- patch-env.js runs to modify wasm-bindgen's generated Wasm wrapper, adding logic to
    - Create shared memory when the module is loaded on the main thread and use shared memory when the module is loaded from a worker (assumed shared memory is supplied to all workers as workerData)
    - Temporarily replace the Wasm module with a global wasm proxy object (`global.__wasmProxy`) if available. This object is created by the ThreadPoolManager and forwards all Wasm calls as PostMessages to the ThreadPoolHost.
### Runtime
- A singleton ThreadPoolManager is initialized with a Wasm timeout
- A JS function that calls Wasm functions that can be parallelized is passed as a callback to `manager.execute()`
- ThreadPoolManager checks to see if the pool has already been initialized, if not, it triggers initialization of the threadpool by
    - Creating a thread for ThreadPoolHost, supplying the shared Wasm memory
    - Creating message channels for each thread that will be created in the pool
    - PostMessaging the channels to the ThreadPoolHost and signalling the ThreadPoolHost to initialize the threadpool
    - Creating a global wasm proxy object 
    - Begining to monitor for heartbeats
- ThreadPoolHost calls `wasm.initThreadPool` (threadpool_manager.rs) which creates an SPMC channel to send Rayon ThreadBuilders to each worker thread, then calls `startWorkers` (threadpool-host.cjs) 
    - `startWorkers` creates a worker thread for each Rayon thread, passing in shared Wasm memory, the message channel to the main thread, and the SPMC channel as workerData
    - The worker calls `wbg_rayon_start_worker` (threadpool_manager.rs) with the SPMC receiver, which blocks until the receiver receives a Rayon ThreadBuilder
    - After all worker threads have been launched, ThreadPoolHost calls `build()` on the ThreadPoolBuilder, which sends Rayon ThreadBuilders for each thread through the SPMC channel
    - The workers receiver their ThreadBuilders, then run them to trigger continuous polling on Rayon's work stealing queues. After this point, the threads are controlled by Rayon.
- After ThreadPoolHost signals that the pool initialization is complete, the wasm proxy is exposed globally as `global.__wasmProxy`, then the JS function passed to `manager.execute()` is called
    - If the JS function triggers calls to the wasm module, they pass through the wasm-bindgen generated wrapper file (blog_demo.js here) which replaces the reference to the Wasm module with a dynamic reference that will point to the proxy if it is defined
    - Calls made through the Proxy are assigned an ID and stored in `this.pendingWasmRequests` by the ThreadPoolManager, then forwarded to the ThreadPoolHost for execution with the thread pool. The result is posted back to the ThreadPoolManager which resolves pending requests with their results.
    - Once the `pendingWasmRequests` have all been processed, the ThreadPoolManager sends a `terminate` message to the ThreadPoolHost
- ThreadPoolHost destroys the Rayon threadpool by calling `wasm.exitThreadPool()`.


## Architecture
- A singleton ThreadpoolManager is created for the application with a Wasm function timeout
    - JS functions that must execute Wasm calls with access to a threadpool are passed to `manager.execute(() => { /* arbitrary JS */ })`
- When a JS function is passed to the manager, it initializes the threadpool by spawning a thread running the `ThreadPoolHost`, and then signalling `ThreadPoolHost` to spawn the full threadpool
    - ThreadPoolHost runs on a worker thread so that if one of the threads in the pool panics, the main process is not blocked
    - The thread pool is only available to functions executed on the ThreadPoolHost's thread
- The threadpool manager creates a Proxy replacement for the wasm object which forwards all Wasm function calls to the threadpool host and tracks them in the ThreadPoolManager
    - patch-env.js updates the wasm-bindgen generated wrapper for the wasm file to use the proxy instead of the default wasm module object
    - When the JS function being executed by the manager calls a wasm function, the proxy is used which stores the request in ThreadPoolManager's `pendingWasmRequests` so that it can be correlated to a PostMessage from the ThreadPoolHost containing the result
- ThreadPoolHost executes wasm functions from a worker thread which has the threadpool available, then postmessages the result to ThreadPoolManager

# Possible Issues Implementing in SDK
- How does JSOO call wasm functions? Does it go through the wasm-bindgen wrapper? If not, we'd need to proxy whatever object it uses too.
- Are the arguments we pass to our Wasm calls always serializable? I assumed yes because Wasm itself supports such limited datatypes, and the wrapper needs to be able to translate anything passed into it into numbers.
