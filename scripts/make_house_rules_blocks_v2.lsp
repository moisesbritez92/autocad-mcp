(vl-load-com)

(defun make-box (x1 y1 x2 y2 / ent)
  (command "._RECTANG" (list x1 y1) (list x2 y2))
  (command "._REGION" (entlast) "")
  (entlast)
)

(defun insert-block-file (filePath inspt xscale yscale rotation)
  (command "._-INSERT" filePath inspt xscale yscale rotation)
)

(defun c:MakeHouseRulesBlocksV2 (/ ss baseWall terrace r1 r2 r3 r4 r5 d1 d2 d3 d4 d5 w1 w2 w3 w4 outpath)
  (setvar "CMDECHO" 0)
  (setvar "OSMODE" 0)

  (setvar "CLAYER" "0")
  (setq ss (ssget "X"))
  (if ss (command "._ERASE" ss ""))

  (command "._LAYER" "_M" "WALLS"      "_C" "7" "" "_LW" "0.40" "" "")
  (command "._LAYER" "_M" "DOORS"      "_C" "3" "" "_LW" "0.30" "" "")
  (command "._LAYER" "_M" "WINDOWS"    "_C" "4" "" "_LW" "0.25" "" "")
  (command "._LAYER" "_M" "FLOOR"      "_C" "8" "" "_LW" "0.15" "" "")
  (command "._LAYER" "_M" "DIMENSIONS" "_C" "2" "" "_LW" "0.18" "" "")
  (command "._LAYER" "_M" "TEXT"       "_C" "7" "" "_LW" "0.15" "" "")

  ;; main house 10x8 + rear terrace 10x2
  (setvar "CLAYER" "FLOOR")
  (command "._RECTANG" "0,0" "10,8")
  (command "._RECTANG" "0,8" "10,10")

  (setvar "CLAYER" "WALLS")
  (setq baseWall (make-box 0 0 10 8))

  ;; spaces: social left, private right, hall central-right, terrace rear
  (setq r1 (make-box 0.25 0.25 4.80 7.75))   ;; Living + Kitchen
  (setq r2 (make-box 5.05 0.25 9.75 2.95))   ;; Bedroom 2
  (setq r3 (make-box 5.05 3.15 6.35 6.85))   ;; Hall / distribution
  (setq r4 (make-box 6.55 3.15 9.75 4.95))   ;; Bathroom
  (setq r5 (make-box 6.55 5.15 9.75 7.75))   ;; Bedroom 1
  (command "._SUBTRACT" baseWall "" r1 r2 r3 r4 r5 "")

  ;; wall openings
  (setq d1 (make-box 1.35 -0.10 2.25 0.35))  ;; main entry
  (setq d2 (make-box 4.80 4.00 5.05 4.90))   ;; living -> hall (open passage, no door block)
  (setq d3 (make-box 6.10 2.95 7.00 3.25))   ;; hall -> bedroom 2
  (setq d4 (make-box 6.10 4.90 7.00 5.20))   ;; hall -> bedroom 1
  (setq d5 (make-box 6.35 3.60 6.65 4.50))   ;; hall -> bathroom
  (command "._SUBTRACT" baseWall "" d1 d2 d3 d4 d5 "")

  ;; rear opening from hall to terrace
  (setq terrace (make-box 5.30 7.75 6.20 8.10))
  (command "._SUBTRACT" baseWall "" terrace "")

  ;; windows longitudinal to walls
  (setq w1 (make-box 1.20 7.65 3.80 8.10))   ;; living top horizontal
  (setq w2 (make-box 7.00 7.65 9.20 8.10))   ;; bedroom 1 top horizontal
  (setq w3 (make-box 7.00 -0.10 9.20 0.35))  ;; bedroom 2 bottom horizontal
  (setq w4 (make-box 9.65 3.35 10.10 4.75))  ;; bathroom right vertical
  (command "._SUBTRACT" baseWall "" w1 w2 w3 w4 "")

  ;; doors (no door on living-hall opening)
  (setvar "CLAYER" "DOORS")
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "1.35,0" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "6.10,3.25" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "6.10,5.20" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "6.35,3.60" 1 1 90)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "5.30,8.00" 1 1 90)

  ;; windows aligned longitudinally to walls
  (setvar "CLAYER" "WINDOWS")
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "1.20,7.75" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "7.00,7.75" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "7.00,0.00" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "9.75,3.35" 0.7 0.7 90)

  ;; labels
  (setvar "CLAYER" "TEXT")
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 2.20 4.20 0.0) (11 2.20 4.20 0.0) (40 . 0.30) (1 . "Living / Kitchen") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 8.00 6.35 0.0) (11 8.00 6.35 0.0) (40 . 0.28) (1 . "Bedroom 1") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 8.00 1.55 0.0) (11 8.00 1.55 0.0) (40 . 0.28) (1 . "Bedroom 2") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 8.15 4.00 0.0) (11 8.15 4.00 0.0) (40 . 0.22) (1 . "Bathroom") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 5.70 5.10 0.0) (11 5.70 5.10 0.0) (40 . 0.20) (1 . "Hall") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 5.00 9.00 0.0) (11 5.00 9.00 0.0) (40 . 0.22) (1 . "Terrace") (72 . 1) (73 . 2)))

  ;; dimensions main body + terrace depth
  (setvar "CLAYER" "DIMENSIONS")
  (command "._DIMLINEAR" "0,0" "10,0" "_H" "5,-1.5")
  (command "._DIMLINEAR" "10,0" "10,8" "_V" "11.5,4")
  (command "._DIMLINEAR" "10,8" "10,10" "_V" "12.5,9")

  (setq outpath "C:/Users/moise/Documents/010_MCP/casa_10x8_reglas_bloques_v2.dwg")
  (command "._SAVEAS" "2018" outpath)
  (command "._ZOOM" "_E")
  (princ (strcat "\nSaved as: " outpath "\n"))
  (princ)
)
