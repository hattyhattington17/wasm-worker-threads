const { ThreadpoolManager } = require('./threadpool-manager.cjs');

async function main() {
    const manager = new ThreadpoolManager({
        timeout: 5000
    });

    try {
        const result1 = manager.execute('multithreadedSum', []);
        const result2 = manager.execute('multithreadedSum', []);
        const result3 = manager.execute('multithreadedSum', []);
        const result4 = manager.execute('multithreadedSum', []);
        const result5 = manager.execute('multithreadedSum', []);
        const result6 = manager.execute('multithreadedSum', []);

        const results = await Promise.all([result1, result2, result3, result4, result5, result6]);
        results.forEach((result, index) => {
            console.log(`Result from multithreadedSum ${index + 1}: ${result}`);
        });

        // delay 2 seconds to allow for worker threads to process
        await new Promise(resolve => setTimeout(resolve, 2000));

        const result7 = await manager.execute('multithreadedSum', []);
        console.log(`Result from multithreadedSum 7: ${result7}`);
    } catch (error) {
        console.error(`Failed to run function with ThreadpoolManager: ${error.message}`);
    }
}

main().catch(console.error);
