(defun oc:json-escape (s / out i ch)
  (setq s (vl-princ-to-string (if s s "")))
  (setq out "" i 1)
  (while (<= i (strlen s))
    (setq ch (substr s i 1))
    (cond
      ((= ch "\\") (setq out (strcat out "\\\\")))
      ((= ch "\"") (setq out (strcat out "\\\"")))
      ((= ch (chr 9)) (setq out (strcat out "\\t")))
      ((= ch (chr 10)) (setq out (strcat out "\\n")))
      ((= ch (chr 13)) (setq out (strcat out "\\r")))
      (t (setq out (strcat out ch)))
    )
    (setq i (1+ i))
  )
  out
)

(defun oc:jstr (s) (strcat "\"" (oc:json-escape s) "\""))
(defun oc:num (n) (if (numberp n) (rtos n 2 6) "null"))
(defun oc:bool (v) (if v "true" "false"))
(defun oc:dxf (code edata) (cdr (assoc code edata)))
(defun oc:str-up (s) (strcase (vl-princ-to-string (if s s ""))))

(defun oc:pt-json (p)
  (if (and p (listp p))
    (strcat "{\"x\":" (oc:num (car p)) ",\"y\":" (oc:num (cadr p)) ",\"z\":" (oc:num (if (caddr p) (caddr p) 0.0)) "}")
    "null"
  )
)

(defun oc:join (items sep / result)
  (if items
    (progn
      (setq result (car items))
      (foreach item (cdr items) (setq result (strcat result sep item)))
      result
    )
    ""
  )
)

(defun oc:update-count (alist key / cell)
  (setq cell (assoc key alist))
  (if cell
    (subst (cons key (1+ (cdr cell))) cell alist)
    (cons (cons key 1) alist)
  )
)

