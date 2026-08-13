import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'node:fs/promises'

// difflib (dep of react-gh-like-diff, pulled in via config-editor-base) assigns
// to function.name, a read-only property: harmless in sloppy-mode CJS (webpack),
// throws under Vite's strict-mode ESM. Stripping is behavior-identical.
// Copied from config-editor/vite.config.js.
// Throws rather than silently no-opping: if a difflib bump ever changes the
// wording, the build must fail loudly instead of reintroducing the crash.
const stripDifflibNameAssignments = (code) => {
  const patched = code.replace(/\b\w+\.name\s*=\s*'\w+';?/g, ';')
  if (patched === code) {
    throw new Error(
      'patch-difflib-strict-mode: no function.name assignment found - difflib changed, re-check the patch'
    )
  }
  return patched
}

const esbuildPatchDifflib = {
  name: 'patch-difflib-strict-mode',
  setup(build) {
    build.onLoad({ filter: /difflib[\\/]lib[\\/]difflib\.js$/ }, async (args) => {
      const code = await fs.readFile(args.path, 'utf8')
      return { contents: stripDifflibNameAssignments(code), loader: 'js' }
    })
  }
}

const rollupPatchDifflib = {
  name: 'patch-difflib-strict-mode',
  enforce: 'pre',
  transform(code, id) {
    if (/difflib[\\/]lib[\\/]difflib\.js(\?(?!commonjs-)|$)/.test(id)) {
      return { code: stripDifflibNameAssignments(code), map: null }
    }
  }
}

// react-overlays 0.8 (react-bootstrap 0.32 dropdowns/overlays) self-closes on
// the same click that opens it under React 18: events now delegate at #root
// instead of document, so the click keeps bubbling to document AFTER the
// RootCloseWrapper listeners attach, and the capture-phase guard never saw it.
// Backport of the upstream fix (react-overlays#833): remember the event that
// was dispatching when the listeners were attached and ignore exactly that one.
// Throws rather than silently no-opping: without this guard a react-overlays
// bump would quietly revert the fix and dropdowns would close on open again.
// Each step is checked separately - a half-applied patch is as broken as none.
const replaceOrThrow = (code, find, replacement, what) => {
  if (!code.includes(find)) {
    throw new Error(
      `patch-root-close-wrapper-react18: ${what} not found - react-overlays changed, re-check the patch`
    )
  }
  return code.replace(find, replacement)
}

const patchRootCloseWrapper = (code) => {
  code = replaceOrThrow(
    code,
    "_this.documentMouseListener = (0, _addEventListener2.default)(doc, event, _this.handleMouse);",
    "_this.currentEvent = typeof window !== 'undefined' ? window.event : undefined;\n      _this.documentMouseListener = (0, _addEventListener2.default)(doc, event, _this.handleMouse);",
    'listener attach site'
  )
  return replaceOrThrow(
    code,
    "if (!_this.preventMouseRootClose && _this.props.onRootClose) {",
    "if (e !== _this.currentEvent && !_this.preventMouseRootClose && _this.props.onRootClose) {",
    'onRootClose guard'
  )
}

// The id may carry a ?query suffix, but must NOT match @rollup/plugin-commonjs'
// synthetic ?commonjs-* proxies - those carry stub content, not the real
// source, and would trip the patch guard above.
const ROOT_CLOSE_FILE = /react-overlays[\\/]lib[\\/]RootCloseWrapper\.js(\?(?!commonjs-)|$)/

const rollupPatchRootClose = {
  name: 'patch-root-close-wrapper-react18',
  enforce: 'pre',
  transform(code, id) {
    if (ROOT_CLOSE_FILE.test(id)) {
      return { code: patchRootCloseWrapper(code), map: null }
    }
  }
}

const esbuildPatchRootClose = {
  name: 'patch-root-close-wrapper-react18',
  setup(build) {
    build.onLoad({ filter: /react-overlays[\\/]lib[\\/]RootCloseWrapper\.js$/ }, async (args) => {
      const code = await fs.readFile(args.path, 'utf8')
      return { contents: patchRootCloseWrapper(code), loader: 'js' }
    })
  }
}

// webpack 4 had `node: { fs: "empty" }` - the sdk imports fs but only uses it
// in Node-only code paths (fGetObject/fPutObject) that the browser app never
// calls. vite-plugin-node-polyfills maps fs to a null default, which crashes
// the ESM interop at import time, so stub it with an empty object instead.
const FS_STUB = 'const fs = {}; export default fs; export const promises = {};'

