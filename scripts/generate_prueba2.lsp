(vl-load-com)

;;; ── reg-rect helper ─────────────────────────────────────────────────────
;;; Creates a single rectangular REGION from four corner coordinates
(defun reg-rect (x1 y1 x2 y2 / e)
  (command "._RECTANG" (list x1 y1) (list x2 y2))
  (command "._REGION" (entlast) "")
  (setq e (entlast))
)

;;; ── insblk helper ────────────────────────────────────────────────────────
(defun insblk (filePath inspt sx sy rot)
  (command "._-INSERT" filePath inspt sx sy rot)
)

(defun c:GeneratePrueba2 (/ ss shell terrace-shell
  void-master void-bed2 void-bed3 void-secbath void-mainbath
  void-entry void-hall void-living void-terrace
  op-entry op-entry-hall op-hall-master op-hall-bed2 op-hall-bed3
  op-hall-mainbath op-entry-secbath op-hall-living
  win-master win-bed2 win-bed3 win-living1 win-living2 win-bath
  outpath)

  (setvar "CMDECHO" 0)
  (setvar "OSMODE"  0)

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 1: CLEAR DRAWING
  ;; ══════════════════════════════════════════════════════════════════════
  (setvar "CLAYER" "0")
  (setq ss (ssget "X"))
  (if ss (command "._ERASE" ss ""))

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 2: LAYER SETUP
  ;; ══════════════════════════════════════════════════════════════════════
  (command "._LAYER" "_M" "WALLS"      "_C" "7" "" "_LW" "0.40" "" "")
  (command "._LAYER" "_M" "DOORS"      "_C" "3" "" "_LW" "0.30" "" "")
  (command "._LAYER" "_M" "WINDOWS"    "_C" "4" "" "_LW" "0.25" "" "")
  (command "._LAYER" "_M" "FLOOR"      "_C" "8" "" "_LW" "0.15" "" "")
  (command "._LAYER" "_M" "DIMENSIONS" "_C" "2" "" "_LW" "0.18" "" "")
  (command "._LAYER" "_M" "TEXT"       "_C" "7" "" "_LW" "0.15" "" "")

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 3: FLOOR OUTLINES
  ;; ══════════════════════════════════════════════════════════════════════
  ;; House envelope: 14.30 x 10.50
  ;; Terrace/Garden: Y 10.50 to 14.00
  (setvar "CLAYER" "FLOOR")
  (command "._RECTANG" "0,0" "14.30,10.50")
  (command "._RECTANG" "0,10.50" "14.30,14.00")

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 4: WALL SHELL (main body as REGION)
  ;; ══════════════════════════════════════════════════════════════════════
  (setvar "CLAYER" "WALLS")
  (setq shell (reg-rect 0.0 0.0 14.30 10.50))

  ;; Terrace shell (thin border region)
  (setq terrace-shell (reg-rect 0.0 10.50 14.30 14.00))

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 5: ROOM VOIDS (SUBTRACT from shell)
  ;; ══════════════════════════════════════════════════════════════════════
  ;; ── Private Zone (South band, Y 0.25 to 4.65) ──────────────────────

  ;; Master Bedroom: 3.50 x 4.40 = 15.40 m²
  (setq void-master (reg-rect 0.25 0.25 3.75 4.65))

  ;; Bedroom 2: 3.10 x 4.40 = 13.64 m²
  (setq void-bed2 (reg-rect 3.90 0.25 7.00 4.65))

  ;; Bedroom 3: 2.90 x 4.40 = 12.76 m²
  (setq void-bed3 (reg-rect 7.15 0.25 10.05 4.65))

  ;; Secondary Bathroom: 2.20 x 2.10 = 4.62 m²
  (setq void-secbath (reg-rect 10.20 0.25 12.40 2.35))

  ;; Main Bathroom: 2.20 x 2.15 = 4.73 m²
  (setq void-mainbath (reg-rect 10.20 2.50 12.40 4.65))

  ;; Entry Vestibule: 1.50 x 4.40 = 6.60 m²
  (setq void-entry (reg-rect 12.55 0.25 14.05 4.65))

  ;; ── Transit Zone (Hallway, Y 4.80 to 5.80) ─────────────────────────
  ;; Hallway: 13.80 x 1.00 = 13.80 m²
  (setq void-hall (reg-rect 0.25 4.80 14.05 5.80))

  ;; ── Social Zone (North band, Y 5.95 to 10.25) ──────────────────────
  ;; Living + Dining + Kitchen: 13.80 x 4.30 = 59.34 m²
  (setq void-living (reg-rect 0.25 5.95 14.05 10.25))

  ;; SUBTRACT all room voids from main shell
  (command "._SUBTRACT" shell ""
    void-master void-bed2 void-bed3
    void-secbath void-mainbath void-entry
    void-hall void-living
    "")

  ;; ── Terrace void ───────────────────────────────────────────────────
  (setq void-terrace (reg-rect 0.25 10.75 14.05 13.75))
  (command "._SUBTRACT" terrace-shell "" void-terrace "")

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 6: DOOR OPENINGS (cut through walls)
  ;; ══════════════════════════════════════════════════════════════════════

  ;; 1. Exterior entrance door (south wall of entry vestibule)
  ;;    Centered on entry: X = 12.55+(1.50/2)-(0.90/2) = 12.85 to 13.75
  (setq op-entry (reg-rect 12.85 -0.10 13.75 0.35))

  ;; 2. Entry vestibule → Hallway (horizontal wall Y 4.65-4.80)
  ;;    Centered on entry at X=13.30, width=0.80
  (setq op-entry-hall (reg-rect 12.90 4.65 13.70 4.80))

  ;; 3. Hallway → Master Bedroom (horizontal wall Y 4.65-4.80)
  ;;    Centered on master at X=2.00, width=0.80
  (setq op-hall-master (reg-rect 1.60 4.65 2.40 4.80))

  ;; 4. Hallway → Bedroom 2 (horizontal wall Y 4.65-4.80)
  ;;    Centered on bed2 at X=5.45, width=0.80
  (setq op-hall-bed2 (reg-rect 5.05 4.65 5.85 4.80))

  ;; 5. Hallway → Bedroom 3 (horizontal wall Y 4.65-4.80)
  ;;    Centered on bed3 at X=8.60, width=0.80
  (setq op-hall-bed3 (reg-rect 8.20 4.65 9.00 4.80))

  ;; 6. Hallway → Main Bathroom (horizontal wall Y 4.65-4.80)
  ;;    Centered on mainbath at X=11.30, width=0.80
  (setq op-hall-mainbath (reg-rect 10.90 4.65 11.70 4.80))

  ;; 7. Entry vestibule → Secondary Bathroom (vertical wall X 12.40-12.55)
  ;;    Centered on secbath Y overlap, width=0.80
  (setq op-entry-secbath (reg-rect 12.40 0.90 12.55 1.70))

  ;; 8. Hallway → Living (horizontal wall Y 5.80-5.95) — wide opening 4.0m
  ;;    Centered at X=7.15, width=4.00
  (setq op-hall-living (reg-rect 5.15 5.80 9.15 5.95))

  ;; SUBTRACT all door openings from shell
  (command "._SUBTRACT" shell ""
    op-entry op-entry-hall
    op-hall-master op-hall-bed2 op-hall-bed3
    op-hall-mainbath op-entry-secbath op-hall-living
    "")

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 7: WINDOW OPENINGS (cut through exterior walls)
  ;; ══════════════════════════════════════════════════════════════════════

  ;; 1. Master Bedroom window (south wall) — 1.80m wide
  ;;    Centered: X = 0.25+(3.50/2)-(1.80/2) = 1.10 to 2.90
  (setq win-master (reg-rect 1.10 -0.10 2.90 0.35))

  ;; 2. Bedroom 2 window (south wall) — 1.80m wide
  ;;    Centered: X = 3.90+(3.10/2)-(1.80/2) = 4.55 to 6.35
  (setq win-bed2 (reg-rect 4.55 -0.10 6.35 0.35))

  ;; 3. Bedroom 3 window (south wall) — 1.80m wide
  ;;    Centered: X = 7.15+(2.90/2)-(1.80/2) = 7.70 to 9.50
  (setq win-bed3 (reg-rect 7.70 -0.10 9.50 0.35))

  ;; 4. Living room window 1 (north wall) — 3.50m wide sliding door
  ;;    X = 2.00 to 5.50
  (setq win-living1 (reg-rect 2.00 10.15 5.50 10.60))

  ;; 5. Living room window 2 (north wall) — 3.50m wide sliding door
  ;;    X = 7.50 to 11.00
  (setq win-living2 (reg-rect 7.50 10.15 11.00 10.60))

  ;; 6. Main Bathroom window (east wall) — 0.80m wide
  ;;    Centered on mainbath: Y = 2.50+(2.15/2)-(0.80/2) = 3.175 to 3.975
  ;;    Using east wall inner face at X=14.05
  ;;    Note: entry vestibule occupies X 12.55-14.05, mainbath is at X 10.20-12.40
  ;;    Bath has no exterior wall access... skip or use a small west window on entry side
  ;;    Actually, let's add a vent window on the right exterior wall for the entry corridor
  ;;    Entry occupies X 12.55-14.05, east wall at X=14.05-14.30
  (setq win-bath (reg-rect 14.05 3.00 14.40 3.80))

  ;; SUBTRACT all window openings from shell
  (command "._SUBTRACT" shell ""
    win-master win-bed2 win-bed3
    win-living1 win-living2 win-bath
    "")

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 8: DOOR BLOCK INSERTS & ARCS
  ;; ══════════════════════════════════════════════════════════════════════
  (setvar "CLAYER" "DOORS")

  ;; Block paths
  ;; Using puerta_09 for exterior (0.90m), puerta_08 for interior (0.80m)
  ;; Path to blocks
  (setq door09 "C:/Users/moise/Documents/010_MCP_CAD/blocks/doors/puerta_09.dwg")
  (setq door08 "C:/Users/moise/Documents/010_MCP_CAD/blocks/doors/puerta_08.dwg")

  ;; 1. Exterior entry door — 0.90m, opens inward (north), at south wall
  (insblk door09 (list 12.85 0.0) 1 1 0)

  ;; 2. Entry→Hall door — 0.80m, at Y=4.65 transition
  (insblk door08 (list 12.90 4.65) 1 1 0)

  ;; 3. Hall→Master door — 0.80m, opens into bedroom (south)
  (insblk door08 (list 1.60 4.80) 1 1 180)

  ;; 4. Hall→Bed2 door — 0.80m
  (insblk door08 (list 5.05 4.80) 1 1 180)

  ;; 5. Hall→Bed3 door — 0.80m
  (insblk door08 (list 8.20 4.80) 1 1 180)

  ;; 6. Hall→MainBath door — 0.80m
  (insblk door08 (list 10.90 4.80) 1 1 180)

  ;; 7. Entry→SecBath door — 0.80m, vertical wall opening
  (insblk door08 (list 12.40 0.90) 1 1 90)

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 9: WINDOW BLOCK INSERTS
  ;; ══════════════════════════════════════════════════════════════════════
  (setvar "CLAYER" "WINDOWS")

  (setq winblk "C:/Users/moise/Documents/010_MCP_CAD/blocks/windows/ventana_2m.dwg")

  ;; Window cancelería lines (drawn as lines through window openings)

  ;; 1. Master window — south wall, 1.80m wide
  ;;    Cancelería line at Y=0.125 (midpoint of 0.25 wall)
  (command "._LINE" (list 1.10 0.125) (list 2.90 0.125) "")

  ;; 2. Bed2 window — south wall
  (command "._LINE" (list 4.55 0.125) (list 6.35 0.125) "")

  ;; 3. Bed3 window — south wall
  (command "._LINE" (list 7.70 0.125) (list 9.50 0.125) "")

  ;; 4. Living window 1 — north wall, cancelería at Y=10.375
  (command "._LINE" (list 2.00 10.375) (list 5.50 10.375) "")

  ;; 5. Living window 2 — north wall
  (command "._LINE" (list 7.50 10.375) (list 11.00 10.375) "")

  ;; 6. Bath vent window — east wall, cancelería at X=14.225
  (command "._LINE" (list 14.225 3.00) (list 14.225 3.80) "")

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 10: ROOM LABELS
  ;; ══════════════════════════════════════════════════════════════════════
  (setvar "CLAYER" "TEXT")

  ;; Master Bedroom — centroid: (2.00, 2.45)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 2.00 2.45 0.0) (11 2.00 2.45 0.0)
    (40 . 0.28) (1 . "Master Bedroom") (72 . 1) (73 . 2)))

  ;; Bedroom 2 — centroid: (5.45, 2.45)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 5.45 2.45 0.0) (11 5.45 2.45 0.0)
    (40 . 0.28) (1 . "Bedroom 2") (72 . 1) (73 . 2)))

  ;; Bedroom 3 — centroid: (8.60, 2.45)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 8.60 2.45 0.0) (11 8.60 2.45 0.0)
    (40 . 0.28) (1 . "Bedroom 3") (72 . 1) (73 . 2)))

  ;; Secondary Bathroom — centroid: (11.30, 1.30)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 11.30 1.30 0.0) (11 11.30 1.30 0.0)
    (40 . 0.22) (1 . "Sec. Bath") (72 . 1) (73 . 2)))

  ;; Main Bathroom — centroid: (11.30, 3.575)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 11.30 3.575 0.0) (11 11.30 3.575 0.0)
    (40 . 0.22) (1 . "Main Bath") (72 . 1) (73 . 2)))

  ;; Entry Vestibule — centroid: (13.30, 2.45)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 13.30 2.45 0.0) (11 13.30 2.45 0.0)
    (40 . 0.20) (1 . "Entry") (72 . 1) (73 . 2)))

  ;; Hallway — centroid: (7.15, 5.30)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 7.15 5.30 0.0) (11 7.15 5.30 0.0)
    (40 . 0.20) (1 . "Hallway") (72 . 1) (73 . 2)))

  ;; Living / Kitchen / Dining — centroid: (7.15, 8.10)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 7.15 8.10 0.0) (11 7.15 8.10 0.0)
    (40 . 0.35) (1 . "Living / Kitchen / Dining") (72 . 1) (73 . 2)))

  ;; Terrace — centroid: (7.15, 12.25)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 7.15 12.25 0.0) (11 7.15 12.25 0.0)
    (40 . 0.25) (1 . "Terrace / Garden") (72 . 1) (73 . 2)))

  ;; Parking label (exterior, right side south)
  (entmake '((0 . "TEXT") (8 . "TEXT")
    (10 12.50 -1.50 0.0) (11 12.50 -1.50 0.0)
    (40 . 0.25) (1 . "Parking") (72 . 1) (73 . 2)))

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 11: DIMENSIONS
  ;; ══════════════════════════════════════════════════════════════════════
  (setvar "CLAYER" "DIMENSIONS")

  ;; Overall horizontal dimension (bottom of house)
  (command "._DIMLINEAR" "0,0" "14.30,0" "_H" "7.15,-2.0")

  ;; Overall vertical dimension (right side — house body)
  (command "._DIMLINEAR" "14.30,0" "14.30,10.50" "_V" "16.0,5.25")

  ;; Terrace vertical dimension
  (command "._DIMLINEAR" "14.30,10.50" "14.30,14.00" "_V" "16.0,12.25")

  ;; Private zone depth — left side
  (command "._DIMLINEAR" "0,0" "0,4.90" "_V" "-1.8,2.45")

  ;; Social zone depth — left side
  (command "._DIMLINEAR" "0,5.60" "0,10.50" "_V" "-1.8,8.05")

  ;; Room widths along south facade
  ;; Master
  (command "._DIMLINEAR" "0.25,0.25" "3.75,0.25" "_H" "2.00,-0.8")
  ;; Bed2
  (command "._DIMLINEAR" "3.90,0.25" "7.00,0.25" "_H" "5.45,-0.8")
  ;; Bed3
  (command "._DIMLINEAR" "7.15,0.25" "10.05,0.25" "_H" "8.60,-0.8")
  ;; Bathrooms + entry
  (command "._DIMLINEAR" "10.20,0.25" "14.05,0.25" "_H" "12.15,-0.8")

  ;; ══════════════════════════════════════════════════════════════════════
  ;; PHASE 12: SAVE DRAWING
  ;; ══════════════════════════════════════════════════════════════════════
  (setvar "FILEDIA" 0)
  (setq outpath "C:/Users/moise/Documents/010_MCP_CAD/outputs/prueba2.dwg")
  (if (findfile outpath)
    (progn
      (command "._SAVEAS" "2018" outpath "_Y")
    )
    (command "._SAVEAS" "2018" outpath)
  )
  (setvar "FILEDIA" 1)
  (command "._ZOOM" "_E")
  (princ (strcat "\nSaved: " outpath "\n"))
  (princ)
)

;; Auto-run on load
(c:GeneratePrueba2)
