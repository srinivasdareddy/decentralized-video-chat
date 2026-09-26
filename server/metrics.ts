type Labels = Record<string, string>;

export interface Counter {
  inc(labels?: Labels): void;
}

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge";
  samples(): { labels: Labels; value: number }[];
}

/**
 * Counters and gauges exposed in the Prometheus text format. Deliberately
 * tiny: the server only needs a handful of numbers.
 */
export class MetricsRegistry {
  readonly #metrics: Metric[] = [];

  counter(name: string, help: string): Counter {
    const values = new Map<string, { labels: Labels; value: number }>();
    this.#metrics.push({ name, help, type: "counter", samples: () => [...values.values()] });
    return {
      inc(labels = {}) {
        const key = JSON.stringify(Object.entries(labels).sort());
        const current = values.get(key);
        if (current) current.value += 1;
        else values.set(key, { labels, value: 1 });
      },
    };
  }

  /** A value read when metrics are scraped. */
  gauge(name: string, help: string, read: () => number, labels: Labels = {}): void {
    this.#metrics.push({ name, help, type: "gauge", samples: () => [{ labels, value: read() }] });
  }

  render(): string {
    const lines: string[] = [];
    for (const { name, help, type, samples } of this.#metrics) {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const { labels, value } of samples()) {
        lines.push(`${name}${formatLabels(labels)} ${value}`);
      }
    }
    return lines.join("\n") + "\n";
  }
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const escape = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
  return `{${entries.map(([key, value]) => `${key}="${escape(value)}"`).join(",")}}`;
}

/** The counters the signaling server updates. */
export interface SignalingMetrics {
  joins: Counter;
  relayed: Counter;
  dropped: Counter;
  refused: Counter;
  iceServerFailures: Counter;
}

export function createSignalingMetrics(registry: MetricsRegistry): SignalingMetrics {
  return {
    joins: registry.counter("zipcall_joins_total", "Join requests, by result."),
    relayed: registry.counter(
      "zipcall_relayed_messages_total",
      "Offers, answers, and candidates relayed between browsers.",
    ),
    dropped: registry.counter(
      "zipcall_dropped_messages_total",
      "Relayed messages dropped because a connection sent too many.",
    ),
    refused: registry.counter(
      "zipcall_refused_connections_total",
      "Signaling connections refused, by reason.",
    ),
    iceServerFailures: registry.counter(
      "zipcall_turn_credential_failures_total",
      "Failed requests for TURN credentials (calls fell back to STUN).",
    ),
  };
}
