const { ThreadpoolManager } = require('./threadpool-manager.cjs');

async function main() {
    const manager = new ThreadpoolManager({
        timeout: 5000
    });

    try {
        const promises = Array.from({ length: 6 }, () => manager.execute('multithreadedSum', []));
        const results = await Promise.all(promises);
        results.forEach((result, index) => {
            console.log(`Result from multithreadedSum ${index + 1}: ${result}`);
        });

        // 2 second wait to let pool shut down
        await new Promise(resolve => setTimeout(resolve, 2000));

        const result7 = await manager.execute('multithreadedSum', []);
        console.log(`Result from multithreadedSum 7: ${result7}`);
    } catch (error) {
        console.error(`Failed to run function with ThreadpoolManager: ${error.message}`);
    }
}

main().catch(console.error);
