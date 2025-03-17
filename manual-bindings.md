# Manual Wasm compilation and bindings generation
- Build `wasm32-unknown-unknown` binary with no bindings
```shell
cargo build --release --target wasm32-unknown-unknown
```
- Build JavaScript bindings for a `wasm32` binary
```shell
cargo install -f wasm-bindgen-cli
wasm-bindgen target/wasm32-unknown-unknown/release/blog_demo.wasm --out-dir bindings/wasm32-bindings 
```

# Building `wasm64-unknown-unknown` binary
- Build `wasm64-unknown-unknown` binary with no bindings
```shell
cargo +nightly build --release -Z build-std=std,core,alloc,panic_abort --target wasm64-unknown-unknown
```

# Building Wasm64 Bindings (WIP)
- `wasm-bindgen` doesn't currently support generating bindings for a `wasm64` binary, running with the CLI will fail:
```shell
wasm-bindgen target/wasm64-unknown-unknown/release/blog_demo.wasm --out-dir bindings/wasm64-bindings 
# error: invalid offset for segment of function table Value(I64(1))
```
## Using a local `wasm-bindgen` cli
- build the cli
```shell
cd ../wasm-bindgen 
cargo build --package wasm-bindgen-cli
```
- call the executable binary in the build output and pass in the wasm that you need to generate bindings for (the compiled wasm for this project)
```shell
../wasm-bindgen/target/debug/wasm-bindgen target/wasm32-unknown-unknown/release/blog_demo.wasm --out-dir bindings/wasm32-bindings 
../wasm-bindgen/target/debug/wasm-bindgen target/wasm64-unknown-unknown/release/blog_demo.wasm --out-dir bindings/wasm64-bindings 
```
- Generate .wat representations of the wasm modules
    - `wasm-tools` is required for `wasm64` binaries, `wbt` doesn't support the latest features in the spec
```shell
cargo install wasm-tools
wasm-tools print target/wasm64-unknown-unknown/release/blog_demo.wasm  -o wasm64.wat 
wasm-tools print target/wasm32-unknown-unknown/release/blog_demo.wasm  -o wasm32.wat 
```
