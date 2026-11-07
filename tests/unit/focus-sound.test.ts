import { describe, expect, it, vi } from 'vitest';
import { createFocusSoundPlayer, isFreshSoundEvent } from '../../packages/ui/src/focus-sound';

function harness(shared = new Map<string, string>()) {
  const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    state: 'suspended', currentTime: 0, destination: {}, onstatechange: null,
    resume: vi.fn(async () => { context.state = 'running'; }), close: vi.fn(async () => { context.state = 'closed'; }),
    createOscillator: vi.fn(() => { const oscillator = { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; oscillators.push(oscillator); return oscillator; }),
    createGain: () => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }),
  };
  const changed = vi.fn();
  const environment = { createContext: () => context as unknown as AudioContext, storage: { getItem: (key: string) => shared.get(key) ?? null, setItem: (key: string, value: string) => { shared.set(key, value); } } };
  const player = createFocusSoundPlayer('test-owner', environment, changed);
  return { player, context, oscillators, changed, environment, shared };
}

describe('focus sound alerts', () => {
  it('requires explicit activation and ignores old/future/invalid boundaries', async () => {
    const { player, context } = harness();
    expect(player.state().status).toBe('off');
    expect(await player.notify('round', 1000, 1000)).toBe(false);
    expect(context.resume).not.toHaveBeenCalled();
    expect(await player.enable()).toBe(true);
    expect(player.state().status).toBe('ready');
    for (const [at, now] of [[0, 15001], [2000, 1000], [NaN, 1000]]) expect(await player.notify('round', at, now)).toBe(false);
    expect(isFreshSoundEvent('', 1000, 1000)).toBe(false);
    expect(await player.notify('round', 1000, 1001)).toBe(true);
    expect(await player.notify('round', 1000, 1002)).toBe(false);
    player.dispose();
  });
  it('retains the preference but requires a new gesture after reload; shared storage suppresses duplicate tab alerts', async () => {
    const first = harness(); await first.player.enable();
    expect(await first.player.notify('room-phase', 1000, 1000)).toBe(true);
    const second = harness(first.shared);
    expect(second.player.state().status).toBe('needsGesture');
    expect(await second.player.notify('room-phase', 1000, 1001)).toBe(false);
    await second.player.enable();
    expect(await second.player.notify('room-phase', 1000, 1001)).toBe(false);
    first.player.mute(); second.player.synchronizePreference();
    expect(second.player.state().status).toBe('off');
    expect(await second.player.notify('next-phase', 2000, 2001)).toBe(false);
    first.player.dispose(); second.player.dispose();
  });
  it('serializes simultaneous tab claims through the shared browser lock', async () => {
    const shared = new Map<string, string>();
    let queue = Promise.resolve(false);
    const lock = (_name: string, action: () => boolean) => { const next = queue.then(action); queue = next; return next; };
    const firstBase = harness(shared), secondBase = harness(shared);
    const first = createFocusSoundPlayer('same-account', { ...firstBase.environment, lock }, vi.fn());
    const second = createFocusSoundPlayer('same-account', { ...secondBase.environment, lock }, vi.fn());
    await first.enable(); await second.enable();
    expect(await Promise.all([first.notify('shared-boundary', 1000, 1000), second.notify('shared-boundary', 1000, 1000)])).toEqual([true, false]);
    first.dispose(); second.dispose();
  });
  it('mute cancels in-flight activation and active tones; disposal releases the audio context', async () => {
    const { player, context, oscillators } = harness();
    let resume!: () => void;
    context.resume.mockImplementation(() => new Promise<void>(resolve => { resume = () => { context.state = 'running'; resolve(); }; }));
    const activation = player.enable(); player.mute(); resume();
    expect(await activation).toBe(false); expect(oscillators).toHaveLength(0);
    context.resume.mockImplementation(async () => { context.state = 'running'; });
    await player.enable(); expect(oscillators).toHaveLength(2);
    player.mute(); expect(oscillators.every(tone => tone.stop.mock.calls.length === 2)).toBe(true);
    player.dispose(); expect(context.close).toHaveBeenCalledOnce();
    expect(await player.enable()).toBe(false);
  });
  it('degrades safely when storage or audio is unavailable and coalesces one boundary with two labels', async () => {
    const base = harness();
    const denied = createFocusSoundPlayer('private', { ...base.environment, storage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } }, vi.fn());
    await denied.enable();
    expect(await denied.notify('room-end', 1000, 1000)).toBe(true);
    expect(await denied.notify('solo-settled', 1001, 1001)).toBe(false);
    expect(await denied.notify('break-end', 4000, 4000)).toBe(true);
    denied.dispose();
    const unsupported = createFocusSoundPlayer('none', {}, vi.fn());
    expect(unsupported.state()).toEqual({ available: false, enabled: false, status: 'unavailable' });
    expect(await unsupported.enable()).toBe(false); unsupported.dispose();
  });
});
