import("../pkg/blog_demo").then(wasm => {
  wasm.greet()
}).catch(console.error);


