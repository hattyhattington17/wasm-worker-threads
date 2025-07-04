const { ThreadpoolManager } = require('./threadpool-manager.cjs');

async function main() {
    const manager = new ThreadpoolManager({
        timeout: 5000,
        heartbeatTimeout: 2000
    });

    await manager.initWorker();
    try {
        const result = await manager.execute('multithreadedSum', []);
    } catch (error) {
        console.error(`Failed to run function with ThreadpoolManager: ${error.message}`);
    } finally {
        await manager.shutdown();
    }
}

main().catch(console.error);
