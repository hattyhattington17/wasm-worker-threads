# multithreaded wasm demo
# todo
- Can this code be TS or does it need to be JS? (especially the worker itself)
- Does wrapping the thread manager in a worker make error handling possible?
- Why do we initialize the memory in custom JS injected into the wasm-bindgen generates JS wrapper?
  - Check how memory initialization is done in basic node projects
- Why are we only able to log one message from each thread to the main thread inside of `wbg_rayon_start_worker`? After the first log, subsequent ones only print to the thread.
 

# notes
- panicking in a background thread before calling receiver.run() still propagates back up to the main thread and logs the error. The main process still hangs.
- JS worker_threads make calls to postMessage while the multithreaded sum is executing, but the main thread isn't notified of the postmessages until after the sum is complete
- it looks like we can run a single console.log from each background thread and have it print to the main thread, then all subsequent console logs print only to the background thread
  - if we panic, the console.log from the background thread will not make it to the main thread if it's in the same function. Try messing with the logging in console error panic hook to see if this can be changed.
