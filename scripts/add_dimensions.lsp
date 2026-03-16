(defun c:AddDims ()
  (vl-load-com)
  (setq acadObj (vlax-get-acad-object))
  (setq doc (vla-get-ActiveDocument acadObj))
  (setq modelSpace (vla-get-ModelSpace doc))
  
  ;; Zoom Extents to update EXTMIN/EXTMAX
  (command "._ZOOM" "_E")
  
  ;; Get Extents from system variables
  (setq minPt (getvar "EXTMIN"))
  (setq maxPt (getvar "EXTMAX"))
  
  (setq minX (car minPt) minY (cadr minPt))
  (setq maxX (car maxPt) maxY (cadr maxPt))
  
  ;; Define corner points
  (setq p1 (list minX minY 0.0)) ;; Bottom-Left
  (setq p2 (list maxX minY 0.0)) ;; Bottom-Right
  (setq p3 (list maxX maxY 0.0)) ;; Top-Right
  
  ;; Calculate an offset for the dimension line (approx 5% of width/height)
  (setq width (- maxX minX))
  (setq height (- maxY minY))
  (setq offset (* 0.05 (max width height)))
  (if (< offset 1.0) (setq offset 50.0)) ;; Ensure minimum offset
  
  ;; Points where the dimension text will sit
  (setq dimPtBottom (list (/ (+ minX maxX) 2.0) (- minY offset) 0.0))
  (setq dimPtRight (list (+ maxX offset) (/ (+ minY maxY) 2.0) 0.0))

  ;; Create and activate "COTAS" layer (Red color)
  (command "._LAYER" "_M" "COTAS" "_C" "1" "" "")
  (setvar "CLAYER" "COTAS")
  
  ;; Add Horizontal Dimension (Width) - Bottom
  ;; P1=Start, P2=End, Location=dimPtBottom
  (command "._DIMLINEAR" p1 p2 "_H" dimPtBottom)
  
  ;; Add Vertical Dimension (Height) - Right
  ;; P2=Start, P3=End, Location=dimPtRight
  (command "._DIMLINEAR" p2 p3 "_V" dimPtRight)
  
  (princ "\nDimensions created on layer COTAS.\n")
  (command "._QSAVE")
)

;; Execute the function
(c:AddDims)
