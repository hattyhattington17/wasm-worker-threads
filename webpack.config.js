const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const dist = path.resolve(__dirname, "dist");

module.exports = {
  mode: "development",
  experiments: {
    asyncWebAssembly: true,
  },
  entry: {
    index: "./webpack/index.js",
  },
  output: {
    path: dist,
    filename: "[name].js",
  },
  devServer: {
    static: dist,
  },
  plugins: [new CopyPlugin({
    patterns: [path.resolve(__dirname, "webpack")],
  })],
};