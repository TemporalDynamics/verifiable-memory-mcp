/**
 * TEST ONLY. A Node module-resolution hook (node:module's register API)
 * that redirects the `@napi-rs/keyring` specifier to fake-keyring.mjs.
 *
 * This is applied ONLY by test worker scripts explicitly calling
 * `register()` with this file — production code (src/**) never imports or
 * references this file, and never runs with it registered. There is no
 * production code path that activates this loader.
 */
const fakeKeyringUrl = new URL("./fake-keyring.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@napi-rs/keyring") {
    return { url: fakeKeyringUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
