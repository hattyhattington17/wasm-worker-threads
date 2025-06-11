use rayon::prelude::*;
use rayon::current_thread_index; 
use console_error_panic_hook;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

#[wasm_bindgen(start)]
pub fn main_js() {
    console_error_panic_hook::set_once();
    log("WASM module initialized.");
}
#[wasm_bindgen]
pub fn greet() {
    log("Hello, World!");
    sum_mapped(vec![1, 2, 3, 4, 5]);
}

// executed in worker thread, logs the thread index
fn heavy_work(n: i32) -> i32 {
    let idx = current_thread_index().unwrap_or(0);
    log(&format!("processing: {} on thread {}", n, idx));
    // panic!("panic in background thread");
    (0..n).fold(0, |acc, i| acc + i)
}

#[wasm_bindgen]
// mutlithreaded function that sums a vector of integers
pub fn sum_mapped(inputs: Vec<i32>) -> i32 {
    inputs.into_par_iter().map(|n| heavy_work(n)).sum()
}
