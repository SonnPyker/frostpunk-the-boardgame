// Public surface of the 3D map. Import from '../map' (or '@/map' in the app): the React component, the imperative scene
// for non-React callers, option-id helpers and the sample state used by the dev harness.
export { MapView, type MapViewProps, type Quality } from './MapView';
export { MapScene, type MapSceneHooks } from './scene';
export { resolvePickId, describePick, pickCentre, spaceLabel, type PickInfo } from './pick';
export { buildSampleState } from './fixtures';
export { PAL, INS_COLOR, INS_NAME, MEEPLE_NAME } from './palette';
