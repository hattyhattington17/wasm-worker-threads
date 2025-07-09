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

if (process.env.threadPoolHostThreadId === undefined) {
  throw new Error("process.env.threadPoolHostThreadId must be set to the threadId of the worker that manages the thread pool hint: did you try to import the wasm wrapper before setting the threadPoolHostThreadId?");
}

if (+process.env.threadPoolHostThreadId === threadId) {
  console.log("Initializing linear memory on thread " + threadId);
  env.memory = new WebAssembly.Memory({
    initial: 20,
    maximum: 10553,
    shared: true,
  });
} else {
  env.memory = workerData.memory;
}

imports['env'] = env;
`
  );
  await fs.writeFile(file, src, 'utf8');
})();
