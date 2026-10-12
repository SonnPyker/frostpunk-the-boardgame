// Full-screen background for menus: snow, a cold vignette and an ember glow low on the right.
import { SnowCanvas } from '../components/ui';

export function Backdrop({ intensity = 1, glow = 'right' }: { intensity?: number; glow?: 'right' | 'center' }) {
  return (
    <div className={`backdrop backdrop--glow-${glow}`} aria-hidden="true">
      <div className="backdrop__sky" />
      <SnowCanvas intensity={intensity} />
      <div className="backdrop__ember" />
      <div className="backdrop__vignette" />
      <div className="backdrop__ground" />
    </div>
  );
}
