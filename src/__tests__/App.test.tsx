import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetToneState, toneModule, toneState } from './toneMock';

vi.mock('tone', () => toneModule);
import App from '../App';

const logOutput = (label: string) => {
  const tones = toneState.toneLog
    .map((evt) => `${evt.note}@${evt.time.toFixed(2)}(${evt.kind})`)
    .join(', ');
  const buttons = toneState.buttonLog.map((btn) => `${btn.label}@${btn.at.toFixed(2)}`).join(', ');
  console.log(`${label} buttons -> ${buttons}`);
  console.log(`${label} tones   -> ${tones}`);
};

describe('pattern timing and controls', () => {
  beforeEach(() => {
    resetToneState();
  });

  it('plays symmetric walk/jog cycles', async () => {
    const user = userEvent.setup();
    render(<App />);

    const applyButton = screen.getByRole('button', { name: /apply/i });
    await user.click(applyButton);
    toneState.buttonLog.push({ label: 'apply', at: toneState.transport.seconds });

    await act(async () => {
      toneState.transport.advanceTo(2);
    });

    const times = toneState.toneLog.map((evt) => evt.time);
    times.slice(0, 5).forEach((t, i) => expect(t).toBeCloseTo([0, 0.5, 1, 1.5, 2][i]));
    expect(toneState.toneLog.map((evt) => evt.note).slice(0, 4)).toEqual(['C5', 'E5', 'C5', 'E5']);
    const wallTimes = toneState.toneLog.map((evt) => evt.wallTime);
    wallTimes.slice(0, 5).forEach((t, i) => expect(t).toBeCloseTo([0, 0.5, 1, 1.5, 2][i]));

    logOutput('walk');
  });

  it('switches to gallop with asymmetric timing', async () => {
    const user = userEvent.setup();
    render(<App />);

    const gallopButton = screen.getByRole('button', { name: /gallop/i });
    await user.click(gallopButton);
    toneState.buttonLog.push({ label: 'gallop', at: toneState.transport.seconds });

    const asymInput = screen.getByLabelText(/asymmetry/i);
    await user.clear(asymInput);
    await user.type(asymInput, '0.6');

    const applyButton = screen.getByRole('button', { name: /apply/i });
    await user.click(applyButton);
    toneState.buttonLog.push({ label: 'apply', at: toneState.transport.seconds });

    await act(async () => {
      toneState.transport.advanceTo(2);
    });

    const toneTimes = toneState.toneLog.map((evt) => evt.time);
    toneTimes.slice(0, 4).forEach((t, i) => expect(t).toBeCloseTo([0, 0.7, 1, 1.7][i]));
    expect(toneState.toneLog.map((evt) => evt.note).slice(0, 2)).toEqual(['C5', 'E5']);
    const wallTimes = toneState.toneLog.map((evt) => evt.wallTime);
    wallTimes.slice(0, 4).forEach((t, i) => expect(t).toBeCloseTo([0, 0.7, 1, 1.7][i]));

    logOutput('gallop');
  });

  it('plays skip pattern and respects queued pattern change while playing', async () => {
    const user = userEvent.setup();
    render(<App />);

    const skipButton = screen.getByRole('button', { name: /skip/i });
    await user.click(skipButton);
    toneState.buttonLog.push({ label: 'skip', at: toneState.transport.seconds });

    const asymInput = screen.getByLabelText(/asymmetry/i);
    await user.clear(asymInput);
    await user.type(asymInput, '0.6');

    const applyButton = screen.getByRole('button', { name: /apply/i });
    await user.click(applyButton);
    toneState.buttonLog.push({ label: 'apply', at: toneState.transport.seconds });

    await user.click(screen.getByRole('button', { name: /walk/i }));
    toneState.buttonLog.push({ label: 'walk', at: toneState.transport.seconds });

    await act(async () => {
      toneState.transport.advanceTo(3.1);
    });
    const firstCycleTimes = toneState.toneLog.filter((evt) => evt.time < 2).map((evt) => evt.time);
    firstCycleTimes.slice(0, 4).forEach((t, i) => expect(t).toBeCloseTo([0, 0.7, 1, 1.7][i]));

    const secondCycleTimes = toneState.toneLog
      .filter((evt) => evt.time >= 2 && evt.time < 3)
      .map((evt) => evt.time);
    secondCycleTimes.slice(0, 2).forEach((t, i) => expect(t).toBeCloseTo([2, 2.5][i]));
    const wallTimes = toneState.toneLog.map((evt) => evt.wallTime);
    const firstWall = wallTimes.filter((t) => t < 2);
    firstWall.slice(0, 4).forEach((t, i) => expect(t).toBeCloseTo([0, 0.7, 1, 1.7][i]));
    const secondWall = wallTimes.filter((t) => t >= 2 && t < 3);
    secondWall.slice(0, 2).forEach((t, i) => expect(t).toBeCloseTo([2, 2.5][i]));

    logOutput('skip-to-walk');
  });
});
