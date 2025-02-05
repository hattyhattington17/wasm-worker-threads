

pub fn set_panic_hook() {
    // only compile next line if console_error_panic_hook feature is enabled
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once(); // log panics to console.error
}
