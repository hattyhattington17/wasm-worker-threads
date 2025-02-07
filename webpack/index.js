import("../pkg").then(wasm => {
  wasm.greet()
}).catch(console.error);


