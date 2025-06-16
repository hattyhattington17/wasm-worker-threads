mod threadpool_manager;

use console_error_panic_hook;
use rayon::current_thread_index;
use rayon::prelude::*;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;

use wasm_bindgen::JsCast;
use web_sys;

fn post_message_to_main_thread(msg: &String) {
    log(format!("post_message_to_main_thread: {}", msg).as_str());
    postMessageToMain(&JsValue::from_str(msg));
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = postMessage)]
    fn postMessageToMain(data: &JsValue);
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

#[wasm_bindgen(start)]
pub fn main_js() {
    // setting the panic hook on the module start seems to be sufficient, no need to set per thread
    console_error_panic_hook::set_once();
    log("WASM module initialized.");
}
#[wasm_bindgen]
pub fn greet() {
    // execute sum_mapped in the threadpool
    // panic!("panic on main thread");
    let x = threadpool_manager::run_in_pool(|| sum_mapped(vec![1, 2, 3]));
    log(&format!("result {:?}", x));
}

fn process_number(n: i32) -> i32 {
    let idx = current_thread_index().unwrap_or(0);
    post_message_to_main_thread(&format!("processing: {} on thread {}", n, idx));
    // panic!("panic on bg thread for testing");
    n
}

#[wasm_bindgen]
pub fn sum_mapped(inputs: Vec<i32>) -> i32 {
    inputs.into_par_iter().map(process_number).sum()
}
