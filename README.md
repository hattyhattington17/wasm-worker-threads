# Multithreaded WebAssembly Node.js Demo

Multithreaded Rust code compiled to WebAssembly in Node.js using worker threads and Rayon.

## Overview

This project showcases:
- **Rust/WebAssembly** with Rayon for parallel processing
- **Node.js Worker Threads** for true multithreading
- **Shared memory** coordination across threads
- **wasm-bindgen** for Rust-JavaScript interoperability

## Architecture

```
Main Thread ←→ Worker Threads
     │              │
WASM Module ←→ WASM Modules
     └──── Shared Memory ────┘
```

## Key Files

- `src/lib.rs` - Main WebAssembly entry point
- `src/threadpool_manager.rs` - Thread pool coordination
- `node-backend.cjs` - Main thread worker management
- `node-worker.cjs` - Worker thread initialization
- `threadpool-runner.cjs` - Lifecycle management
- `patch-env.js` - Shared memory injection

## Getting Started

### Prerequisites
```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
```

### Build and Run
```bash
npm install
npm run node  # Clean, compile, and run
```

### Usage
```javascript
const { withThreadPool } = require('./node-backend.cjs');

await withThreadPool(async () => {
    const { multithreadedSum } = require("./pkg/blog_demo");
    await multithreadedSum();
});
```

## Technical Details

- **Shared Memory**: WebAssembly.Memory with `shared: true`
- **Thread Communication**: SPMC channels for Rayon ThreadBuilder distribution
- **Build Flags**: `+atomics,+bulk-memory` for threading support
- **Memory Management**: Coordinated initialization between main and worker threads

## Build Scripts

- `npm run compile` - Rust → WASM
- `npm run postprocess-node` - Generate Node.js bindings
- `npm run patch-bindgen-node-output` - Inject memory management
- `npm run debug-node` - Run demo

 