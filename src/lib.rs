mod threadpool_manager;

use console_error_panic_hook;
use rayon::current_thread_index;
use rayon::prelude::*;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;

/// FFI for functions to log to JS
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = postMessageToMainThread)]
    fn post_message_to_main_thread_js(data: &JsValue);

    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

// calls JS global.postMessageToMainThread (rayon-worker.cjs) which sends a postmessage to the main thread with the given message
fn post_message_to_main_thread(msg: &String) {
    log(format!("rust: post_message_to_main_thread - {}", msg).as_str());
    post_message_to_main_thread_js(&JsValue::from_str(msg));
}

#[wasm_bindgen(start)]
pub fn main_js() {
    // set panic hook on module start
    console_error_panic_hook::set_once();
    log("Wasm module initialized");
}
#[wasm_bindgen(js_name = multithreadedSum)]
pub fn multithreaded_sum() -> i32 {
    // execute sum_mapped in the threadpool
    let v: Vec<i32> = (1..=10).collect();
    threadpool_manager::run_in_pool(|| parallel_sum(v))
}

pub fn parallel_sum(inputs: Vec<i32>) -> i32 {
    inputs.into_par_iter().map(process_entry).sum()
}

/// Simulate some processing on each vector entry, this is always executed on a worker thread
fn process_entry(n: i32) -> i32 {
    let idx = current_thread_index().unwrap_or(0);
    post_message_to_main_thread(&format!("processing: {} on thread {}", n, idx));
    // if n == 3 {
    //     panic!("Simulated panic on worker thread for testing");
    // }
    n
}
