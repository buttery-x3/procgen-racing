const paths: Record<string, string> = {
  rig: '<path d="m4 16 1-7 3-3h8l3 3 1 7M4 12h16M7 12v3m10-3v3M4 16h16M6 16v3m12-3v3"/>',
  sliders:
    '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  chart: '<path d="M4 4v16h16M7 14l4-5 4 3 5-7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2M12 17h.01"/>',
  play: '<path d="m9 5 10 7-10 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/>',
  arrow: '<path d="m8 5 7 7-7 7"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5"/>',
  drop: '<path d="M12 3v13m-4-4 4 4 4-4M4 21h16"/>',
  compare: '<path d="M12 3v18M8 6H3v12h5m8-12h5v12h-5"/>',
  undo: '<path d="M4 4v6h6M4 10c2-6 15-6 15 3 0 5-6 7-10 4"/>',
};
export function icon(name: string, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.rig}</svg>`;
}
