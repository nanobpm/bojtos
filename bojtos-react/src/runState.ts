/**
 * Pure helpers behind the React binding's decisions.
 *
 * Kept out of the component and the hook — and out of any module that imports
 * bpmn-js — so they can be tested without a DOM or the peer dependency. The
 * component and hook hold rendering and lifecycle; what counts as a change, how
 * a run reads aloud, which resources to deploy and how far to trim the log are
 * decisions, and decisions are worth testing.
 */

/**
 * Stable key for a marker set, so unchanged ids don't re-paint the diagram.
 *
 * Relies on BPMN element ids being XML NCNames (so they can't contain `,` or
 * `|`) — that invariant is what keeps the two-field join collision-free. If ids
 * could contain the delimiters, `["a,b"],[]` and `["a"],["b"]`-style pairs
 * would key alike.
 */
export function markerKey(activeIds: string[], incidentIds: string[]): string {
  return `${activeIds.join(",")}|${incidentIds.join(",")}`;
}

/**
 * Content key for the `bpmn` prop, so a fresh array identity each render doesn't
 * re-create the engine but a real content change still does. Only the array
 * case is serialized (with a boundary-preserving `JSON.stringify`, not a
 * `join` — a delimiter join lets two different resource arrays collapse to one
 * key when a resource borders/contains the delimiter, silently missing a real
 * change). A lone string can't have array-boundary collisions and React deps
 * already compare strings by value, so it passes through untouched — no needless
 * re-walk of potentially large BPMN XML each render.
 */
export function bpmnKey(bpmn: string | string[]): string {
  return Array.isArray(bpmn) ? JSON.stringify(bpmn) : bpmn;
}

/**
 * Normalize the `bpmn` prop to an ordered resource list for deployment. Deploy
 * order is significant: a later resource can reference an earlier one (a call
 * activity's child), so the array order is preserved verbatim.
 */
export function resourceList(bpmn: string | string[]): string[] {
  return Array.isArray(bpmn) ? bpmn : [bpmn];
}

/**
 * Trim an event log to the consumer's cap, keeping the most recent events.
 * `undefined` or a negative cap means "no cap"; `0` means "keep nothing". The
 * input array is never mutated.
 */
export function capEvents<T>(all: T[], cap: number | undefined): T[] {
  return cap !== undefined && cap >= 0 && all.length > cap
    ? all.slice(all.length - cap)
    : all;
}

/**
 * A one-line description of run state, for the diagram's live region. The token
 * and incident highlights are purely visual; this is the same information as
 * text.
 */
export function describeRunState(
  activeIds: string[],
  incidentIds: string[],
  name: (id: string) => string = (id) => id,
): string {
  const parts: string[] = [];
  if (activeIds.length) parts.push(`Running: ${activeIds.map(name).join(", ")}`);
  if (incidentIds.length)
    parts.push(`Incident: ${incidentIds.map(name).join(", ")}`);
  return parts.length ? parts.join(". ") : "Nothing running";
}
