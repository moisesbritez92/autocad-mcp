using System;
using System.Collections.Generic;
using Autodesk.AutoCAD.ApplicationServices;
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
                case "create_line":
                    return CreateLine(request.Args);
                case "get_layers":
                    return GetLayers();
                case "create_layer":
                    return CreateLayer(request.Args);
                default:
                    throw new ArgumentException($"Unknown command: {request.Command}");
            }
        }

        private object CreateLine(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));

            // Extract coordinates
            // Expecting startX, startY, endX, endY
            double x1 = Convert.ToDouble(args["startX"]);
            double y1 = Convert.ToDouble(args["startY"]);
            double x2 = Convert.ToDouble(args["endX"]);
            double y2 = Convert.ToDouble(args["endY"]);

            var doc = Application.DocumentManager.MdiActiveDocument;
            var db = doc.Database;

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                BlockTable bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                BlockTableRecord btr = (BlockTableRecord)tr.GetObject(bt[BlockTableRecord.ModelSpace], OpenMode.ForWrite);

                Line line = new Line(new Point3d(x1, y1, 0), new Point3d(x2, y2, 0));
                
                btr.AppendEntity(line);
                tr.AddNewlyCreatedDBObject(line, true);

                tr.Commit();
                
                return new { status = "success", handle = line.Handle.Value.ToString() };
            }
        }

        private object GetLayers()
        {
            var doc = Application.DocumentManager.MdiActiveDocument;
            var db = doc.Database;
            var layers = new List<string>();

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                LayerTable lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
                foreach (ObjectId id in lt)
                {
                    LayerTableRecord ltr = (LayerTableRecord)tr.GetObject(id, OpenMode.ForRead);
                    layers.Add(ltr.Name);
                }
            }
            return new { layers = layers };
        }

        private object CreateLayer(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string name = args["name"]?.ToString() ?? "NewLayer";

            var doc = Application.DocumentManager.MdiActiveDocument;
            var db = doc.Database;

            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                LayerTable lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForWrite);
                if (!lt.Has(name))
                {
                    LayerTableRecord ltr = new LayerTableRecord();
                    ltr.Name = name;
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
    }
}