(defun oc:counts-json (alist / out)
  (setq out '())
  (foreach pair alist
    (setq out (cons (strcat "{\"name\":" (oc:jstr (car pair)) ",\"count\":" (itoa (cdr pair)) "}") out))
  )
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:bbox-from-pts (pts / p minx miny minz maxx maxy maxz z)
  (if pts
    (progn
      (setq p (car pts))
      (setq minx (car p) miny (cadr p) minz (if (caddr p) (caddr p) 0.0))
      (setq maxx minx maxy miny maxz minz)
      (foreach p (cdr pts)
        (setq z (if (caddr p) (caddr p) 0.0))
        (if (< (car p) minx) (setq minx (car p)))
        (if (< (cadr p) miny) (setq miny (cadr p)))
        (if (< z minz) (setq minz z))
        (if (> (car p) maxx) (setq maxx (car p)))
        (if (> (cadr p) maxy) (setq maxy (cadr p)))
        (if (> z maxz) (setq maxz z))
      )
      (list (list minx miny minz) (list maxx maxy maxz))
    )
    nil
  )
)

(defun oc:bbox-json (bbox)
  (if bbox
    (strcat "{\"min\":" (oc:pt-json (car bbox)) ",\"max\":" (oc:pt-json (cadr bbox)) "}")
    "null"
  )
)

(defun oc:lwpoly-vertices (edata / lst out x y)
  (setq lst edata out '())
  (while lst
    (if (= (caar lst) 10)
      (progn
        (setq x (cadar lst))
        (setq y (caddar lst))
        (setq out (cons (list x y 0.0) out))
      )
    )
    (setq lst (cdr lst))
  )
  (reverse out)
)

(defun oc:points-json (pts / out)
  (setq out '())
  (foreach p pts (setq out (cons (oc:pt-json p) out)))
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:poly-length (pts closed / total prev first)
  (setq total 0.0)
  (if pts
    (progn
      (setq prev (car pts) first (car pts))
      (foreach p (cdr pts)
        (setq total (+ total (distance prev p)))
        (setq prev p)
      )
      (if (and closed (> (length pts) 2))
        (setq total (+ total (distance prev first)))
      )
    )
  )
  total
)

(defun oc:poly-area (pts / n i p1 p2 sum)
  (setq n (length pts) i 0 sum 0.0)
  (if (> n 2)
    (progn
      (while (< i n)
        (setq p1 (nth i pts))
        (setq p2 (nth (rem (1+ i) n) pts))
        (setq sum (+ sum (- (* (car p1) (cadr p2)) (* (car p2) (cadr p1)))))
        (setq i (1+ i))
      )
      (/ (abs sum) 2.0)
    )
    nil
  )
)

(defun oc:layer-category (layer typ / u)
  (setq u (oc:str-up layer))
  (cond
    ((or (wcmatch u "*DOOR*") (wcmatch u "*PUERT*")) "doors")
    ((or (wcmatch u "*WINDOW*") (wcmatch u "*VENTAN*") (wcmatch u "*WIN*")) "windows")
    ((or (wcmatch u "*WALL*") (wcmatch u "*MURO*") (wcmatch u "*PARED*")) "walls")
    ((or (wcmatch u "*TEXT*") (wcmatch u "*NOTA*") (wcmatch u "*LABEL*")) "labels")
    ((or (wcmatch u "*DIM*") (wcmatch u "*COTA*")) "dimensions")
    ((or (wcmatch u "*ELEC*") (wcmatch u "*EL*CTR*")) "electrical")
    ((wcmatch u "*PLOM*") "plumbing")
    ((= typ "INSERT") "blocks")
    (t "other")
  )
)

(defun oc:block-kind (name flags / u)
  (setq u (oc:str-up name))
  (cond
    ((wcmatch u "*MODEL_SPACE") "layout")
    ((wcmatch u "*PAPER_SPACE*") "layout")
    ((= 1 (logand 1 flags)) "anonymous")
    ((= 4 (logand 4 flags)) "xref")
    ((= 8 (logand 8 flags)) "xref-overlay")
    (t "named")
  )
)

(defun oc:block-useful-p (name flags / kind u)
  (setq kind (oc:block-kind name flags))
  (setq u (oc:str-up name))
  (and
    (= kind "named")
    (not (wcmatch u "A$C*"))
    (not (wcmatch u "*MODEL_SPACE*"))
    (not (wcmatch u "*PAPER_SPACE*"))
  )
)

(defun oc:block-category (name / u)
  (setq u (oc:str-up name))
  (cond
    ((or (wcmatch u "*PUERTA*") (wcmatch u "*DOOR*")) "doors")
    ((or (wcmatch u "*VENTANA*") (wcmatch u "*WINDOW*") (wcmatch u "*WIN*")) "windows")
    ((or (wcmatch u "*MESA*") (wcmatch u "*SILLA*") (wcmatch u "*SOFA*") (wcmatch u "*BED*") (wcmatch u "*CAMA*") (wcmatch u "*TABLE*") (wcmatch u "*CHAIR*")) "furniture")
    ((or (wcmatch u "*WC*") (wcmatch u "*LAVAMANO*") (wcmatch u "*LAVABO*") (wcmatch u "*INODORO*") (wcmatch u "*DUCHA*") (wcmatch u "*SHOWER*")) "sanitary")
    ((or (wcmatch u "*TOMA*") (wcmatch u "*SWITCH*") (wcmatch u "*LUZ*") (wcmatch u "*LAMP*") (wcmatch u "*ELECT*")) "electrical")
    (t "other")
  )
)

(defun oc:block-definitions-json (/ rec out name flags kind useful category)
  (setq rec (tblnext "BLOCK" T) out '())
  (while rec
    (setq name (oc:dxf 2 rec))
    (setq flags (oc:dxf 70 rec))
    (setq kind (oc:block-kind name flags))
    (setq useful (oc:block-useful-p name flags))
    (setq category (oc:block-category name))
    (setq out (cons
      (strcat
        "{"
        "\"name\":" (oc:jstr name) ","
        "\"kind\":" (oc:jstr kind) ","
        "\"useful\":" (oc:bool useful) ","
        "\"category\":" (oc:jstr category) ","
        "\"flags\":" (itoa flags)
        "}"
      ) out))
    (setq rec (tblnext "BLOCK"))
  )
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:useful-block-definitions-json (/ rec out name flags kind useful category)
  (setq rec (tblnext "BLOCK" T) out '())
  (while rec
    (setq name (oc:dxf 2 rec))
    (setq flags (oc:dxf 70 rec))
    (setq kind (oc:block-kind name flags))
    (setq useful (oc:block-useful-p name flags))
    (setq category (oc:block-category name))
    (if useful
      (setq out (cons
        (strcat
          "{"
          "\"name\":" (oc:jstr name) ","
          "\"kind\":" (oc:jstr kind) ","
          "\"category\":" (oc:jstr category) ","
          "\"flags\":" (itoa flags)
          "}"
        ) out))
    )
    (setq rec (tblnext "BLOCK"))
  )
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:inserted-blocks-json (alist / out)
  (setq out '())
  (foreach pair alist
    (setq out (cons
      (strcat
        "{"
        "\"name\":" (oc:jstr (car pair)) ","
        "\"count\":" (itoa (cdr pair))
        "}"
      ) out))
  )
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:block-category-counts-json (alist / out)
  (setq out '())
  (foreach pair alist
    (setq out (cons
      (strcat
        "{"
        "\"category\":" (oc:jstr (car pair)) ","
        "\"count\":" (itoa (cdr pair))
        "}"
      ) out))
  )
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:insert-attributes-json (ename / next ed out tag val)
  (setq out '())
  (setq next (entnext ename))
  (while next
    (setq ed (entget next))
    (cond
      ((= (oc:dxf 0 ed) "SEQEND") (setq next nil))
      ((= (oc:dxf 0 ed) "ATTRIB")
        (setq tag (oc:dxf 2 ed))
        (setq val (oc:dxf 1 ed))
        (setq out (cons
          (strcat
            "{"
            "\"tag\":" (oc:jstr tag) ","
            "\"value\":" (oc:jstr val)
            "}"
          ) out))
        (setq next (entnext next))
      )
      (t (setq next (entnext next)))
    )
  )
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:entity-json (ename / edata typ layer handle category start end len area center rad txt blockName inspt closed pts bbox base attrs blockCat)
  (setq edata (entget ename))
  (setq typ (oc:dxf 0 edata))
  (setq layer (oc:dxf 8 edata))
  (setq handle (oc:dxf 5 edata))
  (setq category (oc:layer-category layer typ))
  (setq base (strcat "{\"handle\":" (oc:jstr handle) ",\"type\":" (oc:jstr typ) ",\"layer\":" (oc:jstr layer) ",\"category\":" (oc:jstr category)))
  (cond
    ((= typ "LINE")
      (setq start (oc:dxf 10 edata) end (oc:dxf 11 edata) len (distance (oc:dxf 10 edata) (oc:dxf 11 edata)))
      (setq bbox (oc:bbox-from-pts (list start end)))
      (strcat base ",\"bbox\":" (oc:bbox-json bbox) ",\"start\":" (oc:pt-json start) ",\"end\":" (oc:pt-json end) ",\"length\":" (oc:num len) "}"))
    ((= typ "LWPOLYLINE")
      (setq closed (= 1 (logand 1 (oc:dxf 70 edata))))
      (setq pts (oc:lwpoly-vertices edata))
      (setq len (oc:poly-length pts closed))
      (setq area (if closed (oc:poly-area pts) nil))
      (setq bbox (oc:bbox-from-pts pts))
      (strcat base ",\"bbox\":" (oc:bbox-json bbox) ",\"closed\":" (oc:bool closed) ",\"length\":" (oc:num len) ",\"area\":" (oc:num area) ",\"vertices\":" (oc:points-json pts) "}"))
    ((= typ "CIRCLE")
      (setq center (oc:dxf 10 edata) rad (oc:dxf 40 edata))
      (setq bbox (oc:bbox-from-pts (list (list (- (car center) rad) (- (cadr center) rad) 0.0) (list (+ (car center) rad) (+ (cadr center) rad) 0.0))))
      (strcat base ",\"bbox\":" (oc:bbox-json bbox) ",\"center\":" (oc:pt-json center) ",\"radius\":" (oc:num rad) ",\"area\":" (oc:num (* pi rad rad)) "}"))
    ((= typ "ARC")
      (setq center (oc:dxf 10 edata) rad (oc:dxf 40 edata))
      (setq bbox (oc:bbox-from-pts (list (list (- (car center) rad) (- (cadr center) rad) 0.0) (list (+ (car center) rad) (+ (cadr center) rad) 0.0))))
      (strcat base ",\"bbox\":" (oc:bbox-json bbox) ",\"center\":" (oc:pt-json center) ",\"radius\":" (oc:num rad) ",\"startAngle\":" (oc:num (oc:dxf 50 edata)) ",\"endAngle\":" (oc:num (oc:dxf 51 edata)) "}"))
    ((or (= typ "TEXT") (= typ "MTEXT"))
      (setq txt (oc:dxf 1 edata) inspt (oc:dxf 10 edata))
      (setq bbox (if inspt (oc:bbox-from-pts (list inspt inspt)) nil))
      (strcat base ",\"bbox\":" (oc:bbox-json bbox) ",\"text\":" (oc:jstr txt) ",\"position\":" (oc:pt-json inspt) ",\"height\":" (oc:num (oc:dxf 40 edata)) "}"))
    ((= typ "INSERT")
      (setq blockName (oc:dxf 2 edata) inspt (oc:dxf 10 edata))
      (setq blockCat (oc:block-category blockName))
      (setq bbox (if inspt (oc:bbox-from-pts (list inspt inspt)) nil))
      (setq attrs (oc:insert-attributes-json ename))
      (strcat base ",\"bbox\":" (oc:bbox-json bbox) ",\"blockName\":" (oc:jstr blockName) ",\"blockCategory\":" (oc:jstr blockCat) ",\"position\":" (oc:pt-json inspt) ",\"xScale\":" (oc:num (oc:dxf 41 edata)) ",\"yScale\":" (oc:num (oc:dxf 42 edata)) ",\"rotation\":" (oc:num (oc:dxf 50 edata)) ",\"attributes\":" attrs "}"))
    ((wcmatch typ "*DIMENSION")
      (strcat base ",\"bbox\":null,\"measurement\":" (oc:num (oc:dxf 42 edata)) ",\"text\":" (oc:jstr (oc:dxf 1 edata)) "}"))
    (t (strcat base ",\"bbox\":null}"))
  )
)

(defun oc:safe-entity-json (ename / result edata)
  (setq result (vl-catch-all-apply 'oc:entity-json (list ename)))
  (if (vl-catch-all-error-p result)
    (progn
      (setq edata (entget ename))
      (strcat
        "{\"handle\":" (oc:jstr (oc:dxf 5 edata))
        ",\"type\":" (oc:jstr (oc:dxf 0 edata))
        ",\"layer\":" (oc:jstr (oc:dxf 8 edata))
        ",\"category\":\"other\""
        ",\"bbox\":null"
        ",\"error\":" (oc:jstr (vl-catch-all-error-message result))
        "}"
      )
    )
    result
  )
)

(defun oc:layer-list-json (/ rec out flags)
  (setq rec (tblnext "LAYER" T) out '())
  (while rec
    (setq flags (oc:dxf 70 rec))
    (setq out (cons
      (strcat "{\"name\":" (oc:jstr (oc:dxf 2 rec)) ",\"color\":" (itoa (abs (oc:dxf 62 rec))) ",\"linetype\":" (oc:jstr (oc:dxf 6 rec)) ",\"locked\":" (oc:bool (= 4 (logand 4 flags))) ",\"frozen\":" (oc:bool (= 1 (logand 1 flags))) "}")
      out))
    (setq rec (tblnext "LAYER"))
  )
  (strcat "[" (oc:join (reverse out) ",") "]")
)

(defun oc:write-context-json (outfile / ss i ename edata typ layer category ents textSamples blockSamples total extMin extMax layersJson summary fp typeCounts layerCounts categoryCounts roomLabelCount insertedBlockCounts insertedBlockCategoryCounts blockDefsJson usefulBlockDefsJson insertedBlocksJson)
  (setq ss (ssget "X"))
  (setq i 0 ents '() textSamples '() blockSamples '() total 0)
  (setq typeCounts '() layerCounts '() categoryCounts '() insertedBlockCounts '() insertedBlockCategoryCounts '())
  (setq roomLabelCount 0)
  (if ss
    (progn
      (repeat (sslength ss)
        (setq ename (ssname ss i))
        (setq edata (entget ename))
        (setq typ (oc:dxf 0 edata))
        (setq layer (oc:dxf 8 edata))
        (setq category (oc:layer-category layer typ))
        (setq ents (cons (oc:safe-entity-json ename) ents))
        (setq typeCounts (oc:update-count typeCounts typ))
        (setq layerCounts (oc:update-count layerCounts layer))
        (setq categoryCounts (oc:update-count categoryCounts category))
        (if (or (= typ "TEXT") (= typ "MTEXT"))
          (progn
            (setq textSamples (cons (oc:jstr (oc:dxf 1 edata)) textSamples))
            (setq roomLabelCount (1+ roomLabelCount))
          )
        )
        (if (= typ "INSERT")
          (progn
            (setq blockSamples (cons (oc:jstr (oc:dxf 2 edata)) blockSamples))
            (setq insertedBlockCounts (oc:update-count insertedBlockCounts (oc:dxf 2 edata)))
            (setq insertedBlockCategoryCounts (oc:update-count insertedBlockCategoryCounts (oc:block-category (oc:dxf 2 edata))))
          )
        )
        (setq total (1+ total) i (1+ i))
      )
    )
  )
  (setq extMin (getvar "EXTMIN"))
  (setq extMax (getvar "EXTMAX"))
  (setq layersJson (oc:layer-list-json))
  (setq blockDefsJson (oc:block-definitions-json))
  (setq usefulBlockDefsJson (oc:useful-block-definitions-json))
  (setq insertedBlocksJson (oc:inserted-blocks-json insertedBlockCounts))
  (setq summary
    (strcat
      "{"
      "\"drawingName\":" (oc:jstr (getvar "DWGNAME")) ","
      "\"fullPath\":" (oc:jstr (strcat (getvar "DWGPREFIX") (getvar "DWGNAME"))) ","
      "\"entityCount\":" (itoa total) ","
      "\"extents\":{\"min\":" (oc:pt-json extMin) ",\"max\":" (oc:pt-json extMax) "},"
      "\"layers\":" layersJson ","
      "\"countsByType\":" (oc:counts-json typeCounts) ","
      "\"countsByLayer\":" (oc:counts-json layerCounts) ","
      "\"countsByCategory\":" (oc:counts-json categoryCounts) ","
      "\"blocks\":{\"defined\":" blockDefsJson ",\"definedUseful\":" usefulBlockDefsJson ",\"inserted\":" insertedBlocksJson ",\"byCategory\":" (oc:block-category-counts-json insertedBlockCategoryCounts) "},"
      "\"inferredMetrics\":{\"roomLabelCount\":" (itoa roomLabelCount) ",\"insertedBlockTypeCount\":" (itoa (length insertedBlockCounts)) "},"
      "\"textSamples\":[" (oc:join (reverse textSamples) ",") "],"
      "\"blockSamples\":[" (oc:join (reverse blockSamples) ",") "]"
      "}"
    )
  )
  (setq fp (open outfile "w"))
  (write-line "{" fp)
  (write-line (strcat "\"summary\":" summary ",") fp)
  (write-line (strcat "\"entities\":[" (oc:join (reverse ents) ",") "]") fp)
  (write-line "}" fp)
  (close fp)
)

(defun c:ExtractContext (/ outfile outdir)
  (setq outdir "C:/Users/moise/Documents/010_MCP/outputs")
  (if (not (vl-file-directory-p outdir)) (vl-mkdir outdir))
  (setq outfile (strcat outdir "/plano-contexto.json"))
  (oc:write-context-json outfile)
  (princ (strcat "\nContext extracted to: " outfile "\n"))
  (princ)
)
