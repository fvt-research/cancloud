# CANcloud - Open Source Telematics Platform

CANcloud is an open source S3 browser for managing your [CANedge2](https://www.csselectronics.com/products/can-bus-data-logger-wifi-canedge2)/[CANedge3](https://www.csselectronics.com/products/can-bus-data-logger-4g-lte-canedge3-gnss) CAN loggers and data. 

The tool is a simple front-end that can be hosted on a web server and accessed via your browser. No backend functionality is included - the backend is purely your own S3 bucket.

At [CSS Electronics](https://www.csselectronics.com), we always host the [latest version of CANcloud](https://canlogger.csselectronics.com/cancloud/) - but you can build, customize & host it yourself as well.

---

### Key features 

```
1. Securely login to any S3 server by providing your endpoint, credentials and bucket name
2. List all objects within an S3 bucket in a folder structure hierarchy
3. Easily navigate between connected CANedge2/CANedge3 devices via the sidebar
4. Download, share & delete objects - or upload files (e.g. firmware.bin or certs_server.p7b for over-the-air updates)
5. Configure CANedge devices via an online editor - and submit for easy over-the-air updates
6. Encrypt configuration passwords using the built-in encryption tool
7. Batch-update your fleet over-the-air via the OTA batch manager (configuration, firmware or TLS certificates) with a sortable & searchable device table
8. Monitor your fleet via the status dashboard, incl. a sortable device table
9. Add device meta data (incl. pictures and searchable meta name)
10. Easily customize the portal with your own logo and CSS styling (see `index.html` and `public/customize-css/`)

```
---

### OTA batch manager

The OTA batch manager rolls a single change out across many CANedge devices in one pass. It offers three mutually exclusive modes:

- **Configuration**: Load a partial configuration file (or transfer one from the configuration editor) and apply only those fields on top of each device's current configuration - optionally encrypting all plain-text passwords
- **Firmware**: Load a `firmware.bin` and push it to every compatible device, migrating the configuration to the new firmware revision where required
- **TLS**: Deploy a `certs_server.p7b` to each device's root folder

Every device is validated individually before anything is written - incompatible devices are greyed out with an explanation, and the resulting configuration can be downloaded per device for review. The device table can be searched by device ID, meta name, device type, firmware version and status - and every column can be sorted. This makes it easy to isolate a cohort (e.g. all devices on firmware `01.07.07`), select it via the master checkbox and submit the updates in one batch.

---

### Status dashboard

The status dashboard summarises your fleet in charts and KPIs - and lists every device in a table covering device ID, type, meta name, password encryption state, last heartbeat, firmware version, SD storage used, configuration sync state and uploaded log data. Every column can be sorted by clicking its header (clicking again reverses the order), which makes it easy to spot e.g. the devices that have not checked in recently, the ones running an outdated firmware or the ones still holding plain-text passwords. Devices with no data for the sorted column stay at the bottom in both directions.

---

### Documentation

For more details on CANcloud and the CANedge2 see below:  
- [CANcloud intro](https://www.csselectronics.com/pages/cancloud-telematics-platform)  
- [CANcloud docs](https://canlogger.csselectronics.com/canedge-getting-started/ce2/transfer-data/server-tools/cancloud-intro)  
- [CANedge2 2 x CAN/LIN logger with WiFi](https://www.csselectronics.com/products/can-bus-data-logger-wifi-canedge2)  
- [CANedge3 2 x CAN/LIN logger with 3G/4G](https://www.csselectronics.com/products/can-bus-data-logger-4g-lte-canedge3-gnss)
---
### Simple self-hosting
You can easily host CANcloud on your own web server by unzipping the latest release contents to your target folder. 

#### Style customization 
If you wish to customize your self-hosted version of CANcloud, you can do so without building the tool. To add your own logo, simply replace the logo files in the `images/` folder. Further, in the `customize-css` folder you'll find a `customize.css` file that lets you easily modify the most relevant styles to create custom branding for your self-hosted CANcloud solution.

---

### Installation

#### Deployment (development mode)

1. Clone the repository
2. Run `npm install` in the folder to install application dependencies (requires `node >= 20`, tested on `node: 'v24.13.0'`)
3. Run `npm start` to run application in development mode (Vite dev server on http://localhost:8080)

#### Deployment (production) 

1. Run `npm run build`
2. Copy the contents of the `site` folder to your web server 

You can now access your own self-hosted version of CANcloud - incl. any customizations made. 

#### Example of login details 
If you have set up e.g. an AWS S3 server and bucket, your login details could look as below:

```
endpoint: https://s3.amazonaws.com
accessKey: LBIDJHBOIZQ3XBJ23UUQ
secretKey: Jxasdeue3324e3/wqe9wewdcxsa219421Hsj
bucket: aws-cancloud-bucket
```

Note the following:  
- When logging into a MinIO server the port should be included (e.g. `http://5.123.138.42:9000`)  
- You need to create your bucket before you can login (i.e. outside of CANcloud, e.g. in your AWS console)  
- For some S3 servers (e.g. AWS), you may need to change the CORS config - see the [getting started docs](https://canlogger.csselectronics.com/canedge-getting-started/ce2/transfer-data/s3-server/)  

---
### Testing

CANcloud ships a vitest unit-test suite living alongside the source under `src/browser/js/**/__tests__`.

- Run the full suite: `npm test` (or, on Windows, double-click / run `run-tests.bat`)
- Run a subset by name: `run-tests.bat objects` or `npx vitest run objects`

Notes:
- The suite is fully client-side: the S3 layer (`web`) is mocked, so no live server or credentials are needed to run the tests.
- The legacy enzyme-based component tests are quarantined (excluded, not deleted) in `vitest.config.mjs` - enzyme has no React 18 adapter. The logic/thunk suites all run.

#### Scale testing (synthetic fleet)

A real test bucket usually holds a handful of devices, which hides anything that only appears across hundreds of rows (OTA batch manager, status dashboard). `scripts/seed-perf-fleet.js` seeds a synthetic fleet of CANedge device folders into a bucket of your choice - the `device.json` files are synthesised and every configuration is generated from the schemas bundled with `config-editor-base`, so no fixture files are needed:

```
node scripts/seed-perf-fleet.js validate                       # generate + schema-check the cohorts (no writes)
node scripts/seed-perf-fleet.js seed     --creds <creds.json>  # write 200 device folders (5EED0000...)
node scripts/seed-perf-fleet.js verify   --creds <creds.json>  # count what landed
node scripts/seed-perf-fleet.js teardown --creds <creds.json> --yes
```

`--creds` takes a CANedge configuration file (it reads `connect.s3.server`) or a flat `{ endpoint, bucket, region, accessKey, secretKey }`; the same values can be supplied via `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`. **Keep credential files outside the repository.** Use `--devices <n>` for a different fleet size and `--prefix <hex>` to change the synthetic device-id block (teardown only ever deletes objects under that prefix). The seeded fleet spans several device types, firmware and configuration revisions plus a few deliberately incompatible devices; note the placeholder public key means an *encryption* run against them fails at key import - they are for configuration / firmware / TLS testing.

Add `--profile real` for a realistic small fleet instead (default 30 devices): Random device ids, `TRUCK 01A`-style metas, a genuine public key (encryption runs work), plain-text dummy credentials in every config (WiFi password, S3 secret key, SIM PIN - so the Sec column shows "plain"), all folders complete and consistent. The ids come from a fixed-seed PRNG (`--seed <n>`), so `verify`/`teardown` regenerate the same id list; teardown additionally checks each folder's `device.json` meta marker before deleting. When switching profiles or fleet sizes, always `teardown` the old fleet first - `seed` overwrites its own objects but never deletes strays.

`scripts/seed-log-files.js` adds synthetic log uploads on top of the TRUCK fleet so the status dashboard shows realistic data activity: `upload` writes one NEW session folder per device (1-3 splits of ~300 KB, ~18 MB per run) in the CANedge `<serial>/<session>/<split>-<epoch>.MF4` structure, with the S3 meta `timestamp` CANcloud renders as Start Time. The dashboard bins uploads by S3 Last-Modified, so re-run `upload` a few times over some hours to build history - sessions auto-increment (`--session <n>` to pin one). `verify` totals per device; `teardown --yes` removes only the session folders.

---
### Versioning
The CANcloud versioning is inspired by the semantic versioning system.

Each version is assigned three two digit numbers: `MAJOR`, `MINOR`, `PATCH`:

- `MAJOR`: Incompatible changes (e.g. requires new browser settings)
- `MINOR`: New backwards-compatible functionality (e.g. new features)
- `PATCH`: Backwards-compatible bug fixes (e.g. minor patches)

Example: `version 04.01.01`

---
### Contribution & support 
Feature suggestions, pull requests or questions are welcome!

You can contact us at CSS Electronics below:  
- [www.csselectronics.com](https://www.csselectronics.com)  
- [Contact form](https://www.csselectronics.com/screen/page/can-bus-logger-contact)  
- contact[at]csselectronics.com  


---
### Dependencies
CANcloud uses a number of libraries - the most important are:  
- `minio`: CANcloud utilizes some of the core structure & S3 SDK calls from the MinIO browser  
- [config-editor-base](https://github.com/CSS-Electronics/config-editor-base): This library serves as the basis for the built-in configuration editor
- [config-editor-tools](https://github.com/CSS-Electronics/config-editor-tools): This library adds various supporting config editor tools

