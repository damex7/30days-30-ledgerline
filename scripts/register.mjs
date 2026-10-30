// Lets plain Node run the TypeScript scripts (seed, check) against the real
// app modules. Node strips the types itself; this hook resolves the "@/..."
// alias and extensionless imports the way the Next.js bundler does.
//   node --conditions=react-server --import ./scripts/register.mjs scripts/x.mts
// (--conditions=react-server makes "server-only" resolve to its empty build.)

import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shim = pathToFileURL(join(root, "scripts", "react-shim.mjs")).href;

const isFile = (p) => existsSync(p) && statSync(p).isFile();

registerHooks({
  resolve(specifier, context, next) {
    // next/headers, next/navigation ... are CommonJS files without an exports map.
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
    // React's server build is CommonJS; Node can't see its named export
    // `cache` from ESM, so our own files get a small re-exporting shim.
    const fromOurCode = context.parentURL?.startsWith("file:") && !context.parentURL.includes("node_modules");
    if (specifier === "react" && fromOurCode && context.parentURL !== shim) return next(shim, context);

    let base = null;
    if (specifier.startsWith("@/")) base = join(root, specifier.slice(2));
    else if (fromOurCode && (specifier.startsWith("./") || specifier.startsWith("../"))) {
      base = join(dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base) {
      for (const file of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts")]) {
        if (isFile(file)) return next(pathToFileURL(file).href, context);
      }
    }
    return next(specifier, context);
  },
});
