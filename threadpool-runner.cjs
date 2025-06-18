/**
 * Creates a “withThreadPool” runner that ensures a WebAssembly thread-pool
 * is initialised before the supplied callback runs and is torn down once
 * no callers remain.
 *
 * @param {Object} lifecycle                             Lifecycle hooks
 * @param {() => Promise<void>} lifecycle.initThreadPool  Initialise the pool
 * @param {() => Promise<void>} lifecycle.exitThreadPool  Tear the pool down
 *
 * @template T
 * @returns {(run: () => (T | Promise<T>)) => Promise<T>}
 *          A wrapper that runs {@code run} while the pool is available.
 */
function CreateThreadPoolRunner({ initThreadPool, exitThreadPool }) {
  // number of callers requesting the thread pool
  let callers = 0;
  let state = /** @type {{
      type: 'none'
        | 'initializing' & { initPromise?: Promise<void> }
        | 'running'
        | 'exiting' & { exitPromise?: Promise<void> }
    }} */ ({ type: 'none' });
     
  return async function withThreadPool(run) {
    // increment callers for every function passed to withThreadPool
    callers++;
    switch (state.type) {
      case 'none': {
        state = { type: 'initializing', initPromise: initThreadPool() };
        break;
      }
      case 'initializing':
      case 'running':
        break;
      case 'exiting': {
        // if another call runs during teardown, wait for exit then reinitialize the pool
        state = { type: 'initializing', initPromise: state.exitPromise.then(initThreadPool) };
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
      callers--;
      if (state.type !== 'running') {
        throw new Error('bug in ThreadPool state machine');
      }

      // if no more callers, tear down the pool
      if (callers < 1) {
        state = { type: 'exiting', exitPromise: exitThreadPool() };
        await state.exitPromise;
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
