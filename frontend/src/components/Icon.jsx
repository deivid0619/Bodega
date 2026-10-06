const PATHS = {
  warehouse: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  hanger: 'M12 7.2a2.1 2.1 0 1 1 2.1-2.1c0 1.3-2.1 1.5-2.1 3.1v.4l-8.4 6.9a1.4 1.4 0 0 0 .9 2.5h15a1.4 1.4 0 0 0 .9-2.5L12 8.6',
  scan: 'M3 7.5V5a2 2 0 0 1 2-2h2.5M16.5 3H19a2 2 0 0 1 2 2v2.5M21 16.5V19a2 2 0 0 1-2 2h-2.5M7.5 21H5a2 2 0 0 1-2-2v-2.5M7.5 8v8M10.5 8v8M14 8v8M17 8v8',
  reserve: 'M4 8V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8ZM10 12h4',
  summary: 'M4 20V11M10 20V4M16 20v-6M2.5 20.5h19',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4.2-4.2',
  bell: 'M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6ZM10 19a2 2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10.2 11v5M13.8 11v5',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  pencil: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',
  camera: 'M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5ZM12 16.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  orbit: 'M12 4.5c4.7 0 8.5 3.4 8.5 7.5s-3.8 7.5-8.5 7.5S3.5 16.1 3.5 12M12 4.5 9.5 2M12 4.5 9.5 7M7 12h10M12 7v10',
  plan: 'M4 4h16v16H4zM4 11h9M13 4v16M13 15h7',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3',
  install: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  alert: 'M12 4l9 16H3L12 4ZM12 10v4M12 17.2v.3',
  boxIn: 'M12 3.5v10M8 9.5l4 4 4-4M4 15.5v3.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3.5',
  boxOut: 'M12 13.5v-10M8 7.5l4-4 4 4M4 15.5v3.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3.5',
  equals: 'M5 9h14M5 15h14',
  jacket: 'M9 3.5 12 5.5l3-2 3.8 1.9 2.2 6.1-3 1.2V21H6V12.7l-3-1.2 2.2-6.1L9 3.5ZM12 5.5V21M6 12.7V8M18 12.7V8',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0',
  flash: 'M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  box: 'M3.5 7.5 12 3.5l8.5 4v9l-8.5 4-8.5-4v-9ZM3.5 7.5l8.5 4 8.5-4M12 11.5v9M7.75 5.5l8.5 4',
  crate: 'M3 9h18l-1.4 9.6a1.6 1.6 0 0 1-1.6 1.4H6a1.6 1.6 0 0 1-1.6-1.4L3 9ZM3 9l1.6-4h14.8L21 9M8.5 12.5v4M12 12.5v4M15.5 12.5v4',
  bag: 'M5.5 8.5h13l1 12h-15l1-12ZM9 8.5V7a3 3 0 0 1 6 0v1.5',
  tag: 'M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1 1 0 0 1 0 1.4l-7.4 7.4a1 1 0 0 1-1.4 0L3.5 12.3ZM8 8h.01',
}

export default function Icon({ name, size = 22, stroke = 1.9, className, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

// Marca de la app: tres barras inclinadas, como repisas en movimiento.
export function BrandMark({ size = 28 }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true">
      <path d="M10.2 4.5h14.3l-2.6 4.6H7.6z" fill="#C0FF00" />
      <path d="M7.6 11.7h14.3l-2.6 4.6H5z" fill="#C0FF00" />
      <path d="M5 18.9h14.3l-2.6 4.6H2.4z" fill="#C0FF00" />
    </svg>
  )
}
