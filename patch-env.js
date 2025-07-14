// patches the wasm-bindgen generated JS file to support shared WebAssembly memory in multithreaded nodejs project
// the worker that manages the thread pool (threadpool-host.cjs) will create the shared memory, while other workers will receive it via workerData
// process.env.threadPoolHostThreadId must be set to the threadId of the threadpool-host worker before loading the wasm module

const fs = require('fs/promises');
const file = process.argv[2];

(async () => {
  let src = await fs.readFile(file, 'utf8');
  src = src.replace(
    "imports['env'] = require('env');",
    `
let { isMainThread, workerData, threadId } = require('worker_threads');
let env = {};

// expose the shared memory through the imports object under env
// used from wasm with: (import "env" "memory" (memory 1 2 shared))
if (isMainThread) {
  console.log("Initializing linear memory on main thread");
  env.memory = new WebAssembly.Memory({
    initial: 20,
    maximum: 10553,
    shared: true,
  });
} else {
  env.memory = workerData.memory;
}

// imports is the imports object passed into module instantiation: new WebAssembly.Instance(wasmModule, imports)
imports['env'] = env;
`
  );
  
  // Add WASM proxy code to enable threadpool routing
  src = src.replace(
    /const wasmModule = new WebAssembly\.Module\(bytes\);\nconst wasmInstance = new WebAssembly\.Instance\(wasmModule, imports\);\nwasm = wasmInstance\.exports;\nmodule\.exports\.__wasm = wasm;/,
    `const wasmModule = new WebAssembly.Module(bytes);
const wasmInstance = new WebAssembly.Instance(wasmModule, imports);
const originalWasm = wasmInstance.exports;

// Store original wasm reference
global.__originalWasm = originalWasm;

// Create a function that returns the appropriate wasm object
function getWasm() {
    return global.__wasmProxy || originalWasm;
}

// Replace wasm with a dynamic reference
wasm = new Proxy({}, {
    get(target, prop) {
        return getWasm()[prop];
    },
    has(target, prop) {
        return prop in getWasm();
    },
    ownKeys(target) {
        return Object.keys(getWasm());
    },
    getOwnPropertyDescriptor(target, prop) {
        return Object.getOwnPropertyDescriptor(getWasm(), prop);
    }
});

module.exports.__wasm = originalWasm;`
  );
  
  await fs.writeFile(file, src, 'utf8');
})();
