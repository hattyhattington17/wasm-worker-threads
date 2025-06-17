mod threadpool_manager;

use console_error_panic_hook;
use rayon::current_thread_index;
use rayon::prelude::*;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;


#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = postMessage)]
    fn post_message_to_main_thread_js(data: &JsValue);

    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

fn post_message_to_main_thread(msg: &String) {
    log(format!("rust: post_message_to_main_thread - {}", msg).as_str());
    post_message_to_main_thread_js(&JsValue::from_str(msg));
}

#[wasm_bindgen(start)]
pub fn main_js() {
    // set panic hook on module start, no need to set separately in thread startup code
    console_error_panic_hook::set_once();
    log("Wasm module initialized");
}
#[wasm_bindgen(js_name = multithreadedSum)]
pub fn multithreaded_sum() {
    // panic!("panic on main thread");
    // execute sum_mapped in the threadpool
    let x = threadpool_manager::run_in_pool(|| sum_mapped(vec![1, 2, 3]));
    log(&format!("Result {:?}", x));
}

pub fn sum_mapped(inputs: Vec<i32>) -> i32 {
    inputs.into_par_iter().map(process_number).sum()
}

fn process_number(n: i32) -> i32 {
    let idx = current_thread_index().unwrap_or(0);
    post_message_to_main_thread(&format!("processing: {} on thread {}", n, idx));
    // panic!("panic on background thread");
    n
}

