/*
  Hand-drawn bottom-nav icons.

  Replaces the geometric Lucide set on the nav only. Lucide is perfectly good
  but reads as "tool"; the reference app (鸭觅) gets much of its warmth from
  slightly wobbly, hand-inked icons. Everything else in the app keeps Lucide —
  swapping the whole icon set would cost far more than it returns.

  Rules for these paths: round caps/joins, no perfectly straight lines, and no
  mirror symmetry (each side of a shape differs a little). `active` thickens
  the stroke and adds a soft fill rather than swapping to a different glyph,
  so the shape stays stable as the nav indicator slides underneath.
*/

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false"
};

function stroke(active) {
  return active ? 2.3 : 1.9;
}

/* 收件箱 — a slightly lopsided tray */
export function InboxIcon({ size = 22, active = false }) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={stroke(active)}>
      <path d="M3.4 13.2 6.6 5.9c.25-.6.7-.95 1.3-.95h8.3c.6 0 1.05.35 1.3.95l3.1 7.3" />
      <path d="M3.4 13.2h4.9l1.1 2.3h5.3l1.15-2.3h4.75v4.1c0 1.15-.95 2.05-2.1 2.05H5.4c-1.1 0-2-.9-2-2.05z" />
      {active && <path d="M3.5 13.4h4.8l1.1 2.3h5.3l1.15-2.3h4.65v3.9H3.5z" fill="currentColor" opacity=".18" stroke="none" />}
    </svg>
  );
}

/* 想去 — a heart with uneven lobes */
export function HeartIcon({ size = 22, active = false }) {
  const d =
    "M12 20.2c-.5 0-6.1-3.6-8.05-7.15C2.5 10.4 3.3 6.6 6.4 5.5c2-.7 3.9.1 5.05 1.75.1.15.25.15.35 0C12.9 5.5 14.9 4.75 16.9 5.6c3 1.25 3.6 5 2.2 7.5C17.2 16.6 12.5 20.2 12 20.2z";
  return (
    <svg width={size} height={size} {...base} strokeWidth={stroke(active)}>
      <path d={d} fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.2 : 0} />
    </svg>
  );
}

/* 日历 — a wobbly page with two tacks */
export function CalendarIcon({ size = 22, active = false }) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={stroke(active)}>
      <path d="M4.6 7.4c-.1 3.9-.15 7.7 0 11.5.05.85.6 1.4 1.45 1.45 3.9.15 7.95.15 11.9 0 .85-.05 1.4-.6 1.45-1.45.15-3.8.1-7.6 0-11.5-.05-.85-.6-1.4-1.45-1.45-3.95-.15-8-.15-11.9 0-.85.05-1.4.6-1.45 1.45z" />
      <path d="M4.7 10.3c4.9-.2 9.8-.2 14.6 0" />
      <path d="M8.7 3.6c-.1.95-.12 1.9-.05 2.85" />
      <path d="M15.4 3.6c-.1.95-.12 1.9-.05 2.85" />
      {active && <path d="M4.75 10.6c4.85-.18 9.7-.18 14.5 0 .1 2.9.06 5.75-.02 8.3-3.9.16-10.6.16-14.46 0-.08-2.55-.12-5.4-.02-8.3z" fill="currentColor" opacity=".18" stroke="none" />}
    </svg>
  );
}

/* 已去过 — a hand-inked circle that doesn't quite close, with a tick */
export function CheckIcon({ size = 22, active = false }) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={stroke(active)}>
      <path d="M20.1 10.4c.9 4.3-1.9 8.4-6.3 9.3-4.4.85-8.6-2-9.45-6.3-.85-4.3 1.95-8.45 6.35-9.3 2.6-.5 5.1.3 6.85 1.95" />
      <path d="M8.6 11.9c1.05 1 2.05 2 3 3.05 2.3-3.1 4.9-5.9 7.8-8.35" />
    </svg>
  );
}

/* 我的 — a head and a shoulder line, drawn loosely */
export function PersonIcon({ size = 22, active = false }) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={stroke(active)}>
      <path d="M12.05 3.9c2.25 0 4 1.8 4 4.05 0 2.3-1.75 4.1-4 4.1-2.3 0-4.05-1.8-4.05-4.1 0-2.25 1.75-4.05 4.05-4.05z" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.2 : 0} />
      <path d="M4.5 20.1c.5-3.7 3.6-5.9 7.55-5.9 3.9 0 7 2.2 7.45 5.9" />
    </svg>
  );
}
