import { useEffect, useMemo, useRef, useState } from 'react';
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

    return { duration: intervalLR + intervalRL, actions };
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

    // L
    actions.push({ type: 'tone', offset: t, foot: 'L', note: LEFT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Lj' });
    t += intervalLR - intervalSwitch;

    // R
    actions.push({ type: 'tone', offset: t, foot: 'R', note: RIGHT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Rj' });
    t += intervalRR - intervalSwitch;

    // R
    actions.push({ type: 'tone', offset: t, foot: 'R', note: RIGHT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Rj' });
    t += intervalRL - intervalSwitch;

    // L
    actions.push({ type: 'tone', offset: t, foot: 'L', note: LEFT_NOTE });
    t += intervalSwitch;
    actions.push({ type: 'sprite', offset: t, sprite: 'Lj' });
    t += intervalLL - intervalSwitch;

    return { duration: t, actions };
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

    return { duration: intervalLR + intervalRL, actions };
  }
}

const PATTERNS: Record<PatternKind, PatternDefinition> = {
  walk: new WalkJogPattern(),
  skip: new SkipPattern(),
  gallop: new GallopPattern(),
};

class StepScheduler {
  private nextCycleId: number | null = null;
  private running = false;
  private currentSequence: StepSequence | null = null;
  private pendingSequence: StepSequence | null = null;
  private leftSynth: Tone.Synth;
  private rightSynth: Tone.Synth;
  private setSprite: (sprite: DisplaySprite) => void;
  private scheduleCycleBound: () => void;

  constructor(setSprite: (sprite: DisplaySprite) => void) {
    this.setSprite = setSprite;
    this.leftSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).toDestination();

    this.rightSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).toDestination();
    this.scheduleCycleBound = () => this.scheduleCycle();
  }

  start(sequence: StepSequence) {
    this.stop();
    this.currentSequence = sequence;
    this.running = true;
    Tone.Transport.cancel();

    this.scheduleCycle();
    Tone.Transport.start();
  }

  queueNext(sequence: StepSequence) {
    if (!this.running) {
      this.start(sequence);
      return;
    }

    this.pendingSequence = sequence;
  }

  stop() {
    if (this.nextCycleId !== null) {
      Tone.Transport.clear(this.nextCycleId);
      this.nextCycleId = null;
    }

    if (this.running) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
    }

    this.running = false;
    this.pendingSequence = null;
    this.currentSequence = null;
  }

  dispose() {
    this.stop();
    this.leftSynth.dispose();
    this.rightSynth.dispose();
  }

  private scheduleCycle() {
    if (!this.running) return;

    if (this.pendingSequence) {
      this.currentSequence = this.pendingSequence;
      this.pendingSequence = null;
    }

    const sequence = this.currentSequence;
    if (!sequence) return;

    const startTime = Tone.Transport.seconds;
    sequence.actions.forEach((action) => this.executeAction(action, startTime));

    const nextStart = startTime + sequence.duration;
    this.nextCycleId = Tone.Transport.scheduleOnce(this.scheduleCycleBound, nextStart);
  }

  private executeAction(action: SequenceAction, cycleStart: number) {
    const targetTime = cycleStart + action.offset;

    if (action.type === 'tone') {
      const synth = action.foot === 'L' ? this.leftSynth : this.rightSynth;
      synth.triggerAttackRelease(action.note, 0.08, targetTime);
      Tone.Draw.schedule(() => this.setSprite(action.foot), targetTime);
      return;
    }

    Tone.Draw.schedule(() => this.setSprite(action.sprite), targetTime);
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
  const [asymmetryInput, setAsymmetryInput] = useState(DEFAULT_ASYMMETRY.toFixed(2));
  const [displaySprite, setDisplaySprite] = useState<DisplaySprite>('L');
  const [isPlaying, setIsPlaying] = useState(false);

  const schedulerRef = useRef<StepScheduler | null>(null);

  useEffect(() => {
    schedulerRef.current = new StepScheduler(setDisplaySprite);
    return () => schedulerRef.current?.dispose();
  }, []);

  const currentPattern = useMemo(() => PATTERNS[pattern], [pattern]);

  const parsedPeriod = Number.parseFloat(periodInput);
  const parsedAsymmetry = Number.parseFloat(asymmetryInput);
  const periodInvalid = !Number.isFinite(parsedPeriod) || parsedPeriod < PERIOD_MIN || parsedPeriod > PERIOD_MAX;

  const stopMetronome = () => {
    schedulerRef.current?.stop();
    setIsPlaying(false);
    setDisplaySprite('L');
  };

  const getEffectiveValues = (kind: PatternKind) => {
    const period = clampPeriod(Number.isFinite(parsedPeriod) ? parsedPeriod : DEFAULT_PERIOD);
    const rawAsymmetry =
      Number.isFinite(parsedAsymmetry) && parsedAsymmetry > 0 && parsedAsymmetry < 1
        ? parsedAsymmetry
        : DEFAULT_ASYMMETRY;
    const asymmetry = kind === 'walk' ? 0 : clampAsymmetry(rawAsymmetry);

    const asymmetryInvalid =
      kind !== 'walk' &&
      (!Number.isFinite(parsedAsymmetry) || parsedAsymmetry <= 0 || parsedAsymmetry >= 1);

    return {
      period,
      asymmetry,
      valid: !periodInvalid && !asymmetryInvalid,
    };
  };

  const { period: effectivePeriod, asymmetry: effectiveAsymmetry } = getEffectiveValues(pattern);

  const onPatternPress = async (kind: PatternKind) => {
    setPattern(kind);
    const parsed = Number.parseFloat(asymmetryInput);

    if (kind === 'walk') {
      setAsymmetryInput('0.00');
    } else if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
      setAsymmetryInput(DEFAULT_ASYMMETRY.toFixed(2));
    }

    const rawAsymmetry =
      Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_ASYMMETRY;
    const asymmetryValue = kind === 'walk' ? 0 : clampAsymmetry(rawAsymmetry);
    const periodValue = clampPeriod(Number.isFinite(parsedPeriod) ? parsedPeriod : DEFAULT_PERIOD);

    if (!schedulerRef.current) return;

    await Tone.start();
    const sequence = PATTERNS[kind].build(periodValue, asymmetryValue);
    schedulerRef.current.queueNext(sequence);
    setIsPlaying(true);
    setDisplaySprite('L');

    // Update input boxes to reflect any fallbacks/clamps we applied.
    setPeriodInput(periodValue.toFixed(2));
    setAsymmetryInput(asymmetryValue.toFixed(2));
  };

  return (
    <div className="app-shell">
      <div className="metronome-card">
        <header>
          <p className="eyebrow">Metronome</p>
          <h1>TreadMore</h1>
          <p className="lede">Cue different stepping patterns with Tone.js</p>
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
          <p className="section-title">Select pattern</p>
          <div className="pattern-buttons">
            {(Object.values(PATTERNS) as PatternDefinition[]).map((item) => {
              const disabled = periodInvalid;
              return (
                <button
                  key={item.kind}
                  className={pattern === item.kind ? 'active' : ''}
                  onClick={() => onPatternPress(item.kind)}
                  disabled={disabled}
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
              Allowed: {PERIOD_MIN.toFixed(2)} – {PERIOD_MAX.toFixed(2)}s
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
            <p className="hint">Use values in (0, 1)</p>
          </div>
        </section>

        <section className="controls">
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
            Interval switch capped at {INTERVAL_SWITCH_CAP.toFixed(2)}s and recalculated per pattern.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;
