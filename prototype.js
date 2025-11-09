import React, { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';

const MetronomeApp = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0); // 0: start, 1: middle, 2: end
  const [currentPattern, setCurrentPattern] = useState({ period: 1.0, as: 0.5 });
  const [queuedPattern, setQueuedPattern] = useState(null);
  
  const synthRef = useRef(null);
  const loopRef = useRef(null);
  const nextBeatTimeRef = useRef(0);
  const currentPatternRef = useRef({ period: 1.0, as: 0.5 });
  const queuedPatternRef = useRef(null);
  
  // Load Inter font
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }, []);
  
  // Preset patterns (we'll expand this later)
  const presets = [
    { period: 1.0, as: 0.5 },
    { period: 1.0, as: 0.0 },
    { period: 1.0, as: -0.5 },
    { period: 0.8, as: 0.3 },
    { period: 1.2, as: -0.3 },
    { period: 0.6, as: 0.7 },
  ];
  
  // Calculate beat times for a pattern
  const calculateBeatTimes = (pattern) => {
    const { period, as } = pattern;
    return [
      0,                              // start
      period * 0.5 * (1 + as),       // middle (asymmetric)
      period                          // end
    ];
  };
  
  // Initialize synth
  useEffect(() => {
    synthRef.current = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.05,
        sustain: 0,
        release: 0.05
      }
    }).toDestination();
    
    return () => {
      if (synthRef.current) {
        synthRef.current.dispose();
      }
      if (loopRef.current) {
        loopRef.current.dispose();
      }
    };
  }, []);
  
  const schedulePattern = (pattern, startTime) => {
    const beatTimes = calculateBeatTimes(pattern);
    
    beatTimes.forEach((beatOffset, index) => {
      const absoluteTime = startTime + beatOffset;
      
      // Schedule the click sound
      Tone.Transport.schedule((time) => {
        synthRef.current.triggerAttackRelease(
          index === 0 ? 'C5' : 'C4', // Higher pitch for start beat
          '32n',
          time
        );
        
        // Update visual indicator (with slight delay to sync with audio)
        Tone.Draw.schedule(() => {
          setCurrentBeat(index);
        }, time);
      }, absoluteTime);
    });
    
    return startTime + pattern.period;
  };
  
  const startMetronome = async () => {
    // Start audio context (required for mobile)
    await Tone.start();
    
    if (!isPlaying) {
      setIsPlaying(true);
      
      // Clear any existing scheduled events
      Tone.Transport.cancel();
      
      // Initialize refs
      currentPatternRef.current = currentPattern;
      queuedPatternRef.current = null;
      
      // Start transport
      Tone.Transport.start();
      
      // Schedule first pattern starting now
      const startTime = Tone.Transport.seconds;
      nextBeatTimeRef.current = schedulePattern(currentPattern, startTime);
      
      // Set up loop to schedule next patterns
      const scheduleNext = (time) => {
        // Check if there's a queued pattern
        const patternToPlay = queuedPatternRef.current || currentPatternRef.current;
        
        // If there was a queued pattern, make it current
        if (queuedPatternRef.current) {
          currentPatternRef.current = queuedPatternRef.current;
          setCurrentPattern(queuedPatternRef.current);
          queuedPatternRef.current = null;
          setQueuedPattern(null);
          
          // Recreate loop with new period
          if (loopRef.current) {
            loopRef.current.dispose();
          }
          loopRef.current = new Tone.Loop(scheduleNext, currentPatternRef.current.period);
          loopRef.current.start(nextBeatTimeRef.current);
        }
        
        // Schedule next pattern
        nextBeatTimeRef.current = schedulePattern(patternToPlay, nextBeatTimeRef.current);
      };
      
      loopRef.current = new Tone.Loop(scheduleNext, currentPattern.period);
      loopRef.current.start(nextBeatTimeRef.current);
    }
  };
  
  const stopMetronome = () => {
    if (isPlaying) {
      setIsPlaying(false);
      Tone.Transport.stop();
      Tone.Transport.cancel();
      
      if (loopRef.current) {
        loopRef.current.stop();
        loopRef.current.dispose();
        loopRef.current = null;
      }
      
      setCurrentBeat(0);
      setQueuedPattern(null);
    }
  };
  
  const randomizePattern = () => {
    // Pick a random preset different from current
    let newPattern;
    do {
      newPattern = presets[Math.floor(Math.random() * presets.length)];
    } while (newPattern.period === currentPattern.period && newPattern.as === currentPattern.as);
    
    if (isPlaying) {
      // Queue the pattern to start at next loop boundary
      queuedPatternRef.current = newPattern;
      setQueuedPattern(newPattern);
    } else {
      // If not playing, change immediately
      currentPatternRef.current = newPattern;
      setCurrentPattern(newPattern);
    }
  };
  
  const queueSymmetric = () => {
    // Queue a symmetric pattern (as=0) with current period
    const symmetricPattern = { 
      period: currentPatternRef.current.period, 
      as: 0.0 
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
    <div className="min-h-screen bg-[#fef5ed] text-[#3d2f2a] flex flex-col items-center justify-center p-4" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-4xl font-bold text-center mb-8 text-[#3d2f2a]">Parametric Metronome</h1>
        
        {/* Beat Indicator */}
        <div className="flex justify-center space-x-4 mb-8">
          {[0, 1, 2].map((beat) => (
            <div
              key={beat}
              className={`w-16 h-16 rounded-full border-4 transition-all duration-100 ${
                currentBeat === beat && isPlaying
                  ? 'bg-[#f5d6a8] border-[#e8c17f] scale-110 shadow-lg'
                  : 'bg-[#f5f1e8] border-[#d4c4b8]'
              }`}
            >
              <div className="flex items-center justify-center h-full text-xs font-semibold text-[#3d2f2a]">
                {beat === 0 ? 'Start' : beat === 1 ? 'Mid' : 'End'}
              </div>
            </div>
          ))}
        </div>
        
        {/* Pattern Display */}
        <div className="bg-[#f5f1e8] rounded-lg p-6 space-y-3 border-2 border-[#e5ddd0]">
          <div className="flex justify-between">
            <span className="text-[#6b5d56]">Period:</span>
            <span className="font-mono text-xl font-semibold text-[#3d2f2a]">{currentPattern.period.toFixed(2)}s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6b5d56]">Asymmetry:</span>
            <span className="font-mono text-xl font-semibold text-[#3d2f2a]">{currentPattern.as.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6b5d56]">BPM:</span>
            <span className="font-mono text-xl font-semibold text-[#3d2f2a]">{(60 / currentPattern.period).toFixed(1)}</span>
          </div>
          {queuedPattern && (
            <div className="text-[#c4938f] text-sm mt-2 pt-2 border-t-2 border-[#e5ddd0] font-semibold">
              Next: Period {queuedPattern.period.toFixed(2)}s, As {queuedPattern.as.toFixed(2)}
            </div>
          )}
        </div>
        
        {/* Control Buttons */}
        <div className="space-y-4">
          <button
            onClick={isPlaying ? stopMetronome : startMetronome}
            style={{
              backgroundColor: isPlaying ? '#c4938f' : '#a8b5a0',
              color: 'white'
            }}
            className="w-full py-6 rounded-lg text-xl font-bold transition-all shadow-md hover:shadow-lg"
          >
            {isPlaying ? 'Stop' : 'Start'}
          </button>
          
          <button
            onClick={randomizePattern}
            style={{ backgroundColor: '#e5b299', color: 'white' }}
            className="w-full py-6 rounded-lg text-xl font-bold transition-all shadow-md hover:shadow-lg"
          >
            Random Pattern
          </button>
          
          <button
            onClick={queueSymmetric}
            style={{ backgroundColor: '#b5a8c4', color: 'white' }}
            className="w-full py-4 rounded-lg text-lg font-bold transition-all shadow-md hover:shadow-lg"
          >
            Queue Symmetric (as=0)
          </button>
        </div>
        
        {/* Info */}
        <div className="text-[#8b7d76] text-sm text-center mt-8">
          Tap Start to begin. Use Random Pattern to queue a new rhythm at the next loop boundary.
        </div>
      </div>
    </div>
  );
};

export default MetronomeApp;