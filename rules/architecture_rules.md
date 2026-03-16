# Architectural Design Rules for AI CAD Agents

This document defines architectural heuristics and validation rules that allow an AI agent connected to CAD tools (AutoCAD / DXF / BIM pipelines) to generate and evaluate residential floorplans with professional architectural quality.

The goal is to transform CAD interpretation from pure geometry into **architectural reasoning**.

---

# 1. Architectural Layout Principles

## Separation of Public and Private Zones

Residential architecture usually separates spaces into two categories:

**Social zone**
- Living room
- Dining
- Kitchen

**Private zone**
- Bedrooms
- Bathroom

Rule:

```

bedrooms should not open directly into the living room

```

Prefer:

- hallway
- distribution space
- small foyer

---

## Open Space Concept

Modern housing often integrates living and kitchen spaces.

Instead of:

```

Living | Kitchen

```

Prefer:

```

Living + Kitchen

```

Benefits:

- larger perceived space
- improved lighting
- better circulation

---

## Circulation Efficiency

Corridors waste usable area.

Rule:

```

corridor_area < 10% total_floor_area

```

Prefer:

- central living circulation
- minimal hallway
- shared access points

---

# 2. Room Proportions

Rooms should have balanced proportions.

Recommended aspect ratio:

```

1 : 1.2   to   1 : 1.8

```

Example (good):

```

3.5 x 4.5

```

Example (bad):

```

2 x 6

```

Rule:

```

room_aspect_ratio <= 2

```

---

# 3. Natural Lighting Rules

Habitable rooms must have windows.

Rule:

```

window_area >= 10% room_area

```

Example:

```

Room: 12 m²
Minimum window area: 1.2 m²

```

Exceptions:

- bathrooms
- storage
- closets

---

# 4. Door Placement Rules

Doors must not interfere with circulation.

Avoid:

- doors colliding
- doors opening into narrow spaces
- doors blocking pathways

Rule:

```

door_clearance >= 60cm

```

---

# 5. Wet Core Grouping

Bathrooms, kitchens and laundry rooms should be grouped to reduce plumbing complexity.

Rule:

```

distance(bathroom, kitchen) < 4m

```

Benefits:

- lower construction cost
- simpler piping
- maintenance efficiency

---

# 6. Window Hierarchy

The living room should receive the best natural lighting.

Rule:

```

largest_window -> living_room

```

---

# 7. Bedroom Hierarchy

Master bedroom should be larger.

Rule:

```

master_bedroom_area >= other_bedrooms

```

Typical values:

| Room | Area |
|-----|------|
Master bedroom | 11–14 m² |
Secondary bedroom | 8–10 m² |

---

# 8. Avoid Residual Spaces

Architectural layouts should minimize unusable geometry.

Avoid:

- triangular leftover spaces
- dead corners
- awkward geometry

Rule:

```

usable_area_ratio > 0.85

```

---

# 9. Structural Alignment

Walls should align across axes.

Avoid:

```

misaligned walls

```

Prefer:

```

aligned walls

```

Rule:

```

walls should align across axes

```

Benefits:

- structural clarity
- easier construction
- better aesthetics

---

# 10. Wall Thickness Standards

Typical values:

| Wall Type | Thickness |
|-----------|-----------|
Exterior wall | 25–30 cm |
Interior wall | 10–15 cm |

---

# 11. Functional Space Distribution

Typical distribution in small houses:

```

Living + Kitchen   30 m²
Bedroom 1          12 m²
Bedroom 2          10 m²
Bathroom            4 m²
Circulation + storage 6 m²

```

---

# 12. Entry Transition (Foyer)

Professional layouts rarely open directly into the living space.

Prefer:

```

Entrance
↓
+-------+
| Hall  |
+---+---+
|
Living

```

Benefits:

- privacy
- spatial transition
- better circulation control

---

# 13. Storage Integration

Modern residential plans include:

- built-in closets
- laundry area
- storage niches

Example:

```

Bedroom
+-----------+
|           |
| Closet    |
|           |
+-----------+

```

---

# 14. Indoor-Outdoor Connection

Architectural designs often connect interior spaces with exterior spaces.

Example:

```

+-----------------------+
| Living + Kitchen      |
|            +----------|
|            | Terrace  |
+------------+----------+

```

Benefits:

- improved lighting
- spatial expansion
- lifestyle quality

---

# 15. Bathroom Placement Strategy

Bathrooms should ideally be placed near the center or grouped with plumbing systems.

Prefer:

```

Bedroom | Bathroom | Bedroom

````

Avoid:

- isolated bathrooms
- bathrooms in prime façade positions

---

# 16. Architectural Quality Score

The agent can compute a design quality metric.

Example structure:

```json
{
  "design_score": 0.82,
  "lighting_score": 0.78,
  "circulation_score": 0.85,
  "space_efficiency": 0.88,
  "room_proportions": 0.80
}
````

---

