import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import * as Tone from 'tone';
import leftSprite from './assets/L.png';
import rightSprite from './assets/R.png';
import leftJumpSprite from './assets/Lj.png';
import rightJumpSprite from './assets/Rj.png';
import './App.css';

type Pattern = {
  period: number;
  as: number;
};

type DisplaySprite = 'L' | 'R' | 'Lj' | 'Rj';

const PERIOD_MIN = 0.25;
const PERIOD_MAX = 1.25;
const PERIOD_STEP = 0.01;
const ASYMMETRY_MIN = -1;
const ASYMMETRY_MAX = 1;
const ASYMMETRY_STEP = 0.05;
const DEFAULT_PATTERN: Pattern = { period: 1.0, as: 0.0 };
const ROUNDS_BEFORE_SWITCH = 3;

const App = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPattern, setCurrentPattern] = useState<Pattern>(DEFAULT_PATTERN);
  const [queuedPattern, setQueuedPattern] = useState<Pattern | null>(null);
  const [displaySprite, setDisplaySprite] = useState<DisplaySprite>('L');
  const [periodSetting, setPeriodSetting] = useState(DEFAULT_PATTERN.period);
  const [asymmetrySetting, setAsymmetrySetting] = useState(DEFAULT_PATTERN.as);

  const synthRef = useRef<Tone.Synth | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const nextBeatTimeRef = useRef(0);
  const currentPatternRef = useRef<Pattern>(DEFAULT_PATTERN);
  const queuedPatternRef = useRef<Pattern | null>(null);
  const nextFootRef = useRef<'L' | 'R'>('L');
  const roundsUntilSwitchRef = useRef(0);

  useEffect(() => {
    synthRef.current = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.05,
        sustain: 0,
        release: 0.05,
      },
    }).toDestination();

    return () => {
      Tone.Transport.cancel();
      Tone.Transport.stop();
      synthRef.current?.dispose();
      loopRef.current?.dispose();
    };
  }, []);

  const calculateBeatTimes = (pattern: Pattern) => {
    const { period, as } = pattern;
    return [0, period * 0.5 * (1 + as), period];
  };

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

  const schedulePattern = (pattern: Pattern, startTime: number) => {
    const beatTimes = calculateBeatTimes(pattern);
    const scheduledFeet: Array<'L' | 'R'> = [];

    beatTimes.forEach((beatOffset, index) => {
      const absoluteTime = startTime + beatOffset;
      const footForBeat = nextFootRef.current;
      nextFootRef.current = footForBeat === 'L' ? 'R' : 'L';
      scheduledFeet.push(footForBeat);

      Tone.Transport.schedule((time) => {
        synthRef.current?.triggerAttackRelease(
          index === 0 ? 'C5' : 'C4',
          '32n',
          time,
        );

        Tone.Draw.schedule(() => {
          setDisplaySprite(footForBeat);
        }, time);
      }, absoluteTime);
    });

    beatTimes.slice(0, -1).forEach((beatOffset, index) => {
      const midpointOffset = (beatOffset + beatTimes[index + 1]) / 2;
      const midpointTime = startTime + midpointOffset;
      const precedingFoot = scheduledFeet[index];

      Tone.Transport.schedule((time) => {
        Tone.Draw.schedule(() => {
          setDisplaySprite(precedingFoot === 'L' ? 'Lj' : 'Rj');
        }, time);
      }, midpointTime);
    });

    return startTime + pattern.period;
  };

  const scheduleNextLoop = (_time?: number) => {
    let patternToPlay = currentPatternRef.current;

    if (queuedPatternRef.current) {
      if (roundsUntilSwitchRef.current <= 0) {
        currentPatternRef.current = queuedPatternRef.current;
        patternToPlay = queuedPatternRef.current;
        setCurrentPattern(queuedPatternRef.current);
        queuedPatternRef.current = null;
        setQueuedPattern(null);
        roundsUntilSwitchRef.current = 0;

        loopRef.current?.dispose();
        loopRef.current = new Tone.Loop(scheduleNextLoop, currentPatternRef.current.period);
        loopRef.current.start(nextBeatTimeRef.current);
      } else {
        roundsUntilSwitchRef.current -= 1;
      }
    }

    nextBeatTimeRef.current = schedulePattern(patternToPlay, nextBeatTimeRef.current);
  };

  const startMetronome = async () => {
    await Tone.start();

    if (isPlaying) return;

    setIsPlaying(true);
    Tone.Transport.cancel();

    currentPatternRef.current = currentPattern;
    queuedPatternRef.current = null;
    setQueuedPattern(null);
    nextFootRef.current = 'L';
    roundsUntilSwitchRef.current = 0;
    setDisplaySprite('L');

    Tone.Transport.start();

    const startTime = Tone.Transport.seconds;
    nextBeatTimeRef.current = schedulePattern(currentPattern, startTime);

    loopRef.current?.dispose();
    loopRef.current = new Tone.Loop(scheduleNextLoop, currentPattern.period);
    loopRef.current.start(nextBeatTimeRef.current);
  };

  const stopMetronome = () => {
    if (!isPlaying) return;

    setIsPlaying(false);
    Tone.Transport.stop();
    Tone.Transport.cancel();
    loopRef.current?.stop();
    loopRef.current?.dispose();
    loopRef.current = null;

    setQueuedPattern(null);
    queuedPatternRef.current = null;
    nextFootRef.current = 'L';
    roundsUntilSwitchRef.current = 0;
    setDisplaySprite('L');
  };

  const queuePattern = (pattern: Pattern) => {
    if (isPlaying) {
      queuedPatternRef.current = pattern;
      setQueuedPattern(pattern);
      roundsUntilSwitchRef.current = ROUNDS_BEFORE_SWITCH;
    } else {
      queuedPatternRef.current = null;
      setQueuedPattern(null);
      currentPatternRef.current = pattern;
      setCurrentPattern(pattern);
      roundsUntilSwitchRef.current = 0;
    }
  };

  const randomizePattern = () => {
    const randomPeriod = Math.random() * (PERIOD_MAX - PERIOD_MIN) + PERIOD_MIN;
    const randomAsymmetry =
      Math.random() * (ASYMMETRY_MAX - ASYMMETRY_MIN) + ASYMMETRY_MIN;
    const nextPeriod = parseFloat(randomPeriod.toFixed(2));
    const nextAsymmetry = parseFloat(randomAsymmetry.toFixed(2));
    const newPattern: Pattern = {
      period: nextPeriod,
      as: nextAsymmetry,
    };

    setPeriodSetting(nextPeriod);
    setAsymmetrySetting(nextAsymmetry);
    queuePattern(newPattern);
  };

  const queueSymmetric = () => {
    const symmetricPattern: Pattern = {
      period: periodSetting,
      as: 0.0,
    };

    setAsymmetrySetting(0);
    queuePattern(symmetricPattern);
  };

  const handlePeriodChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextPeriod = parseFloat(event.target.value);
    setPeriodSetting(nextPeriod);
    queuePattern({ period: nextPeriod, as: asymmetrySetting });
  };

  const handleAsymmetryChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextAsymmetry = parseFloat(event.target.value);
    setAsymmetrySetting(nextAsymmetry);
    queuePattern({ period: periodSetting, as: nextAsymmetry });
  };

  return (
    <div className="app-shell">
      <div className="metronome-card">
        <header>
          <p className="eyebrow">prototype</p>
          <h1>TreadMore</h1>
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
        <section className="pattern-display">
          <div className="slider-control">
            <div className="slider-header">
              <span>Period</span>
              <span className="slider-value">{periodSetting.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min={PERIOD_MIN}
              max={PERIOD_MAX}
              step={PERIOD_STEP}
              value={periodSetting}
              onChange={handlePeriodChange}
            />
            <div className="slider-scale">
              <span>{PERIOD_MIN.toFixed(2)}s</span>
              <span>{PERIOD_MAX.toFixed(2)}s</span>
            </div>
          </div>

          <div className="slider-control">
            <div className="slider-header">
              <span>Asymmetry</span>
              <span className="slider-value">{asymmetrySetting.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={ASYMMETRY_MIN}
              max={ASYMMETRY_MAX}
              step={ASYMMETRY_STEP}
              value={asymmetrySetting}
              onChange={handleAsymmetryChange}
            />
            <div className="slider-scale">
              <span>Symmetric</span>
              <span>Asymmetric</span>
            </div>
          </div>

          {queuedPattern && (
            <p className="queued">
              Coming up: Period {queuedPattern.period.toFixed(2)} s, Asymmetry {queuedPattern.as.toFixed(2)}
            </p>
          )}
        </section>

        <section className="controls">
          <button
            className={isPlaying ? 'stop' : 'start'}
            onClick={isPlaying ? stopMetronome : startMetronome}
          >
            {isPlaying ? 'Stop' : 'Start'}
          </button>
          <button className="randomize" onClick={randomizePattern}>
            Skip/Gallop
          </button>
          <button className="symmetric" onClick={queueSymmetric}>
            Walk/Run
          </button>
        </section>

        <footer>
          Tap Start to begin. Try to match your steps to the beat.
        </footer>
      </div>
    </div>
  );
};

export default App;
