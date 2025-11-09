import { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import './App.css';

type Pattern = {
  period: number;
  as: number;
};

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
  const [currentBeat, setCurrentBeat] = useState(0);
  const [currentPattern, setCurrentPattern] = useState<Pattern>(PRESETS[0]);
  const [queuedPattern, setQueuedPattern] = useState<Pattern | null>(null);

  const synthRef = useRef<Tone.Synth | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const nextBeatTimeRef = useRef(0);
  const currentPatternRef = useRef<Pattern>(PRESETS[0]);
  const queuedPatternRef = useRef<Pattern | null>(null);

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

  const schedulePattern = (pattern: Pattern, startTime: number) => {
    const beatTimes = calculateBeatTimes(pattern);

    beatTimes.forEach((beatOffset, index) => {
      const absoluteTime = startTime + beatOffset;
      Tone.Transport.schedule((time) => {
        synthRef.current?.triggerAttackRelease(
          index === 0 ? 'C5' : 'C4',
          '32n',
          time,
        );

        Tone.Draw.schedule(() => {
          setCurrentBeat(index);
        }, time);
      }, absoluteTime);
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

    setCurrentBeat(0);
    setQueuedPattern(null);
    queuedPatternRef.current = null;
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
          <p className="eyebrow">research prototype</p>
          <h1>Parametric Metronome</h1>
        </header>

        <section className="beat-indicators">
          {[0, 1, 2].map((beat) => (
            <div
              key={beat}
              className={`beat-dot ${currentBeat === beat && isPlaying ? 'active' : ''}`}
            >
              <span>{beat === 0 ? 'Start' : beat === 1 ? 'Mid' : 'End'}</span>
            </div>
          ))}
        </section>

        <section className="pattern-display">
          <div className="pattern-row">
            <span>Period</span>
            <strong>{currentPattern.period.toFixed(2)}s</strong>
          </div>
          <div className="pattern-row">
            <span>Asymmetry</span>
            <strong>{currentPattern.as.toFixed(2)}</strong>
          </div>
          <div className="pattern-row">
            <span>BPM</span>
            <strong>{(60 / currentPattern.period).toFixed(1)}</strong>
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
            Random Pattern
          </button>
          <button className="symmetric" onClick={queueSymmetric}>
            Queue Symmetric (as = 0)
          </button>
        </section>

        <footer>
          Tap Start to begin. Random Pattern queues changes at the next loop boundary.
        </footer>
      </div>
    </div>
  );
};

export default App;
