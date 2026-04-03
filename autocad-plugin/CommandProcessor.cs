using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.Colors;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.EditorInput;
using Newtonsoft.Json.Linq;

namespace AutoCAD.MCP.Plugin
{
    public class CommandProcessor
    {
        public object Process(McpCommandRequest request)
        {
            switch (request.Command.ToLower())
            {
                // ── Existing ──────────────────────────
                case "create_line":           return CreateLine(request.Args);
                case "get_layers":            return GetLayers();
                case "create_layer":          return CreateLayer(request.Args);
                case "insert_block":          return InsertBlock(request.Args);
                case "run_command":           return RunCommand(request.Args);
                case "run_lsp_script":        return RunLspScript(request.Args);

                // ── Geometry Advanced ─────────────────
                case "create_circle":         return CreateCircle(request.Args);
                case "create_arc":            return CreateArc(request.Args);
                case "create_polyline":       return CreatePolyline(request.Args);
                case "create_rectangle":      return CreateRectangle(request.Args);
                case "create_hatch":          return CreateHatch(request.Args);
                case "create_ellipse":        return CreateEllipse(request.Args);
                case "create_spline":         return CreateSpline(request.Args);
                case "create_mtext":          return CreateMText(request.Args);
                case "create_text":           return CreateText(request.Args);

                // ── Query & Measurement ───────────────
                case "query_entities":        return QueryEntities(request.Args);
                case "get_entity_properties": return GetEntityProperties(request.Args);
                case "measure_distance":      return MeasureDistance(request.Args);
                case "measure_area":          return MeasureArea(request.Args);
                case "count_entities":        return CountEntities(request.Args);
                case "get_drawing_extents":   return GetDrawingExtents();

                // ── Modify / Transform ────────────────
                case "move_entities":         return MoveEntities(request.Args);
                case "rotate_entities":       return RotateEntities(request.Args);
                case "scale_entities":        return ScaleEntities(request.Args);
                case "copy_entities":         return CopyEntities(request.Args);
                case "mirror_entities":       return MirrorEntities(request.Args);
                case "offset_entity":         return OffsetEntity(request.Args);
                case "erase_entities":        return EraseEntities(request.Args);
                case "change_layer":          return ChangeLayer(request.Args);
                case "change_color":          return ChangeColor(request.Args);

                // ── Block Management ──────────────────
                case "list_blocks":           return ListBlocks();
                case "explode_block":         return ExplodeBlock(request.Args);
                case "get_block_attributes":  return GetBlockAttributes(request.Args);
                case "set_block_attribute":   return SetBlockAttribute(request.Args);

                // ── Dimensions ────────────────────────
                case "add_linear_dimension":  return AddLinearDimension(request.Args);
                case "add_aligned_dimension": return AddAlignedDimension(request.Args);
                case "add_radial_dimension":  return AddRadialDimension(request.Args);

                // ── Annotations ───────────────────────
                case "create_leader":         return CreateLeader(request.Args);
                case "create_table":          return CreateTable(request.Args);
                case "update_text":           return UpdateText(request.Args);

                // ── Layer Management ──────────────────
                case "set_layer_properties":  return SetLayerProperties(request.Args);
                case "delete_layer":          return DeleteLayer(request.Args);
                case "set_current_layer":     return SetCurrentLayer(request.Args);

                // ── Document ──────────────────────────
                case "save_drawing":          return SaveDrawing(request.Args);
                case "zoom_extents":          return ZoomExtents();
                case "undo":                  return Undo(request.Args);

                // ── Advanced ──────────────────────────
                case "create_region":             return CreateRegion(request.Args);
                case "trim_entity":               return TrimEntity(request.Args);
                case "extend_entity":             return ExtendEntity(request.Args);
                case "add_angular_dimension":     return AddAngularDimension(request.Args);
                case "auto_dimension_room":       return AutoDimensionRoom(request.Args);
                case "create_block_definition":   return CreateBlockDefinition(request.Args);
                case "purge_drawing":             return PurgeDrawing();

                default:
                    throw new ArgumentException($"Unknown command: {request.Command}");
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  HELPERS
        // ═══════════════════════════════════════════════════════════════════

        private static Document ActiveDoc => Application.DocumentManager.MdiActiveDocument;
        private static Database ActiveDb => ActiveDoc.Database;
        private static Editor ActiveEditor => ActiveDoc.Editor;

        private static double Deg2Rad(double degrees) => degrees * (Math.PI / 180.0);

        private static double GetDouble(Dictionary<string, object>? args, string key, double fallback = 0)
        {
            if (args != null && args.TryGetValue(key, out var val) && val != null)
                return Convert.ToDouble(val);
            return fallback;
        }

        private static string GetString(Dictionary<string, object>? args, string key, string fallback = "")
        {
            if (args != null && args.TryGetValue(key, out var val) && val != null)
                return val.ToString() ?? fallback;
            return fallback;
        }

        private static int GetInt(Dictionary<string, object>? args, string key, int fallback = 0)
        {
            if (args != null && args.TryGetValue(key, out var val) && val != null)
                return Convert.ToInt32(val);
            return fallback;
        }

        private static bool GetBool(Dictionary<string, object>? args, string key, bool fallback = false)
        {
            if (args != null && args.TryGetValue(key, out var val) && val != null)
                return Convert.ToBoolean(val);
            return fallback;
        }

        private static JArray? GetArray(Dictionary<string, object>? args, string key)
        {
            if (args != null && args.TryGetValue(key, out var val) && val != null)
            {
                if (val is JArray ja) return ja;
                return JArray.FromObject(val);
            }
            return null;
        }

        /// <summary>Find an entity by its hex handle string.</summary>
        private static ObjectId HandleToObjectId(Database db, string hexHandle)
        {
            var handle = new Handle(Convert.ToInt64(hexHandle, 16));
            return db.GetObjectId(false, handle, 0);
        }

        /// <summary>Serialise essential properties of an entity to a dictionary.</summary>
        private static Dictionary<string, object> SerialiseEntity(Entity ent)
        {
            var d = new Dictionary<string, object>
            {
                ["handle"]     = ent.Handle.Value.ToString("X"),
                ["type"]       = ent.GetType().Name,
                ["layer"]      = ent.Layer,
                ["color"]      = ent.Color.ColorIndex,
                ["lineWeight"] = ent.LineWeight.ToString(),
            };

            switch (ent)
            {
                case Line ln:
                    d["startX"] = ln.StartPoint.X; d["startY"] = ln.StartPoint.Y;
                    d["endX"] = ln.EndPoint.X; d["endY"] = ln.EndPoint.Y;
                    d["length"] = ln.Length;
                    break;
                case Circle c:
                    d["centerX"] = c.Center.X; d["centerY"] = c.Center.Y;
                    d["radius"] = c.Radius;
                    d["area"] = c.Area;
                    break;
                case Arc a:
                    d["centerX"] = a.Center.X; d["centerY"] = a.Center.Y;
                    d["radius"] = a.Radius;
                    d["startAngle"] = a.StartAngle * (180.0 / Math.PI);
                    d["endAngle"] = a.EndAngle * (180.0 / Math.PI);
                    d["length"] = a.Length;
                    break;
                case Polyline pl:
                    d["closed"] = pl.Closed;
                    d["length"] = pl.Length;
                    d["numberOfVertices"] = pl.NumberOfVertices;
                    if (pl.Closed) d["area"] = pl.Area;
                    var verts = new List<object>();
                    for (int i = 0; i < pl.NumberOfVertices; i++)
                    {
                        var pt = pl.GetPoint2dAt(i);
                        verts.Add(new { x = pt.X, y = pt.Y, bulge = pl.GetBulgeAt(i) });
                    }
                    d["vertices"] = verts;
                    break;
                case DBText txt:
                    d["text"] = txt.TextString;
                    d["x"] = txt.Position.X; d["y"] = txt.Position.Y;
                    d["height"] = txt.Height;
                    d["rotation"] = txt.Rotation * (180.0 / Math.PI);
                    break;
                case MText mt:
                    d["text"] = mt.Contents;
                    d["x"] = mt.Location.X; d["y"] = mt.Location.Y;
                    d["width"] = mt.Width;
                    d["height"] = mt.TextHeight;
                    break;
                case BlockReference br:
                    d["blockName"] = br.Name;
                    d["x"] = br.Position.X; d["y"] = br.Position.Y;
                    d["scaleX"] = br.ScaleFactors.X; d["scaleY"] = br.ScaleFactors.Y;
                    d["rotation"] = br.Rotation * (180.0 / Math.PI);
                    break;
                case Hatch h:
                    d["patternName"] = h.PatternName;
                    d["area"] = h.Area;
                    break;
                case Ellipse el:
                    d["centerX"] = el.Center.X; d["centerY"] = el.Center.Y;
                    d["majorRadius"] = el.MajorRadius; d["minorRadius"] = el.MinorRadius;
                    d["area"] = el.Area;
                    break;
                case Spline sp:
                    d["closed"] = sp.Closed;
                    d["degree"] = sp.Degree;
                    d["numControlPoints"] = sp.NumControlPoints;
                    break;
                case RotatedDimension rd:
                    d["measurement"] = rd.Measurement;
                    break;
                case AlignedDimension ad:
                    d["measurement"] = ad.Measurement;
                    break;
            }

            return d;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  EXISTING TOOLS (preserved)
        // ═══════════════════════════════════════════════════════════════════

        private object RunCommand(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string command = GetString(args, "command");

            var doc = ActiveDoc;
            doc.SendStringToExecute($"{command} ", true, false, false);

            return new { status = "success", message = "Command queued" };
        }

        private object RunLspScript(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string lspPath = GetString(args, "lspPath");

            if (string.IsNullOrWhiteSpace(lspPath))
                return new { status = "error", message = "lspPath is required" };

            string lispPath = lspPath.Replace('\\', '/');

            if (!File.Exists(lspPath))
                return new { status = "error", message = $"LSP file not found: {lspPath}" };

            var doc = ActiveDoc;
            if (doc == null)
                return new { status = "error", message = "No active AutoCAD document" };

            doc.SendStringToExecute($"(load \"{lispPath}\") ", true, false, false);

            return new { status = "success", message = $"LSP queued for execution: {lspPath}" };
        }

        private object InsertBlock(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));

            string blockName = GetString(args, "blockName");
            string blockPath = GetString(args, "blockPath");
            double x = GetDouble(args, "x");
            double y = GetDouble(args, "y");
            double scale = GetDouble(args, "scale", 1.0);
            double rotation = GetDouble(args, "rotation");

            var db = ActiveDb;

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                BlockTable bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                ObjectId blockId = ObjectId.Null;

                if (bt.Has(blockName))
                {
                    blockId = bt[blockName];
                }
                else if (!string.IsNullOrEmpty(blockPath) && File.Exists(blockPath))
                {
                    using (Database tempDb = new Database(false, true))
                    {
                        tempDb.ReadDwgFile(blockPath, FileOpenMode.OpenForReadAndAllShare, true, "");
                        blockId = db.Insert(blockName, tempDb, true);
                    }
                }
                else
                {
                    return new { status = "error", message = $"Block '{blockName}' not found and no valid path provided." };
                }

                BlockTableRecord btr = (BlockTableRecord)tr.GetObject(bt[BlockTableRecord.ModelSpace], OpenMode.ForWrite);

                using (BlockReference br = new BlockReference(new Point3d(x, y, 0), blockId))
                {
                    br.ScaleFactors = new Scale3d(scale);
                    br.Rotation = Deg2Rad(rotation);

                    btr.AppendEntity(br);
                    tr.AddNewlyCreatedDBObject(br, true);
                }

                tr.Commit();
                return new { status = "success", message = $"Block {blockName} inserted" };
            }
        }

