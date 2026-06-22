# ECO Verifier Universal Model

The ECO Verifier is a standalone browser verifier for ECO artifacts.

It accepts drag-and-drop files, uploaded files, and ECO URLs. It verifies artifacts locally in the browser.

The embedded ECO Verify Widget is a compact verifier that can live inside product dashboards. It is convenience UI, not an authority source.

The verifier reports Integrity and Lifecycle separately.

Integrity values:
- VALID
- TAMPERED
- UNKNOWN

Lifecycle values:
- SNAPSHOT
- FINAL
- SUPERSEDED
- OWNER_REVIEW
- INCIDENT
- UNKNOWN

A snapshot can be valid without being final. A superseded artifact can be intact while no longer representing the latest run state.
