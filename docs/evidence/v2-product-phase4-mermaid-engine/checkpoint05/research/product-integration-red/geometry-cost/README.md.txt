# Geometry cost port — pending execution

Only `packages/core/src/document-svg-image-geometry.ts` was edited by this owner.
`geometry-before.ts` preserves the readable strict port before the two cost fixes.
No test, typecheck, build, formatter, UI or native process was run by this owner.

## Rules

- `documentSvgMarkerInstances` is shared with the codec reference DAG. Per SVG 2,
  start/end apply only at the entire path's endpoints. Middle instances include
  intermediate subpath endpoints, closure vertices, and consecutive movetos, not
  curve control points. An earlier per-subpath formula undercounted middle
  instances; `geometry-subpaths-before.ts` preserves that version.
  A polyline with N points has max(N−2,0) middle instances; a polygon additionally
  closes the last segment. Even overlapping instances require separate work.
- Geometry traversal carries instance multiplicity through symbols, marker
  descendants, clips, filters and compositing. It computes the envelope once but
  charges each repeated instance against the response's existing work counter.
  Per-surface limits still apply to each single surface, not their sum.
- For linear transform A, s=sqrt(||A||1 ||A||infinity) >= sigma_max(A).
  A Gaussian covariance transforms as A Sigma Aᵀ; hence its largest standard
  deviation is at most s*max(sigmaX,sigmaY). The existing kernel-work factor now
  uses this output-pixel bound. CSS shadow blur receives the same conservative
  scaling (the existing blur value is not reduced by a variance conversion).
  Surface area was already transformed into output coordinates. Translation is
  excluded from kernel scaling. The existing local blur domain and aggregate
  budget remain unchanged; no new numeric quota was added.
- The host's ceil(width)×ceil(height) outer raster is charged once. Codec owns
  outer-wrapper node/byte costs. Work is never reset per image.

## Public counterexamples

`geometry-cost.test.ts` is an external Vitest draft importing the real public
validator. It does not assert private counters or copy the implementation cost
formula. Eight cases cover repeated middle vertices, curve endpoints, separate
subpaths' start/end, shared work across images, scaled definition/CSS shadows,
and a small reusable arrowhead control.

The initial test draft is preserved as `geometry-cost-initial.test.ts.txt`; its
start/end-per-subpath expectation was corrected after the official specification
audit. `marker-vertices.test.ts` adds seven explicit topology cases.

The previous single-marker model accepts the repeated-marker adversarial inputs;
the previous local-kernel model accepts the two scaled-shadow inputs. Those are
expected before/after outcomes, not executed test claims. The preserved source
can support a controlled red run in an external checkout. All actual test
results must be added by the agent holding the CPU slot.

Ordinary Sankey/sequence compatibility still requires the official fixture
checks; the small-arrowhead case alone does not establish those products.

## Official specification audit

- SVG 2 Painting 13.7.2: https://www.w3.org/TR/SVG2/painting.html#VertexMarkerProperties
- SVG 2 Paths 9.3.4 (implicit subpath following close): https://www.w3.org/TR/SVG2/paths.html#PathDataClosePathCommand
- SVG 2 Paths 9.5.3 (zero-length segments and consecutive movetos): https://www.w3.org/TR/SVG2/paths.html#ZeroLengthPathSegments

Minimal prior undercount: `M0,0 L1,0 M2,0 L3,0` has two middle markers,
where the old per-subpath interior sum returned zero. The normative closed-path
example likewise draws two middle markers at coincident initial/final points of
a middle closed subpath. Start/end each remain a single marker for the whole path.

The affine blur bound was reviewed again: both filter surface area and kernel
weight are in output-pixel units; the same full matrix includes root viewBox,
symbol, ancestor, and local transforms. Its norm bound includes shear. Marker
instance multiplicity reaches nested filters/compositing/clips without resetting
the shared work counter. No numeric limit was changed.
