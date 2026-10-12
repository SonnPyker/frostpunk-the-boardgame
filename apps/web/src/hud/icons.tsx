// Inline SVG icon set for the HUD (stroke icons, currentColor). Drawn procedurally so no asset is required.
import type { CSSProperties, ReactNode } from 'react';
import type { IconName } from './model';

const P: Record<IconName, ReactNode> = {
  wood: (<><ellipse cx="12" cy="12" rx="8.5" ry="5.5" /><circle cx="12" cy="12" r="2.4" /></>),
  coal: (<path d="M4.5 16.5 L7 8.5 L12 5.5 L18 9 L19.5 15.5 L14.5 19 L8 19.2 Z" />),
  core: (<><path d="M12 2.8 L20 7.4 V16.6 L12 21.2 L4 16.6 V7.4 Z" /><circle cx="12" cy="12" r="3.2" /></>),
  steel: (<path d="M2.8 17 L6 9 H18 L21.2 17 Z" />),
  food: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.2" /></>),
  worker: (<><circle cx="12" cy="7.5" r="3.3" /><path d="M5.8 21 V17 Q5.8 12.6 12 12.6 Q18.2 12.6 18.2 17 V21" /></>),
  engineer: (<><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.8" /><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M5.4 18.6l2.1-2.1M16.5 7.5l2.1-2.1" /></>),
  child: (<><circle cx="12" cy="9.2" r="2.7" /><path d="M7.4 20.5 V17 Q7.4 13.4 12 13.4 Q16.6 13.4 16.6 17 V20.5" /></>),
  automaton: (<><rect x="5" y="7.5" width="14" height="12" rx="2.2" /><path d="M12 3.2v4.3M9.3 13h.01M14.7 13h.01" /></>),
  skull: (<><path d="M12 3.6 A7.6 7.6 0 0 0 4.4 11.2 C4.4 13.8 5.7 15.4 7.6 16.3 V19.6 H16.4 V16.3 C18.3 15.4 19.6 13.8 19.6 11.2 A7.6 7.6 0 0 0 12 3.6 Z" /><circle cx="9" cy="11.2" r="1.6" className="f" /><circle cx="15" cy="11.2" r="1.6" className="f" /></>),
  syringe: (<><path d="M3.5 20.5 L8.3 15.7" /><path d="M7.5 11.2 L12.8 5.9 L18.1 11.2 L12.8 16.5 Z" /><path d="M10.8 13.2 L8.4 10.8" /><path d="M14.6 3.6 L20.4 9.4" /></>),
  hope: (<path d="M12 3 L14.6 9.4 L21 12 L14.6 14.6 L12 21 L9.4 14.6 L3 12 L9.4 9.4 Z" />),
  disc: (<path d="M13.4 2.6 L5.2 13.2 H11.2 L10.4 21.4 L18.8 10.6 H12.8 Z" />),
  heat: (<path d="M12 21 C7.6 21 5.6 17.8 6.6 14.2 C7.5 11.2 10 10.2 9.6 6.2 C12.6 8.2 13.2 10.6 12.7 12.6 C14.1 11.6 14.6 10.1 14.6 8.6 C17.1 10.6 18.1 13.1 17.6 15.6 C17.1 19 15.1 21 12 21 Z" />),
  cold: (<><path d="M12 3v18M4.3 7.5l15.4 9M4.3 16.5l15.4-9" /><path d="M9.6 4.8 L12 6.6 L14.4 4.8M9.6 19.2 L12 17.4 L14.4 19.2" /></>),
  storm: (<><path d="M7 16.2 A4.6 4.6 0 0 1 7.4 7.2 A6.2 6.2 0 0 1 18.7 9 A3.6 3.6 0 0 1 17.6 16.2 Z" /><path d="M12.6 13.6 L10.4 18 H13.4 L11.2 22" /></>),
  round: (<><circle cx="12" cy="12" r="8.6" /><path d="M12 7.2v5.2l3.2 2" /></>),
  hunger: (<><path d="M3.8 11.2 H20.2 A8.2 8.2 0 0 1 3.8 11.2 Z" /><path d="M8 7.4 V4.8 M12 7.4 V3.6 M16 7.4 V4.8" /></>),
  corpse: (<><path d="M6.2 21 V10.4 A5.8 5.8 0 0 1 17.8 10.4 V21 Z" /><path d="M9.8 13.4h4.4M12 11.2v4.4" /></>),
  stress: (<><rect x="4" y="4" width="16" height="16" rx="2.2" /><path d="M4 12h16M12 4v16" /></>),
  tech: (<path d="M9.2 3.2 H14.8 M10.2 3.2 V9.2 L5.2 18 A2 2 0 0 0 7 21 H17 A2 2 0 0 0 18.8 18 L13.8 9.2 V3.2" />),
  expedition: (<path d="M12 3 L18.4 20.4 L12 16.6 L5.6 20.4 Z" />),
  scout: (<path d="M5.4 21 V4 M5.4 4.4 H16.8 L14.2 8.6 L16.8 12.8 H5.4" />),
  law: (<><rect x="5.2" y="3.2" width="13.6" height="17.6" rx="1.6" /><path d="M8.4 8h7.2M8.4 12h7.2M8.4 16h4.6" /></>),
  event: (<><circle cx="12" cy="12" r="8.8" /><path d="M12 7v6.2M12 16.6v.4" /></>),
  advisor: (<path d="M12 3 L19.6 6 V12.2 Q19.6 18.2 12 21 Q4.4 18.2 4.4 12.2 V6 Z" />),
  leader: (<path d="M4 17.4 L3 8 L8.4 12 L12 5.8 L15.6 12 L21 8 L20 17.4 Z" />),
  turn: (<path d="M4.5 12 H18.2 M13 6.2 L18.8 12 L13 17.8" />),
  log: (<path d="M4.8 6.2 H19.2 M4.8 12 H19.2 M4.8 17.8 H13.8" />),
  tree: (<path d="M12 3 L18.4 13.2 H14.4 L19.4 20.8 H4.6 L9.6 13.2 H5.6 Z" />),
  fuel: (<path d="M12 3 C12.2 7.4 17.2 9.2 17.2 14.2 A5.2 5.2 0 0 1 6.8 14.2 C6.8 11.4 8.4 10.2 9.2 8.4 C10.4 9.6 11.2 9.4 12 3 Z" />),
  broken: (<path d="M4 4.5 L10.6 10.2 L8 13.4 L14.2 19.8 M20 4.5 L13.6 10.2 L16.2 13.4" />),
  generator: (<><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="8.6" strokeDasharray="3.2 2.6" /></>),
  check: (<path d="M5 12.5 L10 17.4 L19.4 7.2" />),
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

export function Icon({ name, size = 16, className, style, label }: IconProps) {
  return (
    <svg
      className={'hud-ico' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}
