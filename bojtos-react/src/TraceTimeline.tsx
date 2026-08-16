import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTraceItems,
  isTraceTurnGroup,
  type ElementStatDto,
  type IncidentDto,
  type TraceItem,
  type TraceRow,
  type TraceTurnGroup,
} from "@nanobpm/bojtos-kit";

/**
 * The shared activity log — the run told as a story rather than a flat stack of
 * lines. It is the single component that retired the two drifted, forked
 * `TraceTimeline` copies (nanobpm/bojtos#9): the web-demo framework's agent/tool/
 * turn view and the console test-view's engine-event fold.
 *
 * It renders the framework-agnostic {@link TraceRow} model from
 * `@nanobpm/bojtos-kit` — feed it whichever adapter matches your source:
 *
 * - `foldEngineEvents(useBojtos().events)` for the non-agentic / test-view case, or
 * - `traceEntriesToRows(entries)` for handler-emitted agent/tool/turn entries.
 *
 * Consecutive rows sharing a `turn` fold into one card (the model's raw LLM reply,
 * each tool it activated with its arguments, and — once it lands — what that tool
 * returned); rows with no `turn` render as plain lines in order, so a non-agentic
 * run looks exactly like the flat log it replaces.
 *
 * This module deliberately imports **only** the kit and React — never
 * `./BpmnRuntimeView` or `bpmn-js` — so a trace-only import tree-shakes the
 * diagram renderer out (the package is `sideEffects: false`). See
 * `test/trace.timeline.test.ts`, which walks the built module graph to pin that.
 *
 * The markup keeps the class names the forked copies' CSS already targets
 * (`timeline`, `timeline-turn`, `timeline-tool`, `log-line log-<kind>`, …) so a
 * consumer's existing stylesheet applies unchanged; no design-system dependency
 * is pulled in.
 */
export interface TraceTimelineProps {
  /**
   * The normalized rows to render. Produce them with a kit adapter
   * (`foldEngineEvents` / `traceEntriesToRows`) or your own {@link TraceRow[]}.
   */
  rows: TraceRow[];
  /** `snapshot.elementStats` — per-element completion/active counts, engine-side. */
  elementStats?: ElementStatDto[];
  /** Incidents on the current snapshot, with their reason. */
  incidents?: IncidentDto[];
  /** BPMN element id → human label, for both the timeline and the panels below. */
  labelFor?: (elementId: string) => string;
  /** Card heading. Defaults to "Activity". */
  title?: string;
  /** Sub-heading under the title. */
  description?: string;
  /** Shown when there are no rows yet. Defaults to "Press Run to start.". */
  emptyText?: string;
  /** Optional class for the outer container. */
  className?: string;
}

function safeStringify(value: unknown, space?: number): string {
  // Preserve `undefined`/`null` explicitly rather than folding `undefined` into
  // `{}` — a handler/tool that actually returned `undefined` should show that,
  // not an empty object it never produced.
  if (value === undefined) return "undefined";
  try {
    // `JSON.stringify` throws on BigInt and circular structures; a replacer
    // renders BigInt losslessly as its decimal string so trace payloads that
    // carry engine-native BigInts don't crash serialization.
    return JSON.stringify(
      value,
      (_key, val) => (typeof val === "bigint" ? val.toString() : val),
      space,
    );
  } catch {
    return "[unserializable value]";
  }
}

function ToolStep({
  activation,
  result,
  labelFor,
}: {
  activation: TraceRow;
  result: TraceRow | undefined;
  labelFor: (elementId: string) => string;
}) {
  const elementId = activation.elementId ?? "";
  return (
    <div className="timeline-tool">
      <div className="timeline-tool-head">
        <span className="timeline-badge timeline-badge-info">tool</span>
        <strong>{labelFor(elementId) || elementId}</strong>
        <code>{elementId}</code>
      </div>
      {activation.args !== undefined &&
        Object.keys(activation.args).length > 0 && (
          <div className="timeline-kv">
            <span className="timeline-kv-label">arguments</span>
            <code>{safeStringify(activation.args)}</code>
          </div>
        )}
      <div className="timeline-kv">
        <span className="timeline-kv-label">returned</span>
        <code>
          {result
            ? safeStringify(result.result)
            : "— waiting for the job to complete —"}
        </code>
      </div>
    </div>
  );
}

