import type { TowerId } from '../model';

export type ChainTowersLike = {
  n_x: number;
  n_y: number;
  e_x: number;
  e_y: number;
  s_x: number;
  s_y: number;
  w_x: number;
  w_y: number;
};

// Must match contract defaults in `contracts/proof-of-life/src/lib.rs`.
export const CONTRACT_DEFAULT_TOWERS: ChainTowersLike = {
  n_x: 5,
  n_y: 0,
  e_x: 9,
  e_y: 5,
  s_x: 5,
  s_y: 9,
  w_x: 0,
  w_y: 5,
};

export function towerXYFor(
  tower: TowerId,
  chainTowers: ChainTowersLike | null | undefined
): { x: number; y: number } {
  if (!chainTowers) return towerXYFor(tower, CONTRACT_DEFAULT_TOWERS);
  if (tower === 'N') return { x: Number(chainTowers.n_x), y: Number(chainTowers.n_y) };
  if (tower === 'E') return { x: Number(chainTowers.e_x), y: Number(chainTowers.e_y) };
  if (tower === 'S') return { x: Number(chainTowers.s_x), y: Number(chainTowers.s_y) };
  return { x: Number(chainTowers.w_x), y: Number(chainTowers.w_y) };
}
