import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import leftSprite from './assets/L.png';
import rightSprite from './assets/R.png';
import leftJumpSprite from './assets/Lj.png';
import rightJumpSprite from './assets/Rj.png';
import './App.css';

type Foot = 'L' | 'R';
type DisplaySprite = 'L' | 'R' | 'Lj' | 'Rj';
type PatternKind = 'walk' | 'skip' | 'gallop';

type SequenceAction =
  | { type: 'tone'; offset: number; foot: Foot; note: string }
  | { type: 'sprite'; offset: number; sprite: DisplaySprite };

type StepSequence = {
  name: string;
  duration: number;
  actions: SequenceAction[];
};

interface PatternDefinition {
  kind: PatternKind;
  label: string;
  build: (period: number, asymmetry: number) => StepSequence;
}

const PERIOD_MIN = 0.5;
const PERIOD_MAX = 2.0;
const DEFAULT_PERIOD = 1.0;
const DEFAULT_ASYMMETRY = 0.5;
const ASYMMETRY_EPSILON = 0.001;
const INTERVAL_SWITCH_CAP = 0.1;
const LEFT_NOTE = 'C5';
const RIGHT_NOTE = 'E5';

const clampPeriod = (value: number) =>
  Math.min(PERIOD_MAX, Math.max(PERIOD_MIN, value));

const clampAsymmetry = (value: number) => {
  const lower = ASYMMETRY_EPSILON;
  const upper = 1 - ASYMMETRY_EPSILON;
  return Math.min(upper, Math.max(lower, value));
};

const minSwitch = (...intervals: number[]) =>
  Math.min(INTERVAL_SWITCH_CAP, ...intervals.map((i) => i / 3));

class WalkJogPattern implements PatternDefinition {
  kind: PatternKind = 'walk';
  label = 'Walk/Jog';

  build(period: number, _asymmetry: number): StepSequence {
    const safePeriod = clampPeriod(period);
    const intervalLR = safePeriod / 2;
    const intervalRL = intervalLR;
    const intervalSwitch = minSwitch(intervalLR, intervalRL);

    const actions: SequenceAction[] = [
      { type: 'tone', offset: 0, foot: 'L', note: LEFT_NOTE },
      { type: 'sprite', offset: intervalSwitch, sprite: 'Lj' },
      { type: 'tone', offset: intervalLR, foot: 'R', note: RIGHT_NOTE },
      { type: 'sprite', offset: intervalLR + intervalSwitch, sprite: 'Rj' },
    ];

    return {
      name: 'walk/jog',
      duration: intervalLR + intervalRL,
      actions,
    };
  }
}

class SkipPattern implements PatternDefinition {
  kind: PatternKind = 'skip';
  label = 'Skip';

