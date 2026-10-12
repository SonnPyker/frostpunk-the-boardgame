// Bottom strip: the city's stock at a glance (food, supply, hunger, corpses, stress, heat).
import { memo } from 'react';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { tip } from './context';
import { Icon } from './icons';
import type { IconName } from './model';
import { STRESS_SLOTS, automatonsFree, sameSig, sliceSig } from './model';
import type { SigProps } from './model';

export const RESOURCE_KEYS = ['res', 'food', 'hunger', 'corpse', 'corpseMax', 'meeples', 'gen'] as const satisfies readonly (keyof GameState)[];
export const resourceSig = (s: GameState) => sliceSig(s, RESOURCE_KEYS);

interface Props extends SigProps {
  state: GameState;
}

interface Pill {
  icon: IconName;
  label: string;
  value: string;
  tip: string;
  tone?: 'bad' | 'warn';
}

function ResourceStripImpl({ state: s }: Props) {
  const total = s.gen.stress + s.gen.overflow;
  const pills: Pill[] = [
    { icon: 'food', label: 'Food', value: String(s.food), tip: 'Food stock. Spend it in the Hunger phase; 1 Food = -1 Hunger.' },
    { icon: 'wood', label: 'Wood', value: String(s.res.wood), tip: 'Wood in the supply.' },
    { icon: 'coal', label: 'Coal', value: String(s.res.coal), tip: 'Coal in the supply. Fuels the Generator and powers buildings.' },
    { icon: 'core', label: 'Steam Core', value: String(s.res.core), tip: 'Steam Cores in the supply.' },
    { icon: 'steel', label: 'Steel', value: `${s.res.steel}/8`, tip: 'Steel in the supply (max 8).' },
    {
      icon: 'automaton',
      label: 'Automatons',
      value: `${automatonsFree(s)}/${s.automatonsMax}`,
      tip: 'Automatons available out of the maximum.',
    },
    {
      icon: 'hunger',
      label: 'Hunger',
      value: String(s.hunger),
      tip: 'Hunger marker. 25 or more loses the game.',
      tone: s.hunger >= 15 ? 'bad' : s.hunger >= 5 ? 'warn' : undefined,
    },
    {
      icon: 'corpse',
      label: 'Corpses',
      value: s.corpseMax > 0 ? `${s.corpse}/${s.corpseMax}` : String(s.corpse),
      tip: 'Corpses on the Corpse track. Reaching the last space loses the game.',
      tone: s.corpseMax > 0 && s.corpse >= s.corpseMax - 1 ? 'bad' : undefined,
    },
    {
      icon: 'stress',
      label: 'Stress',
      value: `${total}/${STRESS_SLOTS}`,
      tip: 'Stress cubes on the Generator track. Overflow breaks the Generator.',
      tone: s.gen.overflow > 0 ? 'bad' : total >= STRESS_SLOTS - 2 ? 'warn' : undefined,
    },
    {
      icon: 'heat',
      label: 'Heat',
      value: `${s.gen.heat}/${s.gen.cold}`,
      tip: 'Heat marker over the Cold marker. Citizens between them fall ill if the Generator is not fuelled.',
    },
  ];
  return (
    <div className="hud-resources" aria-label={t('City stock')}>
      {pills.map((p) => (
        <span key={p.label} className={'hud-pill' + (p.tone ? ' is-' + p.tone : '')} {...tip(t(p.tip))}>
          <Icon name={p.icon} size={14} />
          <span className="hud-pill-label">{tn(p.label)}</span>
          <b>{p.value}</b>
        </span>
      ))}
    </div>
  );
}

export const ResourceStrip = memo(ResourceStripImpl, sameSig);
