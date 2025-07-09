# todo
 - shutdown logic
     - to limit memory usage, we kill the threadpool when it is not processing any requests. Do this from threadpool manager
     - currently it is done by threadpoolrunner calling exitThreadPool
 - combine threadpool host and node backend
 - support for js functions
 - load testing with different threadcounts
 - concurrency testing
