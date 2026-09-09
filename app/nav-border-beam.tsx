export function NavBorderBeam() {
  return (
    <svg className="premium-nav-beam" aria-hidden="true" focusable="false">
      <rect
        className="nav-beam-tail"
        x="0.5"
        y="0.5"
        rx="13.5"
        pathLength="100"
      />
      <rect
        className="nav-beam-body"
        x="0.5"
        y="0.5"
        rx="13.5"
        pathLength="100"
      />
      <rect
        className="nav-beam-head"
        x="0.5"
        y="0.5"
        rx="13.5"
        pathLength="100"
      />
    </svg>
  );
}
