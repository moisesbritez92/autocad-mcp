# Blocks Library

Directorio para almacenar bloques reutilizables del proyecto.

## Estructura
- `doors/` → puertas
- `windows/` → ventanas
- `furniture/` → mobiliario
- `sanitary/` → sanitarios / baño
- `electrical/` → símbolos eléctricos
- `raw/` → bloques sin clasificar o recién exportados

## Sugerencia
Guarda aquí DWG/DXF/LISP/notas relacionadas con bloques que luego quieras reutilizar automáticamente desde el pipeline CAD.

## Índice
Puedes regenerar el inventario con:

```bash
python scripts/build_block_index.py
```

Eso actualiza `blocks/index.json` para que la pipeline semántica pueda consultar la biblioteca local.
