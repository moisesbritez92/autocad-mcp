# 🚀 VERSIÓN MEJORADA — Architectural Design Rules for AI CAD Agents (v2.0)

---

# 0. Global Design Constraints

Antes de cualquier layout, el agente debe validar:

```python
total_floor_area > 40 m²
usable_area_ratio > 0.85
natural_light_coverage > 70% habitable rooms
```

---

# 1. Zoning Intelligence (Enhanced)

## Functional Zoning Graph

El layout debe seguir un grafo lógico:

```text
Entrance → (Foyer) → Living → (Kitchen / Dining)
                      ↓
                  Distribution
                      ↓
          Bedrooms + Bathroom
```

### Nueva regla:

```python
private_zone_visibility_from_entrance = LOW
```

✔️ Evitar que desde la puerta se vea:

* camas
* baño
* zonas íntimas

---

# 2. Circulation Model (Advanced)

En vez de solo minimizar pasillos:

## Introducir “Flow Graph”

```python
circulation_efficiency = shortest_path_sum / ideal_path_sum
```

Regla:

```python
circulation_efficiency >= 0.85
```

---

## Evitar “dead paths”

```python
no_space_should_require_backtracking
```

---

# 3. Space Hierarchy (Arquitectura real)

## Jerarquía espacial obligatoria:

```text
Public > Semi-private > Private
```

### Regla nueva:

```python
space_importance_rank(living) > bedrooms > bathroom
```

---

# 4. Proportions (Refined)

Agregar **área mínima funcional real**:

```python
living_area >= 18 m²
kitchen_area >= 6 m²
bedroom_area >= 8 m²
bathroom_area >= 3.5 m²
```

---

## Nueva métrica: Compacidad

```python
compactness = area / perimeter²
```

Regla:

```python
compactness >= 0.05
```

👉 Evita formas raras o caras de construir

---

# 5. Natural Light Optimization (Pro level)

No solo ventanas:

## Introducir orientación

```python
living_room_orientation ∈ [South, South-East, South-West]
```

(si no hay orientación real, usar heurística de fachada principal)

---

## Profundidad de iluminación

```python
max_distance_to_window <= 2.5 * window_height
```

---

# 6. Ventilation Logic (Nuevo 🔥)

```python
cross_ventilation = True for main spaces
```

Regla:

```python
at_least_two_opposite_openings(living or bedrooms)
```

---

# 7. Door Intelligence

Agregar lógica real:

```python
door_swing_collision = False
door_to_wall_distance >= 10 cm
```

---

## Regla premium:

```python
main_paths_width >= 90 cm
secondary_paths_width >= 70 cm
```

---

# 8. Wet Core Optimization (Advanced)

No solo distancia:

```python
wet_core_clustered = True
vertical_alignment_if_multifloor = True
```

---

## Nueva regla:

```python
bathroom_adjacent_to_bedroom_or_hall = True
```

---

# 9. Structural Logic (Ingeniería + Arquitectura)

Agregar grid estructural:

```python
grid_spacing ∈ [3m, 5m]
```

Regla:

```python
load_bearing_walls_aligned = True
```

---

# 10. Furniture Feasibility (MUY IMPORTANTE 🔥)

Aquí es donde la mayoría de IA falla.

## Validar que los muebles caben:

Ejemplo dormitorio:

```python
bed (2.0 x 1.6) + circulation >= 60 cm
```

Regla:

```python
furniture_fit_score >= 0.9
```

---

## Living room:

Debe permitir:

* sofá
* mesa
* TV

---

# 11. Storage Intelligence

```python
storage_area >= 5% total_floor_area
```

---

# 12. Entry Experience (Arquitectura real)

No solo foyer:

## Secuencia espacial:

```text
Compression → Expansion
```

Ejemplo:

```text
Entrada pequeña → Living amplio
```

Regla:

```python
entry_transition_quality >= 0.7
```

---

# 13. Indoor-Outdoor Integration (Enhanced)

```python
living_room_connected_to_outdoor = True
```

---

## Nueva métrica:

```python
outdoor_accessibility_score >= 0.6
```

---

# 14. Bathroom Intelligence

Agregar ergonomía real:

```python
toilet_clearance_front >= 60 cm
sink_clearance >= 50 cm
shower_min_size = 80 x 80 cm
```

---

# 15. Acoustic Separation (Nuevo 🔥)

```python
bathroom_should_not_share_wall_with_living (preferred)
```

```python
bedrooms_should_not_border_noisy_zones
```

---

# 16. Privacy Gradient

```python
privacy_gradient = entrance → living → bedrooms
```

Regla:

```python
no_direct_line_of_sight(entrance, bedroom)
```

---

# 17. AI Validation Metrics (Mucho más potente)

```json
{
  "design_score": 0.0,
  "zoning_score": 0.0,
  "circulation_score": 0.0,
  "lighting_score": 0.0,
  "ventilation_score": 0.0,
  "furniture_fit_score": 0.0,
  "privacy_score": 0.0,
  "efficiency_score": 0.0,
  "structural_score": 0.0
}
```

---

# 18. Penalization Rules (Clave para IA)

Esto es lo que hace que tu sistema sea realmente bueno:

```python
penalty += 0.2 if bedroom_opens_to_living
penalty += 0.1 if corridor_area > 15%
penalty += 0.15 if no_cross_ventilation
penalty += 0.2 if furniture_not_fit
penalty += 0.1 if poor_lighting
```

---

🔥 Nuevos pilares:

* circulación como grafo
* validación de muebles (clave)
* ventilación cruzada
* orientación solar
* privacidad real
* ergonomía
* penalizaciones cuantificables

---

