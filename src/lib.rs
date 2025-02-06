mod utils; // include utils module

use crate::utils::set_panic_hook;
use wasm_bindgen::prelude::*; // import set_panic_hook as top level function in current scope

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}



#[wasm_bindgen]
pub fn greet() {
    log("Hello, World!");
    set_panic_hook();
}
