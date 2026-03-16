(defun c:MakeHouse (/ make-box make-win baseWall r1 r2 r3 r4 r5 d1 d2 d3 d4 d5 w1 w2 w3 w4 ss)
  (vl-load-com)
  (setvar "CMDECHO" 0)
  (setvar "OSMODE" 0)

  ;; --- CLEAR ALL ---
  (setvar "CLAYER" "0")
  (setq ss (ssget "X"))
  (if ss (command "._ERASE" ss ""))

  ;; --- LAYER CREATION ---
  (command "._LAYER" "_M" "WALLS"     "_C" "7" "" "_LW" "0.40" "" "")
  (command "._LAYER" "_M" "DOORS"     "_C" "3" "" "_LW" "0.30" "" "")
  (command "._LAYER" "_M" "WINDOWS"   "_C" "4" "" "_LW" "0.25" "" "")
  (command "._LAYER" "_M" "FLOOR"     "_C" "8" "" "_LW" "0.15" "" "")
  (command "._LAYER" "_M" "DIMENSIONS""_C" "2" "" "_LW" "0.18" "" "")
  (command "._LAYER" "_M" "TEXT"      "_C" "7" "" "_LW" "0.15" "" "")

  (defun make-box (x1 y1 x2 y2 / ent)
    (command "._RECTANG" (list x1 y1) (list x2 y2))
    (command "._REGION" (entlast) "")
    (entlast)
  )

  ;; --- FLOOR ---
  (setvar "CLAYER" "FLOOR")
  (command "._RECTANG" "0,0" "10,8")

  ;; --- WALLS ---
  (setvar "CLAYER" "WALLS")
  (setq baseWall (make-box 0 0 10 8))
  
  (setq r1 (make-box 0.25 0.25 4.0 7.75))     ;; Living
  (setq r2 (make-box 4.15 0.25 9.75 2.85))    ;; Bed 2
  (setq r3 (make-box 4.15 3.0 5.2 5.0))       ;; Corridor/Hall
  (setq r4 (make-box 5.35 3.0 9.75 5.0))      ;; Bath
  (setq r5 (make-box 4.15 5.15 9.75 7.75))    ;; Bed 1
  (command "._SUBTRACT" baseWall "" r1 r2 r3 r4 r5 "")

  (setq d1 (make-box 1.65 -0.1 2.55 0.35))    ;; Main
  (setq d2 (make-box 3.9 3.5 4.25 4.4))       ;; Corridor
  (setq d3 (make-box 4.25 2.75 5.05 3.15))    ;; Bed 2
  (setq d4 (make-box 4.25 4.85 5.05 5.25))    ;; Bed 1
  (setq d5 (make-box 5.05 3.5 5.5 4.3))       ;; Bath
  (command "._SUBTRACT" baseWall "" d1 d2 d3 d4 d5 "")

  (setq w1 (make-box -0.1 2.0 0.35 4.0))      ;; V_Living
  (setq w2 (make-box 6.0 7.65 8.0 8.1))       ;; V_Bed 1
  (setq w3 (make-box 6.0 -0.1 8.0 0.35))      ;; V_Bed 2
  (setq w4 (make-box 9.65 3.5 10.1 4.5))      ;; V_Bath
  (command "._SUBTRACT" baseWall "" w1 w2 w3 w4 "")

  ;; --- DOORS ---
  (setvar "CLAYER" "DOORS")
  (command "._ARC" "_C" "1.65,0.25" "2.55,0.25" "1.65,1.15") 
  (command "._LINE" "1.65,0.25" "1.65,1.15" "")
  
  (command "._ARC" "_C" "4.15,3.5" "5.05,3.5" "4.15,4.4") 
  (command "._LINE" "4.15,3.5" "5.05,3.5" "")
  
  (command "._ARC" "_C" "5.05,2.85" "4.25,2.85" "5.05,2.05") 
  (command "._LINE" "5.05,2.85" "5.05,2.05" "")
  
  (command "._ARC" "_C" "5.05,5.15" "5.05,5.95" "4.25,5.15") 
  (command "._LINE" "5.05,5.15" "5.05,5.95" "")
  
  (command "._ARC" "_C" "5.35,3.5" "6.15,3.5" "5.35,4.3") 
  (command "._LINE" "5.35,3.5" "6.15,3.5" "")

  ;; --- WINDOWS ---
  (setvar "CLAYER" "WINDOWS")
  (defun make-win (x1 y1 x2 y2 is-vert)
    (command "._RECTANG" (list x1 y1) (list x2 y2))
    (if is-vert
      (command "._LINE" (list (/ (+ x1 x2) 2.0) y1) (list (/ (+ x1 x2) 2.0) y2) "")
      (command "._LINE" (list x1 (/ (+ y1 y2) 2.0)) (list x2 (/ (+ y1 y2) 2.0)) "")
    )
  )
  (make-win 0 2.0 0.25 4.0 t)            
  (make-win 6.0 7.75 8.0 8.0 nil)        
  (make-win 6.0 0.0 8.0 0.25 nil)        
  (make-win 9.75 3.5 10.0 4.5 t)         

  ;; --- TEXT ---
  (setvar "CLAYER" "TEXT")
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 2.0 4.0 0.0) (11 2.0 4.0 0.0) (40 . 0.3) (1 . "Living / Kitchen") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 7.0 6.5 0.0) (11 7.0 6.5 0.0) (40 . 0.3) (1 . "Bedroom 1") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 7.0 1.5 0.0) (11 7.0 1.5 0.0) (40 . 0.3) (1 . "Bedroom 2") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 7.5 4.0 0.0) (11 7.5 4.0 0.0) (40 . 0.3) (1 . "Bathroom") (72 . 1) (73 . 2)))
  (entmake '((0 . "TEXT") (8 . "TEXT") (10 4.6 4.0 0.0) (11 4.6 4.0 0.0) (40 . 0.2) (1 . "Hall") (72 . 1) (73 . 2)))

  ;; --- DIMENSIONS ---
  (setvar "CLAYER" "DIMENSIONS")
  (command "._DIMLINEAR" "0,0" "10,0" "_H" "5,-1.5")
  (command "._DIMLINEAR" "10,0" "10,8" "_V" "11.5,4")

  (command "._ZOOM" "_E")
  (command "._QSAVE")
  (princ)
)
