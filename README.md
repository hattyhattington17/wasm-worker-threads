# Wasm Demo

## Using a Wasm module in Node, Browser, and Webpack applications

This repo demonstrates building a Rust library into a Wasm module with `wasm-pack` and consuming the Wasm module from nodejs, vanilla JS in a browser, and an application built with webpack.

Usage:

```bash
npm i
npm i -g wasm-pack
```

- Build bindings for the module to execute in a browser environment and launch a dev server with `npm run web`
- Use the module from node with `npm run node`
- Build bindings for the module to execute in a project built with webpack with `npm run webpack`

## WebAssembly Text Format

- View the text representation of the Wasm module with `npm run wasm2wat`
  - You must build the module first with one of the above commands
  - Requires `brew install wabt`
  - The resulting WAT file will be at `./blog_demo_bg.wat`

## Debugging

Building the application with the `dev` profile causes `wasm-bindgen` to include DWARF debug info which can be used to step through the Rust source code in a debugger when the Wasm module is called into.

```toml
[package.metadata.wasm-pack.profile.dev.wasm-bindgen]
dwarf-debug-info = true
```

- To debug the nodejs code from VSCode
  - install [wasm-dwarf-debugging](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-dwarf-debugging) a
  - run `npm run node` from the JavaScript debug terminal
  - Stepping into calls into the Wasm module should bring you to the Rust sources.

- To use the DWARF output for debugging in a browser
  - install [this extension](https://chromewebstore.google.com/detail/cc++-devtools-support-dwa/pdcpmagijalfljmkmjngeonclgbbannb).
  - run `npm run web`
