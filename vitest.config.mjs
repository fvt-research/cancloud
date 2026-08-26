import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.mjs'

// Quarantined enzyme component suites: enzyme has no React 18 adapter, so
// these files are excluded (not deleted) pending a React Testing Library port.
// Regenerate the list with:
//   grep -rl enzyme src --include="*.js" | grep __tests__
const QUARANTINED = [
  'src/browser/js/__tests__/App.test.js',
  'src/browser/js/alert/__tests__/Alert.test.js',
  'src/browser/js/alert/__tests__/AlertContainer.test.js',
  'src/browser/js/browser/__tests__/AboutModal.test.js',
  'src/browser/js/browser/__tests__/Browser.test.js',
  'src/browser/js/browser/__tests__/BrowserDropdown.test.js',
  'src/browser/js/browser/__tests__/ChangePasswordModal.test.js',
  'src/browser/js/browser/__tests__/Header.test.js',
  'src/browser/js/browser/__tests__/Host.test.js',
  'src/browser/js/browser/__tests__/Login.test.js',
  'src/browser/js/browser/__tests__/MainActions.test.js',
  'src/browser/js/browser/__tests__/MainContent.test.js',
  'src/browser/js/browser/__tests__/MobileHeader.test.js',
  'src/browser/js/browser/__tests__/SideBar.test.js',
  'src/browser/js/buckets/__tests__/Bucket.test.js',
  'src/browser/js/buckets/__tests__/BucketContainer.test.js',
  'src/browser/js/buckets/__tests__/BucketDropdown.test.js',
  'src/browser/js/buckets/__tests__/BucketList.test.js',
  'src/browser/js/buckets/__tests__/BucketPolicyModal.test.js',
  'src/browser/js/buckets/__tests__/BucketSearch.test.js',
  'src/browser/js/buckets/__tests__/MakeBucketModal.test.js',
  'src/browser/js/buckets/__tests__/Policy.test.js',
  'src/browser/js/buckets/__tests__/PolicyInput.test.js',
  'src/browser/js/objects/__tests__/DeleteObjectConfirmModal.test.js',
  'src/browser/js/objects/__tests__/ObjectActions.test.js',
  'src/browser/js/objects/__tests__/ObjectContainer.test.js',
  'src/browser/js/objects/__tests__/ObjectItem.test.js',
  'src/browser/js/objects/__tests__/ObjectsBulkActions.test.js',
  'src/browser/js/objects/__tests__/ObjectsHeader.test.js',
  'src/browser/js/objects/__tests__/ObjectsList.test.js',
  'src/browser/js/objects/__tests__/ObjectsListContainer.test.js',
  'src/browser/js/objects/__tests__/ObjectsSection.test.js',
  'src/browser/js/objects/__tests__/Path.test.js',
  'src/browser/js/objects/__tests__/PrefixContainer.test.js',
  'src/browser/js/objects/__tests__/ShareObjectModal.test.js',
  'src/browser/js/otaBatch/__tests__/OtaBatchSection.test.js',
  'src/browser/js/uploads/__tests__/AbortConfirmModal.test.js',
  'src/browser/js/uploads/__tests__/Dropzone.test.js',
  'src/browser/js/uploads/__tests__/UploadModal.test.js'
]

export default defineConfig((env) =>
  mergeConfig(
    viteConfig({ ...env, mode: 'test' }),
    defineConfig({
      test: {
        globals: true,
        environment: 'jsdom',
        environmentOptions: { jsdom: { url: 'https://localhost:8080' } },
        include: ['src/**/__tests__/**/*.js'],
        exclude: ['**/node_modules/**', '**/__fixtures__/**', ...QUARANTINED],
        css: false
      }
    })
  )
)
