(vl-load-com)

(defun reg-rect (x1 y1 x2 y2 / e)
  (command "._RECTANG" (list x1 y1) (list x2 y2))
  (command "._REGION" (entlast) "")
  (setq e (entlast))
)

(defun insblk (filePath inspt sx sy rot)
  (command "._-INSERT" filePath inspt sx sy rot)
)

(defun c:GenerateHouse8x10 (/ shell publicZone hallZone bed1Zone bathZone bed2Zone 
                              opMain opHall opBed1 opBed2 opBath winLiv winKit winBed1 winBath winBed2 outpath)
  (setvar "CMDECHO" 0)
  (setvar "OSMODE" 0)

  ;; Clear drawing
  (setvar "CLAYER" "0")
  (command "._ERASE" "_ALL" "")

  ;; Layers
  (command "._LAYER" "_M" "WALLS"      "_C" "7" "" "_LW" "0.40" "" "")
  (command "._LAYER" "_M" "DOORS"      "_C" "3" "" "_LW" "0.30" "" "")
  (command "._LAYER" "_M" "WINDOWS"    "_C" "4" "" "_LW" "0.25" "" "")
  (command "._LAYER" "_M" "FLOOR"      "_C" "8" "" "_LW" "0.15" "" "")
  (command "._LAYER" "_M" "TEXT"       "_C" "7" "" "_LW" "0.15" "" "")

  ;; FLOOR PLAN - 10m x 8m
  (setvar "CLAYER" "FLOOR")
  (command "._RECTANG" "0,0" "10,8")

  ;; WALL SHELL - 10x8 Block
  (setvar "CLAYER" "WALLS")
  (setq shell (reg-rect 0 0 10 8))

  ;; SUBTRACT ROOMS (Creating Walls 0.15m thick)
  ;; Layout Strategy: 
  ;; Left Strip (Public): X 0.15 - 5.35 (Width 5.2)
  ;; Center Strip (Hall): X 5.50 - 6.35 (Width 0.85)
  ;; Right Strip (Private): X 6.50 - 9.85 (Width 3.35)

  ;; 1. Public Zone (Living + Kitchen Open Space)
  (setq publicZone (reg-rect 0.15 0.15 5.35 7.85))

  ;; 2. Hallway (Connecting Living to Private)
  ;; Y 1.50 - 6.50 (Not full depth)
  (setq hallZone (reg-rect 5.50 1.50 6.35 6.50))

  ;; 3. Private Rooms (Right Strip)
  ;; Bed 1 (Front): Y 0.15 - 3.00
  (setq bed1Zone (reg-rect 6.50 0.15 9.85 3.00))
  
  ;; Bath (Middle): Y 3.15 - 4.65 (1.5m deep)
  (setq bathZone (reg-rect 6.50 3.15 9.85 4.65))
  
  ;; Bed 2 (Back): Y 4.80 - 7.85
  (setq bed2Zone (reg-rect 6.50 4.80 9.85 7.85))

  (command "._SUBTRACT" shell "" publicZone hallZone bed1Zone bathZone bed2Zone "")

  ;; CREATE OPENINGS (Doors/Arches)
  
  ;; Main Door (Front Wall, into Living) - 1.0m wide
  (setq opMain (reg-rect 1.5 -0.1 2.5 0.3))

  ;; Living -> Hall Arch (Through Wall X=5.35-5.50) - 1.2m wide
  (setq opHall (reg-rect 5.30 3.0 5.55 4.2))

  ;; Hall -> Bed 1 (Through Wall X=6.35-6.50) - 0.9m wide
  (setq opBed1 (reg-rect 6.30 1.8 6.55 2.7))

  ;; Hall -> Bath (Through Wall X=6.35-6.50) - 0.8m wide
  (setq opBath (reg-rect 6.30 3.5 6.55 4.3))

  ;; Hall -> Bed 2 (Through Wall X=6.35-6.50) - 0.9m wide
  (setq opBed2 (reg-rect 6.30 5.2 6.55 6.1))

  (command "._SUBTRACT" shell "" opMain opHall opBed1 opBath opBed2 "")

  ;; WINDOWS (Cuts)
  ;; Living (Front)
  (setq winLiv (reg-rect 3.0 -0.1 5.0 0.3))
  ;; Kitchen (Back)
  (setq winKit (reg-rect 1.0 7.8 4.0 8.2))
  ;; Bed 1 (Right Side)
  (setq winBed1 (reg-rect 9.8 1.0 10.2 2.5))
  ;; Bed 2 (Right Side)
  (setq winBed2 (reg-rect 9.8 5.5 10.2 7.0))
  ;; Bath (High window, Right Side)
  (setq winBath (reg-rect 9.8 3.5 10.2 4.3))

  (command "._SUBTRACT" shell "" winLiv winKit winBed1 winBed2 winBath "")

  ;; INSERT BLOCKS
  (setvar "CLAYER" "DOORS")
  ;; Main Door (Horizontal, Front)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "1.5,0.0" 1 1 0)

  ;; Bed 1 Door (Vertical, Hall->Bed1)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "6.35,1.8" 1 1 90)

  ;; Bath Door (Vertical, Hall->Bath)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "6.35,3.5" 0.88 1 90)

  ;; Bed 2 Door (Vertical, Hall->Bed2)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/doors/puerta_09.dwg" "6.35,5.2" 1 1 90)

  (setvar "CLAYER" "WINDOWS")
  ;; Living (Front, Horizontal)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "3.0,0.0" 1 1 0)

  ;; Kitchen (Back, Horizontal)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "1.0,8.0" 1.5 1 0)

  ;; Bed 1 (Right, Vertical)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "10.0,1.0" 0.75 1 90)

  ;; Bed 2 (Right, Vertical)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "10.0,5.5" 0.75 1 90)

  ;; Bath (Right, Vertical)
  (insblk "C:/Users/moise/Documents/010_MCP/blocks/windows/ventana_2m.dwg" "10.0,3.5" 0.4 1 90)

  ;; FURNITURE / SYMBOLS
  (setvar "CLAYER" "TEXT")
  (command "._TEXT" "_C" "2.75,4.0" "0.2" "0" "LIVING / DINING")
  (command "._TEXT" "_C" "2.75,6.5" "0.2" "0" "KITCHEN")
  (command "._TEXT" "_C" "5.9,4.0" "0.15" "90" "HALL")
  (command "._TEXT" "_C" "8.15,1.5" "0.2" "0" "BEDROOM 1")
  (command "._TEXT" "_C" "8.15,3.9" "0.2" "0" "BATH")
  (command "._TEXT" "_C" "8.15,6.3" "0.2" "0" "BEDROOM 2")

  ;; SAVE
  (setq outpath "C:/Users/moise/Documents/010_MCP/outputs/casa_8x10_v2.dwg")
  (command "._SAVEAS" "2018" outpath)
  (command "._ZOOM" "_E")
  (princ (strcat "\nGenerated: " outpath))
  (princ)
)

(c:GenerateHouse8x10)