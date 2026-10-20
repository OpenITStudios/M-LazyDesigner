import { connectionChanged, connectionCheckDelayMs, type ConnectionBaseline, type ConnectionObservation } from './connectionWatch';

type ConnectionMonitorOptions = {
  current: () => { status: ConnectionBaseline | null; busy: boolean; fixture: boolean };
  observe: () => Promise<ConnectionObservation>;
  refresh: () => Promise<void>;
  onFailures: (failures: number) => void;
};

/** Own passive observation only; full status alone can recover failed authority. */
export function createConnectionMonitor(options: ConnectionMonitorOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;
  let failures = 0;

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function setFailures(value: number) {
    failures = value;
    options.onFailures(value);
  }

  function schedule() {
    stop();
    const { status, fixture } = options.current();
    if (disposed || fixture || document.hidden || !status || failures >= 2 || inFlight) return;
    timer = setTimeout(() => {
      timer = null;
      void probe();
    }, connectionCheckDelayMs(status.blockbench.running));
  }

  async function probe() {
    const { status, busy, fixture } = options.current();
    if (disposed || fixture || document.hidden || !status || inFlight || failures >= 2) return;
    if (busy) {
      schedule();
      return;
    }
    inFlight = true;
    try {
      const candidate = await options.observe();
      // A late probe cannot recover failed full status or update an unmounted view.
      if (disposed || failures >= 2) return;
      const current = options.current().status;
      if (current && connectionChanged(candidate, current)) await options.refresh();
      else setFailures(0);
    } catch {
      if (!disposed) setFailures(Math.min(failures + 1, 2));
    } finally {
      inFlight = false;
      schedule();
    }
  }

  return {
    request() {
      if (disposed || document.hidden || inFlight) return;
      stop();
      void probe();
    },
    stop,
    fullStatusSucceeded() {
      if (disposed) return;
      setFailures(0);
      schedule();
    },
    fullStatusFailed() {
      if (disposed) return;
      if (options.current().status) setFailures(2);
      stop();
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
