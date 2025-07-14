const { ThreadpoolManager } = require('./threadpool-manager.cjs');
const wasm = require('./pkg/blog_demo.js');

async function main() {
    const manager = new ThreadpoolManager({
        timeout: 5000
    });

    try {
        // Example 1: Execute JS functions that call WASM directly
        const promises = Array.from({ length: 6 }, (_, i) =>
            manager.execute(async () => {
                console.log(`Executing function ${i + 1}`);
                // Direct WASM call - no proxy parameter needed!
                const result = await wasm.multithreadedSum();
                return result + i;
            })
        );
        const results = await Promise.all(promises);
        results.forEach((result, index) => {
            console.log(`Result from function ${index + 1}: ${result}`);
        });

        // 2 second wait to let pool shut down
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Example 2: Function with closed-over values and direct WASM calls
        const multiplier = 5;
        const localData = { value: 100 };
        
        const result7 = await manager.execute(async () => {
            console.log(`Executing with closed-over multiplier: ${multiplier}`);
            console.log(`Local data value: ${localData.value}`);
            
            // Direct WASM calls work seamlessly
            const sum1 = await wasm.multithreadedSum();
            const sum2 = await wasm.multithreadedSum();
            
            // Can use closed-over variables
            return (sum1 + sum2) * multiplier + localData.value;
        });
        console.log(`Result from function 7: ${result7}`);
    } catch (error) {
        console.error(`Failed to run function with ThreadpoolManager: ${error.message}`);
    }
}

main().catch(console.error);
