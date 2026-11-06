import path from "node:path";
import HtmlWebpackPlugin from "html-webpack-plugin";

export default {
  entry: { hub: "./src/hub/main.tsx", settings: "./src/settings/main.tsx" },
  output: {
    path: path.resolve(import.meta.dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  resolve: { extensions: [".ts", ".tsx", ".js"] },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        // Type errors fail the lint job; the bundle only needs the JavaScript.
        options: { transpileOnly: true },
      },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
      { test: /\.woff2?$/, type: "asset/inline" },
    ],
  },
  // The settings panel is a page of its own in the same template, so it has the hub's Content Security Policy.
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/hub/hub.html",
      filename: "hub.html",
      chunks: ["hub"],
      // Lets the end-to-end test see which commit the test organization is really running.
      meta: { "waypoint-commit": process.env.GITHUB_SHA ?? "local" },
    }),
    new HtmlWebpackPlugin({ template: "./src/hub/hub.html", filename: "settings.html", chunks: ["settings"] }),
  ],
  performance: { hints: false },
};
