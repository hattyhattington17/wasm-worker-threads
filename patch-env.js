const fs = require('fs/promises');
const file = process.argv[2];

(async () => {
    let src = await fs.readFile(file, 'utf8');
    src = src.replace(
        "imports['env'] = require('env');",
        `
let { isMainThread, workerData, threadId } = require('worker_threads');
let env = {};
if (+process.env.workerManagerThread === threadId) {
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
