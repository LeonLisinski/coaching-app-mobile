/**
 * Shared startup session state.
 *
 * _layout.tsx reads the stored session from SecureStore once and writes the
 * result here BEFORE calling setLoading(false). index.tsx then reads this
 * cached value instead of making a second SecureStore.getItemAsync call on
 * the same key.
 *
 * Why this matters: on Android, if supabase-js is concurrently reading or
 * writing the same SecureStore key (during _recoverAndRefresh on cold-start),
 * a second getItemAsync on that key can block indefinitely — no timeout, no
 * rejection. index.tsx would hang forever at "Step 2/3". Sharing the already-
 * read result from _layout.tsx eliminates the second I/O operation entirely.
 */

let _hasSession = false

export function setStartupSession(v: boolean): void {
  _hasSession = v
}

export function getStartupSession(): boolean {
  return _hasSession
}
