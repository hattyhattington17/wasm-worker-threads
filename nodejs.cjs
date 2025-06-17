const { runInThreadPool } = require('./node-backend.cjs');

runInThreadPool(() => {
    console.log("running multithreadedSum in threadpool");
    const { multithreadedSum } = require("./pkg/blog_demo");
    try {
        multithreadedSum();
        console.log("Executed multithreadedSum in threadpool");
    }
    catch (e) {
        console.log("Failed to execute multithreadedSum in threadpool");
        console.error(JSON.stringify(e, null, 2));
    }
}) 
