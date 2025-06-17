use crate::log; 
use js_sys::Promise;
use spmc::{channel, Receiver, Sender};
use wasm_bindgen::prelude::*;

/// rayon threadpool
static mut THREAD_POOL: Option<rayon::ThreadPool> = None;

/// run an operation in the pool
pub fn run_in_pool<OP, R>(op: OP) -> R
where
    OP: FnOnce() -> R + Send,
    R: Send,
{
    let pool = unsafe { THREAD_POOL.as_ref().unwrap() };
    pool.install(op)
}
 
/// builder wraps an spmc channel that sends rayon ThreadBuilder instances to each worker
#[wasm_bindgen]
pub struct PoolBuilder {
    num_threads: usize,
    sender: Sender<rayon::ThreadBuilder>,
    receiver: Receiver<rayon::ThreadBuilder>,
}

/// used by JS to tell the wasm module how many threads to spawn
/// creates spmc channel to hand each spawned worker its rayon ThreadBuilder
/// after that, Rayon work-stealing queues handle task scheduling and cross-thread communication internally
#[wasm_bindgen]
impl PoolBuilder {
    /// Create spmc channel to communicate ThreadBuilders to processes
    fn new(num_threads: usize) -> Self {
        let (sender, receiver) = channel();
        Self {
            num_threads,
            sender,
            receiver,
        }
    }
    
    /// expose number of threads to js
    #[wasm_bindgen(js_name = numThreads)]
    pub fn num_threads(&self) -> usize {
        self.num_threads
    }

    /// expose a raw pointer to the smpc channel receiver to use on worker startup
    pub fn receiver(&self) -> *const Receiver<rayon::ThreadBuilder> {
        &self.receiver
    }
 
    /// Build rayon pool and send each ThreadBuilder over spmc channel
    pub fn build(&mut self) {
        unsafe {
            THREAD_POOL = Some(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(self.num_threads)
                    .spawn_handler(move |thread| {
                        // sends each threadbuilder over the channel to a worker
                        self.sender.send(thread).unwrap_throw();
                        Ok(())
                    })
                    .build()
                    .unwrap_throw(),
            )
        }
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

/// called by JS to init the threadpool and spawn workers with the builder
#[wasm_bindgen(js_name = initThreadPool)]
pub fn init_thread_pool(num_threads: usize) -> Promise {
    log("rust: init_thread_pool");
    // calls into js to start the workers
    start_workers(wasm_bindgen::memory(), PoolBuilder::new(num_threads))
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

/// called by each spawned worker to hook into the rayon pool
#[wasm_bindgen]
pub fn wbg_rayon_start_worker(receiver: *const Receiver<rayon::ThreadBuilder>)
where
    Receiver<rayon::ThreadBuilder>: Sync,
{
    log("rust: wbg_rayon_start_worker");
    let receiver = unsafe { &*receiver };
    receiver.recv().unwrap_throw().run();
}
