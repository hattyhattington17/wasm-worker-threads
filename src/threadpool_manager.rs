// this file is analogous to rayon.rs in the SDK

use js_sys::Promise;
use spmc::{channel, Receiver, Sender};
use wasm_bindgen::prelude::*;

/// Rayon ThreadPool
static mut THREAD_POOL: Option<rayon::ThreadPool> = None;

/// run an operation in the ThreadPool
pub fn run_in_pool<OP, R>(op: OP) -> R
where
    OP: FnOnce() -> R + Send,
    R: Send,
{
    let pool = unsafe { THREAD_POOL.as_ref().unwrap() };
    pool.install(op)
}
 
/// Wraps SPMC channel used to send Rayon ThreadBuilders to JS workers
#[wasm_bindgen]
pub struct PoolBuilder {
    num_threads: usize,
    sender: Sender<rayon::ThreadBuilder>,
    receiver: Receiver<rayon::ThreadBuilder>,
}


/// Creates SPMC channel to send Rayon ThreadBuilders to JS workers
/// after that, Rayon work-stealing queues handle task scheduling and cross-thread communication internally
#[wasm_bindgen]
impl PoolBuilder {
    // allow JS to configure the number of threads to spawn
    fn new(num_threads: usize) -> Self {
        let (sender, receiver) = channel();
        Self {
            num_threads,
            sender,
            receiver,
        }
    }

    /// expose getter for number of threads to JS
    #[wasm_bindgen(js_name = numThreads)]
    pub fn num_threads(&self) -> usize {
        self.num_threads
    }

    /// expose a raw pointer to the SPMC channel receiver to use on worker startup
    pub fn receiver(&self) -> *const Receiver<rayon::ThreadBuilder> {
        &self.receiver
    }

    /// Build the Rayon pool and send each ThreadBuilder over the SPMC channel
    pub fn build(&mut self) {
        unsafe {
            THREAD_POOL = Some(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(self.num_threads)
                    .spawn_handler(move |thread| {
                        // spawn Rayon threads by sending the ThreadBuilder over the SPMC channel to be processed by a JS worker
                        self.sender.send(thread).unwrap_throw();
                        Ok(())
                    })
                    .build()
                    .unwrap_throw(),
            )
        }
    }
}

/// Entrypoint - Called by JS node-backend to initialize the thread pool with a specified number of threads 
#[wasm_bindgen(js_name = initThreadPool)]
pub fn init_thread_pool(num_threads: usize) -> Promise {
    // Create a PoolBuilder with an SPMC channel for distributing ThreadBuilders to workers.
    // The PoolBuilder exposes a receiver pointer that JavaScript passes to each spawned worker.
    // Each worker then calls wbg_rayon_start_worker with this receiver to join the thread pool.
    start_workers(wasm_bindgen::memory(), PoolBuilder::new(num_threads))
}

/// Called by a JS worker thread to join the Rayon ThreadPool
#[wasm_bindgen]
pub fn wbg_rayon_start_worker(receiver: *const Receiver<rayon::ThreadBuilder>)
where
    Receiver<rayon::ThreadBuilder>: Sync,
{
    // retrieve the SPMC receiver, then use it to receive a Rayon ThreadBuilder
    let receiver = unsafe { &*receiver };
                                                                    
    // run the ThreadBuilder, this will continuously poll for tasks from Rayon's work-stealing queues and block until the pool is shut down
    receiver.recv().unwrap_throw().run();
}

/// called by JS to terminate workers and clear the pool when it is no longer needed
#[wasm_bindgen(js_name = exitThreadPool)]
pub fn exit_thread_pool() -> Promise {
    unsafe {
        let promise = terminate_workers();
        THREAD_POOL = None;
        promise
    }
}

/// FFI bindings to JS functions that spawn and terminate workers
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = startWorkers)]
    fn start_workers(memory: JsValue, builder: PoolBuilder) -> Promise;

    #[wasm_bindgen(js_name = terminateWorkers)]
    fn terminate_workers() -> Promise;
}
