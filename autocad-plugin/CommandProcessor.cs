using System;
using System.Collections.Generic;
using System.IO;
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
                case "insert_block":
                    return InsertBlock(request.Args);
                case "run_command":
                    return RunCommand(request.Args);
                case "run_lsp_script":
                    return RunLspScript(request.Args);
                default:
                    throw new ArgumentException($"Unknown command: {request.Command}");
            }
        }

        private object RunCommand(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string command = args["command"]?.ToString() ?? "";
            
            var doc = Application.DocumentManager.MdiActiveDocument;
            
            // SendStringToExecute is async and "fire and forget" from the API perspective,
            // but it queues the command for the command line.
            // Note: This doesn't return the output of the command.
            doc.SendStringToExecute($"{command} ", true, false, false);
            
            return new { status = "success", message = "Command queued" };
        }

        private object RunLspScript(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            string lspPath = args["lspPath"]?.ToString() ?? "";

            if (string.IsNullOrWhiteSpace(lspPath))
                return new { status = "error", message = "lspPath is required" };

            // Normalise path separators for AutoLISP (forward slashes)
            string lispPath = lspPath.Replace('\\', '/');

            if (!File.Exists(lspPath))
                return new { status = "error", message = $"LSP file not found: {lspPath}" };

            var doc = Application.DocumentManager.MdiActiveDocument;
            if (doc == null)
                return new { status = "error", message = "No active AutoCAD document" };

            // (load "path") is the standard AutoLISP way to execute a script file.
            // SendStringToExecute queues it on the command thread, respecting the document lock.
            doc.SendStringToExecute($"(load \"{lispPath}\") ", true, false, false);

            return new { status = "success", message = $"LSP queued for execution: {lspPath}" };
        }

        private object InsertBlock(Dictionary<string, object>? args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            
            string blockName = args["blockName"]?.ToString() ?? "";
            string blockPath = args.ContainsKey("blockPath") ? args["blockPath"]?.ToString() : null;
            double x = Convert.ToDouble(args["x"]);
            double y = Convert.ToDouble(args["y"]);
            double scale = args.ContainsKey("scale") ? Convert.ToDouble(args["scale"]) : 1.0;
            double rotation = args.ContainsKey("rotation") ? Convert.ToDouble(args["rotation"]) : 0.0;
            
            var doc = Application.DocumentManager.MdiActiveDocument;
            var db = doc.Database;

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
                    // Import block from file
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
                    br.Rotation = rotation * (Math.PI / 180.0); // Convert degrees to radians if input is degrees

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
