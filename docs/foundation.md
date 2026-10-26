# Browser foundation and suspension rig

> **Branch policy:** `main` holds the M0–M5 `v0.1.0` baseline. Each future
> milestone uses its own branch from `development`, then is merged and pushed
> to remote `development` on completion for testing. Later releases to `main`
> require an explicit request. See the [release workflow](workflow.md).

Implemented 25 October 2026 as the first M0/M1 build of the implementation plan.
These notes describe that foundation; [M2](m2.md) replaces the preview driving
forces with wheel slip, engine/gearing, differentials, brakes and assists.

## Architecture decisions

- TypeScript + Vite, imperative Three.js rendering, Rapier 3D, typed DOM workbench.
  Simulation modules have no DOM/rendering dependency and run in integration tests.
- Internal units: metres, kilograms, seconds, radians, newtons. +Y is up, +Z forward,
  +X left (corrected in M2); wheel order is FL, FR, RL, RR. Positive steering turns right.
- One dynamic chassis has explicit mass, COM and box-approximated inertia. A
  massless rounded collision shape prevents collider mass from being counted twice.
- Four virtual wheels use body-relative suspension rays, independent contact
  normals, spring/damper forces, bump stops and axle anti-roll coupling. Road force
  is unilateral. Wheels produce no traction without contact. This is a simplified
  sprung-body model without separate unsprung rigid bodies or suspension linkages.
- Basic longitudinal/lateral driving forces share a per-wheel friction budget.
  These are explicitly a foundation preview; wheel angular dynamics, slip curves,
  differentials, engine/gearing and aero belong to M2.
- Automatic low-speed brake hold enables stationary incline/bank tests. It remains
  limited by the tire friction budget. Normal chassis collision/airborne motion
  remains active.
- The simulation runs at 120 Hz. A bounded accumulator handles long frames, chassis
  poses interpolate for display, and DOM telemetry updates at 20 Hz. Visibility
  loss pauses the lab. Dialogs suspend simulation and driving input.
- World-relative attitude is measured from the chassis orientation. Road-relative
  attitude uses the valid wheel-contact normals; fewer than two contacts marks
  the road reference unavailable. With four non-coplanar contacts this is an
  effective average plane, not an exact local terrain fit.
- Structural setup changes rebuild/reset the chassis and its visual dimensions.
  Suspension edits update at the next simulation step. Setup values are validated
  at the physics and storage boundaries. Versioned local storage holds a saved
  reference; a working setup can be compared and restored without overwriting it.
- Scenery uses an independent deterministic seed. View controls, contact diagrams,
  inputs and setup state are independent of Rapier's object representation.

## Verification

`npm test` exercises the actual Rapier world: settled weight and axle distribution,
drop impact/settling, individual bump response, grade/bank references and low-speed
hold, airborne traction, explicit mass/geometry changes, live spring-rate changes,
pitch/roll impulses and acceleration/braking. Configuration checks reject corrupt,
non-finite and unsafe values and verify reproducible scenery randomness.

`npm run build` runs strict TypeScript checking and produces the static browser app.
The Rapier compatibility package embeds its WASM payload; the first bundle is
approximately 4.95 MB uncompressed / 1.83 MB gzip. Asset splitting or a separate
WASM-loading strategy can be evaluated when loading performance becomes a target.

Browser smoke verification covers rendered 3D/UI, bank/world-reference readings,
single-wheel bump readings, live numeric tuning, chassis apply, saved comparison,
pause/reset, camera modes and response traces. Physical gamepad hardware has not
yet been tested. A named reference GPU/desktop and 1080p performance pass remain
open M0 tasks; the local browser's displayed frame rate is only a live diagnostic.

## Boundaries

The test pad is authored diagnostic geometry, not a procedural circuit. The car is
a dimension-driven reference coupe, not the full archetype generator. The rig has
no lap timing, weather, tire wear, AI or multiplayer. Real kerb
contact quality and footprint/shape queries require the M2/M3 driving-surface work.

Source entry points: `src/app/App.ts`, `src/physics/SuspensionRig.ts`,
`src/rendering/SceneView.ts`, `src/workbench/Workbench.ts`,
`src/workbench/Diagrams.ts`, and `src/vehicle/types.ts`.
