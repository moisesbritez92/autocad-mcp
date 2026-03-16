# Future Prompts

## Índice por secciones del repo
- `scripts/` → extracción, análisis e interpretación de planos en AutoCAD/accoreconsole
- `outputs/` → formatos de salida para IA y resúmenes legibles
- `README / docs` → documentación de uso e interpretación

---

## Sección: `scripts/`

### Prompt 2026-03-16 — V3 de interpretación arquitectónica del plano desde AutoCAD MCP

**Contexto**
- Workspace: `C:\Users\moise\Documents\010_MCP`
- Repo enfocado en un MCP para AutoCAD usando `accoreconsole.exe`.
- Ya existe una V2 funcional en `scripts/extract_context.lsp`.
- La V2 ya puede extraer contexto geométrico/estructurado y generar `outputs/plano-contexto.json`.
- La V2 también clasifica entidades en categorías básicas (`walls`, `doors`, `windows`, `labels`, `dimensions`, etc.).
- Esta mejora debe hacerse más adelante, cuando el repo esté más maduro en otros frentes.

**Objetivo**
Evolucionar `scripts/extract_context.lsp` y su flujo asociado para pasar de un extractor geométrico/estructurado a un analizador semántico de planos arquitectónicos útil para IA.

#### Meta principal
Construir una V3 que no solo enumere entidades, sino que también infiera la estructura espacial del plano y produzca contexto de alto nivel para razonamiento posterior.

#### Líneas de mejora

##### 1. Topología espacial
- Detectar recintos cerrados a partir de polilíneas, regiones o combinaciones de contornos.
- Aproximar habitaciones/zonas cerradas aunque no estén modeladas de forma perfecta.
- Asociar etiquetas de texto cercanas a recintos detectados.
- Inferir relaciones de contigüidad entre espacios.

##### 2. Detección arquitectónica
- Inferir muros exteriores vs interiores.
- Distinguir puertas y ventanas con más robustez usando geometría + layer + arcos + bloques.
- Detectar posibles vanos/openings en muros.
- Identificar elementos repetitivos y bloques relevantes del plano.

##### 3. Normalización y calidad de datos
- Mejorar manejo de encoding para nombres de capas con acentos/caracteres especiales.
- Normalizar nombres de layers a categorías canónicas sin perder el original.
- Marcar entidades problemáticas sin romper toda la extracción.
- Añadir trazabilidad de errores por entidad cuando haga falta.

##### 4. Métricas e inferencias
- Calcular métricas por recinto: área, perímetro, centro aproximado.
- Contar puertas/ventanas por recinto si es posible.
- Estimar superficie útil de zonas etiquetadas.
- Generar conteos agregados por categoría arquitectónica.

#### Entregables deseados
- `scripts/extract_context_v3.lsp` o una evolución limpia del extractor actual.
- `scripts/run_extract_context_v3.scr`.
- Si conviene, funciones auxiliares separadas dentro de `scripts/` para mantener el extractor legible.

#### Restricciones / criterio práctico
- Priorizar robustez en `accoreconsole` sobre sofisticación frágil.
- Si una inferencia no es fiable, marcarla como heurística en vez de fingir certeza.
- Mantener compatibilidad con el flujo ya validado en este repo.
- Construir sobre la V2, no reemplazarla ciegamente.

---

## Sección: `outputs/`

### Prompt 2026-03-16 — Mejorar salidas para consumo por IA y humano

**Contexto**
- Actualmente la salida principal es `outputs/plano-contexto.json`.
- Ya existe una base útil para contexto técnico.
- Falta una salida más interpretable para revisiones rápidas y razonamiento asistido.

**Objetivo**
Diseñar una salida dual para el extractor del plano:
1. una salida estructurada para IA/MCP
2. una salida legible para humanos

#### Mejoras deseadas
- Mantener `plano-contexto.json` como salida estructurada.
- Añadir `plano-resumen.md` como salida paralela en lenguaje natural.
- Incluir hallazgos clave, ambigüedades y advertencias.
- Si es posible, incluir niveles de confianza heurística por inferencia.
- Evitar ruido excesivo y priorizar información accionable.

#### Entregables deseados
- `outputs/plano-contexto.json` mejorado
- `outputs/plano-resumen.md`
- Si aporta valor, una convención estable para que otros prompts o tools puedan reutilizar estas salidas

---

## Sección: `README / docs`

### Prompt 2026-03-16 — Documentar el flujo de extracción de contexto del plano

**Contexto**
- El repo ya tiene scripts y flujo funcional para ejecutar extracción vía MCP + AutoCAD Core Console.
- Conforme aumente la complejidad, hará falta explicar mejor el uso y la interpretación de salidas.

**Objetivo**
Crear o mejorar documentación breve y práctica sobre cómo usar el extractor de contexto del plano.

