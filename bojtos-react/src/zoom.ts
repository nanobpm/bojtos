/** The zoom range the BpmnRuntimeView controls allow (canvas scale factors). */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
/** One zoom-in step multiplies the scale by this; zoom-out divides by it. */
export const ZOOM_STEP = 1.25;

/**
 * The next canvas scale for a zoom-in / zoom-out press, clamped to
 * [MIN_ZOOM, MAX_ZOOM]. A non-finite current scale (nothing imported yet)
 * counts as 1. A scale already beyond the bound in the requested direction is
 * returned unchanged.
 */
export function nextZoom(current: number, direction: "in" | "out"): number {
  const from = Number.isFinite(current) && current > 0 ? current : 1;
  const to = direction === "in" ? from * ZOOM_STEP : from / ZOOM_STEP;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, to));
  // Never move against the requested direction: a fit can leave the scale
  // outside [MIN_ZOOM, MAX_ZOOM], and clamping from there would reverse it.
  return direction === "in" ? Math.max(from, clamped) : Math.min(from, clamped);
}
