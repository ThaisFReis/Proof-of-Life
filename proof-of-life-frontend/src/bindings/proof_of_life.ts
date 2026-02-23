// Re-export generated Soroban TS bindings from the monorepo root.
//
// Keeping this wrapper under `src/` lets TypeScript/Vite resolve it via the existing `@/*` alias,
// while still pointing at the generated output under `Stellar-Game-Studio/bindings/`.
export * from '../../../bindings/proof_of_life/src/index';

