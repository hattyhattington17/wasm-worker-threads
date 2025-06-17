const { runInThreadPool, workers } = require('./node-backend.cjs');

runInThreadPool(() => {
    console.log("running greet in threadpool");
    const { greet } = require("./pkg/blog_demo");
    try {
        greet();
        console.log("Executed greet in threadpool");
    }
    catch (e) {
        console.log("Failed to execute greet in threadpool");
        console.error(JSON.stringify(e, null, 2));
    }
}) 
