const { ThreadpoolManager } = require('./threadpool-manager.cjs');
const wasm = require('./pkg/blog_demo.js');

async function main() {
    const manager = new ThreadpoolManager({
        timeout: 5000
    });

    // Example 1: Execute 6 multithreadedSum calls in parallel
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        manager.execute(async () => await wasm.multithreadedSum())
    ));
    results.forEach((result, index) => console.log(`Result from function ${index + 1}: ${result}`));

    // 2 second wait to let pool shut down
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Example 2: Function with closed-over values
    const multiplier = 5;
    const result7 = await manager.execute(async () => {
        const sum = await wasm.multithreadedSum();
        return sum * multiplier;
    });
    console.log(`Result from function 7: ${result7}`);

}

main();