  build(period: number, asymmetry: number): StepSequence {
    const safePeriod = clampPeriod(period);
    const as = clampAsymmetry(asymmetry);

    const intervalRR = (safePeriod / 2) * as;
    const intervalRL = safePeriod * (1 - as / 2);
    const intervalLL = intervalRR;
    const intervalLR = intervalRL;

    const intervalSwitch = minSwitch(intervalLL, intervalRR, intervalLR, intervalRL);

    let t = 0;
    const actions: SequenceAction[] = [];

    actions.push({ type: 'tone', offset: t, foot: 'L', note: LEFT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Lj' });
    t += intervalLR - intervalSwitch;

    actions.push({ type: 'tone', offset: t, foot: 'R', note: RIGHT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Rj' });
    t += intervalRR - intervalSwitch;

    actions.push({ type: 'tone', offset: t, foot: 'R', note: RIGHT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Rj' });
    t += intervalRL - intervalSwitch;

    actions.push({ type: 'tone', offset: t, foot: 'L', note: LEFT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Lj' });
    t += intervalLL - intervalSwitch;

    return {
      name: 'skip',
      duration: t,
      actions,
    };
  }
}

class GallopPattern implements PatternDefinition {
  kind: PatternKind = 'gallop';
  label = 'Gallop';

  build(period: number, asymmetry: number): StepSequence {
    const safePeriod = clampPeriod(period);
    const as = clampAsymmetry(asymmetry);

    const intervalRL = (safePeriod / 2) * as;
    const intervalLR = safePeriod * (1 - as / 2);
    const intervalSwitch = minSwitch(intervalLR, intervalRL);

    const actions: SequenceAction[] = [
      { type: 'tone', offset: 0, foot: 'L', note: LEFT_NOTE },
      { type: 'sprite', offset: intervalSwitch, sprite: 'Lj' },
      { type: 'tone', offset: intervalLR, foot: 'R', note: RIGHT_NOTE },
      { type: 'sprite', offset: intervalLR + intervalSwitch, sprite: 'Rj' },
    ];

    return {
      name: 'gallop',
      duration: intervalLR + intervalRL,
      actions,
    };
  }
}

const PATTERNS: Record<PatternKind, PatternDefinition> = {
  walk: new WalkJogPattern(),
  skip: new SkipPattern(),
  gallop: new GallopPattern(),
};

class StepScheduler {
  private nextCycleId: number | null = null;
  private scheduledActionIds: number[] = [];
  private running = false;
  private currentSequence: StepSequence | null = null;
  private pendingSequence: StepSequence | null = null;
  private leftSynth: Tone.Synth;
  private rightSynth: Tone.Synth;
  private setSprite: (sprite: DisplaySprite) => void;
  private logEvent: (label: string, payload?: Record<string, unknown>) => void;
  private scheduleCycleBound: (time: number) => void;

  constructor(
    setSprite: (sprite: DisplaySprite) => void,
    logEvent: (label: string, payload?: Record<string, unknown>) => void,
  ) {
    this.setSprite = setSprite;
    this.logEvent = logEvent;
    this.leftSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).toDestination();
    (this.leftSynth as unknown as { _label?: string })._label = 'left';

    this.rightSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).toDestination();
    (this.rightSynth as unknown as { _label?: string })._label = 'right';
    this.scheduleCycleBound = () => this.scheduleCycle(Tone.Transport.seconds);
  }

  applySequence(sequence: StepSequence) {
    if (!this.running) {
      this.startFresh(sequence);
      return;
    }

    this.pendingSequence = sequence;
    this.logEvent('pattern-queued', { pattern: sequence.name });
  }

  stop() {
    this.resetTransport();
    this.running = false;
    this.pendingSequence = null;
    this.currentSequence = null;
    this.logEvent('stopped');
  }

  dispose() {
    this.stop();
    this.leftSynth.dispose();
    this.rightSynth.dispose();
  }

  private startFresh(sequence: StepSequence) {
    this.resetTransport();
    this.currentSequence = sequence;
    this.running = true;
    this.pendingSequence = null;
    this.logEvent('pattern-init', { pattern: sequence.name });

    this.scheduleCycle(Tone.Transport.seconds);
    Tone.Transport.start();
  }

  private resetTransport() {
    if (this.nextCycleId !== null) {
      Tone.Transport.clear(this.nextCycleId);
      this.nextCycleId = null;
    }
    this.clearScheduledActions();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
  }

  private scheduleCycle(cycleStart: number) {
    if (!this.running) return;

    if (this.pendingSequence) {
      this.currentSequence = this.pendingSequence;
      this.pendingSequence = null;
      if (this.currentSequence) {
        this.logEvent('pattern-init', { pattern: this.currentSequence.name });
      }
    }

    const sequence = this.currentSequence;
    if (!sequence) return;

    this.scheduleActions(sequence, cycleStart);
    const nextStart = cycleStart + sequence.duration;
    this.nextCycleId = Tone.Transport.scheduleOnce(this.scheduleCycleBound, nextStart);
  }

  private scheduleActions(sequence: StepSequence, cycleStart: number) {
    this.clearScheduledActions();
    sequence.actions.forEach((action) => {
      const eventId = Tone.Transport.schedule(
        (time) => this.executeAction(action, time),
        cycleStart + action.offset,
      );
      this.scheduledActionIds.push(eventId);
    });
  }

  private clearScheduledActions() {
    this.scheduledActionIds.forEach((id) => Tone.Transport.clear(id));
    this.scheduledActionIds = [];
  }

  private executeAction(action: SequenceAction, scheduledTime: number) {
    if (action.type === 'tone') {
      const synth = action.foot === 'L' ? this.leftSynth : this.rightSynth;
      synth.triggerAttackRelease(action.note, 0.08, scheduledTime);
      this.logEvent('step', {
        pattern: this.currentSequence?.name,
        foot: action.foot,
        at: scheduledTime,
      });
      Tone.Draw.schedule(() => this.setSprite(action.foot), scheduledTime);
      return;
    }

    Tone.Draw.schedule(() => this.setSprite(action.sprite), scheduledTime);
  }
}

const spriteSources: Record<DisplaySprite, string> = {
  L: leftSprite,
  R: rightSprite,
  Lj: leftJumpSprite,
  Rj: rightJumpSprite,
};

const spriteAlt: Record<DisplaySprite, string> = {
  L: 'Left step',
  R: 'Right step',
  Lj: 'Jump between left and right',
  Rj: 'Jump between right and left',
};

const App = () => {
  const [pattern, setPattern] = useState<PatternKind>('walk');
  const [periodInput, setPeriodInput] = useState(DEFAULT_PERIOD.toFixed(2));
  const [asymmetryInput, setAsymmetryInput] = useState('0.00');
  const [displaySprite, setDisplaySprite] = useState<DisplaySprite>('L');
  const [isPlaying, setIsPlaying] = useState(false);

  const logEvent = useCallback(
    (label: string, payload?: Record<string, unknown>) => {
      const stamp = new Date().toISOString();
      if (payload) {
        console.log(`[${stamp}] ${label}`, payload);
      } else {
        console.log(`[${stamp}] ${label}`);
      }
    },
    [],
  );

  const schedulerRef = useRef<StepScheduler | null>(null);

  useEffect(() => {
    schedulerRef.current = new StepScheduler(setDisplaySprite, logEvent);
    return () => schedulerRef.current?.dispose();
  }, [logEvent]);

  const currentPattern = useMemo(() => PATTERNS[pattern], [pattern]);

  const stopMetronome = () => {
    logEvent('button', { name: 'stop' });
    schedulerRef.current?.stop();
    setIsPlaying(false);
    setDisplaySprite('L');
  };

  const getEffectiveValues = (kind: PatternKind, periodStr = periodInput, asymStr = asymmetryInput) => {
    const parsedPeriod = Number.parseFloat(periodStr);
    const parsedAsymmetry = Number.parseFloat(asymStr);
    const periodInvalid =
      !Number.isFinite(parsedPeriod) || parsedPeriod < PERIOD_MIN || parsedPeriod > PERIOD_MAX;

    const rawAsymmetry =
      Number.isFinite(parsedAsymmetry) && parsedAsymmetry > 0 && parsedAsymmetry < 1
        ? parsedAsymmetry
        : DEFAULT_ASYMMETRY;
    const asymmetry = kind === 'walk' ? 0 : clampAsymmetry(rawAsymmetry);

    const asymmetryInvalidForKind =
      kind !== 'walk' &&
      (!Number.isFinite(parsedAsymmetry) || parsedAsymmetry <= 0 || parsedAsymmetry >= 1);

    return {
      period: clampPeriod(Number.isFinite(parsedPeriod) ? parsedPeriod : DEFAULT_PERIOD),
      asymmetry,
      valid: !periodInvalid && !asymmetryInvalidForKind,
    };
  };

  const {
    period: effectivePeriod,
    asymmetry: effectiveAsymmetry,
    valid: inputsValid,
  } = getEffectiveValues(pattern);

  const onPatternPress = async (kind: PatternKind) => {
    logEvent('button', { name: 'select-pattern', pattern: kind });
    setPattern(kind);
    const parsed = Number.parseFloat(asymmetryInput);
    let nextAsymmetryInput = asymmetryInput;

    if (kind === 'walk') {
      nextAsymmetryInput = '0.00';
    } else if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
      nextAsymmetryInput = DEFAULT_ASYMMETRY.toFixed(2);
    }
    setAsymmetryInput(nextAsymmetryInput);

    const { period: periodValue, asymmetry: asymmetryValue, valid } = getEffectiveValues(
      kind,
      periodInput,
      nextAsymmetryInput,
    );

    if (!schedulerRef.current || !isPlaying || !valid) return;

    await Tone.start();
    const sequence = PATTERNS[kind].build(periodValue, asymmetryValue);
    schedulerRef.current.applySequence(sequence);
    setDisplaySprite('L');

    // Update input boxes to reflect any fallbacks/clamps we applied.
    setPeriodInput(periodValue.toFixed(2));
    setAsymmetryInput(asymmetryValue.toFixed(2));
  };

  const handleApply = async () => {
    logEvent('button', {
      name: 'apply',
      pattern,
      period: periodInput,
      asymmetry: asymmetryInput,
    });

    if (!schedulerRef.current) return;

    const { period, asymmetry, valid } = getEffectiveValues(pattern);
    if (!valid) return;

    await Tone.start();
    const sequence = PATTERNS[pattern].build(period, asymmetry);
    schedulerRef.current.applySequence(sequence);
    setIsPlaying(true);
    setDisplaySprite('L');

    setPeriodInput(period.toFixed(2));
    setAsymmetryInput(asymmetry.toFixed(2));
  };

  return (
    <div className="app-shell">
      <div className="metronome-card">
        <header>
          <p className="eyebrow">Metronome</p>
          <h1>TreadMore</h1>
          <p className="lede">Cues for different gait patterns</p>
        </header>

        <section className="beat-indicators">
          <div className={`beat-dot ${isPlaying ? 'active' : ''}`}>
            <img
              src={spriteSources[displaySprite]}
              alt={spriteAlt[displaySprite]}
              className="beat-sprite"
            />
          </div>
        </section>

        <section className="pattern-selector">
          <p className="section-title">Pattern</p>
          <div className="pattern-buttons">
            {(Object.values(PATTERNS) as PatternDefinition[]).map((item) => {
              return (
                <button
                  key={item.kind}
                  className={pattern === item.kind ? 'active' : ''}
                  onClick={() => onPatternPress(item.kind)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="inputs">
          <div className="field">
            <label htmlFor="period">Period (seconds)</label>
            <input
              id="period"
              type="number"
              min={PERIOD_MIN}
              max={PERIOD_MAX}
              step={0.01}
              value={periodInput}
              onChange={(event) => setPeriodInput(event.target.value)}
            />
            <p className="hint">
              Range: ({PERIOD_MIN.toFixed(2)}, {PERIOD_MAX.toFixed(2)})
            </p>
          </div>

          <div className="field">
            <label htmlFor="asymmetry">
              Asymmetry {pattern === 'walk' && <span className="tag">locked</span>}
            </label>
            <input
              id="asymmetry"
              type="number"
              min={ASYMMETRY_EPSILON}
              max={1 - ASYMMETRY_EPSILON}
              step={0.01}
              value={asymmetryInput}
              onChange={(event) => setAsymmetryInput(event.target.value)}
              disabled={pattern === 'walk'}
            />
            <p className="hint">Range: (0, 1)</p>
          </div>
        </section>

        <section className="controls">
          <button className="start" onClick={handleApply} disabled={!inputsValid}>
            Apply
          </button>
          <button className="stop" onClick={stopMetronome} disabled={!isPlaying}>
            Stop
          </button>
        </section>

        <footer>
          <p className="status">
            Pattern: <strong>{currentPattern.label}</strong> · Period{' '}
            {effectivePeriod.toFixed(2)}s · Asymmetry {effectiveAsymmetry.toFixed(2)}
          </p>
          <p className="status note">
            Updated: &mdash; Nov 2025
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;
