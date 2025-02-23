# Wasm Demo
Demonstrates building a Rust library into a Wasm module with `wasm-pack` and consuming the Wasm module from nodejs, vanilla JS in a browser, and an application built with webpack.
- Build bindings for the module to execute in a browser environment and launch a dev server with `npm run web`
- Use the library from node with `npm run node`
- Build bindings for the module to execute in a project built with webpack with `npm run webpack`

# WebAssembly Text Format
- View the text representation of the Wasm module with `npm run wasm2wat`
    - You must build the module first with one of the above commands
    - The resulting WAT file will be at `./blog_demo_bg.wat`

# Debugging
Building the application with the `dev` profile causes `wasm-bindgen` to include DWARF debug info which can be used to step through the Rust source code in a debugger when the Wasm module is called into.

```toml
[package.metadata.wasm-pack.profile.dev.wasm-bindgen]  
dwarf-debug-info = true
```


> Note: To use the DWARF output for debugging in a browser, install [this extension](https://chromewebstore.google.com/detail/cc++-devtools-support-dwa/pdcpmagijalfljmkmjngeonclgbbannb) Currently the DWARF debug extension is having problems loading Rust sources into the browser so this may not work. Debugging should still work in an editor.