#### Mejoras deseadas
- Explicar cómo ejecutar el extractor desde el flujo MCP actual.
- Explicar qué archivos genera y cómo leerlos.
- Documentar limitaciones conocidas de `accoreconsole` y del enfoque heurístico.
- Añadir ejemplos reales basados en `pruebas.dwg` cuando sea útil.

#### Entregables deseados
- sección nueva o ampliada en `README.md`
- si hace falta, un archivo de docs corto con ejemplos y troubleshooting


## Version 2.5

You are a senior software engineer and computational geometry expert.

Your task is to improve an existing Python script that extracts context from AutoCAD drawings (DWG/DXF) and converts them into a structured JSON used by an AI agent.

The current script already extracts:
- metadata
- entities
- layers
- counts
- basic geometry
- inferred categories (walls, doors, windows, labels, dimensions)

The goal is to transform this script into a **semantic CAD interpreter** capable of understanding architectural structure and spatial relationships.

The output must remain a JSON file but with a significantly richer schema.

--------------------------------
OBJECTIVES
--------------------------------

Extend the script to add the following capabilities:

1. ROOM / SPACE DETECTION
2. SPATIAL RELATIONSHIPS
3. OPENING ANALYSIS
4. WALL CLASSIFICATION
5. TOPOLOGICAL GRAPH OF THE BUILDING
6. ARCHITECTURAL VALIDATION RULES
7. AGENT HINTS FOR FUTURE AUTOMATION

--------------------------------
1. ROOM DETECTION
--------------------------------

Detect enclosed regions formed by walls.

Algorithm suggestions:

- build wall polylines
- create planar graph
- detect closed loops
- convert loops into polygons
- compute polygon area
- compute centroid

Output structure:

"rooms": [
  {
    "id": "room_1",
    "label": "Bedroom 1",
    "polygon": [[x,y], ...],
    "area": 12.5,
    "perimeter": 14.2,
    "centroid": [x,y],
    "bounding_box": [xmin,ymin,xmax,ymax],
    "connected_doors": [],
    "connected_windows": [],
    "adjacent_rooms": []
  }
]

Match rooms with text labels when possible.

--------------------------------
2. SPATIAL RELATIONSHIPS
--------------------------------

Determine relationships between elements.

Compute:

- which doors belong to which walls
- which door connects which rooms
- which windows belong to which room
- adjacency between rooms

Example:

"relationships": {
  "room_connections": [
    {
      "from": "Living Room",
      "to": "Hall",
      "via": "door_3"
    }
  ]
}

--------------------------------
3. OPENING ANALYSIS
--------------------------------

Identify architectural openings.

Doors:
- detect door leaf line
- detect swing arc
- compute width
- compute orientation

Windows:
- detect window line sets
- compute width
- classify as exterior or interior

Example:

"openings": {
  "doors": [
    {
      "id": "door_1",
      "position": [x,y],
      "width": 0.9,
      "swing_angle": 90,
      "connects": ["hall","bedroom_1"]
    }
  ]
}

--------------------------------
4. WALL CLASSIFICATION
--------------------------------

Classify walls as:

- exterior
- interior
- partition

Method:

- detect which walls belong to outer boundary
- remaining walls are interior

Output:

"walls": [
  {
    "id": "wall_12",
    "type": "exterior",
    "length": 8.0,
    "orientation": "horizontal"
  }
]

--------------------------------
5. BUILDING TOPOLOGY GRAPH
--------------------------------

Convert the floorplan into a graph.

Nodes = rooms  
Edges = doors

Example:

"topology_graph": {
  "nodes": ["living_room","bedroom_1","bedroom_2","bathroom"],
  "edges": [
    {"from":"living_room","to":"hall"},
    {"from":"hall","to":"bedroom_1"}
  ]
}

--------------------------------
6. ARCHITECTURAL VALIDATION RULES
--------------------------------

Add automated checks.

Examples:

Door width check

minimum = 0.70m

Room minimum areas

Bedroom >= 8 m²  
Bathroom >= 3 m²

Ventilation check

Rooms must have windows

Output:

"validation": [
  {
    "rule": "bedroom_min_area",
    "room": "bedroom_2",
    "result": "pass"
  }
]

--------------------------------
7. AGENT HINTS
--------------------------------

Add high level interpretation to help LLM agents reason about the drawing.

Example:

"agent_hints": {
  "building_type": "small_residential_unit",
  "estimated_rooms": 4,
  "circulation_core": "hall",
  "layout_type": "linear",
  "confidence": 0.82
}

--------------------------------
IMPLEMENTATION DETAILS
--------------------------------

Language: Python

Libraries allowed:

- shapely
- networkx
- numpy
- ezdxf
- scipy.spatial

Key modules to implement:

geometry_utils.py
topology_builder.py
room_detector.py
opening_detector.py
validation_rules.py

--------------------------------
OUTPUT
--------------------------------

Generate:

1) improved script
2) updated JSON schema
3) example output
4) documentation comments explaining the algorithms