type ScheduledCallback = (time: number) => void;

type ScheduledEvent = {
  id: number;
  time: number;
  cb: ScheduledCallback;
};

class FakeTransport {
  seconds = 0;
  position = 0;
  private nextId = 1;
  private events: ScheduledEvent[] = [];

  schedule(cb: ScheduledCallback, time: number) {
    const id = this.nextId++;
    this.events.push({ id, time, cb });
    return id;
  }

  scheduleOnce(cb: ScheduledCallback, time: number) {
    return this.schedule(cb, time);
  }

  clear(id: number) {
    this.events = this.events.filter((evt) => evt.id !== id);
  }

  cancel() {
    this.events = [];
  }

  start() {}

  stop() {}

  advanceTo(target: number) {
    // Run events in time order up to the target, including new ones scheduled during execution.
    const eventsAtOrBeforeTarget = () =>
      this.events.filter((evt) => evt.time <= target).sort((a, b) => a.time - b.time);

    let nextEvents = eventsAtOrBeforeTarget();
    while (nextEvents.length > 0) {
      const evt = nextEvents.shift();
      if (!evt) break;
      this.seconds = evt.time;
      toneState.wallSeconds = evt.time;
      this.events = this.events.filter((e) => e.id !== evt.id);
      evt.cb(evt.time);
      nextEvents = eventsAtOrBeforeTarget();
    }

    this.seconds = target;
    toneState.wallSeconds = target;
  }

  pendingTimes() {
    return this.events
      .slice()
      .sort((a, b) => a.time - b.time)
      .map((evt) => evt.time);
  }

  reset() {
    this.seconds = 0;
    this.position = 0;
    this.events = [];
    this.nextId = 1;
    toneState.wallSeconds = 0;
  }
}

class FakeSynth {
  readonly kind: 'left' | 'right';

  constructor(kind: 'left' | 'right') {
    this.kind = kind;
  }

  toDestination() {
    return this;
  }

  triggerAttackRelease(note: string, duration: number, time = 0) {
    toneState.toneLog.push({
      note,
      duration,
      time,
      kind: this.kind,
      wallTime: toneState.wallSeconds,
    });
  }

  dispose() {}
}

export const toneState = {
  transport: new FakeTransport(),
  toneLog: [] as Array<{
    note: string;
    duration: number;
    time: number;
    kind: 'left' | 'right';
    wallTime: number;
  }>,
  spriteLog: [] as Array<{ sprite: string; time: number }>,
  buttonLog: [] as Array<{ label: string; at: number }>,
  wallSeconds: 0,
};

export const toneModule = {
  Transport: toneState.transport,
  Draw: {
    schedule(cb: () => void, time: number) {
      toneState.spriteLog.push({ sprite: '(sprite)', time });
      cb();
    },
  },
  Synth: class extends FakeSynth {
    constructor(opts?: { _label?: 'left' | 'right' }) {
      super(opts?._label ?? 'left');
    }
  },
  start: async () => {},
};

export const resetToneState = () => {
  toneState.transport.reset();
  toneState.toneLog.length = 0;
  toneState.spriteLog.length = 0;
  toneState.buttonLog.length = 0;
  toneState.wallSeconds = 0;
};
