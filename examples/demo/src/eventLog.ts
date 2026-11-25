import { useCallback, useState } from "react";

/** How many events the demo's log keeps. */
const EVENT_LOG_SIZE = 8;

/** The last `EVENT_LOG_SIZE` events, newest first, and a function that records one. */
export function useEventLog(): {
  events: string[];
  log: (name: string, detail?: string) => void;
} {
  const [events, setEvents] = useState<string[]>([]);
  const log = useCallback((name: string, detail = "") => {
    setEvents((previous) =>
      [detail ? `${name}  ${detail}` : name, ...previous].slice(
        0,
        EVENT_LOG_SIZE
      )
    );
  }, []);
  return { events, log };
}