function TurnCard({
  group,
  labelFor,
}: {
  group: TraceTurnGroup;
  labelFor: (elementId: string) => string;
}) {
  const reply = group.rows.find((e) => e.kind === "llm");
  const activations = group.rows.filter((e) => e.kind === "agent" && e.elementId);
  const results = group.rows.filter((e) => e.kind === "vars" && e.elementId);
  const decisions = group.rows.filter((e) => e.kind === "agent" && !e.elementId);
  const errors = group.rows.filter((e) => e.kind === "error");
  // Entries a handler's own trace call emits (kind "tool") and any "vars" result
  // that never paired with an activation above would otherwise vanish once
  // stamped with a turn — render them as plain lines within the card, in order.
  const activatedElementIds = new Set(activations.map((a) => a.elementId));
  const loose = group.rows
    .filter(
      (e) =>
        e.kind === "tool" ||
        (e.kind === "vars" &&
          e.elementId &&
          !activatedElementIds.has(e.elementId)),
    )
    .sort((a, b) => a.id - b.id);

  return (
    <div className="timeline-turn">
      <div className="timeline-turn-head">
        <span
          className={`timeline-badge ${
            reply?.pending ? "timeline-badge-warning" : "timeline-badge-neutral"
          }`}
        >
          Turn {group.turn}
        </span>
        {reply?.pending && <span className="timeline-pending">thinking…</span>}
      </div>

      {reply && <blockquote className="timeline-reply">{reply.text}</blockquote>}

      {decisions.map((d) => (
        <div key={d.id} className="timeline-note">
          {d.text}
        </div>
      ))}

      {activations.map((a) => (
        <ToolStep
          key={a.id}
          activation={a}
          result={results.find((r) => r.elementId === a.elementId)}
          labelFor={labelFor}
        />
      ))}

      {loose.map((e) => (
        <div key={e.id} className={`log-line log-${e.kind}`}>
          {e.pending ? "⏳ " : ""}
          {e.text}
        </div>
      ))}

      {errors.map((e) => (
        <div key={e.id} className="timeline-error">
          ⚠ {e.text}
        </div>
      ))}
    </div>
  );
}

export function TraceTimeline({
  rows,
  elementStats = [],
  incidents = [],
  labelFor = (id) => id,
  title = "Activity",
  description = "Agent turns, model replies, and tool calls — read top to bottom as a story.",
  emptyText = "Press Run to start.",
  className,
}: TraceTimelineProps) {
  const items: TraceItem[] = useMemo(() => buildTraceItems(rows), [rows]);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest step in view as the run grows, same as the flat logs this
  // replaces.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const copyJson = () => {
    const payload = {
      log: rows.map(({ id: _id, ...rest }) => rest),
      elementStats,
      incidents,
    };
    const text = safeStringify(payload, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {
          // Clipboard access can be denied (permissions policy, insecure
          // context, an embed iframe without a clipboard-write allowance) —
          // fail quietly rather than surfacing an error for a convenience
          // action, not a run-blocking one.
        });
    }
  };

  return (
    <div className={className ? `timeline-panel ${className}` : "timeline-panel"}>
      <div className="timeline-header">
        <div className="timeline-title">{title}</div>
        {description && (
          <div className="timeline-description">{description}</div>
        )}
      </div>

      <div className="timeline-toolbar">
        <button type="button" onClick={copyJson}>
          {copied ? "Copied!" : "Copy run as JSON"}
        </button>
      </div>

      <div className="timeline" ref={scrollRef}>
        {items.length === 0 ? (
          <div className="log-empty">{emptyText}</div>
        ) : (
          items.map((item) =>
            isTraceTurnGroup(item) ? (
              <TurnCard
                key={`turn-${item.turn}-${item.rows[0].id}`}
                group={item}
                labelFor={labelFor}
              />
            ) : (
              <div key={item.id} className={`log-line log-${item.kind}`}>
                {item.pending ? "⏳ " : ""}
                {item.text}
              </div>
            ),
          )
        )}
      </div>

      {(elementStats.length > 0 || incidents.length > 0) && (
        <div className="timeline-engine-view">
          {elementStats.length > 0 && (
            <div className="timeline-stats">
              <span className="timeline-kv-label">Element completion</span>
              <ul>
                {elementStats
                  .filter((s) => s.completed > 0 || (s.active ?? 0) > 0)
                  .map((s) => (
                    <li key={s.elementId}>
                      <code>{labelFor(s.elementId) || s.elementId}</code>{" "}
                      completed {s.completed}
                      {s.active ? `, ${s.active} active` : ""}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {incidents.length > 0 && (
            <div className="timeline-incidents">
              <span className="timeline-kv-label">Incidents</span>
              <ul>
                {incidents.map((inc, i) => (
                  <li key={`${inc.elementId}-${i}`}>
                    <code>{labelFor(inc.elementId) || inc.elementId}</code> —{" "}
                    {inc.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
