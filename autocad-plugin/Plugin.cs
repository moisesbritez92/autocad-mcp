using System;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using Autodesk.AutoCAD.Runtime;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.EditorInput;
using Newtonsoft.Json;
using System.IO;

[assembly: ExtensionApplication(typeof(AutoCAD.MCP.Plugin.Plugin))]
[assembly: CommandClass(typeof(AutoCAD.MCP.Plugin.Commands))]

namespace AutoCAD.MCP.Plugin
{
    public class Plugin : IExtensionApplication
    {
        private HttpServer? _server;

        public void Initialize()
        {
            try
            {
                var doc = Application.DocumentManager.MdiActiveDocument;
                doc?.Editor.WriteMessage("\n[MCP] Initializing AutoCAD MCP Plugin...");

                _server = new HttpServer("http://localhost:12345/");
                _server.Start();

                doc?.Editor.WriteMessage("\n[MCP] Server listening on http://localhost:12345/");
            }
            catch (System.Exception ex)
            {
                Application.DocumentManager.MdiActiveDocument?.Editor.WriteMessage($"\n[MCP] Error starting server: {ex.Message}");
            }
        }

        public void Terminate()
        {
            if (_server != null)
            {
                _server.Stop();
                _server = null;
            }
        }
    }

    public class Commands
    {
        [CommandMethod("MCP_STATUS")]
        public void McpStatus()
        {
            var doc = Application.DocumentManager.MdiActiveDocument;
            doc?.Editor.WriteMessage("\n[MCP] Plugin is loaded and running.");
        }
    }
}