        private object CreateLine(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));

            double x1 = GetDouble(args, "startX");
            double y1 = GetDouble(args, "startY");
            double x2 = GetDouble(args, "endX");
            double y2 = GetDouble(args, "endY");
            string layer = GetString(args, "layer");

            var db = ActiveDb;

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                BlockTable bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                BlockTableRecord btr = (BlockTableRecord)tr.GetObject(bt[BlockTableRecord.ModelSpace], OpenMode.ForWrite);

                var line = new Line(new Point3d(x1, y1, 0), new Point3d(x2, y2, 0));
                if (!string.IsNullOrEmpty(layer)) line.Layer = layer;

                btr.AppendEntity(line);
                tr.AddNewlyCreatedDBObject(line, true);

                tr.Commit();

                return new { status = "success", handle = line.Handle.Value.ToString("X") };
            }
        }

        private object GetLayers()
        {
            var db = ActiveDb;
            var layers = new List<object>();

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                LayerTable lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
                foreach (ObjectId id in lt)
                {
                    LayerTableRecord ltr = (LayerTableRecord)tr.GetObject(id, OpenMode.ForRead);
                    layers.Add(new
                    {
                        name = ltr.Name,
                        color = ltr.Color.ColorIndex,
                        isOff = ltr.IsOff,
                        isFrozen = ltr.IsFrozen,
                        isLocked = ltr.IsLocked,
                        lineWeight = ltr.LineWeight.ToString()
                    });
                }
            }
            return new { status = "success", layers };
        }

        private object CreateLayer(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string name = GetString(args, "name", "NewLayer");
            int color = GetInt(args, "color", 7);
            string lw = GetString(args, "lineWeight", "");

            var db = ActiveDb;

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                LayerTable lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForWrite);
                if (!lt.Has(name))
                {
                    LayerTableRecord ltr = new LayerTableRecord();
                    ltr.Name = name;
                    ltr.Color = Autodesk.AutoCAD.Colors.Color.FromColorIndex(ColorMethod.ByAci, (short)color);
                    if (!string.IsNullOrEmpty(lw) && Enum.TryParse<LineWeight>(lw, true, out var lwVal))
                        ltr.LineWeight = lwVal;
                    lt.Add(ltr);
                    tr.AddNewlyCreatedDBObject(ltr, true);
                    tr.Commit();
                    return new { status = "success", message = $"Layer {name} created" };
                }
                else
                {
                    return new { status = "exists", message = $"Layer {name} already exists" };
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  GEOMETRY ADVANCED
        // ═══════════════════════════════════════════════════════════════════

        private object CreateCircle(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double cx = GetDouble(args, "centerX");
            double cy = GetDouble(args, "centerY");
            double r  = GetDouble(args, "radius", 1.0);
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var circle = new Circle(new Point3d(cx, cy, 0), Vector3d.ZAxis, r);
                if (!string.IsNullOrEmpty(layer)) circle.Layer = layer;

                btr.AppendEntity(circle);
                tr.AddNewlyCreatedDBObject(circle, true);
                tr.Commit();

                return new { status = "success", handle = circle.Handle.Value.ToString("X") };
            }
        }

        private object CreateArc(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double cx = GetDouble(args, "centerX");
            double cy = GetDouble(args, "centerY");
            double r  = GetDouble(args, "radius", 1.0);
            double startAngle = GetDouble(args, "startAngle");
            double endAngle   = GetDouble(args, "endAngle", 360);
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var arc = new Arc(new Point3d(cx, cy, 0), r, Deg2Rad(startAngle), Deg2Rad(endAngle));
                if (!string.IsNullOrEmpty(layer)) arc.Layer = layer;

                btr.AppendEntity(arc);
                tr.AddNewlyCreatedDBObject(arc, true);
                tr.Commit();

                return new { status = "success", handle = arc.Handle.Value.ToString("X") };
            }
        }

        private object CreatePolyline(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var points = GetArray(args, "points");
            bool closed = GetBool(args, "closed");
            string layer = GetString(args, "layer");

            if (points == null || points.Count < 2)
                return new { status = "error", message = "At least 2 points required" };

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var pl = new Polyline();
                for (int i = 0; i < points.Count; i++)
                {
                    var p = points[i] as JObject;
                    double x = p?.Value<double>("x") ?? 0;
                    double y = p?.Value<double>("y") ?? 0;
                    double bulge = p?.Value<double>("bulge") ?? 0;
                    pl.AddVertexAt(i, new Point2d(x, y), bulge, 0, 0);
                }
                pl.Closed = closed;
                if (!string.IsNullOrEmpty(layer)) pl.Layer = layer;

                btr.AppendEntity(pl);
                tr.AddNewlyCreatedDBObject(pl, true);
                tr.Commit();

                return new { status = "success", handle = pl.Handle.Value.ToString("X") };
            }
        }

        private object CreateRectangle(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double x1 = GetDouble(args, "x1");
            double y1 = GetDouble(args, "y1");
            double x2 = GetDouble(args, "x2");
            double y2 = GetDouble(args, "y2");
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var pl = new Polyline();
                pl.AddVertexAt(0, new Point2d(x1, y1), 0, 0, 0);
                pl.AddVertexAt(1, new Point2d(x2, y1), 0, 0, 0);
                pl.AddVertexAt(2, new Point2d(x2, y2), 0, 0, 0);
                pl.AddVertexAt(3, new Point2d(x1, y2), 0, 0, 0);
                pl.Closed = true;
                if (!string.IsNullOrEmpty(layer)) pl.Layer = layer;

                btr.AppendEntity(pl);
                tr.AddNewlyCreatedDBObject(pl, true);
                tr.Commit();

                return new { status = "success", handle = pl.Handle.Value.ToString("X"), area = Math.Abs((x2-x1)*(y2-y1)) };
            }
        }

        private object CreateHatch(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var boundaryHandles = GetArray(args, "boundaryHandles");
            string pattern = GetString(args, "pattern", "SOLID");
            double scale = GetDouble(args, "scale", 1.0);
            double angle = GetDouble(args, "angle");
            string layer = GetString(args, "layer");

            if (boundaryHandles == null || boundaryHandles.Count == 0)
                return new { status = "error", message = "boundaryHandles required" };

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var hatch = new Hatch();
                btr.AppendEntity(hatch);
                tr.AddNewlyCreatedDBObject(hatch, true);

                hatch.SetHatchPattern(
                    pattern.Equals("SOLID", StringComparison.OrdinalIgnoreCase) 
                        ? HatchPatternType.PreDefined 
                        : HatchPatternType.PreDefined,
                    pattern);
                hatch.PatternScale = scale;
                hatch.PatternAngle = Deg2Rad(angle);
                if (!string.IsNullOrEmpty(layer)) hatch.Layer = layer;

                var ids = new ObjectIdCollection();
                foreach (var h in boundaryHandles)
                {
                    ids.Add(HandleToObjectId(db, h.ToString()));
                }
                hatch.AppendLoop(HatchLoopTypes.Outermost, ids);
                hatch.EvaluateHatch(true);

                tr.Commit();
                return new { status = "success", handle = hatch.Handle.Value.ToString("X") };
            }
        }

        private object CreateEllipse(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double cx = GetDouble(args, "centerX");
            double cy = GetDouble(args, "centerY");
            double majorR = GetDouble(args, "majorRadius", 2.0);
            double minorR = GetDouble(args, "minorRadius", 1.0);
            double rotation = GetDouble(args, "rotation");
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var center = new Point3d(cx, cy, 0);
                var majorAxis = new Vector3d(Math.Cos(Deg2Rad(rotation)) * majorR, Math.Sin(Deg2Rad(rotation)) * majorR, 0);
                double ratio = minorR / majorR;

                var ellipse = new Ellipse(center, Vector3d.ZAxis, majorAxis, ratio, 0, 2 * Math.PI);
                if (!string.IsNullOrEmpty(layer)) ellipse.Layer = layer;

                btr.AppendEntity(ellipse);
                tr.AddNewlyCreatedDBObject(ellipse, true);
                tr.Commit();

                return new { status = "success", handle = ellipse.Handle.Value.ToString("X") };
            }
        }

        private object CreateSpline(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var pointsArr = GetArray(args, "points");
            bool closed = GetBool(args, "closed");
            string layer = GetString(args, "layer");

            if (pointsArr == null || pointsArr.Count < 2)
                return new { status = "error", message = "At least 2 points required" };

            var fitPoints = new Point3dCollection();
            foreach (JObject p in pointsArr)
            {
                fitPoints.Add(new Point3d(p.Value<double>("x"), p.Value<double>("y"), 0));
            }

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                // If closed, duplicate first point at end to close the curve
                if (closed && fitPoints.Count >= 2)
                    fitPoints.Add(fitPoints[0]);

                var spline = new Spline(fitPoints, 3, 0.0);
                if (!string.IsNullOrEmpty(layer)) spline.Layer = layer;

                btr.AppendEntity(spline);
                tr.AddNewlyCreatedDBObject(spline, true);
                tr.Commit();

                return new { status = "success", handle = spline.Handle.Value.ToString("X") };
            }
        }

        private object CreateMText(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double x = GetDouble(args, "x");
            double y = GetDouble(args, "y");
            string text = GetString(args, "text", "");
            double height = GetDouble(args, "height", 0.25);
            double width = GetDouble(args, "width", 10);
            double rotation = GetDouble(args, "rotation");
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var mtext = new MText();
                mtext.Location = new Point3d(x, y, 0);
                mtext.Contents = text;
                mtext.TextHeight = height;
                mtext.Width = width;
                mtext.Rotation = Deg2Rad(rotation);
                if (!string.IsNullOrEmpty(layer)) mtext.Layer = layer;

                btr.AppendEntity(mtext);
                tr.AddNewlyCreatedDBObject(mtext, true);
                tr.Commit();

                return new { status = "success", handle = mtext.Handle.Value.ToString("X") };
            }
        }

        private object CreateText(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double x = GetDouble(args, "x");
            double y = GetDouble(args, "y");
            string text = GetString(args, "text", "");
            double height = GetDouble(args, "height", 0.25);
            double rotation = GetDouble(args, "rotation");
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var dbText = new DBText();
                dbText.Position = new Point3d(x, y, 0);
                dbText.TextString = text;
                dbText.Height = height;
                dbText.Rotation = Deg2Rad(rotation);
                if (!string.IsNullOrEmpty(layer)) dbText.Layer = layer;

                btr.AppendEntity(dbText);
                tr.AddNewlyCreatedDBObject(dbText, true);
                tr.Commit();

                return new { status = "success", handle = dbText.Handle.Value.ToString("X") };
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  QUERY & MEASUREMENT
        // ═══════════════════════════════════════════════════════════════════

        private object QueryEntities(Dictionary<string, object>? args)
        {
            string typeFilter = GetString(args, "entityType");
            string layerFilter = GetString(args, "layer");
            int limit = GetInt(args, "limit", 100);

            var db = ActiveDb;
            var results = new List<Dictionary<string, object>>();

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForRead);

                foreach (ObjectId id in btr)
                {
                    if (results.Count >= limit) break;
                    var ent = tr.GetObject(id, OpenMode.ForRead) as Entity;
                    if (ent == null) continue;

                    if (!string.IsNullOrEmpty(typeFilter) &&
                        !ent.GetType().Name.Equals(typeFilter, StringComparison.OrdinalIgnoreCase))
                        continue;

                    if (!string.IsNullOrEmpty(layerFilter) &&
                        !ent.Layer.Equals(layerFilter, StringComparison.OrdinalIgnoreCase))
                        continue;

                    results.Add(SerialiseEntity(ent));
                }
            }

            return new { status = "success", count = results.Count, entities = results };
        }

        private object GetEntityProperties(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var ent = tr.GetObject(objId, OpenMode.ForRead) as Entity;
                if (ent == null)
                    return new { status = "error", message = "Entity not found or not an entity" };

                return new { status = "success", entity = SerialiseEntity(ent) };
            }
        }

        private object MeasureDistance(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double x1 = GetDouble(args, "x1");
            double y1 = GetDouble(args, "y1");
            double x2 = GetDouble(args, "x2");
            double y2 = GetDouble(args, "y2");

            var p1 = new Point3d(x1, y1, 0);
            var p2 = new Point3d(x2, y2, 0);

            return new { status = "success", distance = p1.DistanceTo(p2), deltaX = x2 - x1, deltaY = y2 - y1 };
        }

        private object MeasureArea(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var ent = tr.GetObject(objId, OpenMode.ForRead);

                double area = 0;
                double perimeter = 0;

                switch (ent)
                {
                    case Polyline pl:
                        area = pl.Area;
                        perimeter = pl.Length;
                        break;
                    case Circle c:
                        area = c.Area;
                        perimeter = 2 * Math.PI * c.Radius;
                        break;
                    case Region r:
                        area = r.Area;
                        perimeter = r.Perimeter;
                        break;
                    case Ellipse e:
                        area = e.Area;
                        break;
                    case Hatch h:
                        area = h.Area;
                        break;
                    default:
                        return new { status = "error", message = $"Entity type {ent.GetType().Name} does not support area measurement" };
                }

                return new { status = "success", area, perimeter };
            }
        }

        private object CountEntities(Dictionary<string, object>? args)
        {
            string typeFilter = GetString(args, "entityType");
            string layerFilter = GetString(args, "layer");

            var db = ActiveDb;
            int count = 0;
            var byType = new Dictionary<string, int>();

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForRead);

                foreach (ObjectId id in btr)
                {
                    var ent = tr.GetObject(id, OpenMode.ForRead) as Entity;
                    if (ent == null) continue;

                    if (!string.IsNullOrEmpty(typeFilter) &&
                        !ent.GetType().Name.Equals(typeFilter, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (!string.IsNullOrEmpty(layerFilter) &&
                        !ent.Layer.Equals(layerFilter, StringComparison.OrdinalIgnoreCase))
                        continue;

                    count++;
                    string tn = ent.GetType().Name;
                    byType[tn] = byType.TryGetValue(tn, out int c) ? c + 1 : 1;
                }
            }

            return new { status = "success", count, byType };
        }

        private object GetDrawingExtents()
        {
            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var ext = db.Extmin;
                var ext2 = db.Extmax;
                return new
                {
                    status = "success",
                    minX = ext.X, minY = ext.Y,
                    maxX = ext2.X, maxY = ext2.Y,
                    width = ext2.X - ext.X,
                    height = ext2.Y - ext.Y
                };
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  MODIFY / TRANSFORM
        // ═══════════════════════════════════════════════════════════════════

        private List<ObjectId> ResolveHandles(Dictionary<string, object>? args, string key = "handles")
        {
            var arr = GetArray(args, key);
            if (arr == null || arr.Count == 0)
                throw new ArgumentException($"{key} array is required");

            var db = ActiveDb;
            return arr.Select(h => HandleToObjectId(db, h.ToString())).ToList();
        }

        private object MoveEntities(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);
            double dx = GetDouble(args, "deltaX");
            double dy = GetDouble(args, "deltaY");

            var displacement = new Vector3d(dx, dy, 0);
            var matrix = Matrix3d.Displacement(displacement);

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, OpenMode.ForWrite);
                    ent.TransformBy(matrix);
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Moved {ids.Count} entities by ({dx}, {dy})" };
        }

        private object RotateEntities(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);
            double baseX = GetDouble(args, "baseX");
            double baseY = GetDouble(args, "baseY");
            double angle  = GetDouble(args, "angle");

            var matrix = Matrix3d.Rotation(Deg2Rad(angle), Vector3d.ZAxis, new Point3d(baseX, baseY, 0));

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, OpenMode.ForWrite);
                    ent.TransformBy(matrix);
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Rotated {ids.Count} entities by {angle}°" };
        }

        private object ScaleEntities(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);
            double baseX = GetDouble(args, "baseX");
            double baseY = GetDouble(args, "baseY");
            double factor = GetDouble(args, "factor", 1.0);

            var matrix = Matrix3d.Scaling(factor, new Point3d(baseX, baseY, 0));

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, OpenMode.ForWrite);
                    ent.TransformBy(matrix);
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Scaled {ids.Count} entities by {factor}" };
        }

        private object CopyEntities(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);
            double dx = GetDouble(args, "deltaX");
            double dy = GetDouble(args, "deltaY");

            var displacement = new Vector3d(dx, dy, 0);
            var matrix = Matrix3d.Displacement(displacement);
            var newHandles = new List<string>();

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, OpenMode.ForRead);
                    var clone = (Entity)ent.Clone();
                    clone.TransformBy(matrix);
                    btr.AppendEntity(clone);
                    tr.AddNewlyCreatedDBObject(clone, true);
                    newHandles.Add(clone.Handle.Value.ToString("X"));
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Copied {ids.Count} entities", newHandles };
        }

        private object MirrorEntities(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);
            double ax1 = GetDouble(args, "axisX1");
            double ay1 = GetDouble(args, "axisY1");
            double ax2 = GetDouble(args, "axisX2");
            double ay2 = GetDouble(args, "axisY2");
            bool eraseSource = GetBool(args, "eraseSource");

            var mirrorLine = new Line3d(new Point3d(ax1, ay1, 0), new Point3d(ax2, ay2, 0));
            var matrix = Matrix3d.Mirroring(mirrorLine);
            var newHandles = new List<string>();

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, eraseSource ? OpenMode.ForWrite : OpenMode.ForRead);
                    var clone = (Entity)ent.Clone();
                    clone.TransformBy(matrix);
                    btr.AppendEntity(clone);
                    tr.AddNewlyCreatedDBObject(clone, true);
                    newHandles.Add(clone.Handle.Value.ToString("X"));
                    if (eraseSource) ent.Erase();
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Mirrored {ids.Count} entities", newHandles };
        }

        private object OffsetEntity(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");
            double distance = GetDouble(args, "distance", 1.0);

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var curve = tr.GetObject(objId, OpenMode.ForRead) as Curve;
                if (curve == null)
                    return new { status = "error", message = "Entity is not a curve" };

                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var offsetCurves = curve.GetOffsetCurves(distance);
                var newHandles = new List<string>();
                foreach (Entity e in offsetCurves)
                {
                    btr.AppendEntity(e);
                    tr.AddNewlyCreatedDBObject(e, true);
                    newHandles.Add(e.Handle.Value.ToString("X"));
                }

                tr.Commit();
                return new { status = "success", message = $"Created {newHandles.Count} offset curves", newHandles };
            }
        }

        private object EraseEntities(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, OpenMode.ForWrite);
                    ent.Erase();
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Erased {ids.Count} entities" };
        }

        private object ChangeLayer(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);
            string layerName = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, OpenMode.ForWrite);
                    ent.Layer = layerName;
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Changed {ids.Count} entities to layer {layerName}" };
        }

        private object ChangeColor(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var ids = ResolveHandles(args);
            int colorIndex = GetInt(args, "color", 7);

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                foreach (var id in ids)
                {
                    var ent = (Entity)tr.GetObject(id, OpenMode.ForWrite);
                    ent.Color = Autodesk.AutoCAD.Colors.Color.FromColorIndex(ColorMethod.ByAci, (short)colorIndex);
                }
                tr.Commit();
            }

            return new { status = "success", message = $"Changed {ids.Count} entities to color index {colorIndex}" };
        }

        // ═══════════════════════════════════════════════════════════════════
        //  BLOCK MANAGEMENT
        // ═══════════════════════════════════════════════════════════════════

        private object ListBlocks()
        {
            var db = ActiveDb;
            var blocks = new List<object>();

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                BlockTable bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                foreach (ObjectId id in bt)
                {
                    BlockTableRecord btrec = (BlockTableRecord)tr.GetObject(id, OpenMode.ForRead);
                    if (btrec.IsAnonymous || btrec.IsLayout) continue;

                    int refCount = 0;
                    var refs = btrec.GetBlockReferenceIds(true, false);
                    refCount = refs?.Count ?? 0;

                    blocks.Add(new
                    {
                        name = btrec.Name,
                        isFromExternalRef = btrec.IsFromExternalReference,
                        referenceCount = refCount,
                        origin = new { x = btrec.Origin.X, y = btrec.Origin.Y }
                    });
                }
            }

            return new { status = "success", blocks };
        }

        private object ExplodeBlock(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var br = tr.GetObject(objId, OpenMode.ForWrite) as BlockReference;
                if (br == null)
                    return new { status = "error", message = "Not a block reference" };

                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var exploded = new DBObjectCollection();
                br.Explode(exploded);

                var newHandles = new List<string>();
                foreach (Entity e in exploded)
                {
                    btr.AppendEntity(e);
                    tr.AddNewlyCreatedDBObject(e, true);
                    newHandles.Add(e.Handle.Value.ToString("X"));
                }

                br.Erase();
                tr.Commit();

                return new { status = "success", message = $"Exploded block into {newHandles.Count} entities", newHandles };
            }
        }

        private object GetBlockAttributes(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var br = tr.GetObject(objId, OpenMode.ForRead) as BlockReference;
                if (br == null)
                    return new { status = "error", message = "Not a block reference" };

                var attrs = new List<object>();
                foreach (ObjectId attId in br.AttributeCollection)
                {
                    var attRef = (AttributeReference)tr.GetObject(attId, OpenMode.ForRead);
                    attrs.Add(new { tag = attRef.Tag, value = attRef.TextString });
                }

                return new { status = "success", blockName = br.Name, attributes = attrs };
            }
        }

        private object SetBlockAttribute(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");
            string tag = GetString(args, "tag");
            string value = GetString(args, "value");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var br = tr.GetObject(objId, OpenMode.ForRead) as BlockReference;
                if (br == null)
                    return new { status = "error", message = "Not a block reference" };

                foreach (ObjectId attId in br.AttributeCollection)
                {
                    var attRef = (AttributeReference)tr.GetObject(attId, OpenMode.ForWrite);
                    if (attRef.Tag.Equals(tag, StringComparison.OrdinalIgnoreCase))
                    {
                        attRef.TextString = value;
                        tr.Commit();
                        return new { status = "success", message = $"Attribute '{tag}' set to '{value}'" };
                    }
                }

                return new { status = "error", message = $"Attribute tag '{tag}' not found" };
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  DIMENSIONS
        // ═══════════════════════════════════════════════════════════════════

        private object AddLinearDimension(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double x1 = GetDouble(args, "x1");
            double y1 = GetDouble(args, "y1");
            double x2 = GetDouble(args, "x2");
            double y2 = GetDouble(args, "y2");
            double dimLineOffset = GetDouble(args, "offset", 1.0);
            string orientation = GetString(args, "orientation", "auto");
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                double rotation = 0;
                Point3d dimLinePoint;

                if (orientation.Equals("V", StringComparison.OrdinalIgnoreCase) || orientation == "vertical")
                {
                    rotation = Math.PI / 2;
                    dimLinePoint = new Point3d(x1 + dimLineOffset, (y1 + y2) / 2, 0);
                }
                else if (orientation.Equals("H", StringComparison.OrdinalIgnoreCase) || orientation == "horizontal")
                {
                    rotation = 0;
                    dimLinePoint = new Point3d((x1 + x2) / 2, y1 + dimLineOffset, 0);
                }
                else // auto
                {
                    if (Math.Abs(x2 - x1) >= Math.Abs(y2 - y1))
                    {
                        rotation = 0;
                        dimLinePoint = new Point3d((x1 + x2) / 2, Math.Min(y1, y2) - Math.Abs(dimLineOffset), 0);
                    }
                    else
                    {
                        rotation = Math.PI / 2;
                        dimLinePoint = new Point3d(Math.Max(x1, x2) + Math.Abs(dimLineOffset), (y1 + y2) / 2, 0);
                    }
                }

                var dim = new RotatedDimension(rotation,
                    new Point3d(x1, y1, 0),
                    new Point3d(x2, y2, 0),
                    dimLinePoint,
                    "", db.Dimstyle);

                if (!string.IsNullOrEmpty(layer)) dim.Layer = layer;

                btr.AppendEntity(dim);
                tr.AddNewlyCreatedDBObject(dim, true);
                tr.Commit();

                return new { status = "success", handle = dim.Handle.Value.ToString("X"), measurement = dim.Measurement };
            }
        }

        private object AddAlignedDimension(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double x1 = GetDouble(args, "x1");
            double y1 = GetDouble(args, "y1");
            double x2 = GetDouble(args, "x2");
            double y2 = GetDouble(args, "y2");
            double offset = GetDouble(args, "offset", 1.0);
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                // Perpendicular offset for dim line
                double dx = x2 - x1, dy = y2 - y1;
                double len = Math.Sqrt(dx * dx + dy * dy);
                double nx = -dy / len * offset, ny = dx / len * offset;
                var dimLinePoint = new Point3d((x1 + x2) / 2 + nx, (y1 + y2) / 2 + ny, 0);

                var dim = new AlignedDimension(
                    new Point3d(x1, y1, 0),
                    new Point3d(x2, y2, 0),
                    dimLinePoint, "", db.Dimstyle);

                if (!string.IsNullOrEmpty(layer)) dim.Layer = layer;

                btr.AppendEntity(dim);
                tr.AddNewlyCreatedDBObject(dim, true);
                tr.Commit();

                return new { status = "success", handle = dim.Handle.Value.ToString("X"), measurement = dim.Measurement };
            }
        }

        private object AddRadialDimension(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");
            double leaderLength = GetDouble(args, "leaderLength", 2.0);
            string layer = GetString(args, "layer");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var ent = tr.GetObject(objId, OpenMode.ForRead);

                Point3d center;
                double radius;

                switch (ent)
                {
                    case Circle c:
                        center = c.Center; radius = c.Radius; break;
                    case Arc a:
                        center = a.Center; radius = a.Radius; break;
                    default:
                        return new { status = "error", message = "Entity must be a Circle or Arc" };
                }

                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var chordPoint = new Point3d(center.X + radius, center.Y, 0);
                var dim = new RadialDimension(center, chordPoint, leaderLength, "", db.Dimstyle);
                if (!string.IsNullOrEmpty(layer)) dim.Layer = layer;

                btr.AppendEntity(dim);
                tr.AddNewlyCreatedDBObject(dim, true);
                tr.Commit();

                return new { status = "success", handle = dim.Handle.Value.ToString("X"), measurement = dim.Measurement };
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  ANNOTATIONS
        // ═══════════════════════════════════════════════════════════════════

        private object CreateLeader(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var pointsArr = GetArray(args, "points");
            string text = GetString(args, "text", "");
            string layer = GetString(args, "layer");

            if (pointsArr == null || pointsArr.Count < 2)
                return new { status = "error", message = "At least 2 points needed" };

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var leader = new Leader();
                foreach (JObject p in pointsArr)
                {
                    leader.AppendVertex(new Point3d(p.Value<double>("x"), p.Value<double>("y"), 0));
                }
                leader.HasArrowHead = true;
                if (!string.IsNullOrEmpty(layer)) leader.Layer = layer;

                btr.AppendEntity(leader);
                tr.AddNewlyCreatedDBObject(leader, true);

                if (!string.IsNullOrEmpty(text))
                {
                    var lastPt = pointsArr.Last as JObject;
                    double tx = lastPt?.Value<double>("x") ?? 0;
                    double ty = lastPt?.Value<double>("y") ?? 0;

                    var mtext = new MText();
                    mtext.Location = new Point3d(tx + 0.3, ty, 0);
                    mtext.Contents = text;
                    mtext.TextHeight = 0.25;
                    if (!string.IsNullOrEmpty(layer)) mtext.Layer = layer;
                    btr.AppendEntity(mtext);
                    tr.AddNewlyCreatedDBObject(mtext, true);

                    leader.Annotation = mtext.ObjectId;
                }

                tr.Commit();
                return new { status = "success", handle = leader.Handle.Value.ToString("X") };
            }
        }

        private object CreateTable(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double x = GetDouble(args, "x");
            double y = GetDouble(args, "y");
            int rows = GetInt(args, "rows", 3);
            int cols = GetInt(args, "columns", 3);
            double rowHeight = GetDouble(args, "rowHeight", 0.8);
            double colWidth = GetDouble(args, "columnWidth", 3.0);
            string layer = GetString(args, "layer");
            var data = GetArray(args, "data");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var table = new Table();
                table.Position = new Point3d(x, y, 0);
                table.SetSize(rows, cols);
                table.SetRowHeight(rowHeight);
                table.SetColumnWidth(colWidth);
                if (!string.IsNullOrEmpty(layer)) table.Layer = layer;

                // Fill data if provided
                if (data != null)
                {
                    for (int r = 0; r < Math.Min(data.Count, rows); r++)
                    {
                        var row = data[r] as JArray;
                        if (row == null) continue;
                        for (int c = 0; c < Math.Min(row.Count, cols); c++)
                        {
                            table.Cells[r, c].TextString = row[c]?.ToString() ?? "";
                        }
                    }
                }

                btr.AppendEntity(table);
                tr.AddNewlyCreatedDBObject(table, true);
                tr.Commit();

                return new { status = "success", handle = table.Handle.Value.ToString("X") };
            }
        }

        private object UpdateText(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string handle = GetString(args, "handle");
            string newText = GetString(args, "text");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var objId = HandleToObjectId(db, handle);
                var ent = tr.GetObject(objId, OpenMode.ForWrite);

                switch (ent)
                {
                    case DBText t:
                        t.TextString = newText;
                        break;
                    case MText mt:
                        mt.Contents = newText;
                        break;
                    default:
                        return new { status = "error", message = "Entity is not a text object" };
                }

                tr.Commit();
                return new { status = "success", message = "Text updated" };
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  LAYER MANAGEMENT
        // ═══════════════════════════════════════════════════════════════════

        private object SetLayerProperties(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string name = GetString(args, "name");
            var db = ActiveDb;

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                LayerTable lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
                if (!lt.Has(name))
                    return new { status = "error", message = $"Layer '{name}' not found" };

                LayerTableRecord ltr = (LayerTableRecord)tr.GetObject(lt[name], OpenMode.ForWrite);

                if (args.ContainsKey("color"))
                    ltr.Color = Autodesk.AutoCAD.Colors.Color.FromColorIndex(ColorMethod.ByAci, (short)GetInt(args, "color"));
                if (args.ContainsKey("isOff"))
                    ltr.IsOff = GetBool(args, "isOff");
                if (args.ContainsKey("isFrozen"))
                    ltr.IsFrozen = GetBool(args, "isFrozen");
                if (args.ContainsKey("isLocked"))
                    ltr.IsLocked = GetBool(args, "isLocked");
                if (args.ContainsKey("lineWeight") && Enum.TryParse<LineWeight>(GetString(args, "lineWeight"), true, out var lw))
                    ltr.LineWeight = lw;

                tr.Commit();
                return new { status = "success", message = $"Layer '{name}' properties updated" };
            }
        }

        private object DeleteLayer(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string name = GetString(args, "name");

            if (name == "0" || name.Equals("Defpoints", StringComparison.OrdinalIgnoreCase))
                return new { status = "error", message = "Cannot delete layer '0' or 'Defpoints'" };

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                LayerTable lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForWrite);
                if (!lt.Has(name))
                    return new { status = "error", message = $"Layer '{name}' not found" };

                LayerTableRecord ltr = (LayerTableRecord)tr.GetObject(lt[name], OpenMode.ForWrite);
                ltr.Erase();
                tr.Commit();
                return new { status = "success", message = $"Layer '{name}' deleted" };
            }
        }

        private object SetCurrentLayer(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string name = GetString(args, "name");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                LayerTable lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
                if (!lt.Has(name))
                    return new { status = "error", message = $"Layer '{name}' not found" };

                db.Clayer = lt[name];
                tr.Commit();
                return new { status = "success", message = $"Current layer set to '{name}'" };
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  DOCUMENT OPERATIONS
        // ═══════════════════════════════════════════════════════════════════

        private object SaveDrawing(Dictionary<string, object>? args)
        {
            string path = GetString(args, "path");
            var db = ActiveDb;

            if (string.IsNullOrEmpty(path))
            {
                db.Save();
                return new { status = "success", message = "Drawing saved" };
            }
            else
            {
                db.SaveAs(path, DwgVersion.Current);
                return new { status = "success", message = $"Drawing saved as {path}" };
            }
        }

        private object ZoomExtents()
        {
            var doc = ActiveDoc;
            doc.SendStringToExecute("._ZOOM _E ", true, false, false);
            return new { status = "success", message = "Zoom extents queued" };
        }

        private object Undo(Dictionary<string, object>? args)
        {
            int count = GetInt(args, "count", 1);
            var doc = ActiveDoc;
            doc.SendStringToExecute($"._UNDO {count} ", true, false, false);
            return new { status = "success", message = $"Undo {count} queued" };
        }

        // ═══════════════════════════════════════════════════════════════════
        //  ADVANCED OPERATIONS
        // ═══════════════════════════════════════════════════════════════════

        private object CreateRegion(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            var handlesArr = GetArray(args, "handles");
            if (handlesArr == null || handlesArr.Count == 0)
                return new { status = "error", message = "handles array is required" };

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var curves = new DBObjectCollection();
                foreach (var h in handlesArr)
                {
                    var oid = HandleToObjectId(db, h.ToString()!);
                    var ent = tr.GetObject(oid, OpenMode.ForRead) as Curve;
                    if (ent != null) curves.Add(ent);
                }

                if (curves.Count == 0)
                    return new { status = "error", message = "No valid curves found" };

                var regions = Region.CreateFromCurves(curves);
                if (regions.Count == 0)
                    return new { status = "error", message = "Could not create region from provided curves (ensure they form a closed boundary)" };

                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                string? layer = GetString(args, "layer");
                var handles = new List<string>();
                foreach (Region reg in regions)
                {
                    if (!string.IsNullOrEmpty(layer)) reg.Layer = layer;
                    btr.AppendEntity(reg);
                    tr.AddNewlyCreatedDBObject(reg, true);
                    handles.Add(reg.Handle.Value.ToString("X"));
                }

                tr.Commit();
                return new { status = "success", handles, count = handles.Count };
            }
        }

        private object TrimEntity(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            // Trim is interactive in AutoCAD - we use SendStringToExecute with handles
            string entityHandle = GetString(args, "handle");
            var cuttingHandlesArr = GetArray(args, "cuttingEdges");
            if (string.IsNullOrEmpty(entityHandle))
                return new { status = "error", message = "handle is required" };

            var doc = ActiveDoc;
            var db = ActiveDb;

            // Build selection: select cutting edges first, then the entity to trim
            string cmdStr = "._TRIM ";
            if (cuttingHandlesArr != null && cuttingHandlesArr.Count > 0)
            {
                // Select cutting edges by handle
                using (Transaction tr = db.TransactionManager.StartTransaction())
                {
                    foreach (var h in cuttingHandlesArr)
                    {
                        var oid = HandleToObjectId(db, h.ToString()!);
                        var ent = tr.GetObject(oid, OpenMode.ForRead) as Entity;
                        if (ent != null)
                        {
                            var mid = new Point3d(
                                (ent.GeometricExtents.MinPoint.X + ent.GeometricExtents.MaxPoint.X) / 2,
                                (ent.GeometricExtents.MinPoint.Y + ent.GeometricExtents.MaxPoint.Y) / 2, 0);
                            // Use fence selection at midpoint
                        }
                    }
                    tr.Commit();
                }
            }

            // Fallback: use SendStringToExecute approach
            doc.SendStringToExecute($"._TRIM  {entityHandle}\n\n", true, false, false);
            return new { status = "success", message = "Trim command queued" };
        }

        private object ExtendEntity(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string entityHandle = GetString(args, "handle");
            if (string.IsNullOrEmpty(entityHandle))
                return new { status = "error", message = "handle is required" };

            var doc = ActiveDoc;
            doc.SendStringToExecute($"._EXTEND  {entityHandle}\n\n", true, false, false);
            return new { status = "success", message = "Extend command queued" };
        }

        private object AddAngularDimension(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            double cx = GetDouble(args, "centerX");
            double cy = GetDouble(args, "centerY");
            double x1 = GetDouble(args, "x1");
            double y1 = GetDouble(args, "y1");
            double x2 = GetDouble(args, "x2");
            double y2 = GetDouble(args, "y2");
            double offset = GetDouble(args, "offset", 1.5);
            string? layer = GetString(args, "layer");

            // Build the angular vectors
            var center = new Point3d(cx, cy, 0);
            var pt1 = new Point3d(x1, y1, 0);
            var pt2 = new Point3d(x2, y2, 0);

            // Compute arc point for dimension placement
            var midAngle = (Math.Atan2(y1 - cy, x1 - cx) + Math.Atan2(y2 - cy, x2 - cx)) / 2;
            var arcPt = new Point3d(cx + offset * Math.Cos(midAngle), cy + offset * Math.Sin(midAngle), 0);

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var dim = new Point3AngularDimension(center, pt1, pt2, arcPt, "", ObjectId.Null);
                if (!string.IsNullOrEmpty(layer)) dim.Layer = layer;

                btr.AppendEntity(dim);
                tr.AddNewlyCreatedDBObject(dim, true);
                tr.Commit();

                return new { status = "success", handle = dim.Handle.Value.ToString("X") };
            }
        }

        private object AutoDimensionRoom(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            // Room bounding box coordinates
            double x1 = GetDouble(args, "x1");
            double y1 = GetDouble(args, "y1");
            double x2 = GetDouble(args, "x2");
            double y2 = GetDouble(args, "y2");
            double offset = GetDouble(args, "offset", 1.0);
            string? layer = GetString(args, "layer", "DIMENSIONS");

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var btr = (BlockTableRecord)tr.GetObject(
                    ((BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead))[BlockTableRecord.ModelSpace],
                    OpenMode.ForWrite);

                var handles = new List<string>();

                // Bottom (horizontal)
                var dimBottom = new AlignedDimension(
                    new Point3d(x1, y1, 0), new Point3d(x2, y1, 0),
                    new Point3d((x1 + x2) / 2, y1 - offset, 0), "", ObjectId.Null);
                if (!string.IsNullOrEmpty(layer)) dimBottom.Layer = layer;
                btr.AppendEntity(dimBottom);
                tr.AddNewlyCreatedDBObject(dimBottom, true);
                handles.Add(dimBottom.Handle.Value.ToString("X"));

                // Top (horizontal)
                var dimTop = new AlignedDimension(
                    new Point3d(x1, y2, 0), new Point3d(x2, y2, 0),
                    new Point3d((x1 + x2) / 2, y2 + offset, 0), "", ObjectId.Null);
                if (!string.IsNullOrEmpty(layer)) dimTop.Layer = layer;
                btr.AppendEntity(dimTop);
                tr.AddNewlyCreatedDBObject(dimTop, true);
                handles.Add(dimTop.Handle.Value.ToString("X"));

                // Left (vertical)
                var dimLeft = new AlignedDimension(
                    new Point3d(x1, y1, 0), new Point3d(x1, y2, 0),
                    new Point3d(x1 - offset, (y1 + y2) / 2, 0), "", ObjectId.Null);
                if (!string.IsNullOrEmpty(layer)) dimLeft.Layer = layer;
                btr.AppendEntity(dimLeft);
                tr.AddNewlyCreatedDBObject(dimLeft, true);
                handles.Add(dimLeft.Handle.Value.ToString("X"));

                // Right (vertical)
                var dimRight = new AlignedDimension(
                    new Point3d(x2, y1, 0), new Point3d(x2, y2, 0),
                    new Point3d(x2 + offset, (y1 + y2) / 2, 0), "", ObjectId.Null);
                if (!string.IsNullOrEmpty(layer)) dimRight.Layer = layer;
                btr.AppendEntity(dimRight);
                tr.AddNewlyCreatedDBObject(dimRight, true);
                handles.Add(dimRight.Handle.Value.ToString("X"));

                tr.Commit();

                double width = Math.Abs(x2 - x1);
                double height = Math.Abs(y2 - y1);
                return new
                {
                    status = "success",
                    handles,
                    dimensions = new { width = Math.Round(width, 3), height = Math.Round(height, 3), area = Math.Round(width * height, 2) }
                };
            }
        }

        private object CreateBlockDefinition(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string blockName = GetString(args, "name");
            var handlesArr = GetArray(args, "handles");
            double baseX = GetDouble(args, "baseX", 0);
            double baseY = GetDouble(args, "baseY", 0);

            if (string.IsNullOrEmpty(blockName))
                return new { status = "error", message = "Block name is required" };
            if (handlesArr == null || handlesArr.Count == 0)
                return new { status = "error", message = "handles array is required" };

            var db = ActiveDb;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                var bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForWrite);

                if (bt.Has(blockName))
                    return new { status = "error", message = $"Block '{blockName}' already exists" };

                // Create new BTR
                var newBtr = new BlockTableRecord { Name = blockName, Origin = new Point3d(baseX, baseY, 0) };
                bt.Add(newBtr);
                tr.AddNewlyCreatedDBObject(newBtr, true);

                // Clone entities into block definition
                var modelSpace = (BlockTableRecord)tr.GetObject(bt[BlockTableRecord.ModelSpace], OpenMode.ForWrite);
                int cloned = 0;
                foreach (var h in handlesArr)
                {
                    var oid = HandleToObjectId(db, h.ToString()!);
                    var ent = tr.GetObject(oid, OpenMode.ForWrite) as Entity;
                    if (ent != null)
                    {
                        var clone = ent.Clone() as Entity;
                        if (clone != null)
                        {
                            // Translate to base point
                            clone.TransformBy(Matrix3d.Displacement(new Vector3d(-baseX, -baseY, 0)));
                            newBtr.AppendEntity(clone);
                            tr.AddNewlyCreatedDBObject(clone, true);
                            cloned++;
                        }
                    }
                }

                tr.Commit();
                return new { status = "success", blockName, entitiesCloned = cloned };
            }
        }

        private object PurgeDrawing()
        {
            var db = ActiveDb;
            int totalPurged = 0;

            // Purge iteratively until nothing more can be purged
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                for (int pass = 0; pass < 5; pass++)
                {
                    var ids = new ObjectIdCollection();

                    // Collect purgeable items from block table
                    var bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                    foreach (ObjectId id in bt)
                    {
                        if (!id.IsErased) ids.Add(id);
                    }

                    // Collect from layer table
                    var lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
                    foreach (ObjectId id in lt)
                    {
                        if (!id.IsErased) ids.Add(id);
                    }

                    // Collect from linetype table
                    var ltt = (LinetypeTable)tr.GetObject(db.LinetypeTableId, OpenMode.ForRead);
                    foreach (ObjectId id in ltt)
                    {
                        if (!id.IsErased) ids.Add(id);
                    }

                    // Collect from text style table
                    var tst = (TextStyleTable)tr.GetObject(db.TextStyleTableId, OpenMode.ForRead);
                    foreach (ObjectId id in tst)
                    {
                        if (!id.IsErased) ids.Add(id);
                    }

                    // Collect from dim style table
                    var dst = (DimStyleTable)tr.GetObject(db.DimStyleTableId, OpenMode.ForRead);
                    foreach (ObjectId id in dst)
                    {
                        if (!id.IsErased) ids.Add(id);
                    }

                    db.Purge(ids);
                    if (ids.Count == 0) break;

                    foreach (ObjectId id in ids)
                    {
                        var obj = tr.GetObject(id, OpenMode.ForWrite);
                        obj.Erase();
                        totalPurged++;
                    }
                }
                tr.Commit();
            }

            return new { status = "success", purgedItems = totalPurged };
        }
    }
}
