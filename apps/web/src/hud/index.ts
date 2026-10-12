// Public surface of the HUD. Import from '../hud' (or '@/hud' style relative path) in the app shell.
export { Hud } from './Hud';
export type { HudProps } from './Hud';

export { TopBar, RoundTrack, PhaseChips, ScenarioBadge } from './TopBar';
export { SocietyBoard } from './SocietyBoard';
export { GeneratorBoard } from './GeneratorBoard';
export { WeatherPanel, EmptySlot } from './WeatherPanel';
export { LawsPanel } from './LawsPanel';
export { TechPanel } from './TechPanel';
export { EventDisplay } from './EventDisplay';
export { ExpeditionPanel } from './ExpeditionPanel';
export { PlayersBar } from './PlayersBar';
export { HandPanel } from './HandPanel';
export { ResourceStrip } from './ResourceStrip';
export { LogFeed } from './LogFeed';
export { CityTabs, focusTabFor } from './CityTabs';
export type { CityTab } from './CityTabs';
export { CardImage, CardFace } from './CardImage';
export type { CardImageProps } from './CardImage';

export { HudPanel, TipLayer, usePick, tip, HudContext } from './context';
export type { HudCtx, HudPanelProps } from './context';
export { Icon } from './icons';
export type { IconName } from './model';
export { cardInfo, cardTitle, hungerBand, coldIcons, fuelRoomOf, PHASES, sliceSig } from './model';
export type { CardInfo, CardKind, HungerBand } from './model';
