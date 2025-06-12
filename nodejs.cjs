const { withThreadPool, workers } = require('./node-backend.cjs');

withThreadPool(() => {
    console.log("running greet in threadpool");
    const { greet } = require("./pkg/blog_demo");
    greet();
})
