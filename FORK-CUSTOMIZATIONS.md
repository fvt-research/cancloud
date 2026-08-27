# Fork Customizations (FVT Telematics)

This fork of [CANcloud](https://github.com/cancloud/cancloud) adds four
customizations on top of upstream v07.00.00 (base commit `802e8fe`). Upstream
is adopted as the base: the canonical file set, styles, and Vite/React 18
build are upstream's. The customizations are additive and isolated, so future
upstream merges should be low-conflict.

Fork base tag: `v07.00.00-fvt-1`.

## 1. S3 bucket enumeration + dashboard-first login

Upstream assumes the user knows the bucket name and enters it at login. This
fork enumerates buckets instead: credentials are entered, and a backend
proxy lists all buckets in the account; the login screen and browser header
offer a dropdown of them.

Backend (custom, fork-only files):
- `server.js` — Express production server that also exposes
  `POST /api/list-buckets` (uses `aws-sdk` directly, supports CA-bundle /
  insecure-TLS env config: `S3_PROXY_CA_BUNDLE`, `S3_PROXY_INSECURE_TLS`)
- `docker-compose.yml` + `Dockerfile` — Vite build into `site/`, run via
  `node server.js`

Frontend wiring (edits to shared upstream files):
- `src/browser/js/buckets/actions.js:371,384` — `fetchS3Buckets()` thunk
  POSTs the session's credentials to `/api/list-buckets`
- `src/browser/js/buckets/reducer.js:38,107` — `s3buckets` state field
- `src/browser/js/browser/BucketComboBox.js` (new) — bucket dropdown
- `src/browser/js/browser/Login.js` — fetch buckets at login; dropdown in the
  login form
- `src/browser/js/browser/Host.js:61,64,152` — props plumbing
- `src/browser/js/web.js:192` + `src/browser/js/jsonrpc.js:155` —
  `listS3Buckets` dispatch
- `src/sdk/s3explorer.js:586,830` + `src/sdk/aws-sdk-client.js` — SDK-level
  `listBuckets` (region auto-resolved from AWS service endpoint)
- `vite.config.mjs` — `s3BucketListApi()` dev-server middleware so `Vite dev`
  mirrors the production endpoint

## 2. Per-dashboard auto-refresh

Each status-dashboard can be configured with a refresh interval; a timer
re-polls while that dashboard view is open.

- `src/browser/js/dashboardStatus/autoRefresh.js` (new, 20 lines) —
  module-level handler registry (`setDashboardAutoRefreshHandlers`,
  `getDashboardAutoRefreshHandlers`)
- `src/browser/js/browser/AutoRefreshBar.js` (new, 165 lines) — interval
  picker + countdown; reads the registry to trigger re-fetch
- `src/browser/js/dashboardStatus/DashboardStatusSection.js` — sets/clears
  the handlers on mount/unmount

## 3. Logo navigation → dashboards

Clicking the CANcloud logo navigates to the status dashboard
(`/status-dashboard/`) instead of doing nothing.

- `src/browser/js/browser/SideBar.js`, `Header.js` (via `MobileHeader.js`
  pattern) — logo wrapped in a click handler pushing `/status-dashboard/`
- Route target is the upstream status dashboard component tree under
  `src/browser/js/dashboardStatus/`

## 4. UNSAFE_ method renames — resolved by the base

Upstream v07.00.00 already removes all `UNSAFE_*` usages (React 18, modern
Vite, class components kept clean). No fork action required; listed for
history completeness.

## Shared upstream files touched by the fork

| File | Fork change |
|---|---|
| `buckets/actions.js`, `buckets/reducer.js` | `fetchS3Buckets` thunk + `s3buckets` state |
| `browser/Login.js`, `browser/Host.js` | bucket dropdown + props |
| `browser/SideBar.js`, `browser/MobileHeader.js` | logo → dashboard nav |
| `browser/Header.js`, `BrowserDropdown.js`, `ChangePasswordModal.js`, `DeviceMetaHeaderContainer.js` | layout/style adjustments around the above |
| `web.js`, `jsonrpc.js` | `listS3Buckets` dispatch |
| `sdk/s3explorer.js`, `sdk/storage.js`, `sdk/aws-sdk-client.js` | `listBuckets` + region resolution |
| `less/*.less` | login/sidebar style for dropdown + logo |
| `schema/demo-credentials.default.json` | demo region field |
| `package.json` | `express ^4.21.2` (server.js dep) |

## Verification status (at tag `v07.00.00-fvt-1`)

- `npm test` (vitest): 33/33 files, 376 passed / 1 skipped
- `npm run build`: clean (3650 modules, only chunk-size advisory)
- Smoke test: `server.js` on :3000, `POST /api/list-buckets` functional
  (returns expected credential error with bad keys), static site 200

## Re-applying on a future upstream merge

1. `git fetch upstream && git merge upstream/master`
2. Expected conflicts: `Login.js`, `Host.js`, `bucket actions/reducer`,
   `SideBar.js` / `MobileHeader.js` (logo), `package.json`
3. Resolve toward: keep upstream layout/style; keep the fork's bucket
   dropdown, logo nav, auto-refresh, and `listS3Buckets` dispatch
4. `server.js`, `AutoRefreshBar.js`, `BucketComboBox.js`,
   `dashboardStatus/autoRefresh.js` are fork-only files — conflicts unlikely
5. Re-run `npm test` and `npm run build`
6. Tag `v<upstream>-fvt-1`
