import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./metrics.ts";

describe("MetricsRegistry", () => {
  it("renders counters and gauges in the Prometheus text format", () => {
    const registry = new MetricsRegistry();
    const joins = registry.counter("app_joins_total", "Joins, by result.");
    joins.inc({ result: "ok" });
    joins.inc({ result: "ok" });
    joins.inc({ result: "room-full" });
    let connections = 3;
    registry.gauge("app_connections", "Open connections.", () => connections);
    registry.gauge("app_info", "Version.", () => 1, { version: '2.0.0 "beta"\n' });
    connections = 4;

    expect(registry.render()).toBe(
      [
        "# HELP app_joins_total Joins, by result.",
        "# TYPE app_joins_total counter",
        'app_joins_total{result="ok"} 2',
        'app_joins_total{result="room-full"} 1',
        "# HELP app_connections Open connections.",
        "# TYPE app_connections gauge",
        "app_connections 4",
        "# HELP app_info Version.",
        "# TYPE app_info gauge",
        'app_info{version="2.0.0 \\"beta\\"\\n"} 1',
        "",
      ].join("\n"),
    );
  });

  it("keeps label order from affecting which series is counted", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter("c_total", "C.");
    counter.inc({ a: "1", b: "2" });
    counter.inc({ b: "2", a: "1" });
    expect(registry.render()).toContain('c_total{a="1",b="2"} 2');
  });
});
