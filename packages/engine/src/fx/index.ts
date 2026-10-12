// Registers every FX token module (side-effect imports). Import this once from the engine entry.
import './tokens_people';
import './tokens_supply';
import './tokens_cards';
import './tokens_build';
import './tokens_map';
import './tokens_law';
import './tokens_action';
import './tokens_scenario';
import './custom';
export { runFx, exec, evalCond, evalCount, hasTok, tokenHeads, parseToken } from './core';
export type { Ctx } from './core';
