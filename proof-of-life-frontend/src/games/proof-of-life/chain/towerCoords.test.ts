import { describe, expect, it } from 'bun:test';
import { towerXYFor } from './towerCoords';
import { DEFAULT_SIM_CONFIG } from '../sim/engine';

describe('chain/towerCoords', () => {
  it('uses fallback sim towers when get_towers is unavailable', () => {
    expect(towerXYFor('N', null)).toEqual(DEFAULT_SIM_CONFIG.towers.N);
    expect(towerXYFor('E', undefined)).toEqual(DEFAULT_SIM_CONFIG.towers.E);
    expect(towerXYFor('S', null)).toEqual(DEFAULT_SIM_CONFIG.towers.S);
    expect(towerXYFor('W', undefined)).toEqual(DEFAULT_SIM_CONFIG.towers.W);
  });

  it('maps on-chain tower fields by tower id', () => {
    const towers = {
      n_x: 10,
      n_y: 11,
      e_x: 20,
      e_y: 21,
      s_x: 30,
      s_y: 31,
      w_x: 40,
      w_y: 41,
    };
    expect(towerXYFor('N', towers)).toEqual({ x: 10, y: 11 });
    expect(towerXYFor('E', towers)).toEqual({ x: 20, y: 21 });
    expect(towerXYFor('S', towers)).toEqual({ x: 30, y: 31 });
    expect(towerXYFor('W', towers)).toEqual({ x: 40, y: 41 });
  });
});
