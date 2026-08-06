import { useEffect, useRef } from "react";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import { describeRunState, markerKey } from "./runState.js";

interface Canvas {
  zoom(mode: string): void;
  addMarker(elementId: string, marker: string): void;
  removeMarker(elementId: string, marker: string): void;
}

interface Overlays {
  add(
    elementId: string,
    overlay: {
      position: Record<string, number>;
      html: string | HTMLElement;
    },
  ): string;
  remove(id: string): void;
}

export interface BpmnRuntimeViewProps {
  /** The diagram XML to render. */
  xml: string;
  /** Element ids to highlight as active (token) — marker class `nano-active`. */
  activeIds: string[];
  /** Element ids to highlight as incidents — marker class `nano-incident`. */
  incidentIds: string[];
  /** Optional class for the container element (it always fills its parent). */
  className?: string;
  /**
   * Accessible name for the diagram. The token and incident highlights are
   * purely visual, so without this a screen-reader user is told nothing at all
   * about what is running.
   */
  label?: string;
  /**
   * Map an element id to a human name for the live status announcement — pass
   * the diagram's element names if you have them. Defaults to the raw id.
   */
  elementName?: (elementId: string) => string;
}

/**
 * Read-only diagram that imports the XML once and updates token/incident markers
 * in place (no re-import, so the zoom/scroll position is preserved while
 * stepping through the simulation). This is the token-movement half of the
 * Bojtos visual contract (ADR 0043 §4): drive `activeIds` / `incidentIds` from a
 * session snapshot's `activeElementIds` / `incidentElementIds`.
 *
 * The consumer must load bpmn-js's diagram CSS (`bpmn-js/dist/assets/
 * diagram-js.css` and `.../bpmn-font/css/bpmn-embedded.css`) once in the app,
 * and provide the `.nano-active` / `.nano-incident` marker styles plus a
 * `.nano-token` style for the token badge overlaid on each active element.
 */
export function BpmnRuntimeView({
  xml,
  activeIds,
  incidentIds,
  className,
  label = "BPMN process diagram",
  elementName,
}: BpmnRuntimeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<NavigatedViewer | null>(null);
  const importedRef = useRef(false);
  const markedRef = useRef<{ id: string; cls: string }[]>([]);
  const tokenOverlaysRef = useRef<string[]>([]);
  // Track the latest ids in a ref so the post-import `applyMarkers()` (fired from
  // the `[xml]` effect's async `.then`) uses current values, not the ids that
  // were current when the import started — otherwise ids changing mid-import
  // would leave the diagram unmarked until the next change.
  const idsRef = useRef({ activeIds, incidentIds });
  idsRef.current = { activeIds, incidentIds };

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = new NavigatedViewer({ container: containerRef.current });
    viewerRef.current = viewer;
    importedRef.current = false;
    viewer
      .importXML(xml)
      .then(() => {
        viewer.get<Canvas>("canvas").zoom("fit-viewport");
        importedRef.current = true;
        applyMarkers();
      })
      .catch(() => {
        /* malformed XML — leave blank */
      });
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml]);

  function applyMarkers() {
    const viewer = viewerRef.current;
    if (!viewer || !importedRef.current) return;
    const canvas = viewer.get<Canvas>("canvas");
    for (const { id, cls } of markedRef.current) {
      try {
        canvas.removeMarker(id, cls);
      } catch {
        /* ignore */
      }
    }
    const next: { id: string; cls: string }[] = [];
    for (const id of idsRef.current.activeIds) next.push({ id, cls: "nano-active" });
    for (const id of idsRef.current.incidentIds)
      next.push({ id, cls: "nano-incident" });
    for (const { id, cls } of next) {
      try {
        canvas.addMarker(id, cls);
      } catch {
        /* element not in this diagram */
      }
    }
    markedRef.current = next;

    // A visible token badge on each active element: an explicit "token is here"
    // marker so movement reads clearly even when a class-only highlight is too
    // subtle. Overlays are removed/re-added each update so the token hops with
    // the frontier.
    const overlays = viewer.get<Overlays>("overlays");
    for (const id of tokenOverlaysRef.current) {
      try {
        overlays.remove(id);
      } catch {
        /* ignore */
      }
    }
    const nextOverlays: string[] = [];
    for (const id of idsRef.current.activeIds) {
      try {
        nextOverlays.push(
          overlays.add(id, {
            position: { top: -12, left: -12 },
            html: '<div class="nano-token" aria-hidden="true"></div>',
          }),
        );
      } catch {
        /* element not in this diagram */
      }
    }
    tokenOverlaysRef.current = nextOverlays;
  }

  // `activeIds` / `incidentIds` are almost always fresh arrays (`snapshot?.x ??
  // []`), so depending on their identity re-painted every marker and re-created
  // every token overlay on every render of the parent — visible churn on a busy
  // diagram. Depend on the ids themselves instead.
  const key = markerKey(activeIds, incidentIds);
  useEffect(() => {
    applyMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div
      className={className}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label={label}
        style={{ width: "100%", height: "100%" }}
      />
      {/* The highlights are visual only. Mirror them as text, politely
          announced, so the run is followable without seeing the diagram. No
          `aria-label` here: on a live region it would override the changing
          text in the accessible-name computation, so screen readers would
          announce the static label instead of the run state. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {describeRunState(activeIds, incidentIds, elementName)}
      </div>
    </div>
  );
}
