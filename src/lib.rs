mod threadpool_manager;

use console_error_panic_hook;
use rayon::current_thread_index;
use rayon::prelude::*;
use wasm_bindgen::prelude::*;

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
    log("Hello, World!");
    // execute sum_mapped in the threadpool
    let x = threadpool_manager::run_in_pool(|| {
        sum_mapped(vec![1,2,3])
    });
    log(&format!("result {:?}", x));
}

fn process_number(n: i32) -> i32 {
    let idx = current_thread_index().unwrap_or(0);
    log(&format!("processing: {} on thread {}", n, idx)); 
    n
}

#[wasm_bindgen]
pub fn sum_mapped(inputs: Vec<i32>) -> i32 {
    inputs.into_par_iter().map(process_number).sum()
}
