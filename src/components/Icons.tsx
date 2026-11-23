type P = { size?: number; className?: string };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const CubeIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 2 3 7v10l9 5 9-5V7z" />
    <path d="m3 7 9 5 9-5" />
    <path d="M12 12v10" />
  </svg>
);
export const SearchIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const PrinterIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="4" y="3" width="16" height="12" rx="1" />
    <path d="M8 21h8M12 15v6" />
  </svg>
);
export const PowerIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v9" />
    <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
  </svg>
);
export const DownloadIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
  </svg>
);
export const LayersIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);
export const UploadIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 16V4m0 0-4 4m4-4 4 4M4 21h16" />
  </svg>
);
export const HeartIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);
export const SendIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </svg>
);
export const PauseIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 5v14M15 5v14" />
  </svg>
);
export const PlayIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M7 4v16l13-8z" />
  </svg>
);
export const StopIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
);
export const ExternalIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const CameraIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M23 7 16 12l7 5z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </svg>
);
export const PrintsIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 20h16M6 16h12M8 12h8M10 8h4" />
  </svg>
);
export const GearIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const PlateIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="7" y="7" width="4" height="4" />
    <rect x="13" y="13" width="4" height="4" />
    <rect x="13" y="7" width="4" height="4" />
  </svg>
);
