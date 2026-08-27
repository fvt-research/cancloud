import { defineConfig } from 'vite'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
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

// dev-only replacement for the old webpack devServer proxy ("/api": localhost:3000)
// and the server.js /api/list-buckets handler: answers bucket-listing directly
// in the vite dev server so `npm start` alone works without a second process.
const s3BucketListApi = () => ({
  name: 's3-bucket-list-api',
  configureServer(server) {
    server.middlewares.use('/api/list-buckets', (req, res, next) => {
      if (req.method !== 'POST') return next()
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', async () => {
        const https = require('node:https')
        const fs = require('node:fs')
        try {
          const { accessKey, secretKey, endPoint, region: regionBody } = JSON.parse(body || '{}')
          if (!accessKey || !secretKey || !endPoint) {
            res.statusCode = 400
            res.setHeader('content-type', 'application/json')
            return res.end(JSON.stringify({ error: 'accessKey, secretKey and endPoint are required' }))
          }
          const m = endPoint.match(/^https?:\/\/s3\.([a-z0-9-]+)\.amazonaws\.com\/?$/i)
          const cfg = {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
            signatureVersion: 'v4'
          }
          if (m) {
            cfg.region = regionBody || m[1]
          } else {
            if (regionBody) cfg.region = regionBody
            cfg.endpoint = endPoint
            cfg.s3ForcePathStyle = true
            if (/^https:/i.test(endPoint)) {
              const caBundles = [
                '/etc/ssl/certs/ca-certificates.crt',
                '/etc/ssl/cert.pem'
              ].filter((p) => fs.existsSync(p))
              cfg.httpOptions = {
                agent: new https.Agent(caBundles.length ? { ca: fs.readFileSync(caBundles[0]) } : { rejectUnauthorized: false })
              }
            }
          }
          const AWS = require('aws-sdk')
          const data = await new AWS.S3(cfg).listBuckets().promise()
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ buckets: (data.Buckets || []).map((b) => b.Name) }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: String((err && err.message) || err), code: (err && err.code) || 'UNKNOWN' }))
        }
      })
    })
  }
})

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
      ...(test ? [] : [s3BucketListApi()]),
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
