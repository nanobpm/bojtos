/**
 * Pure helpers behind {@link BpmnRuntimeView}'s decisions.
 *
 * Kept out of the component — and out of any module that imports bpmn-js — so
 * they can be tested without a DOM or the peer dependency. The component should
 * hold rendering; what counts as a change, and how a run reads aloud, are
 * decisions, and decisions are worth testing.
 */

/** Stable key for a marker set, so unchanged ids don't re-paint the diagram. */
export function markerKey(activeIds: string[], incidentIds: string[]): string {
  return `${activeIds.join(",")}|${incidentIds.join(",")}`;
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
