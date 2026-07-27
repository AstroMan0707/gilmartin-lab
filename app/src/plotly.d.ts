/**
 * `plotly.js-dist-min` ships a prebuilt UMD bundle with no typings of its own, but the same
 * runtime API as `plotly.js`, whose community typings are installed. `typeof import(...)`
 * borrows that module's shape as a value type, so the default export gets full typing
 * instead of falling back to `any`.
 */
declare module 'plotly.js-dist-min' {
  const Plotly: typeof import('plotly.js')
  export default Plotly
}