const rollupFsStub = {
  name: 'fs-empty-stub',
  enforce: 'pre',
  resolveId(id) {
    if (id === 'fs' || id === 'node:fs') return '\0fs-empty-stub'
  },
  load(id) {
    if (id === '\0fs-empty-stub') return FS_STUB
  }
}

const esbuildFsStub = {
  name: 'fs-empty-stub',
  setup(build) {
    build.onResolve({ filter: /^(node:)?fs$/ }, () => ({
      path: 'fs-empty-stub',
      namespace: 'fs-empty-stub'
    }))
    build.onLoad({ filter: /.*/, namespace: 'fs-empty-stub' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js'
    }))
  }
}

// One config, three modes:
//   (default / development)  -> main CANcloud app, outDir site/
//   --mode simple            -> offline single-file editor, outDir simple/
//   mode 'test'              -> vitest (real node builtins, no polyfills)
export default defineConfig(({ mode }) => {
  const simple = mode === 'simple'
  const test = mode === 'test'
  return {
    base: './',
    publicDir: simple ? false : 'public', // public/customize-css (was CopyWebpackPlugin)
    plugins: [
      rollupPatchDifflib,
      rollupPatchRootClose,
      ...(test ? [] : [rollupFsStub]),
      // browser bundles need the node polyfills (sdk/minio/aws-sdk use
      // crypto/stream/http/Buffer/process); vitest runs on real node builtins
      ...(test
        ? []
        : [nodePolyfills({ globals: { Buffer: true, global: true, process: true } })]),
      react(),
      {
        // Both modes share the single src/browser/index.js entry - the offline
        // build differs only by mode-specific config, so there is no separate
        // simple.js entry (a late transformIndexHtml hook could not swap it
        // anyway: Vite resolves HTML entries before normal hooks run).
        name: 'html-entry-title',
        transformIndexHtml: (html) =>
          html.replace('%TITLE%', simple ? 'Configuration Editor' : 'CANcloud')
      },
      ...(simple
        ? [
            viteSingleFile({ removeViteModuleLoader: true }),
            {
              // the crossorigin attribute on the inlined module script makes
              // Chrome log an "unsafe attempt to load URL" error under file://
              name: 'strip-crossorigin',
              transformIndexHtml: {
                order: 'post',
                handler: (html) =>
                  html.replace(/<script type="module" crossorigin/g, '<script type="module"')
              }
            }
          ]
        : [])
    ],
    resolve: {
      // aws-sdk v2's source entry is a web of circular CJS requires; Rollup's
      // commonjs interop breaks their ordering in prod builds (AWS.STS is
      // undefined when its customization runs -> crash before mount). The
      // prebuilt browser bundle is a single correctly-ordered file.
      alias: [{ find: /^aws-sdk$/, replacement: 'aws-sdk/dist/aws-sdk.js' }],
      // NOTE: no 'react-select' here - react-multiselect-checkboxes must keep
      // resolving its own nested react-select@2 (deep-imports ./lib/theme,
      // which v5's exports map does not expose)
      dedupe: ['react', 'react-dom', 'react-redux']
    },
    css: {
      // Bootstrap 3 LESS uses slash division; less 4 defaults to parens-division
      preprocessorOptions: { less: { math: 'always' } }
    },
    server: {
      port: 8080,
      open: true
    },
    build: simple
      ? {
          outDir: 'simple',
          modulePreload: { polyfill: false },
          assetsInlineLimit: 100000000,
          chunkSizeWarningLimit: 20000
        }
      : {
          outDir: 'site',
          chunkSizeWarningLimit: 8000
        },
    optimizeDeps: {
      esbuildOptions: {
        loader: { '.js': 'jsx' },
        // node/webpack/rollup resolve .js before .jsx; esbuild defaults to
        // .jsx-first, which picks up react-multiselect-checkboxes' broken raw
        // .jsx sources instead of its compiled lib/*.js
        resolveExtensions: ['.mjs', '.js', '.jsx', '.json'],
        plugins: [esbuildFsStub, esbuildPatchDifflib, esbuildPatchRootClose]
      }
    },
    // CRA/webpack-era JSX inside .js files
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.js$/,
      exclude: []
    }
  }
})
