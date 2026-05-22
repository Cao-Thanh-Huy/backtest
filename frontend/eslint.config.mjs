import reactPlugin from "eslint-plugin-react";
export default [
  {
    files: ["src/pages/Pipelines.jsx", "src/pages/ConnectorManager.jsx"],
    plugins: { react: reactPlugin },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { document: "readonly", window: "readonly", console: "readonly", setTimeout: "readonly", alert: "readonly", confirm: "readonly", navigate: "readonly" }
    },
    rules: { "no-undef": "error" }
  }
];
