const { withThreadPool: runInThreadPool } = require('./node-backend.cjs');

// the callback while the rayon threadpool is available
runInThreadPool(async () => {
    console.log("running multithreadedSum with threadpool");
    const { multithreadedSum } = require("./pkg/blog_demo");
    try {
        await multithreadedSum();
        console.log("Executed multithreadedSum with threadpool");
    }
    catch (e) {
        console.log("Failed to execute multithreadedSum with threadpool");
        console.error(JSON.stringify(e, null, 2));
    }
}) 
