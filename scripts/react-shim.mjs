// Scripts only: re-export React's CommonJS server build for ESM callers.
import { createRequire } from "node:module";

const React = createRequire(import.meta.url)("react");
export default React;
export const { cache } = React;
