(vl-load-com)

(defun reg-rect (x1 y1 x2 y2 / e)
  (command "._RECTANG" (list x1 y1) (list x2 y2))
  (command "._REGION" (entlast) "")
  (setq e (entlast))
)

(defun insblk (filePath inspt sx sy rot)
  (command "._-INSERT" filePath inspt sx sy rot)
)

(defun c:MakeHouseRulesBlocksV3 (/ ss shell liv bed2 hall bath bed1 opMain opBed2 opBed1 opBath opRear winLiv winBed1 winBed2 winBath outpath)
  (setvar "CMDECHO" 0)
  (setvar "OSMODE" 0)

  ;; clear drawing
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

  ;; floor outlines: main body + terrace
  (setvar "CLAYER" "FLOOR")
  (command "._RECTANG" "0,0" "10,8")
  (command "._RECTANG" "0,8" "10,10")

  ;; wall shell as boolean region with explicit room voids
  (setvar "CLAYER" "WALLS")
  (setq shell (reg-rect 0 0 10 8))

  ;; room voids
  ;; social zone left, private zone right, hall central, terrace rear
  (setq liv  (reg-rect 0.25 0.25 4.70 7.75))
  (setq bed2 (reg-rect 5.00 0.25 9.75 2.85))
  (setq hall (reg-rect 5.00 3.15 6.25 6.85))
  (setq bath (reg-rect 6.55 3.15 9.75 4.95))
  (setq bed1 (reg-rect 6.55 5.25 9.75 7.75))
  (command "._SUBTRACT" shell "" liv bed2 hall bath bed1 "")

  ;; openings in shell
  (setq opMain (reg-rect 1.35 -0.10 2.25 0.35))   ;; main entry
  (setq opBed2 (reg-rect 5.95 2.85 6.85 3.15))    ;; hall -> bedroom 2
  (setq opBath (reg-rect 6.25 3.60 6.55 4.50))    ;; hall -> bathroom
  (setq opBed1 (reg-rect 5.95 5.05 6.85 5.35))    ;; hall -> bedroom 1
  (setq opRear (reg-rect 5.15 7.75 6.05 8.10))    ;; hall -> terrace
  (command "._SUBTRACT" shell "" opMain opBed2 opBath opBed1 opRear "")

  ;; windows (all longitudinal to walls)
  (setq winLiv  (reg-rect 1.20 7.65 3.80 8.10))   ;; top wall living
  (setq winBed1 (reg-rect 7.00 7.65 9.20 8.10))   ;; top wall bed1
  (setq winBed2 (reg-rect 7.00 -0.10 9.20 0.35))  ;; bottom wall bed2
  (setq winBath (reg-rect 9.65 3.35 10.10 4.75))  ;; right wall bath
  (command "._SUBTRACT" shell "" winLiv winBed1 winBed2 winBath "")

  ;; reusable block inserts
  (setvar "CLAYER" "DOORS")
  ;; no door between living and hall: intentional open passage
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "1.35,0" 1 1 0)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "5.95,3.15" 1 1 0)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "6.25,3.60" 1 1 90)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "5.95,5.35" 1 1 0)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "5.15,8.00" 1 1 90)

  (setvar "CLAYER" "WINDOWS")
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "1.20,7.75" 1 1 0)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "7.00,7.75" 1 1 0)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "7.00,0.00" 1 1 0)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "9.75,3.35" 0.70 0.70 90)

  ;; labels
  (setvar "CLAYER" "TEXT")
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 2.10 4.05 0.0) (11 2.10 4.05 0.0) (40 . 0.30) (1 . "Living / Kitchen") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 7.95 6.45 0.0) (11 7.95 6.45 0.0) (40 . 0.28) (1 . "Bedroom 1") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 7.95 1.45 0.0) (11 7.95 1.45 0.0) (40 . 0.28) (1 . "Bedroom 2") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 8.05 4.00 0.0) (11 8.05 4.00 0.0) (40 . 0.22) (1 . "Bathroom") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 5.60 5.00 0.0) (11 5.60 5.00 0.0) (40 . 0.20) (1 . "Hall") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 5.00 9.00 0.0) (11 5.00 9.00 0.0) (40 . 0.22) (1 . "Terrace") (72 . 1) (73 . 2)))

  ;; dimensions
  (setvar "CLAYER" "DIMENSIONS")
  (command "._DIMLINEAR" "0,0" "10,0" "_H" "5,-1.5")
  (command "._DIMLINEAR" "10,0" "10,8" "_V" "11.5,4")
  (command "._DIMLINEAR" "10,8" "10,10" "_V" "12.5,9")

  ;; save in repo root
  (setq outpath "C:/Users/moise/Documents/010_MCP/casa_10x8_reglas_bloques_v3.dwg")
  (command "._SAVEAS" "2018" outpath)
  (command "._ZOOM" "_E")
  (princ (strcat "\nSaved as: " outpath "\n"))
  (princ)
)
