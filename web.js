(async () => {
  // Dynamically import the wasm-pack generated JS module
  const {initSync} = await import('./pkg/blog_demo.js');

  // Fetch the WASM file and convert it into an ArrayBuffer
  const response = await fetch("./pkg/blog_demo_bg.wasm");
  const bytes = await response.arrayBuffer();

  // Initialize WebAssembly synchronously with the correct buffer format
  let wasm = initSync({module: bytes});

  // Call an exported function (modify as needed)
  wasm.greet();

  console.log("WASM Loaded:", wasm);
})();
