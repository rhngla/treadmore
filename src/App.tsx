import { useEffect, useRef, useState } from 'react';
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

const PRESETS: Pattern[] = [
  { period: 1.0, as: 0.5 },
  { period: 1.0, as: 0.0 },
  { period: 1.0, as: -0.5 },
  { period: 0.8, as: 0.3 },
  { period: 1.2, as: -0.3 },
  { period: 0.6, as: 0.7 },
];

const App = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPattern, setCurrentPattern] = useState<Pattern>(PRESETS[0]);
  const [queuedPattern, setQueuedPattern] = useState<Pattern | null>(null);
  const [displaySprite, setDisplaySprite] = useState<DisplaySprite>('L');

  const synthRef = useRef<Tone.Synth | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const nextBeatTimeRef = useRef(0);
  const currentPatternRef = useRef<Pattern>(PRESETS[0]);
  const queuedPatternRef = useRef<Pattern | null>(null);
  const nextFootRef = useRef<'L' | 'R'>('L');

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
    const patternToPlay = queuedPatternRef.current ?? currentPatternRef.current;

    if (queuedPatternRef.current) {
      currentPatternRef.current = queuedPatternRef.current;
      setCurrentPattern(queuedPatternRef.current);
      queuedPatternRef.current = null;
      setQueuedPattern(null);

      loopRef.current?.dispose();
      loopRef.current = new Tone.Loop(scheduleNextLoop, currentPatternRef.current.period);
      loopRef.current.start(nextBeatTimeRef.current);
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
    setDisplaySprite('L');
  };

  const randomizePattern = () => {
    let newPattern: Pattern;
    do {
      newPattern = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    } while (
      newPattern.period === currentPatternRef.current.period &&
      newPattern.as === currentPatternRef.current.as
    );

    if (isPlaying) {
      queuedPatternRef.current = newPattern;
      setQueuedPattern(newPattern);
    } else {
      currentPatternRef.current = newPattern;
      setCurrentPattern(newPattern);
    }
  };

  const queueSymmetric = () => {
    const symmetricPattern: Pattern = {
      period: currentPatternRef.current.period,
      as: 0.0,
    };

    if (isPlaying) {
      queuedPatternRef.current = symmetricPattern;
      setQueuedPattern(symmetricPattern);
    } else {
      currentPatternRef.current = symmetricPattern;
      setCurrentPattern(symmetricPattern);
    }
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
          <div className="pattern-row">
            <span>Period (seconds)</span>
            <strong>{currentPattern.period.toFixed(2)}</strong>
          </div>
          <div className="pattern-row">
            <span>Asymmetry</span>
            <strong>{currentPattern.as.toFixed(2)}</strong>
          </div>

          {queuedPattern && (
            <p className="queued">
              Next: period {queuedPattern.period.toFixed(2)}s, as {queuedPattern.as.toFixed(2)}
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
            Skip
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
