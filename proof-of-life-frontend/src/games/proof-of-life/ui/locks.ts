import type { SessionState } from '../model';

export function shouldDisableChadCommands(params: {
  uiPhase: 'setup' | 'boot' | 'cutscene' | 'play';
  session: SessionState | null;
  commandLocked: boolean;
  chainPipelineLocked?: boolean;
}): boolean {
  const { uiPhase, session, commandLocked, chainPipelineLocked = false } = params;
  if (uiPhase !== 'play') return true;
  if (!session) return true;
  if (session.ended) return true;
  if (commandLocked) return true;
  if (chainPipelineLocked) return true;
  if (session.phase !== 'dispatcher') return true;
  if (session.turn_step !== 'command') return true;
  return false;
}
