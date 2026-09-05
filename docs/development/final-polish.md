# Final Polish Measurements

## Renderer bundle

The release-hardening baseline main renderer chunk was approximately **1,104.8 kB raw / 359.0 kB gzip**. After the attachment and secure credential UI surfaces it is approximately **1,107.4 kB raw / 359.6 kB gzip**, with Graph and Canvas remaining separate lazy chunks.

The additional surfaces are startup-visible sidebar functionality, so moving them behind more granular boundaries would add fragmentation without a meaningful reduction. The current result is recorded as:

`BUNDLE_OPTIMIZATION_SATURATED`

The Vite advisory is intentionally not suppressed, `chunkSizeWarningLimit` was not raised, and no blind `manualChunks` configuration was added.

## Plugin runtime decision

`PLUGIN_RUNTIME_DEFERRED_FOR_SECURITY`

The existing host safely discovers manifests and enforces default-deny policy, but it does not yet provide a separately isolated process with authenticated capability IPC. Executing third-party plugin code in the renderer or unrestricted main process would weaken the trust boundary, so runtime execution remains deferred.
