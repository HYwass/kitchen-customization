# Floor-plan kitchen recognition

Extract the kitchen room geometry from one residential floor-plan image. This task only prepares editable user input; it does not generate cabinets or a Kitchen Studio scene.

## Target

- Locate the room explicitly labelled `厨房`, `Kitchen`, or an unambiguous equivalent.
- Trace the kitchen's orthogonal boundary from the wall lines in the image, then scale that traced shape to metres. Printed dimensions calibrate the image scale; they do not imply that every irregular wall segment is directly dimensioned.
- The editor supports one simple orthogonal polygon only: every edge must be horizontal or vertical, the polygon must not self-intersect, and it must have no holes.
- Use metres. Translate the result so its minimum x and y are both `0`. List vertices counter-clockwise without repeating the first vertex. Use a canonical start vertex: among vertices with the minimum `y`, start at the one with the minimum `x`.
- For a rectangle, prefer direct printed lengths and derive one missing side from printed area when useful. For a non-rectangular room, trace all corners by image proportions, calibrate horizontal and vertical pixel scales from the nearest reliable dimension chains, then use printed area as a global check and small scale correction. Do not invent exact segment lengths that the drawing does not provide.
- Detect only doors and windows that open directly onto the target kitchen. Do not include openings belonging to adjacent rooms.
- For each opening, set `connectsTo` to the adjacent room label when it is visible; otherwise use `null`.

## Accuracy rules

1. Read the complete image before choosing the target room.
2. Never treat the coloured room fill, furniture symbols, dimension lines, or text bounding box as a wall.
3. For a rectangular kitchen, if one side `L` is printed and the room area `A` is printed, derive the other side as `A / L`. Example: a printed width of `2600 mm` and area of `5.1 m²` means `2.6 m × 1.9615 m` (round coordinates to centimetres only after this calculation).
4. For a non-rectangular orthogonal room, first identify every corner in image coordinates. Estimate segment proportions from the image, using printed overall or nearby dimensions to establish metres-per-pixel separately for horizontal and vertical directions. The printed area may correct small accumulated scale error, but must not remove a visible notch or add a nonexistent one.
5. Before saving a recognized result, recompute polygon area from `outline`. It must agree with `areaM2`, and when `printedAreaM2` exists it should normally be within 3%. If not, revisit the dimension evidence; if the conflict cannot be resolved, return `needs_user_input` instead of accepting a visibly inconsistent boundary.
6. Classify an opening primarily by what lies immediately across that exact kitchen wall segment. If the other side is another labelled/coloured interior space (living room, dining room, corridor, balcony, bathroom, etc.), a passable gap is a `door`. If the other side is unlabelled white space outside the building envelope, an opening in the exterior wall is a `window`. Door swing/sliding arcs and window double-line symbols are supporting evidence, not a substitute for this adjacency test.
7. For every candidate opening, inspect a point immediately outside the kitchen polygon across the wall normal. Record a `door` only when it connects to an adjacent space and set `connectsTo` to that room label. Record a `window` only on the building exterior and set `connectsTo` to `null`. Exterior glazing beyond a balcony is not a kitchen opening.
8. `wallIndex` is the zero-based index of the edge from `outline[i]` to `outline[(i+1) % outline.length]`.
9. `offset` is the distance in metres from that edge's first vertex to the opening's first endpoint while following the edge direction.
10. Use typical door/window dimensions only as a last resort. Mark every assumed value in `assumptions` and lower confidence.
11. If no kitchen can be identified, dimensions cannot be scaled to metres, the kitchen is not representable as one simple orthogonal polygon, or important walls are hidden, set `status` to `needs_user_input`. Explain the issue in `warnings`; do not fabricate a complete answer.
12. Confidence values are numbers from `0` to `1`. Do not report confidence above `0.85` when any boundary length is inferred only from proportions or area.
13. Validate every opening geometrically before saving: its `wallIndex` must identify the actual edge containing the symbol, `offset >= 0`, `width > 0`, and `offset + width` must not exceed that edge length. Recheck the image if this fails.
14. The saved JSON file must contain ASCII bytes only. Encode every non-ASCII character inside JSON strings with `\uXXXX` escapes. This avoids Windows shell encoding corruption; `JSON.parse` will restore the original text.

## Output

Save exactly one JSON object as `floorplan_result.json` with this shape:

```json
{
  "resultVersion": "1.0.0",
  "status": "recognized",
  "targetRoom": {
    "label": "厨房",
    "outline": [[0, 0], [3.2, 0], [3.2, 3.4], [0, 3.4]],
    "areaM2": 10.88,
    "printedAreaM2": 10.9,
    "confidence": 0.9
  },
  "openings": [
    {
      "type": "door",
      "wallIndex": 0,
      "offset": 0.35,
      "width": 0.8,
      "height": 2.0,
      "sillHeight": 0,
      "confidence": 0.75,
      "connectsTo": "餐厅",
      "description": "厨房南墙靠西的内开门"
    }
  ],
  "dimensionEvidence": ["顶部尺寸链标注厨房所在分段为 3200 mm", "房间文字标注面积 10.9 m²"],
  "assumptions": [],
  "warnings": []
}
```

`status` must be `recognized` or `needs_user_input`. Use `null` for an unknown optional numeric field; never encode unknown values as zero. Return JSON only, with no Markdown or outer wrapper.
