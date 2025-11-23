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

    const t0 = 0;
    const t1 = t0 + intervalSwitch;
    const t2 = t0 + intervalLR;
    const t3 = t2 + intervalSwitch;
    const t4 = t2 + intervalRR;
    const t5 = t4 + intervalSwitch;
    const t6 = t4 + intervalRL;
    const t7 = t6 + intervalSwitch;
    const duration = t6 + intervalLL;

    const actions: SequenceAction[] = [
      { type: 'tone', offset: t0, foot: 'L', note: LEFT_NOTE },
      { type: 'sprite', offset: t1, sprite: 'Lj' },
      { type: 'tone', offset: t2, foot: 'R', note: RIGHT_NOTE },
      { type: 'sprite', offset: t3, sprite: 'Rj' },
      { type: 'tone', offset: t4, foot: 'R', note: RIGHT_NOTE },
      { type: 'sprite', offset: t5, sprite: 'Rj' },
      { type: 'tone', offset: t6, foot: 'L', note: LEFT_NOTE },
      { type: 'sprite', offset: t7, sprite: 'Lj' },
    ];

    return { duration, actions };
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
  private loopId: number | null = null;
  private running = false;
  private sequence: StepSequence | null = null;
  private leftSynth: Tone.Synth;
  private rightSynth: Tone.Synth;
  private setSprite: (sprite: DisplaySprite) => void;

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
  }

  start(sequence: StepSequence) {
    this.stop();
    this.sequence = sequence;
    this.running = true;
    Tone.Transport.cancel();

    this.loopId = Tone.Transport.scheduleRepeat(
      (time) => {
        if (!this.running || !this.sequence) return;
        this.sequence.actions.forEach((action) => this.executeAction(action, time));
      },
      sequence.duration,
      0,
    );

    Tone.Transport.start();
  }

  stop() {
    if (this.loopId !== null) {
      Tone.Transport.clear(this.loopId);
      this.loopId = null;
    }

    if (this.running) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
    }

    this.running = false;
  }

  dispose() {
    this.stop();
    this.leftSynth.dispose();
    this.rightSynth.dispose();
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
  const [asymmetryInput, setAsymmetryInput] = useState('0.00');
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
  const asymmetryInvalid =
    pattern !== 'walk' &&
    (!Number.isFinite(parsedAsymmetry) || parsedAsymmetry <= 0 || parsedAsymmetry >= 1);
  const canPlay = !periodInvalid && !asymmetryInvalid;

  const effectivePeriod = clampPeriod(Number.isFinite(parsedPeriod) ? parsedPeriod : DEFAULT_PERIOD);
  const effectiveAsymmetry =
    pattern === 'walk'
      ? 0
      : clampAsymmetry(Number.isFinite(parsedAsymmetry) ? parsedAsymmetry : DEFAULT_ASYMMETRY);

  const startMetronome = async () => {
    if (!canPlay || !schedulerRef.current) return;

    await Tone.start();
    const sequence = currentPattern.build(effectivePeriod, effectiveAsymmetry);
    schedulerRef.current.start(sequence);
    setIsPlaying(true);
    setDisplaySprite('L');
  };

  const stopMetronome = () => {
    schedulerRef.current?.stop();
    setIsPlaying(false);
    setDisplaySprite('L');
  };

  const onPatternSelect = (kind: PatternKind) => {
    setPattern(kind);
    const parsed = Number.parseFloat(asymmetryInput);

    if (kind === 'walk') {
      setAsymmetryInput('0.00');
    } else if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
      setAsymmetryInput(DEFAULT_ASYMMETRY.toFixed(2));
    }

    if (isPlaying) {
      stopMetronome();
    }
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
            {(Object.values(PATTERNS) as PatternDefinition[]).map((item) => (
              <button
                key={item.kind}
                className={pattern === item.kind ? 'active' : ''}
                onClick={() => onPatternSelect(item.kind)}
              >
                {item.label}
              </button>
            ))}
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
          <button className="start" onClick={startMetronome} disabled={!canPlay || isPlaying}>
            Play
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
            Interval switch capped at {INTERVAL_SWITCH_CAP.toFixed(2)}s and recalculated per pattern.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;
