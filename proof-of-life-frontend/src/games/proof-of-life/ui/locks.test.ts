import { describe, expect, it } from 'bun:test';
import { shouldDisableChadCommands } from './locks';

describe('ui/locks', () => {
  const baseSession: any = {
    ended: false,
    phase: 'dispatcher',
    turn_step: 'command',
  };

  it('disables when not in play phase', () => {
    expect(shouldDisableChadCommands({ uiPhase: 'boot', session: baseSession, commandLocked: false })).toBe(true);
  });

  it('disables when commandLocked', () => {
    expect(shouldDisableChadCommands({ uiPhase: 'play', session: baseSession, commandLocked: true })).toBe(true);
  });

  it('disables when chain pipeline is locked', () => {
    expect(
      shouldDisableChadCommands({
        uiPhase: 'play',
        session: baseSession,
        commandLocked: false,
        chainPipelineLocked: true,
      })
    ).toBe(true);
  });

  it('disables when wrong session phase/step', () => {
    expect(
      shouldDisableChadCommands({
        uiPhase: 'play',
        session: { ...baseSession, phase: 'assassin' },
        commandLocked: false,
      })
    ).toBe(true);
    expect(
      shouldDisableChadCommands({
        uiPhase: 'play',
        session: { ...baseSession, turn_step: 'action' },
        commandLocked: false,
      })
    ).toBe(true);
  });

  it('enables only in dispatcher+command when not locked', () => {
    expect(shouldDisableChadCommands({ uiPhase: 'play', session: baseSession, commandLocked: false })).toBe(false);
  });
});
