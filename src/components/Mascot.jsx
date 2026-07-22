/*
  「小白」— the app mascot.

  This is the user-supplied vector (a tonal trace of the hand-drawn schnauzer,
  18 stacked shade layers) rather than something drawn by hand in code — my
  hand-built version could not match it.

  It is referenced as a static <img> from /public rather than inlined as JSX
  on purpose: the artwork is ~70KB of path data, which would be dead weight in
  every JS bundle. As a file it stays out of the bundle entirely, is served
  with an image/svg+xml MIME type by server.mjs, and gets HTTP-cached once.

  `mood` is accepted but unused — the artwork is a single fixed expression.
  It is kept so call sites (e.g. EmptyState) don't need to change, and so a
  second expression can be swapped in later without touching them.
*/

export function Mascot({ size = 46, className = "", mood }) {
  void mood;
  return (
    <img
      src="/mascot.svg"
      alt=""
      width={size}
      height={size}
      className={className}
      draggable="false"
      style={{ display: "block", flexShrink: 0 }}
    />
  );
}
