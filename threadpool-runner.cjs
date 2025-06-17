/**
 * Wraps a function so it runs with a WebAssembly thread pool:
 *  - makes sure initThreadpool is called before the wrapped function is executed
 *  - Keeps track of concurrent callers
 *  - Tears down the pool when no one else needs it
 *
 * @param {{ initThreadPool(): Promise, exitThreadPool(): Promise }}
 *        lifecycle methods for the WASM thread pool
 * @returns {function(run: Function): Promise<any>} withThreadPool runner
 */
function CreateThreadPoolRunner({ initThreadPool, exitThreadPool }) {
  let state = { type: 'none' };
  // number of nested callers still using the pool
  let isNeededBy = 0;

  return async function withThreadPool(run) {
    // mark that someone needs the pool
    isNeededBy++;
    switch (state.type) {
      case 'none': {
        const initPromise = initThreadPool();
        state = { type: 'initializing', initPromise };
        break;
      }
      case 'initializing':
      case 'running':
        break;
      case 'exiting': {
        // if another call runs during teardown, wait for exit then reinitialize the pool
        const initPromise = state.exitPromise.then(initThreadPool);
        state = { type: 'initializing', initPromise };
        break;
      }
    }

    if (state.type === 'initializing') {
      await state.initPromise;
    }
    state = { type: 'running' };

    let result;
    try {
      // run the user's function with the pool available 
      await run();
    } finally {
      isNeededBy--;
      if (state.type !== 'running') {
        throw new Error('bug in ThreadPool state machine');
      }

      // if no more callers, tear down the pool
      if (isNeededBy < 1) {
        const exitPromise = exitThreadPool();
        state = { type: 'exiting', exitPromise };

        await exitPromise;
        if (state.type === 'exiting') {
          state = { type: 'none' };
        }
      }
    }
    return result;
  };
}

const workers = { numWorkers: undefined };
function setNumberOfWorkers(numWorkers) {
  workers.numWorkers = numWorkers;
}

module.exports = { workers, setNumberOfWorkers, CreateThreadPoolRunner };
