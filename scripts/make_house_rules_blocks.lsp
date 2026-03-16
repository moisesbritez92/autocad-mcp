(vl-load-com)

(defun make-box (x1 y1 x2 y2 / ent)
  (command "._RECTANG" (list x1 y1) (list x2 y2))
  (command "._REGION" (entlast) "")
  (entlast)
)

(defun insert-block-file (filePath inspt xscale yscale rotation)
  (command "._-INSERT" filePath inspt xscale yscale rotation)
)

(defun c:MakeHouseRulesBlocks (/ ss baseWall r1 r2 r3 r4 r5 d1 d2 d3 d4 w1 w2 w3 outpath)
  (setvar "CMDECHO" 0)
  (setvar "OSMODE" 0)

  ;; clear
  (setvar "CLAYER" "0")
  (setq ss (ssget "X"))
  (if ss (command "._ERASE" ss ""))

  ;; layers
  (command "._LAYER" "_M" "WALLS"      "_C" "7" "" "_LW" "0.40" "" "")
  (command "._LAYER" "_M" "DOORS"      "_C" "3" "" "_LW" "0.30" "" "")
  (command "._LAYER" "_M" "WINDOWS"    "_C" "4" "" "_LW" "0.25" "" "")
  (command "._LAYER" "_M" "FLOOR"      "_C" "8" "" "_LW" "0.15" "" "")
  (command "._LAYER" "_M" "DIMENSIONS" "_C" "2" "" "_LW" "0.18" "" "")
  (command "._LAYER" "_M" "TEXT"       "_C" "7" "" "_LW" "0.15" "" "")

  ;; floor 10x8
  (setvar "CLAYER" "FLOOR")
  (command "._RECTANG" "0,0" "10,8")

  ;; architectural layout with social/private separation
  ;; left = living+kitchen, right = hall + two bedrooms + bathroom
  (setvar "CLAYER" "WALLS")
  (setq baseWall (make-box 0 0 10 8))

  ;; room voids
  (setq r1 (make-box 0.25 0.25 4.60 7.75))   ;; Living + Kitchen (social)
  (setq r2 (make-box 4.85 0.25 9.75 2.85))   ;; Bedroom 2 (private)
  (setq r3 (make-box 4.85 3.05 6.10 4.95))   ;; Hall / distribution
  (setq r4 (make-box 6.30 3.05 9.75 4.95))   ;; Bathroom
  (setq r5 (make-box 4.85 5.15 9.75 7.75))   ;; Bedroom 1
  (command "._SUBTRACT" baseWall "" r1 r2 r3 r4 r5 "")

  ;; openings in walls (voids)
  (setq d1 (make-box 1.35 -0.10 2.25 0.35))  ;; main door
  (setq d2 (make-box 4.50 3.55 4.95 4.45))   ;; living -> hall
  (setq d3 (make-box 4.95 2.55 5.85 3.15))   ;; hall -> bedroom 2
  (setq d4 (make-box 4.95 4.85 5.85 5.45))   ;; hall -> bedroom 1
  (command "._SUBTRACT" baseWall "" d1 d2 d3 d4 "")

  ;; windows: living best light, bedrooms also lit, bathroom with smaller opening area fallback via same block
  (setq w1 (make-box -0.10 2.20 0.35 5.20))  ;; large living window zone
  (setq w2 (make-box 6.10 7.65 8.10 8.10))   ;; bedroom 1
  (setq w3 (make-box 6.10 -0.10 8.10 0.35))  ;; bedroom 2
  (setq w4 (make-box 9.65 3.45 10.10 4.55))  ;; bathroom
  (command "._SUBTRACT" baseWall "" w1 w2 w3 w4 "")

  ;; insert reusable blocks from local library
  (setvar "CLAYER" "DOORS")
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "1.35,0" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "4.95,3.55" 1 1 90)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "5.85,3.05" 1 1 180)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "5.85,5.15" 1 1 180)

  (setvar "CLAYER" "WINDOWS")
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "0.25,2.20" 1 1 90)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "6.10,7.75" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "6.10,0.00" 1 1 0)
  (insert-block-file "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "9.75,3.45" 0.5 0.5 90)

  ;; labels
  (setvar "CLAYER" "TEXT")
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 2.20 4.20 0.0) (11 2.20 4.20 0.0) (40 . 0.30) (1 . "Living / Kitchen") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 7.20 6.45 0.0) (11 7.20 6.45 0.0) (40 . 0.30) (1 . "Bedroom 1") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 7.20 1.55 0.0) (11 7.20 1.55 0.0) (40 . 0.30) (1 . "Bedroom 2") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 8.00 4.00 0.0) (11 8.00 4.00 0.0) (40 . 0.25) (1 . "Bathroom") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 5.45 4.00 0.0) (11 5.45 4.00 0.0) (40 . 0.20) (1 . "Hall") (72 . 1) (73 . 2)))

  ;; dimensions
  (setvar "CLAYER" "DIMENSIONS")
  (command "._DIMLINEAR" "0,0" "10,0" "_H" "5,-1.5")
  (command "._DIMLINEAR" "10,0" "10,8" "_V" "11.5,4")

  ;; save in repo root
  (setq outpath "C:/Users/moise/Documents/010_MCP/casa_10x8_reglas_bloques.dwg")
  (command "._SAVEAS" "2018" outpath)
  (command "._ZOOM" "_E")
  (princ (strcat "\nSaved as: " outpath "\n"))
  (princ)
)
