export function Icon({ name = "recorder" }: { name?: string }) {
  const paths: Record<string, string> = {
    recorder: "M3 17V7h5v10h5V7h5v10h3",
    sources: "M8 2v5m8-5v5M6 7h12v5a6 6 0 0 1-12 0V7zm6 11v4",
    answers: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
    agents: "m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 20",
    journal: "M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1",
    system: "M3 12h4l3-8 4 16 3-8h4",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    close: "m5 5 14 14M19 5 5 19",
    menu: "M3 5h18M3 12h18M3 19h18",
    check: "m4 12 5 5L20 6",
    clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l4 2",
    plus: "M12 3v18M3 12h18",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    lock: "M6 10h12v11H6zm2 0V6a4 4 0 0 1 8 0v4",
    shield: "m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5l8-3",
    logout: "M9 3H3v18h6m5-15 6 6-6 6M8 12h12",
    search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.recorder} />
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon />
      </span>
      blackbox<span className="brand-dot">.</span>
    </span>
  );
}
