// Human readable English text for effect tokens (used for choice labels and the game log).
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function typeWord(t: string): string {
  const map: Record<string, string> = {
    any: 'a Citizen of your choice',
    anyOneType: 'Citizens of one chosen type',
    current: 'Citizens of the current Round type',
    workerEngineer: 'Worker or Engineer',
    workerOrEngineer: 'Worker or Engineer',
  };
  return map[t] ?? cap(t);
}

export function describe(item: any): string {
  if (typeof item !== 'string') return describeObj(item);
  const m = /^([A-Za-z]+)([+-])(\d+)(?::(.*))?$/.exec(item);
  let head: string;
  let a: string[];
  if (m) {
    head = m[1] + m[2];
    a = [m[3], ...(m[4] ? m[4].split(':') : [])];
  } else {
    const p = item.split(':');
    head = p[0];
    a = p.slice(1);
  }
  const n = Number(a[0]);
  switch (head) {
    case 'hope+':
      return `Hope +${n}` + (a[1] ? ` (${a[1].split('|').map(cap).join(' / ')})` : '');
    case 'hope-':
      return `Hope −${n}`;
    case 'disc+':
      return `Discontent +${n}` + (a[1] ? ` (${cap(a[1])})` : '');
    case 'disc-':
      return `Discontent −${n}`;
    case 'hunger+':
      return `Hunger +${n}` + (a[1] === 'perCitizenMeeple' ? ' per Citizen Meeple' : '');
    case 'hunger-':
      return `Hunger −${n}` + (a[1] === 'plusPerActiveCare' ? ' (+1 per active Care)' : '');
    case 'food+':
      return `Gain ${n} Food`;
    case 'stress+':
      return `Add ${plural(n, 'Stress cube')}`;
    case 'gain':
      if (a[0] === 'automaton') return `Gain ${plural(Number(a[1]), 'Automaton')}`;
      if (['worker', 'engineer', 'child'].includes(a[0])) return `+${a[1]} ${cap(a[0])} Citizens`;
      return `Gain ${a[1]} ${cap(a[0] === 'core' ? 'Steam Core' : a[0])}` + (a[2] ? ' per Food Ration' : '');
    case 'pay':
    case 'spend':
      if (/^\d+res/.test(a[0])) return a[0].includes('|') ? `Spend ${a[0].replace('res', ' Resources').replace('|', ' or ').replace('food', ' Food')}` : `Spend ${parseInt(a[0], 10)} Resources`;
      return `${cap(head === 'pay' ? 'Pay' : 'Spend')} ${a[1]} ${a[0] === 'core' ? 'Steam Core' : cap(a[0])}`;
    case 'sick':
      return `${a[1]} sick ${typeWord(a[0])}`;
    case 'die':
      return `${a[1]} ${typeWord(a[0])} die${a[2] === 'noCards' ? ' (no Citizen card)' : ''}`;
    case 'lose':
      if (a[0] === 'res') return `Lose ${plural(Number(a[1]), 'Resource')}`;
      if (a[0] === 'food') return `Lose ${a[1]} Food`;
      return `${a[1]} ${cap(a[0])} leave the city`;
    case 'spent':
      return `Place ${plural(Number(a[1]), 'Spent ' + typeWord(a[0]) + ' token')} in the supply`;
    case 'cure':
      return a[0] === 'perChildMeeple' ? 'Cure 1 per Child Meeple' : `Cure ${a[0]}` + (a[1] === 'oneType' ? ' (one type)' : '');
    case 'treat':
      return `Treat ${a[0]}`;
    case 'cureOrTreat':
      return `Cure ${a[0]} or Treat ${a[1] ?? a[0]}`;
    case 'flipSickness':
      return `Flip ${a[1] === 'all' ? 'all' : a[1]} Sickness marker(s) ${a[0] === 'toSkull' ? 'to Skull' : a[0] === 'toSyringe' ? 'to Syringe (a Citizen dies)' : ''}`;
    case 'activate':
      return `Activate ${a.map((x) => (x === 'allOfType' ? 'all of one type' : x)).join(' ')}`;
    case 'activateHope':
      return `Activate ${a[0]} Hope`;
    case 'activateDisc':
      return a[0] === 'allOfType' ? 'Activate all Discontent of one type' : `Activate ${a[0]} Discontent`;
    case 'exhaust':
      return `Exhaust ${a.map((x) => (x === 'allOfType' ? 'all of one type' : x === 'oneOfEachType' ? 'one of each type' : x)).join(' ')}`;
    case 'exhaustHope':
      return `Exhaust ${a[0] === 'all' ? 'all' : a[0] === 'allOfType' ? 'all Hope of one type' : a[0]} Hope`;
    case 'exhaustAll':
      return 'Exhaust all Hope';
    case 'exhaustHopeOrDisc':
      return 'Exhaust one Hope or one Discontent';
    case 'disc-discard':
      return `Discard ${a[0]} ${a[1] === 'active' ? 'active ' : ''}Discontent`;
    case 'discardHope':
      return 'Discard 1 Hope';
    case 'drawHope':
      return 'Draw 1 Hope token and activate it';
    case 'removeStress':
      return a[0] === 'all' ? 'Remove all Stress cubes' : a[0] === 'upTo' ? `Remove up to ${a[1]} Stress cubes` : `Remove up to ${a[0]} Stress cubes`;
    case 'removeAllStress':
      return 'Remove all Stress cubes';
    case 'upgradeBuilding':
      return 'Upgrade a Building';
    case 'upgradeFree':
      return 'Upgrade a Building for free';
    case 'buildFree':
      return 'Build a Building for free';
    case 'workshop':
    case 'workshopEffects':
      return `${plural(Number(a[0] ?? 1), 'Workshop effect')}`;
    case 'devBack':
    case 'devTokenBack':
      return `Move the Development token back ${a[0]}`;
    case 'devToken-':
      return 'Move the Development token back 1';
    case 'corpseBack':
      return `Move the Corpse marker back ${a[0]}`;
    case 'takeMapRes':
      return `Take ${a[0]} Resource(s) from the map`;
    case 'placeTile':
      return a[0] === 'far' ? 'Place a Far tile' : a[0] === 'nearElseFar' ? 'Place a Near tile (else Far)' : 'Place a Near or Far tile';
    case 'reuseWorker':
      return 'Reuse a Worker (take another action)';
    case 'reuseBuilding':
      return 'Reuse a Building';
    case 'destroyBuilding':
      return 'Destroy a Building';
    case 'dusk':
      return `Add Dusk card ${a[0]}`;
    case 'event':
      return 'Place in the Event display';
    case 'remove':
      return 'Remove this card';
    case 'shuffleBack':
      return 'Shuffle back into the Dusk deck';
    case 'custom':
      if (a[0] === 'M016') return `A Child Meeple becomes a Child-${cap(a[1])} and is placed on this card`;
      return `Special effect (${a[0]})`;
    case 'clearSupply':
      return 'Lose all Resources';
    case 'gainFoodRound':
      return 'Gain Food equal to the Round';
    case 'loseResOrHunger':
      return `Lose ${a[0]} Resources (each missing: Hunger +${a[1]})`;
    case 'payFoodOrHunger':
      return `Pay ${a[0]} Food (each missing: Hunger +1)`;
    case 'heated':
      return 'Counts as heated';
    case 'discard':
      return 'Discard';
    case 'removeCard':
      return `Remove ${a[0]} from the Event display`;
    default:
      return item;
  }
}

function describeObj(o: any): string {
  if ('choose' in o) return o.choose.map((l: any[]) => describeList(l)).join('  OR  ');
  if ('if' in o) return `If ${o.if}: ${describeList(o.then ?? [])}` + (o.else && o.else.length ? ` else ${describeList(o.else)}` : '');
  if ('ifPay' in o) return `May ${describe(o.ifPay)}: ${describeList(o.then ?? [])}` + (o.else && o.else.length ? ` otherwise ${describeList(o.else)}` : '');
  if ('each' in o) return `For each ${o.each}: ${describeList(o.fx)}`;
  if ('times' in o) return `${o.times}×: ${describeList(o.fx)}`;
  if ('perActiveHope' in o || 'perActiveDisc' in o) return 'For each active token…';
  if ('activateAllDiscOfType' in o) return 'Activate all Discontent of one type…';
  if ('exhaustAllHopeOfType' in o) return 'Exhaust all Hope of one type…';
  if ('spendOr' in o) return `Spend ${JSON.stringify(o.spendOr)} or ${describeList(o.else ?? [])}`;
  if ('custom' in o) return `Special (${o.custom})`;
  return JSON.stringify(o);
}

export function describeList(list: any[]): string {
  return list.map((x) => describe(x)).join(', ');
}
